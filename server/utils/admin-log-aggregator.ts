/**
 * Аггрегатор журналов для /admin/logs.
 *
 * Тянет 8 разных таблиц в общий формат AdminLogEntry. Чтобы поддерживать
 * пагинацию через объединённую ленту, каждый источник вытягивает первые
 * `take = page*limit + buffer` записей (новейшие), потом merge-sort по
 * createdAt desc и slice по нужной странице.
 *
 * Это compromise: при росте таблиц до миллионов строк подход придётся
 * переписать на keyset cursor. Сейчас (десятки тысяч строк суммарно)
 * это работает быстро благодаря индексам по createdAt в каждой таблице.
 */

import type {
  AdminLogEntry,
  AdminLogLevel,
  AdminLogSource,
  AdminLogsResponse,
} from "../../shared/types/admin-log"
import { ADMIN_LOG_SOURCES_ALL } from "../../shared/types/admin-log"

interface AggregatorQuery {
  sources: AdminLogSource[]
  level?: AdminLogLevel
  /** true — только нерешённые (применяется к agent), 'all' — все. */
  resolvedFilter: "all" | "true" | "false"
  /** Поиск по message (case-insensitive contains). */
  q?: string
  page: number
  limit: number
}

/**
 * Сколько брать из каждого источника при объединении нескольких.
 * Берём с запасом, чтобы page*limit-я запись после merge-sort
 * не оказалась обрезанной из-за неравномерного распределения по времени.
 */
const PER_SOURCE_BUFFER = 200

export async function aggregateAdminLogs(
  q: AggregatorQuery,
): Promise<AdminLogsResponse> {
  const selected = q.sources.length > 0 ? q.sources : ADMIN_LOG_SOURCES_ALL
  const takePerSource = q.page * q.limit + PER_SOURCE_BUFFER
  const isSelected = (s: AdminLogSource) => selected.includes(s)

  // Запрашиваем все 8 источников всегда, чтобы карточки сводки были стабильной
  // навигацией (не «обнулялись» при выборе одного источника). Для невыбранных
  // findMany не делается — take=0 возвращает пустой массив, count выполняется.
  // Уровень/q/resolved-фильтр всё ещё применяется к count, чтобы цифры
  // соответствовали тому, что юзер увидит после клика на карточку.
  const tasks = ADMIN_LOG_SOURCES_ALL.map((src) =>
    fetchSource(src, {
      level: q.level,
      resolvedFilter: q.resolvedFilter,
      q: q.q,
      take: isSelected(src) ? takePerSource : 0,
    }),
  )

  const results = await Promise.all(tasks)

  const merged: AdminLogEntry[] = results
    .filter((r) => isSelected(r.source))
    .flatMap((r) => r.entries)
  merged.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  // total для пагинации — только по выбранным источникам.
  const total = results
    .filter((r) => isSelected(r.source))
    .reduce((sum, r) => sum + r.total, 0)

  const offset = (q.page - 1) * q.limit
  const sliced = merged.slice(offset, offset + q.limit)

  // sourceCounts — по всем 8, независимо от выбранного фильтра sources.
  const sourceCounts = ADMIN_LOG_SOURCES_ALL.reduce(
    (acc, s) => {
      acc[s] = 0
      return acc
    },
    {} as Record<AdminLogSource, number>,
  )
  for (const r of results) {
    sourceCounts[r.source] = r.total
  }

  return {
    data: sliced,
    meta: {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
      sourceCounts,
    },
  }
}

interface SourceResult {
  source: AdminLogSource
  entries: AdminLogEntry[]
  total: number
}

interface FetchOpts {
  level?: AdminLogLevel
  resolvedFilter: "all" | "true" | "false"
  q?: string
  take: number
}

async function fetchSource(
  source: AdminLogSource,
  opts: FetchOpts,
): Promise<SourceResult> {
  switch (source) {
    case "agent":
      return fetchAgent(opts)
    case "app_enrichment":
      return fetchAppEnrichment(opts)
    case "secret_access":
      return fetchSecretAccess(opts)
    case "telegram_command":
      return fetchTelegramCommand(opts)
    case "trendwatcher_run":
      return fetchTrendwatcherRun(opts)
    case "webhook":
      return fetchWebhook(opts)
    case "ai_audit":
      return fetchAiAudit(opts)
    case "posting_job":
      return fetchPostingJob(opts)
  }
}

// ---------- helpers

function ciContains(field: string, q?: string): Record<string, unknown> | null {
  if (!q || !q.trim()) return null
  return { [field]: { contains: q.trim(), mode: "insensitive" } }
}

