/**
 * Дополнительные исполнители нод конвейера:
 * HTTP Request, Code (worker_threads isolated sandbox), Set, If/Switch, Loop, Wait.
 */

import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { throwIfAborted, cancellableDelay, CancellationError } from './pipeline-cancel-registry'
import { withPassthrough, withPassthroughNoData } from './pipeline-passthrough'

export async function executeHttpRequestNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const url = String(config.url || '')

  // KILL SWITCH (инцидент 2026-06-15): нода «HTTP запрос» — единственное место,
  // где конвейер ходит на ПРОИЗВОЛЬНЫЙ внешний URL из пользовательской конфигурации.
  // Была использована для DoS чужого хоста (≈1 req/s, без какого-либо троттла на
  // исходящие). Легитимного юзкейса для внешних HTTP-запросов из конвейера нет —
  // отключаем fail-closed. Лог даёт pipelineId+URL для опознания виновного конвейера.
  // Вернуть ноду можно ТОЛЬКО осознанно через env PIPELINE_HTTP_NODE_ENABLED=true
  // (и только после того, как появится per-host троттл на исходящие).
  if (process.env.PIPELINE_HTTP_NODE_ENABLED !== 'true') {
    console.warn('[http_request] НОДА ОТКЛЮЧЕНА — исходящий запрос заблокирован', {
      pipelineId: input._pipelineId,
      runId: input._runId,
      url: url.slice(0, 200),
    })
    throw new Error('Нода «HTTP запрос» отключена администратором: внешние HTTP-запросы из конвейера запрещены.')
  }

  if (!url) throw new Error('URL не указан')

  // Validate URL — block internal/private addresses
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1', 'metadata.google.internal']
    if (blocked.includes(hostname) || hostname.endsWith('.internal') || hostname.startsWith('10.') || hostname.startsWith('192.168.') || hostname.startsWith('172.')) {
      throw new Error('Запрещённый адрес: обращение к внутренним сервисам не разрешено')
    }
  } catch (e) {
    if (e instanceof TypeError) throw new Error(`Некорректный URL: ${url}`)
    throw e
  }

  const method = String(config.method || 'GET') as 'GET' | 'POST' | 'PUT' | 'DELETE'

  let headers: Record<string, string> = {}
  if (config.headers) {
    try {
      headers = typeof config.headers === 'string' ? JSON.parse(config.headers) : config.headers as Record<string, string>
    } catch {
      throw new Error('Некорректный JSON в заголовках')
    }
  }

  // Inject credential-resolved auth headers
  if (config._authToken) {
    headers['Authorization'] = `Bearer ${config._authToken}`
  } else if (config._authApiKey) {
    headers['X-API-Key'] = String(config._authApiKey)
  }

  const body = (method === 'POST' || method === 'PUT') && config.body
    ? String(config.body)
    : undefined

  throwIfAborted(signal)

  const timeout = Math.min(Number(config.timeout) || 30000, 60000)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  // Link cancellation signal to this request's AbortController
  function onCancel() { controller.abort() }
  signal?.addEventListener('abort', onCancel, { once: true })

  try {
    const response = await $fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    })
    return { response, statusCode: 200 }
  } catch (err) {
    if (signal?.aborted) throw new CancellationError()
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`HTTP-запрос: таймаут (${timeout / 1000}с)`)
    }
    throw err
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onCancel)
  }
}

/**
 * Safe Data Transformation Node — worker_threads isolated execution.
 *
 * This is NOT arbitrary code execution. It is a restricted transformation mode
 * that only allows pure data transformations with no side effects.
 *
 * Security model:
 * - Isolated worker_threads.Worker: sync infinite loops CANNOT hang the main process
 * - Hard kill via worker.terminate() after 5-second timeout
 * - No network access, no filesystem, no database, no timers, no async
 * - No access to process, global objects, constructors, prototypes
 * - No dynamic code generation (eval, Function, import)
 * - Frozen input/config — immutable
 * - Strict whitelist of allowed globals (Math, JSON, String, etc.)
 * - Output size limit: 1MB
 * - Memory limit: 64MB per worker
 *
 * What IS allowed: map, filter, reduce, string manipulation, math, JSON transforms.
 */

