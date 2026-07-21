/**
 * POST /api/accounts/:id/deep-proxy-check
 *
 * Запускает Уровень C проверку прокси через реальный Indigo browser.
 * Дорогая операция (1 Indigo session, 30-90 сек) — admin-only, per-account.
 *
 * После runtime check INSERT в ProxyDeepCheckLog (best-effort, не блокирует
 * ответ оператору при ошибке INSERT). Возвращает { result, logId } —
 * legacy shape `result` тот же, logId — новый optional для UI которые хотят
 * сразу открыть детали лога.
 *
 * См. server/utils/proxy/deep-check.ts и pre-flight memo
 * (.claude/agent-memory/architect/indigo_deep_proxy_check_preflight.md).
 */

import { deepCheckAccountProxy } from "~~/server/utils/proxy/deep-check"
import { prisma } from "~~/server/utils/prisma"

function determineOutcome(result: {
  proxyId: string | null
  result: { isLeaking: boolean | null }
  verdict: { proxyActuallyWorking: boolean }
  steps: {
    profileStart: { ok: boolean }
    cdpConnect: { ok: boolean }
    pageLoad: { ok: boolean }
    ipExtraction: { ok: boolean }
  }
}): "ok" | "leak" | "error" | "precondition_failed" {
  if (!result.proxyId) return "precondition_failed"
  if (result.result.isLeaking === true) return "leak"
  if (result.verdict.proxyActuallyWorking) return "ok"
  return "error"
}

export default defineEventHandler(async (event) => {
  const user = await requirePermission(event, "canAdmin")

  const idRaw = getRouterParam(event, "id")
  const id = Number(idRaw)
  if (!idRaw || !Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, message: "Неверный ID аккаунта" })
  }

  const result = await deepCheckAccountProxy(id)

  console.warn(
    "[deep-proxy-check]",
    JSON.stringify({
      accountId: result.accountId,
      proxyId: result.proxyId,
      deviceProfileId: result.deviceProfileId,
      durationMs: result.durationMs,
      detectedIp: result.result.detectedIp,
      detectedCountry: result.result.detectedCountry,
      isLeaking: result.result.isLeaking,
      proxyActuallyWorking: result.verdict.proxyActuallyWorking,
      stepsOk: {
        profileStart: result.steps.profileStart.ok,
        cdpConnect: result.steps.cdpConnect.ok,
        pageLoad: result.steps.pageLoad.ok,
        ipExtraction: result.steps.ipExtraction.ok,
        profileStop: result.steps.profileStop.ok,
      },
    }),
  )

  // INSERT в ProxyDeepCheckLog (best-effort). При proxyId=null не пишем —
  // precondition_failed без proxy не имеет смысла как history entry.
  let logId: string | null = null
  if (result.proxyId) {
    try {
      const outcome = determineOutcome(result)
      const finishedAt = result.durationMs
        ? new Date(new Date(result.startedAt).getTime() + result.durationMs)
        : null
      const log = await prisma.proxyDeepCheckLog.create({
        data: {
          proxyId: result.proxyId,
          socialAccountId: result.accountId,
          deviceProfileId: result.deviceProfileId,
          initiatedById: user.id,
          triggeredFrom: "manual",
          outcome,
          startedAt: new Date(result.startedAt),
          finishedAt,
          durationMs: result.durationMs,
          detectedIp: result.result.detectedIp,
          detectedCountry: result.result.detectedCountry ?? null,
          detectedCity: result.result.detectedCity ?? null,
          isLeaking: result.result.isLeaking,
          matchesProxyExpectation: result.result.matchesProxyExpectation,
          proxyActuallyWorking: result.verdict.proxyActuallyWorking,
          recommendation: result.verdict.recommendation,
          fullResult: result as never,
        },
        select: { id: true },
      })
      logId = log.id
    } catch (err) {
      // Best-effort — не блокируем response оператору.
      console.warn(
        "[deep-proxy-check] failed to persist log:",
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  return { result, logId }
})
