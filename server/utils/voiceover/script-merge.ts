/**
 * Один голос ролика из двух потоков речи.
 *
 * Исторически речь разделена: `scene.spokenLine` — то, что ведущий говорит в
 * кадре (его потребляет lip-sync), `voiceoverPlan.lines[]` — закадровый
 * нарратор (его потребляет шаг озвучки). Для зрителя это один и тот же человек,
 * и на audio-first маршруте текст ролика единый (решение владельца 16.08).
 *
 * Приоритет реплики в кадре над закадровой строкой той же сцены не вкусовой: в
 * противном случае на один отрезок времени пришлось бы два голоса.
 */

export interface MergeScriptInput {
  scenes: Array<{ order: number, spokenLine: string | null }>
  voiceoverLines: Array<{ sceneOrder: number, text: string }>
}

export interface MergedScene {
  order: number
  text: string
  source: "spoken" | "narration"
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim()
}

export function mergeScriptLines(input: MergeScriptInput): MergedScene[] {
  const narration = new Map<number, string>()
  for (const line of input.voiceoverLines) {
    const text = clean(line.text)
    if (text) narration.set(line.sceneOrder, text)
  }

  const merged: MergedScene[] = []
  const seen = new Set<number>()

  for (const scene of input.scenes) {
    seen.add(scene.order)
    const spoken = clean(scene.spokenLine)
    if (spoken) {
      merged.push({ order: scene.order, text: spoken, source: "spoken" })
      continue
    }
    const narrated = narration.get(scene.order)
    if (narrated) merged.push({ order: scene.order, text: narrated, source: "narration" })
  }

  // Строка нарратора, у которой нет своей сцены, всё равно звучит в ролике:
  // потерять её значило бы потерять кусок сценария.
  for (const [order, text] of narration) {
    if (!seen.has(order)) merged.push({ order, text, source: "narration" })
  }

  return merged.sort((a, b) => a.order - b.order)
}
