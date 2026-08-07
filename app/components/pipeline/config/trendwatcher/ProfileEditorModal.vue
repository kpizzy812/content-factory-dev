<script setup lang="ts">
import type { TrendwatcherProfile } from '~/composables/useTrendwatcherProfiles'

const props = defineProps<{
  open: boolean
  /** Если задан — режим редактирования; иначе — создание. */
  profile?: TrendwatcherProfile | null
  /** Фиксированное приложение (нельзя менять при создании из ноды). */
  lockAppId?: number
}>()

const emit = defineEmits<{
  close: []
  saved: [profile: TrendwatcherProfile]
}>()

const { createProfile, updateProfile } = useTrendwatcherProfiles()

const apps = ref<Array<{ id: number, name: string }>>([])
const loadingApps = ref(false)
const saving = ref(false)
const errorText = ref('')
// Any-cast: exposed refs через defineExpose в ProfileForm проксируются parent'ом
// с auto-unwrap, точные типы через InstanceType генерировать неудобно.
const formRef = ref<{ testStatus: string, testMessage: string } | null>(null)

function setTestStatus(status: 'idle' | 'testing' | 'success' | 'error', message = '') {
  if (formRef.value) {
    formRef.value.testStatus = status
    formRef.value.testMessage = message
  }
}

async function fetchApps() {
  loadingApps.value = true
  try {
    const res = await $fetch<{ data: Array<{ id: number, name: string }> }>('/api/admin/apps')
    apps.value = res.data ?? []
  } catch {
    apps.value = []
  } finally {
    loadingApps.value = false
  }
}

watch(() => props.open, (v) => {
  if (v) {
    errorText.value = ''
    setTestStatus('idle')
    if (apps.value.length === 0) fetchApps()
  }
})

const initialData = computed(() => {
  if (props.profile) {
    return {
      id: props.profile.id,
      appId: props.profile.appId,
      name: props.profile.name,
      actorId: props.profile.actorId,
      keywords: [...(props.profile.keywords ?? [])],
      platforms: [...(props.profile.platforms ?? [])],
      language: props.profile.language ?? '',
      geo: props.profile.geo ?? '',
      viewCountMin: props.profile.viewCountMin,
      viewCountMax: props.profile.viewCountMax,
      maxItems: props.profile.maxItems,
    }
  }
  if (props.lockAppId) {
    return { appId: props.lockAppId, platforms: ['tiktok'], keywords: [] }
  }
  return undefined
})

const filteredApps = computed(() => {
  if (props.lockAppId) {
    return apps.value.filter(a => a.id === props.lockAppId)
  }
  return apps.value
})

const title = computed(() =>
  props.profile?.id ? `Редактирование профиля «${props.profile.name}»` : 'Новый профиль парсинга',
)

async function handleSubmit(data: {
  appId: number
  name: string
  actorId: string
  keywords: string[]
  platforms: string[]
  language?: string
  geo?: string
  viewCountMin?: number | null
  viewCountMax?: number | null
  maxItems?: number
}) {
  saving.value = true
  errorText.value = ''
  try {
    if (props.profile?.id) {
      const res = await updateProfile(props.profile.id, data as Record<string, unknown>) as { data: TrendwatcherProfile }
      emit('saved', res.data)
    } else {
      const res = await createProfile(data) as { data: TrendwatcherProfile }
      emit('saved', res.data)
    }
    emit('close')
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : 'Не удалось сохранить профиль'
  } finally {
    saving.value = false
  }
}

async function handleTestConnection(actorId: string) {
  if (!actorId) return
  setTestStatus('testing')
  try {
    if (!props.profile?.id) {
      setTestStatus('error', 'Сначала создайте профиль, затем проверяйте актор')
      return
    }
    const res = await $fetch<{ data: { valid: boolean, errorSummary?: string } }>(
      `/api/trendwatcher/profiles/${props.profile.id}/validate`,
      { method: 'POST' },
    )
    if (res.data.valid) {
      setTestStatus('success')
    } else {
      setTestStatus('error', res.data.errorSummary ?? 'Актор недоступен')
    }
  } catch (e) {
    setTestStatus('error', e instanceof Error ? e.message : 'Не удалось проверить')
  }
}
</script>

<template>
  <UiModal :open="open" :title="title" size="lg" @close="emit('close')">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-muted">
        Профили переиспользуются между нодой в конвейере и модулем Трендвотчер.
      </p>

      <div v-if="loadingApps" class="flex items-center gap-2 text-muted">
        <Icon name="mingcute:loading-line" class="animate-spin" />
        Загрузка приложений…
      </div>

      <TrendProfileForm
        v-else
        ref="formRef"
        :initial-data="initialData"
        :apps="filteredApps"
        @submit="handleSubmit"
        @cancel="emit('close')"
        @test-connection="handleTestConnection"
      />

      <p
        v-if="errorText"
        class="rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-danger"
      >
        {{ errorText }}
      </p>

      <div v-if="saving" class="flex items-center gap-2 text-muted">
        <Icon name="mingcute:loading-line" class="animate-spin" />
        Сохранение…
      </div>
    </div>
  </UiModal>
</template>
