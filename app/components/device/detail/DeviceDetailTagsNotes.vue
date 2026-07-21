<script setup lang="ts">
import type { DeviceProfileDto } from "~~/shared/types/device-profile"

const props = defineProps<{
  profile: DeviceProfileDto
}>()

const emit = defineEmits<{
  updated: []
}>()

const { updateProfile, isBusy } = useDeviceActions()

const editMode = ref(false)
const tagsDraft = ref<string[]>([...props.profile.tags])
const notesDraft = ref(props.profile.notes ?? "")

watch(() => props.profile, (next) => {
  tagsDraft.value = [...next.tags]
  notesDraft.value = next.notes ?? ""
})

function startEdit() {
  tagsDraft.value = [...props.profile.tags]
  notesDraft.value = props.profile.notes ?? ""
  editMode.value = true
}

function cancelEdit() {
  editMode.value = false
}

async function save() {
  const result = await updateProfile(props.profile.id, {
    tags: tagsDraft.value,
    notes: notesDraft.value.trim() || null,
  })
  if (result) {
    editMode.value = false
    emit("updated")
  }
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <div class="flex items-center justify-between gap-2">
        <h3 class="font-semibold flex items-center gap-2">
          <Icon name="mingcute:tag-line" />
          Теги и заметки
        </h3>
        <button
          v-if="!editMode"
          class="btn btn-xs btn-ghost gap-1"
          @click="startEdit"
        >
          <Icon name="mingcute:edit-line" />
          Изменить
        </button>
        <div v-else class="flex items-center gap-1">
          <button class="btn btn-xs btn-ghost" :disabled="isBusy" @click="cancelEdit">
            Отмена
          </button>
          <button class="btn btn-xs btn-primary" :disabled="isBusy" @click="save">
            <span v-if="isBusy" class="loading loading-spinner loading-xs" />
            Сохранить
          </button>
        </div>
      </div>

      <!-- Tags -->
      <div>
        <div class="text-xs text-base-content/60 mb-1">Теги</div>
        <div v-if="!editMode" class="flex items-center gap-1 flex-wrap min-h-[1.5rem]">
          <span
            v-for="t in profile.tags"
            :key="t"
            class="badge badge-soft badge-sm"
          >
            {{ t }}
          </span>
          <span v-if="profile.tags.length === 0" class="text-sm text-base-content/50 italic">нет тегов</span>
        </div>
        <SharedTagPicker
          v-else
          v-model="tagsDraft"
          endpoint="/api/device-profiles/tags"
          :allow-create="false"
          placeholder="Добавить тег..."
        />
      </div>

      <!-- Notes -->
      <div>
        <div class="text-xs text-base-content/60 mb-1">Заметки</div>
        <p v-if="!editMode" class="text-sm whitespace-pre-wrap min-h-[2rem]">
          {{ profile.notes ?? "" }}
          <span v-if="!profile.notes" class="text-base-content/50 italic">нет заметок</span>
        </p>
        <textarea
          v-else
          v-model="notesDraft"
          class="textarea textarea-sm w-full"
          rows="3"
          placeholder="План прогрева, особенности..."
        />
      </div>
    </div>
  </div>
</template>
