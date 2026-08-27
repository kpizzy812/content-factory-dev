/**
 * Правка реплики в СЦЕНАРИИ ролика (`ScenarioVariant.storyPlan`).
 *
 * Трек озвучки — производная сценария, а не источник истины: полная
 * перегенерация (`runAudioFirstVoiceover`) собирает его заново из
 * `storyPlan.scenes[].spokenLine` и `storyPlan.voiceoverPlan.lines[]`. Поэтому
 * локальная замена фразы, поправившая только трек, живёт до первой же
 * перегенерации — а потом молча возвращает СТАРЫЙ текст и стирает правку,
 * за которую оператор уже заплатил.
 *
 * Куда именно писать, решает тот же приоритет, что и у сборки трека
 * (`mergeScriptLines`): реплика ведущего в кадре главнее закадровой строки той
 * же сцены. Ошибись мы стороной — закадровая сцена получила бы `spokenLine`,
 * то есть говорящего в кадре ведущего там, где его не было, и ролик оплатил бы
 * лишний lip-sync.
 *
 * Патч storyPlan в этом проекте — уже существующий приём: ровно так
 * `edit-subtitles.post.ts` правит `subtitleCopy` и `subtitlePlacement` сцены.
 *
 * Функция чистая и вход не мутирует: наружу уходит КОПИЯ storyPlan, которую
 * вызывающий записывает одной транзакцией со снапшотами шагов.
 */

export type ScriptTextTarget = "spoken" | "narration"

export type ScriptTextPatch =
  | {
    ok: true
    /** Куда легла правка: реплика в кадре или закадровая строка. */
    target: ScriptTextTarget
    /** Копия сценария с новым текстом. */
    storyPlan: Record<string, unknown>
    /** `false` — в сценарии уже ровно этот текст, писать нечего. */
    changed: boolean
  }
  | { ok: false, reason: string }

interface StoryScene {
  order?: unknown
  spokenLine?: unknown
}

interface NarrationLine {
  sceneOrder?: unknown
  text?: unknown
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function planScriptTextPatch(input: {
  storyPlan: unknown
  sceneOrder: number
  newText: string
}): ScriptTextPatch {
  const newText = input.newText.trim()
  if (!newText) return { ok: false, reason: "пустой текст" }

  const plan = input.storyPlan as Record<string, unknown> | null | undefined
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return { ok: false, reason: "у ролика нет сценария (storyPlan)" }
  }

  const scenes = Array.isArray(plan.scenes) ? (plan.scenes as StoryScene[]) : null
  const voiceoverPlan = (plan.voiceoverPlan ?? null) as Record<string, unknown> | null
  const lines = Array.isArray(voiceoverPlan?.lines) ? (voiceoverPlan!.lines as NarrationLine[]) : null

  const scene = scenes?.find(item => Number(item.order) === input.sceneOrder) ?? null
  const lineIndex = lines?.findIndex(line => Number(line.sceneOrder) === input.sceneOrder) ?? -1
  const line = lineIndex >= 0 ? lines![lineIndex]! : null

  if (!scene && !line) {
    return { ok: false, reason: `сцены ${input.sceneOrder} нет в сценарии` }
  }

  /**
   * Закадровая строка правится только тогда, когда трек её и произносил, —
   * то есть когда реплики в кадре у сцены нет. Иначе `mergeScriptLines`
   * закадровую строку вообще не читает, и правка в неё была бы записью в никуда.
   */
  const spokenWins = !!scene && textOf(scene.spokenLine).length > 0
  if (!spokenWins && line) {
    if (textOf(line.text) === newText) {
      return { ok: true, target: "narration", storyPlan: plan, changed: false }
    }
    return {
      ok: true,
      target: "narration",
      changed: true,
      storyPlan: {
        ...plan,
        voiceoverPlan: {
          ...voiceoverPlan,
          lines: lines!.map((item, index) => (index === lineIndex ? { ...item, text: newText } : item)),
        },
      },
    }
  }

  if (!scene) {
    return { ok: false, reason: `сцены ${input.sceneOrder} нет в сценарии` }
  }

  if (textOf(scene.spokenLine) === newText) {
    return { ok: true, target: "spoken", storyPlan: plan, changed: false }
  }
  return {
    ok: true,
    target: "spoken",
    changed: true,
    storyPlan: {
      ...plan,
      scenes: scenes!.map(item => (
        Number(item.order) === input.sceneOrder ? { ...item, spokenLine: newText } : item
      )),
    },
  }
}