function levelFilter(level?: AdminLogLevel) {
  return level ? { level } : null
}

// ---------- AgentLog

async function fetchAgent(opts: FetchOpts): Promise<SourceResult> {
  const where: Record<string, unknown> = {}
  if (opts.level) where.level = opts.level
  if (opts.resolvedFilter === "true") where.resolved = true
  if (opts.resolvedFilter === "false") where.resolved = false
  const search = ciContains("message", opts.q)
  if (search) Object.assign(where, search)

  const [rows, total] = await Promise.all([
    prisma.agentLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.take,
      include: { cycle: { select: { id: true, status: true, appId: true } } },
    }),
    prisma.agentLog.count({ where }),
  ])

  const entries: AdminLogEntry[] = rows.map((r) => ({
    id: `agent:${r.id}`,
    source: "agent",
    level: r.level as AdminLogLevel,
    module: r.module,
    message: r.message,
    details: r.details ?? undefined,
    resolved: r.resolved,
    rawId: r.id,
    ref: r.cycleId
      ? {
          type: "cycle",
          id: r.cycleId,
          href: `/admin/cycles/${r.cycleId}`,
          label: `Цикл #${r.cycleId}`,
        }
      : undefined,
    createdAt: r.createdAt.toISOString(),
  }))

  return { source: "agent", entries, total }
}

// ---------- AppEnrichmentLog

async function fetchAppEnrichment(opts: FetchOpts): Promise<SourceResult> {
  const where: Record<string, unknown> = {}
  // Маппинг status → level
  if (opts.level === "error") where.status = "failed"
  if (opts.level === "warn") where.status = "partial"
  if (opts.level === "info") where.status = "success"
  if (opts.q && opts.q.trim()) {
    where.OR = [
      { sourceUrl: { contains: opts.q.trim(), mode: "insensitive" } },
      { errorMessage: { contains: opts.q.trim(), mode: "insensitive" } },
    ]
  }

  const [rows, total] = await Promise.all([
    prisma.appEnrichmentLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.take,
    }),
    prisma.appEnrichmentLog.count({ where }),
  ])

  const entries: AdminLogEntry[] = rows.map((r) => ({
    id: `app_enrichment:${r.id}`,
    source: "app_enrichment",
    level:
      r.status === "failed"
        ? "error"
        : r.status === "partial"
          ? "warn"
          : "info",
    module: "app-enrichment",
    message:
      r.errorMessage ?? `[${r.platform}] ${r.status} — ${r.sourceUrl}`,
    details: {
      platform: r.platform,
      status: r.status,
      sourceUrl: r.sourceUrl,
      parsedData: r.parsedData,
      aiContext: r.aiContext,
      rawPayload: r.rawPayload,
    },
    rawId: r.id,
    ref: {
      type: "app",
      id: r.appId,
      href: `/admin/apps/${r.appId}`,
      label: `Приложение #${r.appId}`,
    },
    createdAt: r.createdAt.toISOString(),
  }))

  return { source: "app_enrichment", entries, total }
}

// ---------- SecretAccessLog

async function fetchSecretAccess(opts: FetchOpts): Promise<SourceResult> {
  // SecretAccessLog не имеет level — все записи трактуем как info.
  if (opts.level && opts.level !== "info") {
    return { source: "secret_access", entries: [], total: 0 }
  }
  const where: Record<string, unknown> = {}
  if (opts.q && opts.q.trim()) {
    where.OR = [
      { entityType: { contains: opts.q.trim(), mode: "insensitive" } },
      { reason: { contains: opts.q.trim(), mode: "insensitive" } },
      { action: { contains: opts.q.trim(), mode: "insensitive" } },
    ]
  }

  const [rows, total] = await Promise.all([
    prisma.secretAccessLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.take,
      include: { user: { select: { id: true, email: true, name: true } } },
    }),
    prisma.secretAccessLog.count({ where }),
  ])

  const entries: AdminLogEntry[] = rows.map((r) => ({
    id: `secret_access:${r.id}`,
    source: "secret_access",
    level: "info",
    module: "secret-access",
    message: `${r.user?.email ?? `user#${r.userId}`} → ${r.action} ${r.entityType}#${r.entityId}${r.reason ? ` (${r.reason})` : ""}`,
    details: {
      userId: r.userId,
      userEmail: r.user?.email,
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
      reason: r.reason,
      clientIp: r.clientIp,
      userAgent: r.userAgent,
    },
    rawId: r.id,
    createdAt: r.createdAt.toISOString(),
  }))

  return { source: "secret_access", entries, total }
}

