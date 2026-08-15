/**
 * Сопоставление «сцена storyPlan → клип на диске» для шага lip-sync.
 *
 * Зачем отдельный модуль: раньше runner искал клип запросом
 * `videoAsset.findFirst({ order: scene.order })`, но order в storyPlan 1-based
 * (scene-planner: «order — порядковый номер сцены, начиная с 1»), а клипы
 * сохраняются в runClipGeneration с order = индекс цикла, то есть 0-based.
 * Из-за этого реплика сцены N уезжала на клип сцены N+1, а последняя сцена
 * всегда получала «не найден клип в БД». Единственный надёжный ключ —
 * ПОЗИЦИЯ сцены в videoPlan.scenes: она же индекс клипа в clipPaths и она же
 * order у VideoAsset(type=clip).
 *
 * Логика здесь чистая (без БД, сети и ffmpeg), чтобы её можно было накрыть
 * DB-free тестом.
 */

import { createHash } from "node:crypto"

export interface SceneOrderLike {
  order: number
}

/**
 * Строит Map<scene.order → индекс клипа в clipPaths>.
 *
 * Главный источник истины — clipSceneOrders: order'ы сцен в том порядке, в котором
 * реально нарезались клипы (prompts.scenePrompts.scenes). Этот порядок задаёт Claude,
 * и совпадать с videoPlan.scenes он не обязан: при ответе [1,2,4,3,5] clipPaths[2] —
 * это клип сцены 4, а не сцены 3. Позиция сцены в videoPlan.scenes остаётся только
 * фолбэком на случай, когда порядок клипов неизвестен.
 */
export interface SceneClipIndexOptions {
  /**
   * Разрешить фолбэк «позиция сцены в videoPlan.scenes = индекс клипа».
   *
   * По умолчанию true — фолбэк остаётся для потребителей, которым приблизительная
   * карта лучше пустой. Но для платных операций (lip-sync) его надо выключать:
   * порядок клипов задаёт Claude в prompts.scenePrompts.scenes, и при перестановке
   * позиционная догадка отдаёт сцене ЧУЖОЙ клип — реплика ляжет не на тот кадр,
   * причём за деньги. Пропустить сцену честнее.
   */
  allowPositionalFallback?: boolean
}

export function buildSceneClipIndexMap(
  scenes: readonly SceneOrderLike[],
  clipSceneOrders?: readonly number[] | null,
  options?: SceneClipIndexOptions,
): Map<number, number> {
  const map = new Map<number, number>()

  if (clipSceneOrders && clipSceneOrders.length > 0) {
    clipSceneOrders.forEach((order, index) => {
      // Дубликат order — побеждает первый клип, остальные останутся ничьими:
      // отдать сцене чужой клип хуже, чем не синхронизировать её вовсе.
      if (Number.isFinite(order) && !map.has(order)) map.set(order, index)
    })
    // Порядок клипов известен точно — досочинять позиции для сцен, которых в нём
    // нет, нельзя: у такой сцены клипа попросту не существует.
    return map
  }

  if (options?.allowPositionalFallback === false) return map

  scenes.forEach((scene, index) => {
    // Claude иногда присылает повторяющиеся order — побеждает первая позиция,
    // иначе поздняя сцена перетянула бы на себя чужой клип (тот же класс бага,
    // из-за которого key клипа завязан на индекс цикла, а не на s.order).
    if (!map.has(scene.order)) map.set(scene.order, index)
  })

  return map
}

/**
 * Признак файла, который УЖЕ прошёл lip-sync. Такой путь нельзя брать источником:
 * синхронизация ляжет поверх синхронизации, а TTS и lip-sync будут оплачены заново.
 *
 * Ловим не только сам `_lipsync.mp4`, но и его производные: политика
 * voiceoverReconciliation='extend_scene' делает из клипа `<клип>_ext.mp4` и пишет
 * результат в VideoAsset(type=clip).filePath — то есть после удлинения в БД лежит
 * `scene_N_lipsync_ext.mp4`. По старому признаку такой файл считался «оригиналом»
 * и на следующем прогоне уезжал в модель источником.
 */
