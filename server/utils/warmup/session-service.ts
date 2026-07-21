/**
 * CRUD-сервис для WarmupSession.
 *
 * - createSessionForAccount: генерирует план и сохраняет (с проверкой дедупа по dayKey).
 * - cancelSession: переводит planned/running → cancelled.
 * - listSessions / getSession / listSessionsForAccount: чтение.
 *
 * Дедупликация: на тот же socialAccountId+dayKey НЕ должно быть двух planned/running записей.
 * При попытке создать дубль — 409 с указанием existingSessionId. Если replace=true,
 * существующая planned-запись удаляется и создаётся новая.
 */

import type { Prisma, WarmupSession, WarmupSessionStatus } from "~~/app/generated/prisma/client"
import type { WarmupSessionDto, WarmupSessionListResponse } from "~~/shared/types/warmup"
import { prisma } from "../prisma"
import { classifyAccountAge } from "./age-classifier"
import { loadKeywordPoolForAccount } from "./keyword-pool"
import {
  buildDayKey,
  buildSeed,
  generateWarmupPlan,
  type GenerateWarmupPlanInput,
} from "./planner"
import { toSessionDto } from "./dto"

export interface CreateSessionInput {
  socialAccountId: number
  /** Время запланированного запуска. Default — сейчас. */
  scheduledAt?: Date
  /** Если есть planned/running на тот же dayKey — удалить и создать новый. Default false. */
  replace?: boolean
  /** Опциональный override длительности (минуты). */
  targetDurationMinutes?: number
  /** ID пользователя-инициатора (для аудита). */
  createdById?: number | null
}

export interface PreviewSessionInput {
  socialAccountId: number
  scheduledAt?: Date
  targetDurationMinutes?: number
}

const ACTIVE_STATUSES: WarmupSessionStatus[] = ["planned", "running"]

interface AccountSnapshot {
  id: number
  appId: number
  platform: "tiktok" | "instagram" | "youtube"
  createdAt: Date
  totalPostsPublished: number
  app: { language: string | null }
}

async function loadAccount(socialAccountId: number): Promise<AccountSnapshot> {
  const account = await prisma.socialAccount.findUnique({
    where: { id: socialAccountId },
    select: {
      id: true,
      appId: true,
      platform: true,
      createdAt: true,
      totalPostsPublished: true,
      app: { select: { language: true } },
    },
  })
  if (!account) {
    throw createError({
      statusCode: 404,
      message: `SocialAccount #${socialAccountId} не найден`,
    })
  }
  return account
}

function resolveScheduledAt(scheduledAt?: Date): Date {
  return scheduledAt ?? new Date()
}

function resolveTargetDurationSec(minutes?: number): number | undefined {
  if (minutes === undefined || minutes === null) return undefined
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) {
    throw createError({
      statusCode: 400,
      message: "targetDurationMinutes должно быть в диапазоне 1..120",
    })
  }
  return Math.round(minutes * 60)
}

/**
 * Подготовка контекста (аккаунт, bucket, language, keyword pool) — переиспользуется
 * preview и schedule.
 */
async function buildPlannerContext(
  account: AccountSnapshot,
  scheduledAt: Date,
  targetDurationSecOverride?: number,
): Promise<GenerateWarmupPlanInput> {
  const ageBucket = classifyAccountAge({
    createdAt: account.createdAt,
    totalPostsPublished: account.totalPostsPublished,
    now: scheduledAt,
  })

  const language = (account.app.language || "en").toLowerCase()
  const commentLanguage = language === "ru" ? "ru" : "en"

  const keywordPool = await loadKeywordPoolForAccount({
    appId: account.appId,
    language: commentLanguage,
    platform: account.platform,
  })

  return {
    socialAccountId: account.id,
    platform: account.platform,
    ageBucket,
    scheduledAt,
    keywordPool,
    commentLanguage,
    targetDurationSecOverride,
  }
}

export async function previewSessionForAccount(opts: PreviewSessionInput) {
  const account = await loadAccount(opts.socialAccountId)
  const scheduledAt = resolveScheduledAt(opts.scheduledAt)
  const override = resolveTargetDurationSec(opts.targetDurationMinutes)
  const ctx = await buildPlannerContext(account, scheduledAt, override)
  const plan = generateWarmupPlan(ctx)
  return {
    plan,
    dayKey: buildDayKey(scheduledAt),
    seed: buildSeed(account.id, scheduledAt),
    ageBucket: ctx.ageBucket,
  }
}