// ---------- TelegramCommandAudit

async function fetchTelegramCommand(opts: FetchOpts): Promise<SourceResult> {
  const where: Record<string, unknown> = {}
  if (opts.level === "error") {
    where.resultStatus = { in: ["error", "unauthorized"] }
  } else if (opts.level === "warn") {
    where.resultStatus = "not_found"
  } else if (opts.level === "info") {
    where.resultStatus = "success"
  }
  if (opts.q && opts.q.trim()) {
    where.OR = [
      { command: { contains: opts.q.trim(), mode: "insensitive" } },
      { parsedArgs: { contains: opts.q.trim(), mode: "insensitive" } },
      { errorMessage: { contains: opts.q.trim(), mode: "insensitive" } },
    ]
  }

  const [rows, total] = await Promise.all([
    prisma.telegramCommandAudit.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.take,
    }),
    prisma.telegramCommandAudit.count({ where }),
  ])

  const entries: AdminLogEntry[] = rows.map((r) => {
    const userLabel = r.telegramUsername
      ? `@${r.telegramUsername}`
      : r.telegramUserId
        ? `tg#${r.telegramUserId}`
        : `chat ${r.chatId}`
    return {
      id: `telegram_command:${r.id}`,
      source: "telegram_command" as const,
      level:
        r.resultStatus === "error" || r.resultStatus === "unauthorized"
          ? ("error" as AdminLogLevel)
          : r.resultStatus === "not_found"
            ? ("warn" as AdminLogLevel)
            : ("info" as AdminLogLevel),
      module: "telegram",
      message: `${userLabel} → /${r.command}${r.parsedArgs ? ` ${r.parsedArgs}` : ""} → ${r.resultStatus}${r.errorMessage ? ` — ${r.errorMessage}` : ""}`,
      details: {
        chatId: r.chatId,
        telegramUserId: r.telegramUserId,
        telegramUsername: r.telegramUsername,
        command: r.command,
        parsedArgs: r.parsedArgs,
        resultStatus: r.resultStatus,
        relatedEntityType: r.relatedEntityType,
        relatedEntityId: r.relatedEntityId,
        errorMessage: r.errorMessage,
      },
      rawId: r.id,
      ref: {
        type: "telegram_chat",
        id: r.chatId,
        label: `Chat ${r.chatId}`,
      },
      createdAt: r.createdAt.toISOString(),
    }
  })

  return { source: "telegram_command", entries, total }
}

// ---------- TrendwatcherRunLog

async function fetchTrendwatcherRun(opts: FetchOpts): Promise<SourceResult> {
  const where: Record<string, unknown> = {}
  if (opts.level) where.level = opts.level
  const search = ciContains("message", opts.q)
  if (search) Object.assign(where, search)

  const [rows, total] = await Promise.all([
    prisma.trendwatcherRunLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.take,
    }),
    prisma.trendwatcherRunLog.count({ where }),
  ])

  const entries: AdminLogEntry[] = rows.map((r) => ({
    id: `trendwatcher_run:${r.id}`,
    source: "trendwatcher_run",
    level: r.level as AdminLogLevel,
    module: "trendwatcher",
    message: `[run #${r.runId}${r.step ? ` · ${r.step}` : ""}] ${r.message}`,
    details: r.payload ?? undefined,
    rawId: r.id,
    ref: {
      type: "trendwatcher_run",
      id: r.runId,
      label: `Run #${r.runId}`,
    },
    createdAt: r.createdAt.toISOString(),
  }))

  return { source: "trendwatcher_run", entries, total }
}

// ---------- WebhookLog

async function fetchWebhook(opts: FetchOpts): Promise<SourceResult> {
  const where: Record<string, unknown> = {}
  if (opts.level === "error") where.statusCode = { gte: 400 }
  else if (opts.level === "warn") where.statusCode = { gte: 300, lt: 400 }
  else if (opts.level === "info") where.statusCode = { lt: 300 }
  if (opts.q && opts.q.trim()) {
    where.OR = [
      { errorMsg: { contains: opts.q.trim(), mode: "insensitive" } },
      { sourceIp: { contains: opts.q.trim(), mode: "insensitive" } },
    ]
  }

  const [rows, total] = await Promise.all([
    prisma.webhookLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.take,
    }),
    prisma.webhookLog.count({ where }),
  ])

  const entries: AdminLogEntry[] = rows.map((r) => ({
    id: `webhook:${r.id}`,
    source: "webhook",
    level:
      r.statusCode >= 400
        ? "error"
        : r.statusCode >= 300
          ? "warn"
          : "info",
    module: "webhook",
    message: `Pipeline #${r.pipelineId}${r.runId ? ` (run #${r.runId})` : ""} ← ${r.sourceIp ?? "?"} → ${r.statusCode}${r.errorMsg ? ` — ${r.errorMsg}` : ""}`,
    details: {
      pipelineId: r.pipelineId,
      runId: r.runId,
      sourceIp: r.sourceIp,
      userAgent: r.userAgent,
      statusCode: r.statusCode,
      errorMsg: r.errorMsg,
      payload: r.payload,
    },
    rawId: r.id,
    ref: {
      type: "pipeline",
      id: r.pipelineId,
      href: `/pipeline/${r.pipelineId}`,
      label: `Pipeline #${r.pipelineId}`,
    },
    createdAt: r.createdAt.toISOString(),
  }))

  return { source: "webhook", entries, total }
}

