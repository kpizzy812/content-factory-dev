<script setup lang="ts">
import { platformMeta } from '~/components/ui/platform-meta'

/**
 * Карточка пачки аккаунтов.
 *
 * Режим раздачи стоит прямо на карточке: пачка «по кругу» и пачка «во все сразу»
 * дают разное число публикаций из одного ролика, а раньше это было видно только
 * внутри модалки правки.
 */
const props = defineProps<{
  group: {
    id: number
    name: string
    dispatchMode?: string
    activeMembersCount?: number
    members: {
      id: number
      socialAccount: { id: number, platform: string, displayName: string, status: string }
    }[]
  }
}>()

const emit = defineEmits<{ edit: [], delete: [] }>()

const { can } = usePermissions()
const canDelete = computed(() => can('canDelete'))

const DISPATCH_LABELS: Record<string, string> = {
  round_robin: 'по кругу',
  all: 'во все сразу',
  first_active: 'в первый активный',
}

const shown = computed(() => props.group.members.slice(0, 5))
const rest = computed(() => Math.max(0, props.group.members.length - shown.value.length))
</script>

<template>
  <div class="flex flex-col gap-3 rounded-lg border border-border bg-panel p-3.5">
    <div class="flex items-start gap-2">
      <div class="min-w-0 flex-1">
        <h3 class="truncate font-medium">{{ group.name }}</h3>
        <p class="text-micro text-subtle">
          Раздача {{ DISPATCH_LABELS[group.dispatchMode ?? 'round_robin'] ?? group.dispatchMode }}
        </p>
      </div>
      <span class="tnum shrink-0 rounded-sm border border-neutral-border bg-neutral-bg px-2 py-0.5 font-mono text-micro text-neutral">
        {{ group.members.length }} акк.
      </span>
    </div>

    <div v-if="shown.length" class="flex flex-wrap gap-1.5">
      <span
        v-for="member in shown"
        :key="member.id"
        class="flex items-center gap-1.5 rounded-sm border border-border bg-card px-1.5 py-0.5 text-micro"
        :class="member.socialAccount.status === 'active' ? 'text-muted' : 'text-subtle'"
      >
        <span class="h-2.5 w-1 shrink-0 rounded-[2px]" :style="{ background: platformMeta(member.socialAccount.platform).color }" />
        <span class="max-w-32 truncate font-mono">{{ member.socialAccount.displayName }}</span>
      </span>
      <span v-if="rest" class="rounded-sm border border-divider px-1.5 py-0.5 text-micro text-subtle">+{{ rest }}</span>
    </div>
    <p v-else class="text-sm text-subtle">Пачка пустая — ролики из неё никуда не уйдут.</p>

    <div class="flex items-center gap-2">
      <span v-if="group.activeMembersCount !== undefined" class="tnum text-micro text-subtle">
        активных {{ group.activeMembersCount }}
      </span>
      <span class="flex-1" />
      <UiButton @click="emit('edit')">
        <Icon name="mingcute:edit-line" />
        Изменить
      </UiButton>
      <UiButton v-if="canDelete" variant="danger" @click="emit('delete')">
        <Icon name="mingcute:delete-2-line" />
        Удалить
      </UiButton>
    </div>
  </div>
</template>
