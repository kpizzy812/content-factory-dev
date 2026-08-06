<script setup lang="ts">
/**
 * Теги и заметки профиля.
 *
 * Правка по кнопке, а не постоянное поле: заметки читают чаще, чем меняют,
 * а случайная правка тега ломает выборку в списке.
 */
import type { DeviceProfileDto } from '~~/shared/types/device-profile'

const props = defineProps<{
  profile: DeviceProfileDto
}>()

const emit = defineEmits<{
  updated: []
}>()

const { updateProfile, isBusy } = useDeviceActions()

const editMode = ref(false)
const tagsDraft = ref<string[]>([...props.profile.tags])
const notesDraft = ref(props.profile.notes ?? '')

watch(() => props.profile, (next) => {
  tagsDraft.value = [...next.tags]
  notesDraft.value = next.notes ?? ''
})

function startEdit() {
  tagsDraft.value = [...props.profile.tags]
  notesDraft.value = props.profile.notes ?? ''
  editMode.value = true
}

async function save() {
  const result = await updateProfile(props.profile.id, {
    tags: tagsDraft.value,
    notes: notesDraft.value.trim() || null,
  })
  if (result) {
    editMode.value = false
    emit('updated')
  }
}
</script>

<template>
  <section class="flex flex-col gap-2.5 rounded-lg border border-border bg-panel p-3.5">
    <div class="flex items-center gap-2">
      <h2 class="text-micro tracking-[.06em] text-subtle uppercase">Теги и заметки</h2>
      <span class="flex-1" />
      <UiButton v-if="!editMode" variant="ghost" @click="startEdit">
        <Icon name="mingcute:edit-line" />
        Изменить
      </UiButton>
      <template v-else>
        <UiButton variant="ghost" :disabled="isBusy" @click="editMode = false">Отмена</UiButton>
        <UiButton variant="primary" :loading="isBusy" @click="save">Сохранить</UiButton>
      </template>
    </div>

    <UiField label="Теги">
      <div v-if="!editMode" class="flex min-h-6 flex-wrap items-center gap-1">
        <span
          v-for="t in profile.tags"
          :key="t"
          class="rounded-sm border border-divider px-1.5 py-0.5 text-micro text-muted"
        >
          {{ t }}
        </span>
        <span v-if="!profile.tags.length" class="text-sm text-subtle">нет тегов</span>
      </div>
      <SharedTagPicker
        v-else
        v-model="tagsDraft"
        endpoint="/api/device-profiles/tags"
        :allow-create="false"
        placeholder="Добавить тег"
      />
    </UiField>

    <UiField label="Заметки">
      <p v-if="!editMode" class="min-h-8 text-sm whitespace-pre-wrap">
        <template v-if="profile.notes">{{ profile.notes }}</template>
        <span v-else class="text-subtle">нет заметок</span>
      </p>
      <UiTextarea
        v-else
        v-model="notesDraft"
        :rows="3"
        placeholder="План прогрева, особенности профиля"
      />
    </UiField>
  </section>
</template>