/** Static forbidden patterns — validated before worker spawn. */
const CODE_FORBIDDEN_PATTERNS: Array<[RegExp, string]> = [
  [/\bprocess\b/i, 'process'],
  [/\brequire\b/i, 'require'],
  [/\bimport\b/i, 'import'],
  [/\bglobal(?:This)?\b/i, 'globalThis'],
  [/\beval\b/i, 'eval'],
  [/\bFunction\s*\(/i, 'Function constructor'],
  [/\bnew\s+Function\b/i, 'new Function'],
  [/\b__(?:dirname|filename|proto__?)\b/, '__proto__'],
  [/\bfetch\b/, 'fetch'],
  [/\bprisma\b/i, 'prisma'],
  [/\bfs\b/, 'fs'],
  [/\bchild_process\b/, 'child_process'],
  [/\bexec(?:Sync)?\s*\(/, 'exec'],
  [/\bProxy\b/, 'Proxy'],
  [/\bReflect\b/, 'Reflect'],
  [/\.constructor\s*[\[(]/, '.constructor access'],
  [/\bWindow\b/i, 'Window'],
  [/\bdocument\b/, 'document'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bSharedArrayBuffer\b/, 'SharedArrayBuffer'],
  [/\bAtomics\b/, 'Atomics'],
  [/\bsetTimeout\b/, 'setTimeout'],
  [/\bsetInterval\b/, 'setInterval'],
  [/\bsetImmediate\b/, 'setImmediate'],
  [/\bPromise\b/, 'Promise (async не поддерживается)'],
  [/\basync\b/, 'async'],
  [/\bawait\b/, 'await'],
  [/\bthis\b/, 'this'],
  [/\\u[\da-fA-F]{4}/, 'unicode escape (обфускация запрещена)'],
  [/\\x[\da-fA-F]{2}/, 'hex escape (обфускация запрещена)'],
]

const CODE_TIMEOUT_MS = 5000
const CODE_MEMORY_LIMIT_MB = 64

export async function executeCodeNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const code = String(config.code || 'return input')

  // --- Phase 1: Static analysis (before spawning worker) ---
  for (const [pattern, label] of CODE_FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      throw new Error(
        `Запрещённая конструкция: "${label}". ` +
        'Трансформация данных допускает только чистые операции с input/config: ' +
        'map, filter, reduce, строки, математика, JSON.',
      )
    }
  }

  // --- Phase 2: Code size limit ---
  if (code.length > 10_000) {
    throw new Error('Код слишком длинный (максимум 10 000 символов)')
  }

  // --- Phase 3: Execute in isolated worker thread ---
  const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'pipeline-code-worker.ts')

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: { code, input, config },
      resourceLimits: {
        maxOldGenerationSizeMb: CODE_MEMORY_LIMIT_MB,
        maxYoungGenerationSizeMb: CODE_MEMORY_LIMIT_MB / 4,
      },
    })

    const timeout = setTimeout(() => {
      worker.terminate()
      reject(new Error(
        `Таймаут выполнения трансформации (${CODE_TIMEOUT_MS / 1000}с). ` +
        'Код был принудительно остановлен. Проверьте наличие бесконечных циклов.',
      ))
    }, CODE_TIMEOUT_MS)

    worker.on('message', (msg: { success: boolean; result?: unknown; error?: string }) => {
      clearTimeout(timeout)
      worker.terminate()
      if (msg.success) {
        resolve({ output: msg.result })
      } else {
        reject(new Error(msg.error || 'Ошибка выполнения трансформации'))
      }
    })

    worker.on('error', (err) => {
      clearTimeout(timeout)
      worker.terminate()
      // Worker crash due to memory limit or other fatal error
      if (err.message.includes('resource limit')) {
        reject(new Error('Превышен лимит памяти (64МБ). Уменьшите объём обрабатываемых данных.'))
      } else {
        reject(new Error(`Ошибка выполнения: ${err.message}`))
      }
    })

    worker.on('exit', (exitCode) => {
      clearTimeout(timeout)
      if (exitCode !== 0) {
        reject(new Error('Воркер завершился аварийно. Возможна ошибка в коде трансформации.'))
      }
    })
  })
}

