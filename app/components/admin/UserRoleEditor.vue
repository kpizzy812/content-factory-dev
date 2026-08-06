<script setup lang="ts">
/**
 * Права пользователя приходят из MarketingCamp и здесь только показываются.
 * Менять можно единственное — локальную блокировку, поэтому всё остальное
 * подано как справка, а не как форма.
 */
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
  allModules.map(mod => ({
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
  }
  catch (e) {
    error.value = (e as Error).message || 'Не удалось сохранить'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      role="note"
      class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm"
    >
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
      <span class="text-muted">
        Роли, права, модули и приложения ведутся в MarketingCamp и приезжают при каждом входе.
        Здесь их можно только посмотреть — менять есть что одно, локальную блокировку.
      </span>
    </div>

    <section>
      <h3 class="mb-1.5 text-micro tracking-[.06em] text-subtle uppercase">Роль</h3>
      <div class="flex flex-wrap items-center gap-2">
        <span class="rounded-sm border border-accent-border bg-accent-bg px-2 py-0.5 text-sm text-accent">
          {{ user.roleName || presetLabels[user.rolePreset] || user.rolePreset }}
        </span>
        <span
          v-if="user.rolePresetName && user.rolePresetName !== user.roleName"
          class="rounded-sm border border-divider px-2 py-0.5 text-sm text-muted"
        >
          {{ user.rolePresetName }}
        </span>
      </div>
    </section>

    <section>
      <h3 class="mb-1.5 text-micro tracking-[.06em] text-subtle uppercase">Права</h3>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div v-for="p in permissionEntries" :key="p.key" class="flex items-center gap-1.5 text-sm">
          <Icon
            :name="p.granted ? 'mingcute:check-2-line' : 'mingcute:close-line'"
            :class="p.granted ? 'text-success' : 'text-subtle'"
          />
          <span :class="!p.granted && 'text-subtle'">{{ p.label }}</span>
        </div>
      </div>
    </section>

    <section>
      <h3 class="mb-1.5 text-micro tracking-[.06em] text-subtle uppercase">Модули</h3>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="m in moduleEntries"
          :key="m.slug"
          class="flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-micro"
          :class="m.granted
            ? 'border-success-border bg-success-bg text-success'
            : 'border-divider text-subtle'"
        >
          <Icon :name="m.granted ? 'mingcute:check-2-line' : 'mingcute:close-line'" />
          {{ m.label }}
        </span>
      </div>
      <p v-if="user.canAdmin" class="mt-1 text-micro text-subtle">
        У администратора доступ ко всем модулям независимо от списка.
      </p>
    </section>

    <section>
      <h3 class="mb-1.5 text-micro tracking-[.06em] text-subtle uppercase">Приложения</h3>
      <p v-if="!appAssignments.length" class="text-sm text-muted">
        {{ user.canAdmin
          ? 'У администратора доступ ко всем приложениям.'
          : 'В MarketingCamp приложения не назначены.' }}
      </p>
      <div v-else class="flex flex-col gap-1.5">
        <div
          v-for="a in appAssignments"
          :key="a.appId"
          class="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
        >
          <span class="text-sm font-medium">{{ a.appName }}</span>
          <span class="rounded-sm border border-divider px-1.5 py-0.5 font-mono text-micro text-muted">
            уровень {{ a.accessLevel }}
          </span>
          <span class="rounded-sm border border-divider px-1.5 py-0.5 font-mono text-micro text-subtle">
            аккаунты {{ a.accounts }}
          </span>
          <span class="rounded-sm border border-divider px-1.5 py-0.5 font-mono text-micro text-subtle">
            гео {{ a.geos }}
          </span>
          <span class="rounded-sm border border-divider px-1.5 py-0.5 font-mono text-micro text-subtle">
            права {{ a.permissions }}
          </span>
        </div>
      </div>
    </section>

    <section>
      <h3 class="mb-1.5 text-micro tracking-[.06em] text-subtle uppercase">Локальная блокировка</h3>
      <UiToggle v-model="isActive" :label="isActive ? 'Работает' : 'Заблокирован здесь'" />
      <p class="mt-1 text-micro text-subtle">
        Действует только в ContentFactory. В MarketingCamp учётная запись остаётся.
      </p>
    </section>

    <div
      v-if="error"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ error }}</span>
    </div>

    <div>
      <UiButton variant="primary" :loading="saving" @click="save">Сохранить</UiButton>
    </div>
  </div>
</template>
