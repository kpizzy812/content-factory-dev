/**
 * Account-level readiness для quick-glance бейджа (4-точечный чек-лист).
 *
 * Лёгкая версия useYoutubePreflight без caption/video — учитывает только:
 *   1. proxy       — proxyId + status='healthy'
 *   2. device      — deviceProfileId присутствует
 *   3. deep_check  — косвенный сигнал: loginCheckedAt ≤ 7д (deep-check не персистится,
 *                    но регулярный login-check означает что Indigo session + proxy
 *                    работают на уровне реального Chromium)
 *   4. login       — loginCheckedStatus === true и loginCheckedAt ≤ 7д
 *
 * Используется AccountReadinessBadge и AccountReadinessTab. НЕ делает $fetch —
 * читает всё из переданного account-объекта (родитель уже имеет его).
 */
import { computed, type Ref } from "vue"
import type {
  AccountReadinessCheck,
  AccountReadinessState,
} from "~~/shared/types/posting-youtube"
import type { AccountDeepCheckStatus } from "~~/shared/types/deep-proxy-check"
import type { LoginCheckResult } from "~~/shared/types/login-check"
import type { PreflightAccount } from "./useYoutubePreflight"

const LOGIN_RECENT_DAYS = 7

function isRecent(checkedAt: string | null | undefined, maxDays: number): boolean {
  if (!checkedAt) return false
  const checkedTime = new Date(checkedAt).getTime()
  if (Number.isNaN(checkedTime)) return false
  const ageMs = Date.now() - checkedTime
  return ageMs < maxDays * 24 * 60 * 60 * 1000
}

function formatRelative(iso: string): string {
  const ageMs = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ageMs)) return "?"
  const minutes = Math.floor(ageMs / 60_000)
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.floor(hours / 24)
  return `${days} д назад`
}

/**
 * @param account — основные данные SocialAccount
 * @param deepCheckStatus — опциональный Ref на AccountDeepCheckStatus от
 *   GET /api/accounts/:id/deep-check-status. Если передан — composable использует
 *   реальные данные ProxyDeepCheckLog для check deep_check (leak/stale).
 *   Если не передан — legacy mode (косвенный сигнал через loginCheckedAt ≤ 7д).
 *
 *   Legacy mode используется AccountReadinessBadge в карточках списка (где нет
 *   смысла делать N+1 fetch'ей). AccountReadinessTab передаёт реальный status.
 */