export function isLipSyncOutputPath(path: string | null | undefined): boolean {
  return typeof path === "string" && /_lipsync(_[a-z0-9]+)*\.mp4$/i.test(path.trim())
}

/** Откуда взят исходный клип сцены — нужно для внятного лога расхождений. */
export type SceneSourceOrigin = "clip_paths" | "snapshot" | "db_asset" | "none"

export interface SceneSourceResolution {
  path: string | null
  origin: SceneSourceOrigin
  /** filePath ассета разошёлся с выбранным источником (обычно в БД уже лежит *_lipsync.mp4). */
  mismatch: boolean
}

/**
 * Выбирает исходный клип сцены. Приоритет: clipPaths шага clip_generation →
 * явно сохранённый в снапшоте исходник → filePath ассета. Пути, похожие на
 * результат прошлого lip-sync, отбрасываются на любом уровне приоритета.
 */
export function resolveSceneSourcePath(input: {
  sceneIndex: number
  clipPaths: readonly string[]
  assetFilePath?: string | null
  snapshotSourcePath?: string | null
}): SceneSourceResolution {
  const candidates: Array<{ path: string | null | undefined; origin: SceneSourceOrigin }> = [
    { path: input.clipPaths[input.sceneIndex], origin: "clip_paths" },
    { path: input.snapshotSourcePath, origin: "snapshot" },
    { path: input.assetFilePath, origin: "db_asset" },
  ]

  const assetPath = typeof input.assetFilePath === "string" ? input.assetFilePath.trim() : ""

  for (const candidate of candidates) {
    const path = typeof candidate.path === "string" ? candidate.path.trim() : ""
    if (!path || isLipSyncOutputPath(path)) continue
    return {
      path,
      origin: candidate.origin,
      mismatch: assetPath.length > 0 && assetPath !== path,
    }
  }

  return { path: null, origin: "none", mismatch: false }
}

/**
 * Допуск на границах диапазона модели.
 *
 * Длительность MP4 в контейнере почти никогда не равна номиналу: Kling отдаёт клип
 * «на 10 секунд», а format.duration показывает 10.03-10.2 с (последний кадр + округление
 * таймбазы). Модель kwaivgi/kling-lip-sync объявляет максимум ровно 10 с, а сцены
 * планировщик клампит именно к 10 с — то есть верхняя граница это не редкий край,
 * а самый частый случай в проде. Без допуска такая сцена выпадала из диапазона по
 * сотым секунды и молча теряла lip-sync навсегда.
 *
 * Четверть секунды покрывает контейнерную погрешность и при этом не пропускает
 * реально чужие по длине исходники (12 с при пределе 10 с как были вне диапазона,
 * так и остаются).
 */
export const MODEL_DURATION_TOLERANCE_SEC = 0.25

/**
 * Реальная длительность источника должна лежать в диапазоне модели
 * (kling-lip-sync — 2-10 с) с точностью до допуска. Иначе получим рассинхрон
 * и уехавший хронометраж.
 */
export function isDurationWithinModelRange(
  durationSec: number,
  minDurationSec: number,
  maxDurationSec: number,
  toleranceSec: number = MODEL_DURATION_TOLERANCE_SEC,
): boolean {
  if (!Number.isFinite(durationSec)) return false
  const tolerance = Number.isFinite(toleranceSec) && toleranceSec > 0 ? toleranceSec : 0
  return durationSec >= minDurationSec - tolerance && durationSec <= maxDurationSec + tolerance
}

/**
 * Зажимает измеренную длительность в объявленный моделью диапазон.
 *
 * Именно это значение уходит в runLipSync: провайдер валидирует durationSec строго
 * (`< min || > max`, без допуска), и «как измерено» 10.03 с уронило бы вызов, который
 * мы только что признали допустимым. Отклонение здесь всегда в пределах допуска —
 * сцены за его границами до этого места не доходят.
 */
