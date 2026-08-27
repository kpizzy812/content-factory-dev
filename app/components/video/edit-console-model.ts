import type { StatusTone } from '~~/shared/utils/entity-status'
import type {
  PlannedShot,
  ShotBackground,
  ShotFact,
  ShotRow,
  TrackRegenerationPreview,
} from '~~/shared/types/edit-console'
import { PAID_SHOT_BACKGROUNDS, SHOT_BACKGROUND_LABELS } from '~~/shared/types/edit-console'

/**
 * Чистая логика монтажной консоли: как из ответов сервера получается то, что
 * видит оператор. Вынесено из `.vue` намеренно — компонентных тестов в проекте
 * нет, а решения тут денежные, и проверять их надо не глазами.
 *
 * Макет: `design-preview/catalog/09-edit-console.dc.html`.
 */

// ─── Кадры ───────────────────────────────────────────────────────────────────

/** Строка шага генерации в том виде, в каком её отдаёт `/api/videos/:id/progress`. */
interface StepLike {
  stepKey: string
  status: string
  outputSnapshot?: unknown
}

export interface EditPlanSnapshotRead {
  shots: PlannedShot[]
  warnings: string[]
  /** Шаг плана монтажа отработал и снапшот прочитан. */
  available: boolean
}

/**
 * План монтажа из снапшота шага `edit_plan`.
 *
 * Отдельной ручки `GET /api/videos/:id/shots` в сервере нет, а снапшот шага
 * уже приезжает в прогресс — и в нём лежат ровно те кадры, что записаны в
 * `VideoShot`, вместе с `degradeReason` и плановой стоимостью.
 */
export function readEditPlanShots(steps: readonly StepLike[] | null | undefined): EditPlanSnapshotRead {
  const step = steps?.find(s => s.stepKey === 'edit_plan')
  const snapshot = step?.outputSnapshot as { shots?: unknown, warnings?: unknown } | null | undefined
  if (!snapshot || !Array.isArray(snapshot.shots)) {
    return { shots: [], warnings: [], available: false }
  }
  const shots = (snapshot.shots as PlannedShot[])
    .filter(shot => shot && typeof shot.order === 'number')
    .slice()
    .sort((a, b) => a.order - b.order)
  const warnings = Array.isArray(snapshot.warnings) ? (snapshot.warnings as string[]) : []
  return { shots, warnings, available: true }
}

/**
 * Склейка плана и факта.
 *
 * Пока факта нет (нет ручки списка кадров), строка живёт планом: `backgroundActual`
 * остаётся `null`, и таблица это подписывает, а не притворяется, что фон исполнен.
 */
export function buildShotRows(
  plan: readonly PlannedShot[],
  facts: readonly ShotFact[] = [],
): ShotRow[] {
  const factByOrder = new Map(facts.map(f => [f.order, f]))

  return plan.map((shot) => {
    const fact = factByOrder.get(shot.order) ?? null
    const backgroundActual = fact?.backgroundActual ?? null
    const degradeReason = fact?.degradeReason ?? shot.degradeReason ?? null
    const status = fact?.status ?? 'planned'

    // Деградация — это либо явная причина от сервера, либо разошедшиеся план и
    // факт: запрошено видео, получена картинка. Одного статуса мало: кадр с
    // причиной может быть `completed` и всё равно остаться без фона.
    const degraded = degradeReason != null
      || status === 'degraded'
      || (backgroundActual != null && backgroundActual !== shot.background)

    return {
      order: shot.order,
      startSec: shot.startSec,
      endSec: shot.endSec,
      sceneOrder: shot.sceneOrder,
      idea: shot.idea,
      withPresenter: shot.foreground === 'presenter',
      pipEnabled: shot.pipEnabled === true,
      background: shot.background,
      backgroundActual,
      costUsd: fact?.costUsd ?? shot.costUsd ?? 0,
      status,
      degradeReason,
      degraded,
      // Платит повторная сборка ровно за то, что ПЛАН просит заново, а не за то,
      // что вышло в прошлый раз: перегенерация начинается с плана.
      rerenderPaid: PAID_SHOT_BACKGROUNDS.includes(shot.background as ShotBackground),
    }
  })
}

export function shotBackgroundLabel(value: string | null | undefined): string {
  if (value == null) return '—'
  return SHOT_BACKGROUND_LABELS[value as ShotBackground] ?? value
}

/**
 * Тон статуса кадра.
 *
 * Не `EntityStatus`: у деградировавшего кадра нет подходящего значения в общем
 * словаре — он собран и лежит в ролике, то есть не провал, но и не «Готово».
 * Ставить ему `review` значило бы соврать ярлыком.
 */
export function shotStatusTone(status: string | null | undefined, degraded = false): StatusTone {
  if (degraded) return 'warning'
  switch (status) {
    case 'completed': return 'success'
    case 'failed': return 'danger'
    case 'rendering': return 'info'
    case 'degraded': return 'warning'
    default: return 'neutral'
  }
}

export const SHOT_STATUS_LABELS: Record<string, string> = {
  planned: 'Запланирован',
  rendering: 'Собирается',
  completed: 'Готов',
  degraded: 'Деградировал',
  failed: 'Не собрался',
}

export function shotStatusLabel(status: string | null | undefined): string {
  return SHOT_STATUS_LABELS[status ?? ''] ?? (status ?? '—')
}

