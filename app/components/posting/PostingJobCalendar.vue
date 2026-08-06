<script setup lang="ts">
import type { PostingJobDto } from '~~/shared/types/posting-job'
import { postingStatus } from './PostingStatusMap'

/**
 * Очередь публикаций сеткой «аккаунт × час» на ближайшие сутки.
 * Источник: раздел «Очередь публикаций · календарь» макета 06.
 *
 * В макете у каждой дорожки подписана свободная ёмкость аккаунта. Её здесь нет:
 * лимит публикаций платформа отдаёт только в момент отправки и никуда не
 * сохраняется. Вместо ёмкости подписано то, что известно — сколько задач стоит.
 *
 * Перетаскивания тоже нет: `PATCH /api/posting-jobs/:id` умеет менять время, но
 * час — слишком грубый шаг для минимального интервала между публикациями.
 * Время правится в карточке задачи.
 */
const props = defineProps<{
  jobs: PostingJobDto[]
  /** Сколько часов показывать: 24 или 48. */
  hours: number
}>()

const emit = defineEmits<{ pick: [job: PostingJobDto] }>()

const now = new Date()
const startHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours())

const slots = computed(() =>
  Array.from({ length: props.hours }, (_, i) => new Date(startHour.getTime() + i * 3_600_000)),
)

interface Track {
  accountId: number
  label: string
  platform: string
  total: number
  cells: Map<number, PostingJobDto[]>
}

/** Задачи без времени в сетку не попадают — им негде стоять. */
const tracks = computed<Track[]>(() => {
  const byAccount = new Map<number, Track>()
  const endMs = startHour.getTime() + props.hours * 3_600_000

  for (const job of props.jobs) {
    if (!job.scheduledAt) continue
    const at = new Date(job.scheduledAt).getTime()
    if (Number.isNaN(at) || at < startHour.getTime() || at >= endMs) continue

    const idx = Math.floor((at - startHour.getTime()) / 3_600_000)
    const accountId = job.socialAccountId
    let track = byAccount.get(accountId)
    if (!track) {
      track = {
        accountId,
        label: job.socialAccount?.displayName ?? `аккаунт #${accountId}`,
        platform: job.socialAccount?.platform ?? job.platform,
        total: 0,
        cells: new Map(),
      }
      byAccount.set(accountId, track)
    }
    track.total += 1
    const cell = track.cells.get(idx) ?? []
    cell.push(job)
    track.cells.set(idx, cell)
  }

  return [...byAccount.values()].sort((a, b) => b.total - a.total)
})

const outOfWindow = computed(() => {
  const endMs = startHour.getTime() + props.hours * 3_600_000
  return props.jobs.filter((j) => {
    if (!j.scheduledAt) return true
    const at = new Date(j.scheduledAt).getTime()
    return Number.isNaN(at) || at < startHour.getTime() || at >= endMs
  }).length
})

/** Цвет ячейки — по самому «тревожному» состоянию задач в ней. */
function cellTone(jobs: PostingJobDto[]): string {
  const states = jobs.map(j => postingStatus(j.status))
  if (states.includes('failed')) return 'border-danger-border bg-danger-bg text-danger'
  if (states.includes('review')) return 'border-warning-border bg-warning-bg text-warning'
  if (states.includes('running')) return 'border-info-border bg-info-bg text-info'
  if (states.every(s => s === 'done')) return 'border-success-border bg-success-bg text-success'
  if (states.every(s => s === 'cancelled')) return 'border-divider bg-transparent text-subtle'
  return 'border-accent bg-accent-bg text-fg'
}

function hourLabel(d: Date) {
  return String(d.getHours()).padStart(2, '0')
}

function cellTitle(jobs: PostingJobDto[], slot: Date) {
  const names = jobs.slice(0, 4).map(j => `${new Date(j.scheduledAt!).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · ${j.video?.id ? `ролик ${j.video.id}` : j.id.slice(0, 8)}`)
  const more = jobs.length > names.length ? `\nи ещё ${jobs.length - names.length}` : ''
  return `${hourLabel(slot)}:00 — ${jobs.length} публикаций\n${names.join('\n')}${more}`
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-border bg-panel">
    <div class="overflow-x-auto">
      <div :style="{ minWidth: `${190 + hours * 34}px` }">
        <div
          class="tnum grid h-7 items-center border-b border-border bg-card px-3 font-mono text-micro text-subtle"
          :style="{ gridTemplateColumns: `172px repeat(${hours}, 1fr)` }"
        >
          <span />
          <span v-for="slot in slots" :key="slot.getTime()">{{ hourLabel(slot) }}</span>
        </div>

        <div
          v-for="track in tracks"
          :key="track.accountId"
          class="grid h-11 items-center border-b border-divider px-3 last:border-b-0"
          :style="{ gridTemplateColumns: `172px repeat(${hours}, 1fr)` }"
        >
          <span class="flex min-w-0 flex-col gap-0.5 pr-2.5">
            <span class="truncate font-mono text-sm">{{ track.label }}</span>
            <span class="tnum font-mono text-micro text-subtle">запланировано {{ track.total }}</span>
          </span>

          <template v-for="(slot, i) in slots" :key="slot.getTime()">
            <button
              v-if="track.cells.get(i)?.length"
              type="button"
              class="tnum mr-[3px] flex h-6 cursor-pointer items-center justify-center rounded-sm border px-1.5 font-mono text-micro"
              :class="cellTone(track.cells.get(i)!)"
              :title="cellTitle(track.cells.get(i)!, slot)"
              @click="emit('pick', track.cells.get(i)![0]!)"
            >
              {{ track.cells.get(i)!.length }}
            </button>
            <span v-else />
          </template>
        </div>

        <div v-if="!tracks.length" class="px-3 py-6 text-center text-sm text-subtle">
          На ближайшие {{ hours }} часов публикаций не запланировано.
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-3 border-t border-border bg-card px-3 py-2 text-micro text-subtle">
      <span class="flex items-center gap-1.5">
        <span class="h-2 w-2.5 rounded-[2px] bg-accent" />в плане
      </span>
      <span class="flex items-center gap-1.5">
        <span class="h-2 w-2.5 rounded-[2px] bg-warning" />ждёт повтора
      </span>
      <span class="flex items-center gap-1.5">
        <span class="h-2 w-2.5 rounded-[2px] bg-success" />вышло
      </span>
      <span class="flex items-center gap-1.5">
        <span class="h-2 w-2.5 rounded-[2px] bg-danger" />упало
      </span>
      <span class="flex-1" />
      <span v-if="outOfWindow" class="tnum">
        вне окна ещё {{ outOfWindow }} — они видны списком
      </span>
    </div>
  </div>
</template>