export function useAccountReadiness(
  account: Ref<PreflightAccount | null>,
  deepCheckStatus?: Ref<AccountDeepCheckStatus | null>,
  liveLoginResult?: Ref<LoginCheckResult | null>,
) {
  const state = computed<AccountReadinessState>(() => {
    const a = account.value
    if (!a) {
      return {
        checks: [],
        score: 0,
        total: 4,
        ready: false,
        loading: true,
      }
    }

    const usesBrowser = a.postingMethod === "browser_automation"
    const proxyOk = !!a.proxyId && a.proxy?.status === "healthy"
    const indigoOk = !usesBrowser || !!a.deviceProfileId
    const loginRecent = isRecent(a.loginCheckedAt, LOGIN_RECENT_DAYS)

    // Live-результат login-check имеет приоритет: transient (Indigo CDP отвалился
    // при валидном snapshot) и confirmed считаем за login ok — иначе временный
    // сбой ложно красит «Вход подтверждён» + «Прокси работает в браузере»
    // (deepCheckOk наследует loginOk в legacy-режиме).
    const live = liveLoginResult?.value
    const liveForThisAccount = live != null && live.accountId === a.id
    const liveLoginOk
      = liveForThisAccount
      && (live!.outcome === "confirmed" || live!.outcome === "transient")
    // login-check заморожен на миграцию DuoPlus: статус в БД не пишется
    // (loginCheckedStatus всегда null), endpoint - заглушка. Для browser-аккаунта
    // без live-результата это заморозка, а НЕ «не залогинен».
    const loginFrozen
      = usesBrowser && !liveForThisAccount && a.loginCheckedStatus == null
    // Строгий сигнал входа (для метки и legacy deep_check): заморозка ≠ вход.
    const loginConfirmed
      = !usesBrowser
      || liveLoginOk
      || (a.loginCheckedStatus === true && loginRecent)

    // Deep-check проверка — два режима:
    //   1. Real mode (deepCheckStatus передан): leak → fail, никогда/stale → fail,
    //      ok+свежий → pass. Это точная проверка из ProxyDeepCheckLog.
    //   2. Legacy mode (deepCheckStatus undefined): косвенный сигнал — если
    //      login-check недавно прошёл, считаем что реальный Chromium-flow работает.
    //      Используется AccountReadinessBadge в карточках списка (избегаем N+1).
    const deepStatus = deepCheckStatus?.value
    let deepCheckOk: boolean
    let deepCheckDetail: string | undefined
    let deepCheckFrozen = false
    if (!usesBrowser) {
      deepCheckOk = true
      deepCheckDetail = "Не требуется для API метода"
    } else if (deepStatus !== undefined && deepStatus !== null) {
      // Real mode.
      if (deepStatus.leaking) {
        deepCheckOk = false
        deepCheckDetail = "LEAK! Прокси не работает в Chromium — постинг ОТМЕНЁН"
      } else if (!deepStatus.last) {
        deepCheckOk = false
        deepCheckDetail = "Никогда не запускался"
      } else if (deepStatus.stale) {
        deepCheckOk = false
        deepCheckDetail = `Устарел (последний ${formatRelative(deepStatus.last.createdAt)})`
      } else if (!deepStatus.last.proxyActuallyWorking) {
        deepCheckOk = false
        deepCheckDetail = "Последняя проверка показала ошибку"
      } else {
        deepCheckOk = true
        deepCheckDetail = `Подтверждено ${formatRelative(deepStatus.last.createdAt)}`
      }
    } else if (loginFrozen) {
      // Legacy deep_check выводился из login-check, который заморожен миграцией
      // DuoPlus → вывести нельзя. Помечаем замороженным (не провал, не блокирует).
      deepCheckOk = false
      deepCheckFrozen = true
      deepCheckDetail = "Заморожен на миграцию DuoPlus (device-проверка позже)"
    } else {
      // Legacy mode.
      deepCheckOk = loginConfirmed && loginRecent
      deepCheckDetail = loginRecent
        ? "Подтверждено login-check'ом (косвенно)"
        : "Требуется свежий check"
    }

    const checks: AccountReadinessCheck[] = [
      {
        key: "proxy",
        label: "Прокси healthy",
        passed: proxyOk,
        detail: a.proxy
          ? `${a.proxy.label} · ${a.proxy.status}`
          : a.proxyId
            ? "Прокси привязан, но статус неизвестен"
            : "Прокси не привязан",
      },
      {
        key: "indigo",
        label: "Профиль устройства",
        passed: indigoOk,
        detail: usesBrowser
          ? a.deviceProfileId
            ? a.deviceProfileId.slice(0, 8) + "…"
            : "Не привязан"
          : "Не требуется для API метода",
      },
      {
        key: "deep_check",
        label: "Прокси работает на устройстве",
        passed: deepCheckOk,
        detail: deepCheckDetail,
        frozen: deepCheckFrozen,
      },
      {
        key: "login",
        label: loginFrozen
          ? "Login-check заморожен (миграция DuoPlus)"
          : "Вход в платформу подтвержден",
        passed: loginConfirmed,
        frozen: loginFrozen,
        detail: !usesBrowser
          ? "Не требуется для API метода"
          : loginFrozen
            ? "Проверка сессии на устройстве будет позже. Постинг разрешен."
            : liveForThisAccount && live!.outcome === "transient"
              ? "Временный сбой - аккаунт не разлогинен (воркер повторит)"
              : liveForThisAccount && live!.outcome === "confirmed"
                ? `@${live!.username ?? a.loginCheckedUsername ?? "?"} (live)`
                : a.loginCheckedStatus === true
                  ? loginRecent
                    ? `@${a.loginCheckedUsername ?? "?"} (свежий)`
                    : "Устарел (>7д)"
                  : a.loginCheckedStatus === false
                    ? "Не залогинен"
                    : "Не проверен",
      },
    ]

    // Замороженные миграцией проверки (login/deep-check) исключаем из гейта - иначе
    // browser-аккаунт вечно «не готов». Готов = все оцениваемые проверки прошли.
    const evaluable = checks.filter((c) => !c.frozen)
    const score = evaluable.filter((c) => c.passed).length
    const total = evaluable.length

    return {
      checks,
      score,
      total,
      ready: total > 0 && score === total,
      loading: false,
    }
  })

  return { state }
}
