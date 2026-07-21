<script setup lang="ts">
/**
 * Sanity-panel: live preview предупреждений по форме DeviceProfileEditModal.
 *
 * Не блокирует submit — только подсказки оператору о подозрительных комбинациях
 * (Desktop res на Mobile / Mobile res на Desktop / TZ не match с proxy country / ...).
 */
import type { DevicePlatformType } from "~~/shared/types/device-profile"
import {
  isDesktopResolution,
  isMobileResolution,
  suggestLanguage,
  suggestTimezone,
} from "~~/shared/data/device-presets"
import type { ProxyDto } from "~~/shared/types/proxy"

const props = defineProps<{
  platformType: DevicePlatformType
  screenResolution: string
  language: string
  timezone: string
  userAgent: string
  proxy: ProxyDto | null
}>()

interface SanityWarning {
  kind: "warning" | "info"
  message: string
}

const warnings = computed<SanityWarning[]>(() => {
  const list: SanityWarning[] = []

  // Resolution × platform mismatch
  if (props.platformType === "desktop" && isMobileResolution(props.screenResolution)) {
    list.push({
      kind: "warning",
      message:
        "Разрешение похоже на мобильное, но платформа Desktop. Возможна детекция несоответствия.",
    })
  }
  if (
    (props.platformType === "mobile_android" || props.platformType === "mobile_ios")
    && isDesktopResolution(props.screenResolution)
  ) {
    list.push({
      kind: "warning",
      message:
        "Разрешение похоже на десктопное, но платформа Mobile. Возможна детекция несоответствия.",
    })
  }

  // UA × platform mismatch (heuristic)
  const ua = props.userAgent.toLowerCase()
  if (ua) {
    const looksMobile =
      ua.includes("mobile") || ua.includes("android") || ua.includes("iphone") || ua.includes("ipad")
    if (props.platformType === "desktop" && looksMobile) {
      list.push({
        kind: "warning",
        message: "User-Agent выглядит как мобильный, но платформа Desktop.",
      })
    }
    if (
      (props.platformType === "mobile_android" || props.platformType === "mobile_ios")
      && !looksMobile
    ) {
      list.push({
        kind: "warning",
        message: "User-Agent выглядит как десктопный, но платформа Mobile.",
      })
    }
  }

  // Timezone empty - всегда подсказка (с suggestion от прокси если есть)
  if (!props.timezone) {
    if (props.proxy?.expectedCountry) {
      const tz = suggestTimezone(props.proxy.expectedCountry, props.proxy.expectedCity)
      if (tz) {
        list.push({
          kind: "info",
          message: `Часовой пояс не выбран. Прокси из ${props.proxy.expectedCountry} — рекомендуем ${tz}.`,
        })
      } else {
        list.push({
          kind: "info",
          message: "Часовой пояс не выбран. У прокси указана страна, но соответствующая TZ не найдена.",
        })
      }
    } else {
      list.push({
        kind: "info",
        message: "Часовой пояс не выбран. Устройство DuoPlus подставит дефолт, что может повредить маскировке устройства.",
      })
    }
  }

  // Language empty - подсказка
  if (!props.language) {
    if (props.proxy?.expectedCountry) {
      const lang = suggestLanguage(props.proxy.expectedCountry)
      if (lang) {
        list.push({
          kind: "info",
          message: `Язык не выбран. Прокси из ${props.proxy.expectedCountry} — рекомендуем ${lang}.`,
        })
      }
    } else {
      list.push({
        kind: "info",
        message: "Язык не выбран. Рекомендуем указать явно для согласованности с прокси.",
      })
    }
  }

  // Language mismatch with proxy country
  if (props.language && props.proxy?.expectedCountry) {
    const expectedLang = suggestLanguage(props.proxy.expectedCountry)
    if (expectedLang && expectedLang !== props.language) {
      list.push({
        kind: "info",
        message: `Прокси из ${props.proxy.expectedCountry} обычно использует ${expectedLang}, выбрано ${props.language}.`,
      })
    }
  }

  return list
})
</script>

<template>
  <div v-if="warnings.length > 0" class="space-y-2">
    <div
      v-for="(w, idx) in warnings"
      :key="idx"
      role="alert"
      class="alert text-xs py-2"
      :class="w.kind === 'warning' ? 'alert-warning alert-soft' : 'alert-info alert-soft'"
    >
      <Icon
        :name="w.kind === 'warning' ? 'mingcute:warning-line' : 'mingcute:information-line'"
        class="text-sm"
      />
      <span>{{ w.message }}</span>
    </div>
  </div>
</template>
