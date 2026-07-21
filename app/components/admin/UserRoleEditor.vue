<script setup lang="ts">
const props = defineProps<{
  user: {
    id: number
    email: string
    rolePreset: string
    roleName?: string | null
    rolePresetName?: string | null
    canRead: boolean
    canWrite: boolean
    canCreate: boolean
    canDelete: boolean
    canApprove: boolean
    canRunAgent: boolean
    canApplyChanges: boolean
    canAdmin: boolean
    moduleAccess: string[]
    appAssignments?: Array<{
      appId: number
      appName: string
      accessLevel: string
      accounts: string
      geos: string
      permissions: string
    }>
    isActive: boolean
  }
}>()

const emit = defineEmits<{ saved: [] }>()

const { presetLabels, allModules, permissionLabels } = useRbacConfig()

const saving = ref(false)
const error = ref('')
const isActive = ref(props.user.isActive)

const permissionEntries = computed(() =>
  (Object.entries(permissionLabels) as Array<[string, string]>).map(([key, label]) => ({
    key,
    label,
    granted: !!props.user[key as keyof typeof props.user],
  })),
)

const moduleEntries = computed(() =>
  allModules.map((mod) => ({
    slug: mod.slug,
    label: mod.label,
    granted: props.user.canAdmin || props.user.moduleAccess.includes(mod.slug),
  })),
)

const appAssignments = computed(() => props.user.appAssignments ?? [])

async function save() {
  saving.value = true
  error.value = ''
  try {
    await $fetch(`/api/admin/users/${props.user.id}`, {
      method: 'PUT',
      body: { isActive: isActive.value },
    })
    emit('saved')
  } catch (e: unknown) {
    error.value = (e as Error).message || 'Ошибка сохранения'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div role="alert" class="alert alert-info alert-soft">
      <Icon name="mingcute:information-line" />
      <div class="text-sm">
        Права, роли, модули и приложения управляются в <strong>MarketingCamp</strong> и
        синхронизируются при каждом логине пользователя. Здесь только просмотр и
        локальная блокировка аккаунта в ZavodCamp.
      </div>
    </div>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Роль (из MarketingCamp)</legend>
      <div class="flex flex-wrap items-center gap-2">
        <span class="badge badge-primary badge-lg">{{ user.roleName || presetLabels[user.rolePreset] || user.rolePreset }}</span>
        <span v-if="user.rolePresetName && user.rolePresetName !== user.roleName" class="badge badge-ghost">{{ user.rolePresetName }}</span>
      </div>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Права доступа</legend>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div v-for="p in permissionEntries" :key="p.key" class="flex items-center gap-2">
          <Icon
            :name="p.granted ? 'mingcute:check-2-line' : 'mingcute:close-line'"
            :class="p.granted ? 'text-success' : 'text-base-content/40'"
          />
          <span class="text-sm" :class="!p.granted && 'text-base-content/50'">{{ p.label }}</span>
        </div>
      </div>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Доступ к модулям</legend>
      <div class="flex flex-wrap gap-3">
        <span
          v-for="m in moduleEntries"
          :key="m.slug"
          class="badge badge-sm"
          :class="m.granted ? 'badge-secondary' : 'badge-ghost opacity-50'"
        >
          <Icon :name="m.granted ? 'mingcute:check-2-line' : 'mingcute:close-line'" class="size-3" />
          {{ m.label }}
        </span>
      </div>
      <p v-if="user.canAdmin" class="text-xs text-base-content/60 mt-1">
        Администратор имеет доступ ко всем модулям через bypass.
      </p>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Доступ к приложениям</legend>
      <div v-if="appAssignments.length === 0" class="text-sm text-base-content/60">
        {{ user.canAdmin ? 'Админ — доступ ко всем приложениям через bypass.' : 'Приложения не назначены в MarketingCamp.' }}
      </div>
      <div v-else class="grid gap-2">
        <div
          v-for="a in appAssignments"
          :key="a.appId"
          class="flex flex-wrap items-center gap-2 rounded border border-base-300 px-3 py-2"
        >
          <span class="font-medium text-sm">{{ a.appName }}</span>
          <span class="badge badge-xs">level: {{ a.accessLevel }}</span>
          <span class="badge badge-xs badge-ghost">accounts: {{ a.accounts }}</span>
          <span class="badge badge-xs badge-ghost">geos: {{ a.geos }}</span>
          <span class="badge badge-xs badge-ghost">perm: {{ a.permissions }}</span>
        </div>
      </div>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Локальный статус в ZavodCamp</legend>
      <label class="flex items-center gap-2 cursor-pointer">
        <input v-model="isActive" type="checkbox" class="toggle toggle-sm toggle-success" />
        <span class="text-sm">{{ isActive ? 'Активен' : 'Заблокирован локально' }}</span>
      </label>
      <p class="text-xs text-base-content/60 mt-1">
        Блокировка работает только в ZavodCamp. В MC аккаунт остаётся.
      </p>
    </fieldset>

    <div v-if="error" role="alert" class="alert alert-error alert-soft">
      <Icon name="mingcute:warning-line" />
      <span>{{ error }}</span>
    </div>

    <button class="btn btn-primary" :disabled="saving" @click="save">
      <span v-if="saving" class="loading loading-spinner loading-sm" />
      Сохранить статус
    </button>
  </div>
</template>