// ---------- AiAuditLog

async function fetchAiAudit(opts: FetchOpts): Promise<SourceResult> {
  const where: Record<string, unknown> = {}
  if (opts.level === "warn") where.status = "dismissed"
  else if (opts.level === "info") where.status = { in: ["suggested", "applied", "partial"] }
  // error не применяется (нет такого статуса)
  else if (opts.level === "error") return { source: "ai_audit", entries: [], total: 0 }

  if (opts.q && opts.q.trim()) {
    where.OR = [
      { action: { contains: opts.q.trim(), mode: "insensitive" } },
      { prompt: { contains: opts.q.trim(), mode: "insensitive" } },
      { model: { contains: opts.q.trim(), mode: "insensitive" } },
    ]
  }

  const [rows, total] = await Promise.all([
    prisma.aiAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.take,
    }),
    prisma.aiAuditLog.count({ where }),
  ])

  // AiAuditLog не имеет relation на ZavodUser (только userId — Int?).
  // balance_v2: userId стал nullable для background pipeline calls — фильтруем
  // null перед батч-запросом юзеров.
  const userIds = Array.from(
    new Set(rows.map((r) => r.userId).filter((id): id is number => id !== null)),
  )
  const users =
    userIds.length > 0
      ? await prisma.zavodUser.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true },
        })
      : []
  const userEmailById = new Map(users.map((u) => [u.id, u.email]))

  const entries: AdminLogEntry[] = rows.map((r) => ({
    id: `ai_audit:${r.id}`,
    source: "ai_audit",
    level: r.status === "dismissed" ? "warn" : "info",
    module: `ai-${r.action}`,
    message: `${r.userId === null ? "system" : (userEmailById.get(r.userId) ?? `user#${r.userId}`)} · ${r.action}${r.nodeType ? ` (${r.nodeType})` : ""} · ${r.model} → ${r.status}`,
    details: {
      userId: r.userId,
      action: r.action,
      nodeType: r.nodeType,
      pipelineId: r.pipelineId,
      nodeCanvasId: r.nodeCanvasId,
      model: r.model,
      prompt: r.prompt,
      suggestions: r.suggestions,
      blockedFields: r.blockedFields,
      rejectedFields: r.rejectedFields,
      appliedFields: r.appliedFields,
      status: r.status,
    },
    rawId: r.id,
    ref: r.pipelineId
      ? {
          type: "pipeline",
          id: r.pipelineId,
          href: `/pipeline/${r.pipelineId}`,
          label: `Pipeline #${r.pipelineId}`,
        }
      : undefined,
    createdAt: r.createdAt.toISOString(),
  }))

  return { source: "ai_audit", entries, total }
}

// ---------- PostingJobLog

async function fetchPostingJob(opts: FetchOpts): Promise<SourceResult> {
  const where: Record<string, unknown> = {}
  if (opts.level) where.level = opts.level
  const search = ciContains("message", opts.q)
  if (search) Object.assign(where, search)

  const [rows, total] = await Promise.all([
    prisma.postingJobLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.take,
    }),
    prisma.postingJobLog.count({ where }),
  ])

  const entries: AdminLogEntry[] = rows.map((r) => ({
    id: `posting_job:${r.id}`,
    source: "posting_job",
    level: r.level as AdminLogLevel,
    module: "posting-job",
    message: r.message,
    details: r.data ?? undefined,
    rawId: r.id,
    ref: {
      type: "posting_job",
      id: r.jobId,
      href: `/posting-jobs?jobId=${r.jobId}`,
      label: `Job ${r.jobId.slice(0, 8)}`,
    },
    createdAt: r.createdAt.toISOString(),
  }))

  return { source: "posting_job", entries, total }
}