/** Сколько из потолка уже потрачено кадрами этого источника. */
export function spentOnBackground(rows: readonly ShotRow[], background: ShotBackground): number {
  return rows
    .filter(row => (row.backgroundActual ?? row.background) === background)
    .reduce((sum, row) => sum + (Number.isFinite(row.costUsd) ? row.costUsd : 0), 0)
}

// ─── Фразы озвучки ───────────────────────────────────────────────────────────

export interface SpokenScene {
  sceneOrder: number
  text: string
}

/**
 * Статусы, в которых сервер принимает правки озвучки
 * (`REPLACEABLE_VIDEO_STATUSES` в `segment-replace-runner.ts`). Дублируется на
 * клиенте не ради проверки, а ради честной подписи: кнопка должна объяснять,
 * почему она недоступна, до того как оператор получит 400.
 */
export const REPLACEABLE_VIDEO_STATUSES: readonly string[] = [
  'completed',
  'failed',
  'canceled',
  'awaiting_operator',
]

/**
 * Реплики сценария с их номерами сцен.
 *
 * Источник — тот же, что у сервера: сначала `voiceoverPlan.lines`, потом
 * `scenes[].spokenLine`. Сцены без реплики в список не попадают: заменять там
 * нечего.
 */
export function readSpokenScenes(storyPlan: unknown): SpokenScene[] {
  const plan = storyPlan as { scenes?: unknown, voiceoverPlan?: { lines?: unknown } } | null
  if (!plan || typeof plan !== 'object') return []

  const byOrder = new Map<number, string>()

  const scenes = Array.isArray(plan.scenes) ? plan.scenes : []
  for (const raw of scenes as Array<{ order?: unknown, spokenLine?: unknown }>) {
    const order = Number(raw?.order)
    const text = typeof raw?.spokenLine === 'string' ? raw.spokenLine.trim() : ''
    if (Number.isInteger(order) && text) byOrder.set(order, text)
  }

  const lines = Array.isArray(plan.voiceoverPlan?.lines) ? plan.voiceoverPlan.lines : []
  for (const raw of lines as Array<{ sceneOrder?: unknown, text?: unknown }>) {
    const order = Number(raw?.sceneOrder)
    const text = typeof raw?.text === 'string' ? raw.text.trim() : ''
    // Строка плана озвучки точнее: именно она уходит в синтез.
    if (Number.isInteger(order) && text) byOrder.set(order, text)
  }

  return [...byOrder.entries()]
    .map(([sceneOrder, text]) => ({ sceneOrder, text }))
    .sort((a, b) => a.sceneOrder - b.sceneOrder)
}

// ─── Пошаговый режим ─────────────────────────────────────────────────────────

export const STEPWISE_SOURCE_LABELS: Record<string, string> = {
  video: 'на ролике',
  profile: 'из профиля',
  default: 'по умолчанию',
}

/** Три состояния переключателя: `null` — «наследовать профиль», законное значение. */
export type StepwiseChoice = 'inherit' | 'on' | 'off'

export function stepwiseChoice(override: boolean | null | undefined): StepwiseChoice {
  if (override === true) return 'on'
  if (override === false) return 'off'
  return 'inherit'
}

export function stepwiseOverrideValue(choice: StepwiseChoice): boolean | null {
  if (choice === 'on') return true
  if (choice === 'off') return false
  return null
}

// ─── Смета дорогого действия ─────────────────────────────────────────────────

function isPreview(value: unknown): value is TrackRegenerationPreview {
  const p = value as Partial<TrackRegenerationPreview> | null
  return !!p
    && typeof p.shotsToRebuild === 'number'
    && typeof p.estimatedCostUsd === 'number'
}

/**
 * Смета из ответа 400 на перегенерацию трека.
 *
 * `ofetch` кладёт тело ошибки в `err.data`, а h3 заворачивает наши данные ещё
 * раз в `data` — то есть смета лежит на `err.data.data.preview`. Разбираем обе
 * формы: если однажды прослойка исчезнет, экран не онемеет.
 */
export function readTrackRegenerationPreview(error: unknown): TrackRegenerationPreview | null {
  const err = error as { data?: { preview?: unknown, data?: { preview?: unknown } } } | null
  const nested = err?.data?.data?.preview
  if (isPreview(nested)) return nested
  const flat = err?.data?.preview
  if (isPreview(flat)) return flat
  return null
}

/** Ответ 200 «сделано» / «делать нечего» тоже несёт смету. */
export function readTrackRegenerationResult(
  payload: unknown,
): { regenerated: boolean, reason: string | null, preview: TrackRegenerationPreview | null } {
  const data = (payload as { data?: Record<string, unknown> } | null)?.data ?? null
  return {
    regenerated: data?.regenerated === true,
    reason: typeof data?.reason === 'string' ? data.reason : null,
    preview: isPreview(data?.preview) ? data.preview : null,
  }
}

// ─── Проверка образца голоса ─────────────────────────────────────────────────

/**
 * Локальная проверка образца — до платного вызова.
 *
 * Сервер проверяет то же самое и отвечает 415/413/422, но заставлять оператора
 * узнавать про формат после загрузки 25 МБ незачем.
 */
export function voiceSampleRejection(file: { name: string, size: number } | null): string | null {
  if (!file) return null
  const lower = file.name.toLowerCase()
  const ok = ['.mp3', '.m4a', '.wav'].some(ext => lower.endsWith(ext))
  if (!ok) return 'Нужен файл MP3, M4A или WAV'
  if (file.size > 20 * 1024 * 1024) {
    return `Образец ${(file.size / 1024 / 1024).toFixed(1)} МБ, предел модели 20 МБ`
  }
  return null
}
