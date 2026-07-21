/**
 * Deep Proxy Check (Уровень C) — ЗАГЛУШКА на время миграции на DuoPlus (Этап 2).
 *
 * Раньше: реальная валидация прокси через Indigo browser session + CDP
 * (открывали ifconfig.me внутри Chromium, сверяли detected IP с IP сервера).
 * Браузерная автоматизация выпилена при переходе на DuoPlus (облачный Android),
 * поэтому Level C через CDP больше недоступен. Реальная проверка переедет на
 * ADB (IP-проверка командой на устройстве) в Этапе 3.
 *
 * Контракт `deepCheckAccountProxy(accountId): Promise<DeepProxyCheckResult>`
 * сохранён, чтобы эндпоинт и UI не падали — возвращаем структурированный
 * результат с verdict «недоступно до Этапа 3». Денорм-проверки (привязан ли
 * прокси/устройство) оставлены как лёгкая полезная информация для оператора,
 * без запуска какой-либо сессии.
 */

import { prisma } from "../prisma"
import type { DeepProxyCheckResult } from "../../../shared/types/deep-proxy-check"

const STAGE3_NOTICE =
  "Level C проверка прокси (реальная сессия) недоступна до Этапа 3: браузерная " +
  "автоматизация выпилена при миграции на DuoPlus, проверка переедет на ADB-команду " +
  "на устройстве."

export async function deepCheckAccountProxy(
  accountId: number,
): Promise<DeepProxyCheckResult> {
  const startTime = Date.now()
  const result: DeepProxyCheckResult = {
    accountId,
    proxyId: null,
    deviceProfileId: null,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    steps: {
      profileStart: { ok: false, durationMs: 0 },
      cdpConnect: { ok: false, durationMs: 0 },
      pageLoad: { ok: false, durationMs: 0, url: "" },
      ipExtraction: { ok: false, durationMs: 0 },
      profileStop: { ok: false, durationMs: 0 },
    },
    result: {
      detectedIp: null,
      expectedNotToBe: null,
      isLeaking: null,
      matchesProxyExpectation: null,
    },
    verdict: {
      proxyConfiguredInIndigo: false,
      proxyActuallyWorking: false,
      recommendation: STAGE3_NOTICE,
    },
  }

  // Лёгкие denorm-проверки (без запуска сессии) — полезный контекст для UI.
  const account = await prisma.socialAccount.findUnique({
    where: { id: accountId },
    select: { id: true, proxyId: true, deviceProfileId: true },
  })
  if (account) {
    result.proxyId = account.proxyId
    result.deviceProfileId = account.deviceProfileId
  }

  result.durationMs = Date.now() - startTime
  return result
}
