/**
 * Pre-flight для YouTube browser_automation постинга.
 *
 * 5 проверок per (accountId, videoId):
 *   1. video      — videoId выбран и Video.status === 'completed'
 *   2. proxy      — account.proxyId присутствует и status === 'healthy'   (BLOCKER)
 *   3. device     — account.deviceProfileId присутствует                  (BLOCKER для browser_automation)
 *   4. login      — loginCheckedStatus === true и loginCheckedAt ≤ 7д     (warn если stale, blocker если false)
 *   5. caption    — Caption для youtube существует. approved=ok, unapproved=warn, missing=blocker.
 *
 * Caption fetch делегирован в useCaptionPreload (единый источник правды
 * для UploadCreateModal + PostingJobYoutubeFields + этого composable).
 */
import { computed, type Ref } from "vue"

import type { PreflightCheck, PreflightState } from "~~/shared/types/posting-youtube"
import type { LoginCheckResult } from "~~/shared/types/login-check"
import { useCaptionPreload } from "./useCaptionPreload"

const LOGIN_STALE_DAYS = 7

export interface PreflightAccount {
  id: number
  /**
   * Платформа: youtube/tiktok/instagram. Тип string (не enum) ради совместимости с
   * useAccounts() который возвращает данные из Prisma generated client (там
   * platform — это enum, но shape после fetch — string). Логика проверок ниже
   * работает по equality к 'youtube' / 'browser_automation'.
   */
  platform: string
  status: string
  postingMethod?: string | null
  proxyId?: string | null
  deviceProfileId?: string | null
  proxy?: {
    id: string
    label: string
    status: string
  } | null
  loginCheckedStatus?: boolean | null
  loginCheckedAt?: string | null
  loginCheckedUsername?: string | null
}

export interface PreflightVideo {
  id: number
  status: string
}

export interface UseYoutubePreflightOptions {
  account: Ref<PreflightAccount | null>
  video: Ref<PreflightVideo | null>
  /**
   * Live-результат последнего login-check из кнопки «Запустить login-check»
   * (опционально). Если outcome === "transient" — Indigo CDP отвалился при
   * валидном snapshot, аккаунт НЕ реально разлогинен → показываем warn, а не
   * blocker (job-retry воркера разрулит). confirmed → ok даже если persisted
   * loginCheckedStatus ещё не обновился. logged_out → blocker.
   */
  liveLoginResult?: Ref<LoginCheckResult | null>
}