export async function executeSetNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields = (config.fields ?? []) as Array<{ name: string; value: unknown }>
  const overrides: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.name) overrides[field.name] = field.value
  }
  return withPassthrough(input, overrides)
}

export async function executeIfNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const field = String(config.field || '')
  const operator = String(config.operator || '==')
  const value = config.value
  const fieldValue = input?.[field]

  let passes = false
  switch (operator) {
    case '>': passes = Number(fieldValue) > Number(value); break
    case '<': passes = Number(fieldValue) < Number(value); break
    case '>=': passes = Number(fieldValue) >= Number(value); break
    case '<=': passes = Number(fieldValue) <= Number(value); break
    case '==': passes = String(fieldValue) === String(value); break
    case '!=': passes = String(fieldValue) !== String(value); break
    case 'contains': passes = String(fieldValue).includes(String(value)); break
    case 'not_contains': passes = !String(fieldValue).includes(String(value)); break
    case 'starts_with': passes = String(fieldValue).startsWith(String(value)); break
    case 'ends_with': passes = String(fieldValue).endsWith(String(value)); break
    case 'is_empty': passes = !fieldValue || String(fieldValue).trim() === ''; break
    case 'is_not_empty': passes = !!fieldValue && String(fieldValue).trim() !== ''; break
  }

  return withPassthrough(input, { _condition: passes, _conditionField: field })
}

export async function executeLoopNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const arrayField = String(config.arrayField || 'items')
  const items = (input?.[arrayField] ?? input?.items ?? []) as unknown[]
  const totalItems = items.length

  // Pass-through: loop — control-flow нода, не "съедает" данные предыдущих блоков,
  // а только аннотирует индекс/счётчик. Без этого downstream (scenario, video,
  // upload) теряет trends/scenarios/videos и валится в "Нет данных на входе".
  const overrides = { items, totalItems, currentIndex: 0 }

  if (totalItems === 0) {
    // Пустой массив → loop ставит собственный _noData. Если upstream уже сигналил,
    // withPassthroughNoData предпочтёт upstream reason как более информативный.
    return withPassthroughNoData(
      input,
      overrides,
      `Пустой массив для итерации (поле "${arrayField}")`,
    )
  }

  // items.length > 0 → НЕ маскируем upstream _noData если он есть (drift safety),
  // просто пропускаем как есть. Engine/downstream разберётся с грязным состоянием.
  return withPassthrough(input, overrides)
}

export async function executeWaitNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  throwIfAborted(signal)
  const seconds = Number(config.delaySeconds) || 5
  const maxWait = 15 * 60 // 15 minutes max
  const clampedSeconds = Math.min(seconds, maxWait)
  await cancellableDelay(clampedSeconds * 1000, signal)
  return withPassthrough(input, { _waitedSeconds: clampedSeconds })
}

/**
 * Caption Generator Node — конечное звено воронки. Получает upstream Video,
 * собирает Scenario+App контекст и через AI генерирует viral title+hashtags
 * для tiktok/youtube/instagram. Сохраняет в Caption (one per videoId+platform)
 * и возвращает captions для downstream нод (например, кастомный Upload или
 * Notification с превью).
 *
 * Idempotency: если для (videoId, platform) уже есть Caption созданный в этом
 * runStartedAt scope — переиспользуем без повторного AI-вызова.
 */