export function clampDurationToModelRange(
  durationSec: number,
  minDurationSec: number,
  maxDurationSec: number,
): number {
  if (!Number.isFinite(durationSec)) return durationSec
  if (!Number.isFinite(minDurationSec) || !Number.isFinite(maxDurationSec)) return durationSec
  if (minDurationSec > maxDurationSec) return durationSec
  return Math.min(maxDurationSec, Math.max(minDurationSec, durationSec))
}

/**
 * Можно ли подставить результат сцены в clipPaths по этому индексу.
 *
 * Присваивание за длиной массива молча расширяет его дырами (undefined), а дыры
 * дальше уезжают в сборку как «пути клипов». Индекс приходит из снапшота
 * prompt_generation, а длина — из снапшота clip_generation: при их рассинхроне
 * (сброшенный шаг, перегенерация части клипов) индекс вполне может быть больше.
 */
export function isAssignableClipIndex(index: number, clipPathsLength: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < clipPathsLength
}

/** Позиции пустых (отсутствующих или пробельных) путей в итоговом списке клипов. */
export function findEmptyClipPathIndexes(paths: readonly unknown[]): number[] {
  const empty: number[] = []
  for (let index = 0; index < paths.length; index++) {
    const value = paths[index]
    if (typeof value !== "string" || value.trim().length === 0) empty.push(index)
  }
  return empty
}

