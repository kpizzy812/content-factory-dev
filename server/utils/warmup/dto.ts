/**
 * Мапперы Prisma → DTO для warmup-сущностей.
 *
 * Сериализация Date → ISO string. Json-поля приводим к структурным типам
 * (без runtime-валидации — runner и planner пишут консистентно).
 */

import type {
  WarmupKeywordPool,
  WarmupSession,
  Platform,
} from "~~/app/generated/prisma/client"
import type {
  AccountAgeBucket,
  WarmupExecutionLog,
  WarmupKeywordPoolDto,
  WarmupPlan,
  WarmupPlatform,
  WarmupSessionDto,
} from "~~/shared/types/warmup"

interface SessionWithRelations extends WarmupSession {
  socialAccount?: {
    id: number
    displayName: string
    platform: Platform
    appId: number
  } | null
}

export function toSessionDto(session: SessionWithRelations): WarmupSessionDto {
  return {
    id: session.id,
    socialAccountId: session.socialAccountId,
    status: session.status,
    scheduledAt: session.scheduledAt.toISOString(),
    dayKey: session.dayKey,
    seed: session.seed,
    ageBucket: session.ageBucket as AccountAgeBucket,
    plan: session.plan as unknown as WarmupPlan,
    executedActions: (session.executedActions as unknown as WarmupExecutionLog[] | null) ?? null,
    startedAt: session.startedAt ? session.startedAt.toISOString() : null,
    finishedAt: session.finishedAt ? session.finishedAt.toISOString() : null,
    errorMessage: session.errorMessage,
    createdById: session.createdById,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    socialAccount: session.socialAccount
      ? {
          id: session.socialAccount.id,
          displayName: session.socialAccount.displayName,
          platform: session.socialAccount.platform as WarmupPlatform,
          appId: session.socialAccount.appId,
        }
      : null,
  }
}

export function toKeywordPoolDto(pool: WarmupKeywordPool): WarmupKeywordPoolDto {
  return {
    id: pool.id,
    name: pool.name,
    appId: pool.appId,
    language: pool.language,
    category: pool.category,
    platform: pool.platform as WarmupPlatform | null,
    keywords: pool.keywords,
    hashtags: pool.hashtags,
    isActive: pool.isActive,
    createdById: pool.createdById,
    createdAt: pool.createdAt.toISOString(),
    updatedAt: pool.updatedAt.toISOString(),
  }
}