export function useYoutubePreflight(opts: UseYoutubePreflightOptions) {
  // Caption: только если account.platform === 'youtube' (иначе fetch бессмысленный).
  // useCaptionPreload сам debouncит, отменяет, кэширует — нам остаётся читать
  // approvalStateForPlatform.
  const videoIdForCaption = computed<number | null>(() => {
    if (opts.account.value?.platform !== "youtube") return null
    return opts.video.value?.id ?? null
  })
  const captionPreload = useCaptionPreload({ videoId: videoIdForCaption })

  function isLoginRecent(checkedAt: string | null | undefined): boolean {
    if (!checkedAt) return false
    const checkedTime = new Date(checkedAt).getTime()
    if (Number.isNaN(checkedTime)) return false
    const ageMs = Date.now() - checkedTime
    return ageMs < LOGIN_STALE_DAYS * 24 * 60 * 60 * 1000
  }

  const state = computed<PreflightState>(() => {
    const account = opts.account.value
    const video = opts.video.value

    const checks: PreflightCheck[] = []

    // 1. Video
    if (!video) {
      checks.push({
        key: "video",
        label: "Видео выбрано",
        status: "blocker",
        detail: "Выберите видео из списка",
        actionLabel: "Выбрать видео",
        actionType: "select_video",
      })
    } else if (video.status !== "completed") {
      checks.push({
        key: "video",
        label: "Видео готово",
        status: "blocker",
        detail: `Статус видео: ${video.status} (нужен completed)`,
      })
    } else {
      checks.push({
        key: "video",
        label: "Видео готово",
        status: "ok",
        detail: `#${video.id} · completed`,
      })
    }

    // 2. Proxy
    if (!account) {
      checks.push({
        key: "proxy",
        label: "Прокси привязан и healthy",
        status: "loading",
      })
    } else if (!account.proxyId || !account.proxy) {
      checks.push({
        key: "proxy",
        label: "Прокси привязан",
        status: "blocker",
        detail: "У аккаунта нет прокси — постинг запрещён (защита от бана)",
        actionLabel: "Выбрать прокси",
        actionType: "select_proxy",
      })
    } else if (account.proxy.status !== "healthy") {
      checks.push({
        key: "proxy",
        label: "Прокси healthy",
        status: "blocker",
        detail: `Статус прокси: ${account.proxy.status} — нужен healthy`,
      })
    } else {
      checks.push({
        key: "proxy",
        label: "Прокси healthy",
        status: "ok",
        detail: account.proxy.label,
      })
    }

    // 3. Indigo profile (только для browser_automation)
    const usesBrowser = account?.postingMethod === "browser_automation"
    if (usesBrowser) {
      if (!account?.deviceProfileId) {
        checks.push({
          key: "indigo",
          label: "Профиль устройства привязан",
          status: "blocker",
          detail: "browser_automation требует профиль устройства",
          actionLabel: "Открыть профиль",
          actionType: "open_indigo_profile",
        })
      } else {
        checks.push({
          key: "indigo",
          label: "Профиль устройства привязан",
          status: "ok",
          detail: account.deviceProfileId.slice(0, 8) + "…",
        })
      }
    }

    // 4. Login (только для browser_automation)
    if (usesBrowser) {
      // Live-результат имеет приоритет над persisted loginCheckedStatus: только
      // что нажатый login-check мог вернуть transient (Indigo CDP отвалился при
      // валидном snapshot) — это НЕ реально не залогинен. Берём live только если
      // он относится к выбранному аккаунту.
      const live = opts.liveLoginResult?.value
      const liveForThisAccount
        = live != null && account != null && live.accountId === account.id

      if (liveForThisAccount && live!.outcome === "transient") {
        // Transient: warn вместо blocker — доверяем job-retry воркера.
        checks.push({
          key: "login",
          label: "Login-check: временный сбой браузера",
          status: "warn",
          detail:
            "Соединение с браузером отвалилось при валидном snapshot — аккаунт НЕ разлогинен. "
            + "Постинг разрешен, воркер повторит при необходимости. Можно перепроверить.",
          actionLabel: "Перепроверить login",
          actionType: "run_login_check",
        })
      } else if (liveForThisAccount && live!.outcome === "confirmed") {
        // Live подтвердил вход — ok даже если persisted ещё не обновился.
        const username = live!.username ?? account?.loginCheckedUsername ?? "?"
        checks.push({
          key: "login",
          label: "Вход в YouTube подтверждён",
          status: "ok",
          detail: `@${username}`,
        })
      } else if (liveForThisAccount && live!.outcome === "error") {
        // Live не смог проверить И нет сохранённого snapshot (snapshotExists в
        // эндпоинте уже отнёс бы "browser упал при валидном snapshot" к transient).
        // Значит login-улик нет вовсе → blocker, не пускаем вслепую.
        checks.push({
          key: "login",
          label: "Login-check: не удалось подтвердить вход",
          status: "blocker",
          detail:
            (live!.error ?? "Проверка не завершилась")
            + " — нет сохранённого входа, войдите в аккаунт на устройстве DuoPlus и перепроверьте.",
          actionLabel: "Запустить login-check",
          actionType: "run_login_check",
        })
      } else if (account?.loginCheckedStatus === false) {
        // Реальная проверка сказала «не залогинен» → blocker (честный сигнал).
        // Сейчас endpoint check-login - заглушка 501 и статус не пишется, так что
        // ветка теоретическая, но оставлена честной на случай возврата проверки.
        checks.push({
          key: "login",
          label: "Вход в YouTube не подтверждён",
          status: "blocker",
          detail: "Login-check показал: не залогинены. Войдите вручную на устройстве DuoPlus",
          actionLabel: "Запустить login-check",
          actionType: "run_login_check",
        })
      } else if (account?.loginCheckedStatus == null) {
        // loginCheckedStatus == null: проверка НЕ выполнялась. На время миграции на
        // DuoPlus (Этап 3) login-check заморожен - device-движок проверки сессии на
        // устройстве ещё не реализован. Честно: НЕ «подтверждён» (не врём зелёным),
        // но и НЕ blocker (заморозка - артефакт миграции, а не сигнал «не залогинен»).
        // Постинг разрешен: воркер публикует через устройство DuoPlus, login-check
        // публикацию не контролирует (серверный POST /api/posting-jobs его не требует).
        checks.push({
          key: "login",
          label: "Login-check заморожен (миграция DuoPlus)",
          status: "warn",
          detail:
            "Проверка сессии на устройстве будет доступна после device-движка. "
            + "Постинг разрешен - публикация идёт через устройство DuoPlus.",
        })
      } else if (!isLoginRecent(account.loginCheckedAt)) {
        checks.push({
          key: "login",
          label: "Свежий login-check",
          status: "warn",
          detail: `Проверка устарела (>${LOGIN_STALE_DAYS}д). Рекомендуется обновить`,
          actionLabel: "Перепроверить login",
          actionType: "run_login_check",
        })
      } else {
        const username = account.loginCheckedUsername ?? "?"
        checks.push({
          key: "login",
          label: "Вход в YouTube подтверждён",
          status: "ok",
          detail: `@${username}`,
        })
      }
    }

    // 5. Caption (только для youtube)
    if (account?.platform === "youtube" && video) {
      const approvalState = captionPreload.youtubeApprovalState.value
      if (approvalState === "loading") {
        checks.push({
          key: "caption",
          label: "Caption для YouTube",
          status: "loading",
        })
      } else if (captionPreload.error.value) {
        checks.push({
          key: "caption",
          label: "Caption для YouTube",
          status: "warn",
          detail: captionPreload.error.value,
        })
      } else if (approvalState === "missing") {
        // Caption вообще нет — blocker, оператор должен создать.
        checks.push({
          key: "caption",
          label: "Caption для YouTube",
          status: "blocker",
          detail: "Caption ещё не создан — сгенерируйте на /videos/:id",
          actionLabel: "Открыть редактор captions",
          actionType: "open_caption_editor",
        })
      } else if (approvalState === "unapproved") {
        // Caption есть, но не утверждён — warn (не blocker). Оператор может
        // отредактировать прямо в форме (поля заполнены preload'ом из
        // unapproved caption) и создать job. Утверждение caption — лучшая
        // практика, но не блокирующая.
        checks.push({
          key: "caption",
          label: "Caption для YouTube",
          status: "warn",
          detail: "Caption не утверждён — отредактируйте здесь или утвердите на /videos/:id",
          actionLabel: "Открыть редактор",
          actionType: "open_caption_editor",
        })
      } else {
        checks.push({
          key: "caption",
          label: "Caption для YouTube утверждён",
          status: "ok",
        })
      }
    }

    const blocking = checks.some((c) => c.status === "blocker")
    const loading =
      checks.some((c) => c.status === "loading") || captionPreload.loading.value

    return { checks, blocking, loading }
  })

  return {
    state,
    refresh: captionPreload.refresh,
    /** Экспонируем низкоуровневый caption preload для caller'ов которые хотят preload form fields. */
    captionPreload,
  }
}
