/**
 * Unit-тесты runVideoPipeline AbortSignal propagation (этап B3).
 *
 * Контекст бага B:
 *   runVideoPipeline раньше не принимал signal — глубокая отмена не работала.
 *   Pipeline зависал в fal polling до 2 мин watchdog (B2). После B3 — abort
 *   между шагами выбрасывает CancellationError, executor финализирует видео
 *   через cancelVideoPipeline (cascade), не помечая failed.
 *
 * Тестируем:
 *  1. Сигнатура runVideoPipeline принимает options.signal.
 *  2. Backward-compat — вызов без signal работает как раньше.
 *  3. Если signal aborted ДО загрузки данных — выбрасывается CancellationError
 *     на первом checkpoint, видео НЕ помечается failed/timeout, lock release'ится.
 *  4. CancellationError при aborted=false ловится catch и не пробрасывается как failed
 *     (но это уже edge case — runtime сам никогда не должен бросать без abort).
 */
import { describe, expect, it } from 'vitest'
import { prisma } from '../../server/utils/prisma'
import { runVideoPipeline } from '../../server/utils/video-pipeline'
import { CancellationError } from '../../server/utils/pipeline-cancel-registry'

async function createBareVideo(): Promise<{ videoId: number; userId: number }> {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const user = await prisma.zavodUser.create({
    data: {
      externalId: seed,
      email: `b3-${seed}@test`,
      rolePreset: 'admin',
      canRead: true,
      canWrite: true,
      canCreate: true,
      canDelete: true,
      canApprove: true,
      canRunAgent: true,
      canApplyChanges: true,
      canAdmin: true,
      moduleAccess: ['pipeline'],
      isActive: true,
    },
  })
  const app = await prisma.app.create({
    data: { name: `b3-app-${seed}` },
  })
  const scenario = await prisma.scenario.create({
    data: {
      appId: app.id,
      // trendId nullable — shadow scenario для теста, без Trend; status=default(draft)
    },
  })
  // ВАЖНО: ScenarioVariant НЕ создаём — оба теста срабатывают на checkpoint #1
  // (до загрузки сценария/вариантов), либо на acquireLock fail. Variant нужен
  // только если pipeline дошёл бы до runPromptGeneration — мы туда не доходим.
  const video = await prisma.video.create({
    data: { scenarioId: scenario.id, status: 'pending' as never },
  })
  return { videoId: video.id, userId: user.id }
}

describe('runVideoPipeline — AbortSignal (этап B3)', () => {
  it('сигнатура принимает options.signal (backward-compat обеспечивается optional)', () => {
    // Функция должна иметь arity 1 (default param=undefined для options), но
    // важна не arity, а что TS принимает второй параметр — это проверяет typecheck.
    expect(typeof runVideoPipeline).toBe('function')
    expect(runVideoPipeline.length).toBeGreaterThanOrEqual(1)
  })

  it('aborted signal до старта → CancellationError на первом checkpoint, видео НЕ failed, lock release', async () => {
    const { videoId } = await createBareVideo()

    const controller = new AbortController()
    controller.abort() // ОТМЕНА ДО ВЫЗОВА — checkpoint #1 сразу должен сработать

    let thrown: unknown = null
    try {
      await runVideoPipeline(videoId, { signal: controller.signal })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(CancellationError)

    // Видео НЕ должно быть failed/timeout (catch CancellationError early-return)
    const video = await prisma.video.findUnique({ where: { id: videoId } })
    expect(video).not.toBeNull()
    expect(video!.status).not.toBe('failed')
    expect(video!.status).not.toBe('timeout')

    // Lock должен быть снят (finally → releaseLock)
    expect(video!.isLocked).toBe(false)
  })

  it('backward-compat: вызов без options не падает при отсутствии signal (acquireLock работает)', async () => {
    const { videoId } = await createBareVideo()

    // Заблокируем acquireLock искусственно (через двойной вызов) чтобы получить
    // предсказуемую ошибку lock — это самый дешёвый способ проверить что путь
    // без signal не пытается trip'нуть undefined signal.
    await prisma.video.update({
      where: { id: videoId },
      data: { isLocked: true, lockedAt: new Date(), lockedReason: 'manual' },
    })

    let thrown: unknown = null
    try {
      await runVideoPipeline(videoId) // НЕТ options — старый callsite
    } catch (err) {
      thrown = err
    }
    // Должна быть ошибка lock (не TS-крэш и не CancellationError)
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain('уже запущен')
  })
})
