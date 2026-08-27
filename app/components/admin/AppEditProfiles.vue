<script setup lang="ts">
/**
 * Монтажные профили приложения: список, выбор, создание и правка.
 *
 * Экран живёт в админке приложения, а не на детали ролика: обе ручки
 * (`/api/edit-profiles`, `/api/apps/:id/background-clips`) работают ПО
 * ПРИЛОЖЕНИЮ, и правка потолков здесь меняет правила для всех его роликов
 * сразу. На ролике остаётся только переопределение (`Video.editOverrides`).
 */
import type { EditProfile } from '~~/shared/types/edit-console'
import { formatMoney } from '~~/shared/utils/money'
import { EDIT_PROFILE_DEFAULTS } from './edit-profile-form-model'

/**
 * Что произойдёт, если профиля нет вовсе: конвейер возьмёт
 * `DEFAULT_EDIT_PROFILE`. Числа названы прямо — «настроек нет» скрывало бы,
 * что деньги при этом всё равно тратятся.
 */
const NO_PROFILE_DESCRIPTION
  = 'Ролики этого приложения собираются по встроенным значениям: доля перебивок '
    + `${String(EDIT_PROFILE_DEFAULTS.brollRatio).replace('.', ',')}, потолок расхода на картинки `
    + `${formatMoney(EDIT_PROFILE_DEFAULTS.imageBudgetUsd)}, генеративное видео выключено. `
    + 'Профиль нужен, чтобы задать свои.'

const props = defineProps<{ appId: number }>()

const { data, pending, error, refresh } = await useFetch<{ data: EditProfile[] }>(
  '/api/edit-profiles',
  {
    query: computed(() => ({ appId: props.appId })),
    key: `admin-edit-profiles-${props.appId}`,
  },
)

const profiles = computed(() => data.value?.data ?? [])

const selectedId = ref<number | null>(null)
const creating = ref(false)
/** Меняется на «Отмене» — форма перемонтируется и возвращает значения профиля. */
const formNonce = ref(0)

const selected = computed<EditProfile | null>(() => {
  if (creating.value) return null
  const list = profiles.value
  return list.find(p => p.id === selectedId.value)
    ?? list.find(p => p.isDefault)
    ?? list[0]
    ?? null
})

/** Форма открыта, когда есть что править или оператор явно создаёт профиль. */
const formVisible = computed(() => creating.value || selected.value !== null)

function startCreate() {
  creating.value = true
}

function select(profile: EditProfile) {
  creating.value = false
  selectedId.value = profile.id
}

async function onSaved(profile: EditProfile) {
  creating.value = false
  selectedId.value = profile.id
  await refresh()
}

function onCancel() {
  creating.value = false
  formNonce.value += 1
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <UiSkeleton v-if="pending && !profiles.length" variant="details" :count="5" />

    <UiErrorState
      v-else-if="error"
      title="Не удалось загрузить монтажные профили"
      :message="error.message"
      @retry="refresh"
    />

    <template v-else>
      <div v-if="profiles.length" class="flex flex-wrap items-center gap-2">
        <button
          v-for="profile in profiles"
          :key="profile.id"
          type="button"
          class="flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors duration-(--duration-fast)"
          :class="!creating && selected?.id === profile.id
            ? 'border-accent-border bg-accent-bg text-accent-text'
            : 'border-border bg-card text-muted hover:border-subtle hover:text-fg'"
          @click="select(profile)"
        >
          {{ profile.name }}
          <span v-if="profile.isDefault" class="text-micro text-subtle">по умолчанию</span>
        </button>

        <UiButton variant="secondary" @click="startCreate">
          <Icon name="mingcute:add-line" />
          Новый профиль
        </UiButton>
      </div>

      <UiEmptyState
        v-else-if="!creating"
        icon="mingcute:settings-3-line"
        title="Монтажного профиля нет"
        :description="NO_PROFILE_DESCRIPTION"
      >
        <UiButton variant="primary" @click="startCreate">
          <Icon name="mingcute:add-line" />
          Создать профиль
        </UiButton>
      </UiEmptyState>

      <AdminEditProfileForm
        v-if="formVisible"
        :key="`${creating ? 'new' : (selected?.id ?? 'new')}-${formNonce}`"
        :app-id="props.appId"
        :profile="creating ? null : selected"
        @saved="onSaved"
        @cancel="onCancel"
      />
    </template>
  </div>
</template>
