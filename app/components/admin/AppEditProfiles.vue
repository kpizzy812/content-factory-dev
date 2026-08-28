<script setup lang="ts">
/**
 * Монтажные профили приложения: список, выбор, создание и правка.
 *
 * Экран живёт в админке приложения, а не на детали ролика: обе ручки
 * (`/api/edit-profiles`, `/api/apps/:id/background-clips`) работают ПО
 * ПРИЛОЖЕНИЮ, и правка потолков здесь меняет правила для всех его роликов
 * сразу. На ролике остаётся только переопределение (`Video.editOverrides`).
 */
import type { EditProfile, EditProfileDeletionResult } from '~~/shared/types/edit-console'
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
  deletionNote.value = ''
}

function select(profile: EditProfile) {
  creating.value = false
  selectedId.value = profile.id
  // Итог прошлого удаления гасится на первом же следующем действии: висящая
  // строка «профилем по умолчанию стал такой-то» через десять минут читалась бы
  // как рассказ про текущий выбор.
  deletionNote.value = ''
}

async function onSaved(profile: EditProfile) {
  creating.value = false
  selectedId.value = profile.id
  deletionNote.value = ''
  await refresh()
}

function onCancel() {
  creating.value = false
  formNonce.value += 1
}

/**
 * Что стало с профилем по умолчанию после удаления. Берётся ИЗ ОТВЕТА сервера:
 * преемника выбирает он, в одной транзакции с удалением, и вторая догадка на
 * клиенте была бы вторым источником правды.
 */
const deletionNote = ref('')

async function onDeleted(result: EditProfileDeletionResult) {
  // Выбор сбрасывается: удалённый профиль остался бы «выбранным», и форма
  // открылась бы на строке, которой уже нет.
  selectedId.value = null
  deletionNote.value = result.note
  await refresh()
}

/** Сколько других профилей у приложения — форме нужно для текста подтверждения. */
const siblingCount = computed(() => Math.max(profiles.value.length - 1, 0))
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
      <!-- Итог удаления: кому уехал дефолт или что приложение осталось без профиля. -->
      <div
        v-if="deletionNote"
        role="status"
        class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-info"
      >
        <Icon name="mingcute:information-line" class="mt-0.5 shrink-0" />
        <span>{{ deletionNote }}</span>
      </div>

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
        :sibling-count="siblingCount"
        @saved="onSaved"
        @deleted="onDeleted"
        @cancel="onCancel"
      />
    </template>
  </div>
</template>