/** Есть ли в ячейке путь клипа (пробельная строка — та же дыра, что и пустая). */
export function hasClipPath(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

/**
 * Разворачивает ПЛОТНЫЙ список клипов (снапшот старого формата) в список по сценам.
 *
 * До 15.08.2026 `runClipGeneration` складывал пути подряд и пропускал сцены ведущей:
 * на девять сцен приходило шесть путей, а адресовались они индексом сцены. Новый
 * контракт — длина по числу сцен и пустая ячейка там, где своего клипа нет.
 *
 * Возвращает null, когда арифметика не сходится (путей + сцен ведущей ≠ числу сцен):
 * достроить такую карту можно только догадкой, а догадка здесь означает клип чужой
 * сцены. Вызывающий обязан пересобрать список сам — это дешевле, чем ошибиться:
 * шаг поднимает готовые клипы с диска по order ассета и повторно за них не платит.
 */
export function restoreSceneIndexedClipPaths(
  storedPaths: readonly string[],
  sceneCount: number,
  presenterSceneIndexes: readonly number[],
): string[] | null {
  if (!Number.isInteger(sceneCount) || sceneCount < 0) return null
  // Длина уже по сценам — список либо новый, либо у ролика вовсе нет сцен ведущей.
  if (storedPaths.length === sceneCount) return [...storedPaths]

  const presenter = new Set(presenterSceneIndexes.filter(i => Number.isInteger(i) && i >= 0 && i < sceneCount))
  if (storedPaths.length + presenter.size !== sceneCount) return null

  const restored = new Array<string>(sceneCount).fill("")
  let cursor = 0
  for (let sceneIndex = 0; sceneIndex < sceneCount; sceneIndex++) {
    if (presenter.has(sceneIndex)) continue
    restored[sceneIndex] = storedPaths[cursor] ?? ""
    cursor++
  }
  return restored
}

/** Список клипов под склейку плюс карта «индекс сцены → позиция в склейке». */
export interface CompactedSceneClips {
  /** Пути в порядке склейки — без пустых ячеек. */
  clips: string[]
  /** Индекс сцены → её позиция в `clips`. Сцены без клипа в карте нет. */
  positionBySceneIndex: Map<number, number>
  /** Сцены, у которых клипа нет: в ролик они не попадут. */
  missingSceneIndexes: number[]
}

/**
 * Схлопывает список «по сценам» в список под ffmpeg concat.
 *
 * Это ЕДИНСТВЕННОЕ место, где пустые ячейки исчезают: дальше по потоку индексы
 * снова означают позицию в склейке, и субтитры обязаны переехать вместе с ними.
 */
export function compactSceneClipPaths(paths: readonly string[]): CompactedSceneClips {
  const clips: string[] = []
  const positionBySceneIndex = new Map<number, number>()
  const missingSceneIndexes: number[] = []

  for (let sceneIndex = 0; sceneIndex < paths.length; sceneIndex++) {
    const path = paths[sceneIndex]
    if (!hasClipPath(path)) {
      missingSceneIndexes.push(sceneIndex)
      continue
    }
    positionBySceneIndex.set(sceneIndex, clips.length)
    clips.push(path.trim())
  }

  return { clips, positionBySceneIndex, missingSceneIndexes }
}

export interface PresenterCandidateLike {
  durationSec: number
}

/**
 * Предел расхождения длительности исходника ведущего с плановой длиной сцены.
 *
 * Lip-sync отдаёт ролик длиной ИСХОДНИКА, поэтому подставленный клип ведущего
 * напрямую переписывает хронометраж сцены. Секунда — компромисс: требовать точного
 * совпадения нельзя (ingest режет записи по речевым паузам, ровных длительностей
 * там нет), а пять секунд разницы уже выбивают ролик из целевых 70-90 с.
 */
export const DEFAULT_PRESENTER_MAX_DELTA_SEC = 1

export interface PickPresenterCandidateOptions {
  /** Люфт, в пределах которого две длительности считаем одинаково близкими. */
  tolerance?: number
  /** Жёсткий предел |длительность - target|; за ним кандидат не подходит вообще. */
  maxDeltaSec?: number
}

/**
 * Выбирает исходник ведущего, ближайший по длительности к плановой длине сцены.
 * Кандидаты приходят уже отсортированными «наименее использованный первым», и этот
 * порядок остаётся вторичным критерием: при равной близости (в пределах tolerance)
 * побеждает тот, кто выше в списке.
 *
 * Кандидат дальше maxDeltaSec от target не берётся вообще: раньше «ближайший» из
 * пула означал «хоть какой-нибудь», и сцене на 9 с могли отдать клип на 2.5 с —
 * формально внутри диапазона модели, фактически минус 6.5 с хронометража.
 */
export function pickClosestPresenterCandidate<T extends PresenterCandidateLike>(
  candidates: readonly T[],
  targetSec: number,
  options?: PickPresenterCandidateOptions,
): T | null {
  const tolerance = options?.tolerance ?? 0.05
  const maxDeltaSec = options?.maxDeltaSec ?? DEFAULT_PRESENTER_MAX_DELTA_SEC
  let best: T | null = null
  let bestDelta = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.durationSec)) continue
    const delta = Math.abs(candidate.durationSec - targetSec)
    if (delta > maxDeltaSec) continue
    // Строго ближе с запасом на tolerance — иначе микроразница в 0.01с перебила бы
    // приоритет «наименее использованный», ради которого и делалась ротация.
    if (delta < bestDelta - tolerance) {
      best = candidate
      bestDelta = delta
    }
  }

  return best
}

/**
 * Под какую длительность подбирать фрагмент ведущей.
 *
 * План сцены — намерение сценариста, а не факт. Факт создаёт TTS: реплика на
 * 77 символов звучит 5.9 с, а сцена может быть запланирована на 9-10. Фрагмент,
 * взятый под план, длиннее речи, и `kling-lip-sync` синхронизирует губы только
 * на длину аудио — остаток идёт исходным видео, где человек говорит, а звука
 * уже нет. На ролике 21 таких дыр набралось 20 секунд из 50.
 *
 * Поэтому целью служит измеренная речь, и только пока её нет — план.
 * Негодный замер (ноль, NaN, отрицательное) планом НЕ подменяется молча:
 * ноль означал бы поиск фрагмента нулевой длины, то есть сцену без ведущей.
 */
export function presenterTargetDuration(
  speechDurationSec: number | null | undefined,
  plannedDurationSec: number,
): number {
  if (typeof speechDurationSec !== "number") return plannedDurationSec
  if (!Number.isFinite(speechDurationSec) || speechDurationSec <= 0) return plannedDurationSec
  return speechDurationSec
}

