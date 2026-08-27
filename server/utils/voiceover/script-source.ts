/**
 * Откуда ролик берёт свой сценарий.
 *
 * Источников два, и путать их нельзя: ОБЩИЙ текст живёт в
 * `ScenarioVariant.storyPlan` (его читают все ролики варианта), а правки
 * реплик, сделанные оператором на КОНКРЕТНОМ ролике, — в
 * `Video.scriptOverrides`. Наложение одно на другое и есть «сценарий этого
 * ролика»: именно из него полная перегенерация собирает трек озвучки.
 *
 * Функция здесь одна на всех потребителей (порт раннера замены, ручка
 * перегенерации трека, тесты) намеренно: заведись у каждого своя пара
 * запросов, один из них рано или поздно прочитал бы общий вариант без правок —
 * и ролик оплатил бы синтез текста, который оператор уже переписал.
 */

import {
  applyScriptOverrides,
  planVideoSubtitleOverride,
  type SubtitleScenePatch,
} from "./script-overrides"

export interface VideoScriptSource {
  /** Общий сценарий варианта — без правок ролика. */
  storyPlan: unknown
  /** Сырое содержимое `Video.scriptOverrides`. null — правок не было. */
  overrides: unknown
}

/**
 * Сырые источники сценария ролика.
 *
 * `null` означает «сценария нет вовсе»: ролик без варианта (legacy или
 * отвязанный) или вариант, которого уже нет. Это НЕ ошибка — у такого ролика
 * трек может быть и правиться законно, просто записать новый текст некуда.
 */
export async function loadVideoScriptSource(videoId: number): Promise<VideoScriptSource | null> {
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { variantId: true, scriptOverrides: true },
  })
  if (!video?.variantId) return null

  const variant = await prisma.scenarioVariant.findUnique({
    where: { id: video.variantId },
    select: { storyPlan: true },
  })
  if (!variant) return null

  return { storyPlan: variant.storyPlan, overrides: video.scriptOverrides ?? null }
}

/**
 * Сценарий ролика с уже наложенными правками — то, из чего собирается трек.
 *
 * У ролика без правок возвращается ТОТ ЖЕ объект варианта: копия плана не
 * заводится никогда.
 */
export async function loadVideoStoryPlan(videoId: number): Promise<unknown> {
  const source = await loadVideoScriptSource(videoId)
  if (!source) return null
  return applyScriptOverrides(source.storyPlan, source.overrides)
}

export interface SaveSubtitleOverridesResult {
  /** Что-то реально записано в ролик. `false` — писать было нечего. */
  changed: boolean
  /** Сколько сцен поправлено. */
  patched: number
  /** Почему не записано, когда `changed: false` по причине отказа. */
  reason?: string
}

/**
 * Правка ПОДПИСЕЙ конкретного ролика.
 *
 * Одна точка записи на всех: ручку `edit-subtitles` и тесты. Заведись у ручки
 * свой `prisma.video.update`, рано или поздно он разошёлся бы с наложением —
 * ровно та дыра, из-за которой правка субтитров и уезжала в общий вариант.
 *
 * Ролик без варианта (legacy или отвязанный) — не ошибка прогона: писать
 * подписи некуда, но и падать не за что. Возвращаем причину, вызывающий решает
 * сам.
 */
export async function saveVideoSubtitleOverrides(
  videoId: number,
  scenes: readonly SubtitleScenePatch[],
): Promise<SaveSubtitleOverridesResult> {
  if (scenes.length === 0) return { changed: false, patched: 0 }

  const source = await loadVideoScriptSource(videoId)
  if (!source) {
    return { changed: false, patched: 0, reason: "у ролика нет сценария: вариант не привязан или удалён" }
  }

  const plan = planVideoSubtitleOverride({
    storyPlan: source.storyPlan,
    overrides: source.overrides,
    scenes,
  })
  if (!plan.ok) return { changed: false, patched: 0, reason: plan.reason }
  // Ничего не изменилось — не трогаем ролик вовсе: лишний UPDATE тянет за собой
  // лишнюю пересборку mp4 на каждый клик «сохранить».
  if (!plan.changed) return { changed: false, patched: 0 }

  await prisma.video.update({
    where: { id: videoId },
    data: { scriptOverrides: plan.overrides as never },
  })
  return { changed: true, patched: plan.patched }
}