export async function createSessionForAccount(
  opts: CreateSessionInput,
): Promise<WarmupSession> {
  const account = await loadAccount(opts.socialAccountId)
  const scheduledAt = resolveScheduledAt(opts.scheduledAt)
  const override = resolveTargetDurationSec(opts.targetDurationMinutes)
  const dayKey = buildDayKey(scheduledAt)

  const existingActive = await prisma.warmupSession.findFirst({
    where: {
      socialAccountId: account.id,
      dayKey,
      status: { in: ACTIVE_STATUSES },
    },
    select: { id: true, status: true },
  })

  if (existingActive) {
    if (!opts.replace) {
      throw createError({
        statusCode: 409,
        message: `На дату ${dayKey} уже есть warmup-сессия (#${existingActive.id}, статус ${existingActive.status}). Используйте replace=true для замены.`,
        data: { existingSessionId: existingActive.id, status: existingActive.status, dayKey },
      })
    }
    if (existingActive.status === "running") {
      throw createError({
        statusCode: 409,
        message: `Сессия #${existingActive.id} уже выполняется и не может быть заменена. Дождитесь завершения или отмените вручную.`,
        data: { existingSessionId: existingActive.id, status: existingActive.status },
      })
    }
    // Удаляем planned-запись
    await prisma.warmupSession.delete({ where: { id: existingActive.id } })
  }

  const ctx = await buildPlannerContext(account, scheduledAt, override)
  const plan = generateWarmupPlan(ctx)

  const session = await prisma.warmupSession.create({
    data: {
      socialAccountId: account.id,
      status: "planned",
      scheduledAt,
      dayKey,
      seed: plan.meta.seed,
      ageBucket: ctx.ageBucket,
      plan: plan as unknown as Prisma.InputJsonValue,
      createdById: opts.createdById ?? null,
    },
  })

  return session
}

export async function cancelSession(
  sessionId: string,
): Promise<WarmupSession> {
  const session = await prisma.warmupSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true },
  })
  if (!session) {
    throw createError({ statusCode: 404, message: `WarmupSession ${sessionId} не найдена` })
  }
  if (session.status !== "planned") {
    throw createError({
      statusCode: 409,
      message: `Можно отменить только planned-сессии. Текущий статус: ${session.status}`,
      data: { status: session.status },
    })
  }
  return prisma.warmupSession.update({
    where: { id: sessionId },
    data: { status: "cancelled", finishedAt: new Date() },
  })
}

/**
 * Полное удаление сессии из БД.
 *
 * Разрешено только для terminal-статусов (planned/cancelled/failed).
 * running и completed нельзя удалять, чтобы не потерять историю выполнения
 * и не оборвать активный runner.
 */
const DELETABLE_STATUSES: WarmupSessionStatus[] = ["planned", "cancelled", "failed"]

export async function deleteSession(sessionId: string): Promise<void> {
  const session = await prisma.warmupSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true },
  })
  if (!session) {
    throw createError({ statusCode: 404, message: `WarmupSession ${sessionId} не найдена` })
  }
  if (!DELETABLE_STATUSES.includes(session.status)) {
    throw createError({
      statusCode: 409,
      message: `Удалять можно только сессии в статусах: ${DELETABLE_STATUSES.join(", ")}. Текущий: ${session.status}`,
      data: { status: session.status },
    })
  }
  await prisma.warmupSession.delete({ where: { id: sessionId } })
}

export interface ListSessionsFilters {
  socialAccountId?: number
  status?: WarmupSessionStatus | WarmupSessionStatus[]
  from?: Date
  to?: Date
  limit?: number
  offset?: number
}

export async function listSessions(
  filters: ListSessionsFilters,
): Promise<WarmupSessionListResponse> {
  const where: Prisma.WarmupSessionWhereInput = {}
  if (filters.socialAccountId) where.socialAccountId = filters.socialAccountId
  if (filters.status) {
    where.status = Array.isArray(filters.status)
      ? { in: filters.status }
      : filters.status
  }
  if (filters.from || filters.to) {
    where.scheduledAt = {}
    if (filters.from) where.scheduledAt.gte = filters.from
    if (filters.to) where.scheduledAt.lte = filters.to
  }
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
  const offset = Math.max(filters.offset ?? 0, 0)

  const [items, total] = await Promise.all([
    prisma.warmupSession.findMany({
      where,
      orderBy: { scheduledAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        socialAccount: {
          select: { id: true, displayName: true, platform: true, appId: true },
        },
      },
    }),
    prisma.warmupSession.count({ where }),
  ])

  return {
    items: items.map(toSessionDto),
    total,
  }
}

export async function getSession(sessionId: string): Promise<WarmupSessionDto> {
  const session = await prisma.warmupSession.findUnique({
    where: { id: sessionId },
    include: {
      socialAccount: {
        select: { id: true, displayName: true, platform: true, appId: true },
      },
    },
  })
  if (!session) {
    throw createError({ statusCode: 404, message: `WarmupSession ${sessionId} не найдена` })
  }
  return toSessionDto(session)
}

export async function listSessionsForAccount(
  socialAccountId: number,
  opts: { limit?: number; offset?: number } = {},
): Promise<WarmupSessionListResponse> {
  return listSessions({
    socialAccountId,
    limit: opts.limit ?? 20,
    offset: opts.offset ?? 0,
  })
}