/**
 * Годится ли реально измеренный исходник под плановую длину сцены.
 *
 * Проверка диапазона модели этого не ловит: 2.5-секундный клип ведущего для сцены
 * на 9 с проходит «2-10 с» и молча укорачивает сцену на 6.5 с. Сверяемся именно с
 * ПЛАНОВОЙ длительностью (не с зажатой в диапазон модели): сцену, которая в модель
 * не влезает, честнее оставить несинхронизированной, чем ужать до размера исходника.
 */
export function isSourceDurationCloseToScene(
  measuredDurationSec: number,
  sceneDurationSec: number,
  maxDeltaSec = DEFAULT_PRESENTER_MAX_DELTA_SEC,
): boolean {
  if (!Number.isFinite(measuredDurationSec) || !Number.isFinite(sceneDurationSec)) return false
  return Math.abs(measuredDurationSec - sceneDurationSec) <= maxDeltaSec
}

/**
 * Хэш текста реплики: по нему решаем, годится ли уже синтезированный TTS-файл
 * сцены. Без этого шаг переозвучивал одну и ту же фразу при каждом рестарте.
 */
export function hashSpokenLine(text: string): string {
  return createHash("sha1").update(text.trim()).digest("hex")
}

/** Параметры синтеза речи, от которых зависит САМ звук реплики. */
export interface SpeechIdentity {
  spokenLine: string
  voiceoverModelId: string | null
  voiceoverVoiceId: string | null
  voiceoverLanguage: string | null
  voiceoverPacing: string | null
}

/**
 * Отпечаток синтезированной реплики — им именуется mp3 на диске.
 *
 * Одного текста мало: смена голоса, TTS-модели, языка или темпа даёт ДРУГОЙ звук
 * при том же тексте, а файл с именем по хэшу текста переиспользовался как
 * подходящий — сцена уезжала в lip-sync со старым голосом.
 */
export function hashSpeechIdentity(identity: SpeechIdentity): string {
  return createHash("sha1")
    .update([
      identity.spokenLine.trim(),
      identity.voiceoverModelId ?? "",
      identity.voiceoverVoiceId ?? "",
      identity.voiceoverLanguage ?? "",
      identity.voiceoverPacing ?? "",
    ].join(" "))
    .digest("hex")
}

/** Всё, от чего зависит годность уже готового lip-sync файла сцены. */
export interface LipSyncReuseFingerprint extends SpeechIdentity {
  /** Путь исходного (не синхронизированного) клипа сцены. */
  sourcePath: string
  /**
   * Отпечаток содержимого исходника (размер+mtime) либо null, если файл недоступен.
   * Путь после перегенерации клипов не меняется (scene_N_clip.mp4), поэтому без
   * отпечатка «новый клип» неотличим от «тот же клип».
   */
  sourceSignature: string | null
  /** Персонаж-ведущий: другой человек в кадре — другой ролик, текст тут ни при чём. */
  lipSyncCharacterId: string | null
  /** Запрошенная в конфиге lip-sync модель. */
  lipSyncModelId: string | null
}

/**
 * Ключ переиспользования готового lip-sync сцены.
 *
 * Раньше ключом был только хэш текста реплики: смена персонажа, голоса, TTS-модели
 * или перегенерация исходного клипа старый файл не инвалидировали, и сцена
 * оставалась с lip-sync поверх устаревшего источника. Ключ намеренно строковый и
 * складывается в снапшот сцены — запись без него (старый прогон) просто не
 * переиспользуется, вместо того чтобы врать.
 */
export function buildLipSyncReuseKey(fingerprint: LipSyncReuseFingerprint): string {
  return createHash("sha1")
    .update([
      "v1",
      hashSpeechIdentity(fingerprint),
      fingerprint.sourcePath.trim(),
      fingerprint.sourceSignature ?? "unknown",
      fingerprint.lipSyncCharacterId ?? "",
      fingerprint.lipSyncModelId ?? "",
    ].join(" "))
    .digest("hex")
}