export async function executeCaptionGeneratorNode(
  config: Record<string, unknown>,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const { runCaptionGenerator } = await import('./agents/caption-generator-agent')
  const { detectUpstreamNoData, getUpstreamNoDataReason } = await import('./pipeline-executors')
  const { mapFramePassToCaptionFrameAnalyses } = await import('./agents/caption-frame-mapper')
  type SocialPlatform = import('~~/shared/types/caption').SocialPlatform

  throwIfAborted(signal)

  // ── Платформы из node config (default — все три) ──
  // Парсим один раз ДО видео-loop, чтобы invalid config упал быстро без БД-запросов.
  const rawPlatforms = Array.isArray(config.platforms) ? config.platforms : []
  const validSet: ReadonlySet<SocialPlatform> = new Set(['tiktok', 'youtube', 'instagram'] as const)
  const platforms = rawPlatforms
    .map((p) => String(p).toLowerCase())
    .filter((p): p is SocialPlatform => validSet.has(p as SocialPlatform))

  if (platforms.length === 0) {
    throw new Error('Не выбрана ни одна платформа для генерации captions (config.platforms пуст)')
  }

  const styleHints = typeof config.styleHints === 'string' ? config.styleHints : undefined
  const styleVariant = (typeof config.styleVariant === 'string'
    && ['viral', 'informative', 'storytelling'].includes(config.styleVariant)
    ? config.styleVariant
    : 'viral') as 'viral' | 'informative' | 'storytelling'

  const forceRegenerate = config.forceRegenerate === true
  const failOnNotFitsLimits = config.failOnNotFitsLimits === true
  const VALID_LANGUAGES = new Set(['auto', 'en', 'ru', 'es'])
  const language = (
    typeof config.language === 'string' && VALID_LANGUAGES.has(config.language)
      ? config.language
      : 'auto'
  ) as 'auto' | 'en' | 'ru' | 'es'

  const runId = Number(input._runId) || undefined
  const pipelineId = Number(input._pipelineId) || undefined

  // ── Upstream Video discovery: ВСЕ видео, не только первое ──
  // Источник: input.videos (Video node output, может быть массивом).
  // Fallback: input.video (legacy / single-video shape).
  const videosArr = (input.videos ?? []) as Array<{ id?: number; status?: string }>
  const singleVideo = (input.video ?? null) as { id?: number; status?: string } | null
  const stubs = videosArr.filter((v) => v && typeof v.id === 'number')
  if (stubs.length === 0 && singleVideo && typeof singleVideo.id === 'number') {
    stubs.push(singleVideo)
  }

  if (stubs.length === 0) {
    const upstreamNoData = detectUpstreamNoData(input)
    const reason = upstreamNoData
      ? `Нет видео (upstream: ${getUpstreamNoDataReason(input) ?? 'нет данных'})`
      : 'Нет upstream Video для CaptionGenerator'
    return {
      captions: {},
      skipped: true,
      reason,
      videosReceived: videosArr.length,
      _noData: true,
      _noDataReason: reason,
      _domainStatus: 'no_data',
    }
  }

  // runStartedAt — снимок один раз до loop (одинаковый для всех видео run-а)
  let runStartedAt: Date | null = null
  if (runId) {
    const run = await prisma.workflowRun.findUnique({
      where: { id: runId },
      select: { startedAt: true },
    })
    runStartedAt = run?.startedAt ?? null
  }

  // ── Per-video processor (вынесено для batch-loop) ──
  const processOne = async (
    stub: { id?: number },
  ): Promise<Record<string, unknown>> => {
    throwIfAborted(signal)
    const stubId = stub.id as number

    const video = await prisma.video.findUnique({
      where: { id: stubId },
      include: {
        scenario: {
          include: {
            variants: {
              where: { status: 'accepted' as never },
              take: 1,
              orderBy: { variantIndex: 'asc' as const },
            },
          },
        },
      },
    })

    if (!video) {
      const reason = `Video #${stubId} не найдено в БД`
      return {
        videoId: stubId,
        captions: {},
        skipped: true,
        reason,
        _noData: true,
        _noDataReason: reason,
      }
    }

    // Guard 1: терминальный статус completed
    if (video.status !== 'completed') {
      const reason = `Видео #${video.id} в статусе "${video.status}" — генерация captions пропущена`
      return {
        videoId: video.id,
        scenarioId: video.scenarioId,
        captions: {},
        skipped: true,
        reason,
        _noData: true,
        _noDataReason: reason,
      }
    }

    // КРИТИЧНО: контекст вычисляется СВОЙ для каждого видео (variant, app, frameAnalyses)
    const variant = video.scenario?.variants[0] ?? null
    const appId = video.applicationId ?? video.scenario?.appId ?? null
    const app = appId ? await prisma.app.findUnique({ where: { id: appId } }) : null
    const frameAnalyses = mapFramePassToCaptionFrameAnalyses(
      video.analysisData as import('~~/shared/types/video-analysis').VideoAnalysisFramePass | null,
    )

    // Guard 2: должен быть scenario variant ИЛИ frameAnalyses
    const hasVariantContext = !!variant && (
      !!variant.hook || !!variant.body || !!variant.cta || !!variant.fullScript || !!variant.title
    )
    const hasFrameContext = !!frameAnalyses && frameAnalyses.length > 0
    if (!hasVariantContext && !hasFrameContext) {
      const reason = 'Недостаточно контекста: нет accepted variant сценария и нет frameAnalyses (добавьте Сценарий или Анализ видео перед нодой Описаний)'
      return {
        videoId: video.id,
        scenarioId: video.scenarioId,
        captions: {},
        skipped: true,
        reason,
        _noData: true,
        _noDataReason: reason,
      }
    }

    // Idempotency check (per-video, runStartedAt одинаковый)
    if (runStartedAt && !forceRegenerate) {
      const existing = await prisma.caption.findMany({
        where: {
          videoId: video.id,
          platform: { in: platforms as never[] },
          createdAt: { gte: runStartedAt },
          ...(runId ? { runId } : {}),
        },
      })
      if (existing.length === platforms.length) {
        return {
          videoId: video.id,
          scenarioId: video.scenarioId,
          captions: Object.fromEntries(
            existing.map((c) => [c.platform, captionToOutputShape(c)]),
          ),
          idempotentReuse: true,
          skippedDuplicates: existing.length,
        }
      }
    }

    throwIfAborted(signal)
    const t0 = Date.now()
    console.log(`[caption_generator] Video ${video.id}: AI generation start (platforms=${platforms.join(',')})`)

    const result = await runCaptionGenerator({
      videoId: video.id,
      scenarioId: video.scenarioId,
      platforms,
      styleHints,
      styleVariant,
      context: {
        storyPlan: variant?.storyPlan as Record<string, unknown> | null,
        hook: variant?.hook ?? null,
        body: variant?.body ?? null,
        cta: variant?.cta ?? null,
        fullScript: variant?.fullScript ?? null,
        appName: app?.name ?? null,
        appBrandTone: app?.brandTone ?? null,
        appCorePain: app?.corePain ?? null,
        appTransformationPromise: app?.transformationPromise ?? null,
        appForbiddenClaims: app?.forbiddenClaims ?? null,
        targetPlatform: video.targetPlatform as SocialPlatform | null,
        videoDurationSec: video.duration ?? null,
        frameAnalyses,
        marketingTitle: variant?.title ?? null,
        language,
      },
    })

    let createdCount = 0
    let fitsAll = true
    for (const platform of platforms) {
      const c = result.captions[platform]
      if (!c) continue
      if (!c.fitsLimits) fitsAll = false

      const charsHashtagsTotal = c.hashtags.length === 0
        ? 0
        : c.hashtags.map((h) => `#${h}`).join(' ').length

      await prisma.caption.upsert({
        where: { videoId_platform: { videoId: video.id, platform: platform as never } },
        create: {
          videoId: video.id,
          platform: platform as never,
          title: c.title,
          description: c.description ?? null,
          hashtags: c.hashtags,
          charsTitle: c.title.length,
          charsHashtagsTotal,
          fitsLimits: c.fitsLimits,
          modelVersion: result.modelVersion,
          promptVersion: 'v1',
          ...(runId ? { runId } : {}),
          ...(pipelineId ? { pipelineId } : {}),
        },
        update: {
          title: c.title,
          description: c.description ?? null,
          hashtags: c.hashtags,
          charsTitle: c.title.length,
          charsHashtagsTotal,
          fitsLimits: c.fitsLimits,
          modelVersion: result.modelVersion,
        },
      })
      createdCount++
    }

    if (createdCount > 0 && video.isExternalCreative && video.externalSource === 'google_drive') {
      await prisma.driveFile.updateMany({
        where: { videoId: video.id },
        data: { hasGeneratedCaption: true },
      })
    }

    console.log(`[caption_generator] Video ${video.id}: ${createdCount} captions saved за ${Date.now() - t0}мс${fitsAll ? '' : ' (не уложились в лимиты)'}`)

    // Сбор violations для failOnNotFitsLimits — throw делается ПОСЛЕ loop,
    // чтобы все captions для всех видео успели persist'нуться в БД.
    let violations: string[] | undefined
    if (!fitsAll) {
      violations = []
      for (const platform of platforms) {
        const c = result.captions[platform]
        if (c && !c.fitsLimits) {
          const errs = c.validationErrors && c.validationErrors.length > 0
            ? c.validationErrors.join('; ')
            : 'превышены лимиты платформы'
          violations.push(`${platform}: ${errs}`)
        }
      }
    }

    return {
      videoId: video.id,
      scenarioId: video.scenarioId,
      captions: result.captions,
      contextUsed: result.contextUsed,
      generatedCount: createdCount,
      fitsAllLimits: fitsAll,
      generatedAt: result.generatedAt,
      ...(fitsAll ? {} : { _domainDegraded: true, failedCount: createdCount, _violations: violations }),
    }
  }

  // ── Loop по всем видео с per-video try/catch ──
  console.log(`[caption_generator] Batch start: ${stubs.length} видео`)
  const results: Array<Record<string, unknown>> = []
  let totalGenerated = 0
  let totalSkipped = 0
  let totalErrored = 0
  let totalReused = 0

  for (const stub of stubs) {
    try {
      const r = await processOne(stub)
      results.push(r)
      if (r.skipped === true) totalSkipped++
      else if (r.idempotentReuse === true) totalReused++
      else totalGenerated += Number(r.generatedCount ?? 0)
    } catch (err) {
      if (err instanceof CancellationError) throw err
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[caption_generator] Video ${stub.id} failed:`, errMsg)
      results.push({
        videoId: stub.id,
        captions: {},
        error: errMsg,
        _domainDegraded: true,
      })
      totalErrored++
    }
  }

  // failOnNotFitsLimits: throw ПОСЛЕ loop (все captions уже в БД)
  if (failOnNotFitsLimits) {
    const allViolations: string[] = []
    for (const r of results) {
      const v = r._violations as string[] | undefined
      if (v && v.length > 0) {
        allViolations.push(`Video ${r.videoId}: ${v.join(' | ')}`)
      }
    }
    if (allViolations.length > 0) {
      throw new Error(
        `AI captions не уложились в лимиты платформ (failOnNotFitsLimits=true): ${allViolations.join(' || ')}`,
      )
    }
  }

  // Чистим служебное поле _violations из results (оно нужно было только для throw выше)
  for (const r of results) delete r._violations

  // Domain status batch-уровня
  const allSkipped = totalSkipped + totalErrored === stubs.length && totalGenerated === 0 && totalReused === 0
  const hasErrorOrDegraded = totalErrored > 0 || results.some((r) => r._domainDegraded === true)
  const batchStatus = allSkipped
    ? 'no_data'
    : hasErrorOrDegraded
      ? 'domain_degraded'
      : 'success'

  console.log(`[caption_generator] Batch done: ${stubs.length} видео → generated=${totalGenerated} reused=${totalReused} skipped=${totalSkipped} errored=${totalErrored}`)

  // Backward compat: spread первого результата в верхний уровень — single-video
  // pipelines (и существующие тесты) видят прежнюю shape: videoId, captions,
  // skipped, idempotentReuse, fitsAllLimits, generatedCount, _noData и т.д.
  const first = results[0] ?? {}
  return {
    ...first,
    videos: results,
    totalVideos: stubs.length,
    totalGenerated,
    totalReused,
    totalSkipped,
    totalErrored,
    ...(batchStatus !== 'success' ? { _domainStatus: batchStatus } : {}),
    ...(batchStatus === 'no_data' ? { _noData: true, _noDataReason: String(first.reason ?? 'все видео пропущены') } : {}),
  }
}

/** Преобразует Prisma Caption в shape для downstream нод. */
function captionToOutputShape(c: {
  platform: string
  title: string
  description: string | null
  hashtags: string[]
  fitsLimits: boolean
}): Record<string, unknown> {
  return {
    platform: c.platform,
    title: c.title,
    description: c.description,
    hashtags: c.hashtags,
    fitsLimits: c.fitsLimits,
  }
}
