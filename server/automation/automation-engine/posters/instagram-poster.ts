/**
 * Instagram Reel-постер для DuoPlus ADB-движка (Этап 3, фаза P8).
 *
 * Калибровка ДОКАЗАНА на реальном устройстве — Reel опубликован
 * (см. researcher/duoplus_instagram_poster_calibration.md). Весь flow идёт через
 * REST `cloudPhone/command` (стратегия A1) — БЕЗ adb-клиента/Appium/браузера.
 *
 * Навигация — по семантике (`findNode` по content-desc / text); координаты из
 * калибровки оставлены fallback'ом, когда узел не нашёлся. Уроки калибровки,
 * вшитые в flow:
 *  1. IG Create = свайп ВПРАВО (`input swipe 150 960 950 960 250`), НЕ кнопка
 *     нав-бара (навбар = Home/Reels/Message/Search/Profile, без Create).
 *  2. Permissions (камера/микрофон/photos) при ПЕРВОМ create ПРЕРЫВАЮТ свайп →
 *     после разрешений вернулись на feed → повторить свайп.
 *  3. Много промо-оверлеев (map «Not now», reuse «OK», audio) → dismissPromos.
 *  4. dump таймаутит на feed/editor/uploading (анимации) → `--compressed` +
 *     success-detection по `currentActivity` (MainTabActivity = на главном).
 *  5. Visibility по умолчанию Public — отдельный шаг НЕ нужен (в отличие от YouTube).
 *
 * Каждая device-команда атомарна (≤10с); ожидание экрана = повторный dump (poll),
 * НЕ sleep-в-команде. Таймауты flow ≥90с, переходы с retry (правило проекта).
 */

import {
  dismissPromos,
  dumpUi,
  findNode,
  handlePermissions,
  inputText,
  keyevent,
  launchApp,
  swipe,
  tapNode,
  tapXY,
  currentActivity,
  type UiNode,
} from "../adb-shell"
import { PostingPhaseError, type PostingPhase } from "../../posters/types"

/** Package Instagram-приложения. */
const INSTAGRAM_PKG = "com.instagram.android"

/** KEYCODE_BACK — закрыть экранную клавиатуру после ввода caption. */
const KEYCODE_BACK = 4

/** Координата успешной активности — вернулись на главную = Reel опубликован. */
const MAIN_TAB_ACTIVITY = "MainTabActivity"

/** Свайп открытия Create: справа из центра по вертикали (1080×1920). */
const CREATE_SWIPE = { x1: 150, y1: 960, x2: 950, y2: 960, durationMs: 250 } as const

/** Координаты-fallback из калибровки (1080×1920). Используются, если findNode не нашёл узел. */
const COORD = {
  reel: { x: 730, y: 1685 }, // таб «REEL» в camera-create
  gallery: { x: 102, y: 1683 }, // «Gallery» (низ-лево)
  nextEditor: { x: 933, y: 1711 }, // «Next» из Reel-editor
  caption: { x: 540, y: 1243 }, // поле «Write a caption»
  nextDetails: { x: 798, y: 1650 }, // «Next» из details
  share: { x: 540, y: 1530 }, // «Share» — публикация
} as const

/** Параметры Instagram Reel-постинга. */
export interface PostInstagramReelParams {
  /** image_id устройства DuoPlus. */
  imageId: string
  /** Путь к уже залитому видео на устройстве (`/sdcard/DCIM/<jobId>.mp4`, от P3 media-push). */
  deviceVideoPath: string
  /** Подпись Reel (caption). Вводится в поле «Write a caption». */
  caption: string
}

/** Результат публикации Reel. */
export interface PostInstagramReelResult {
  /** Подтверждено ли по activity (вернулись на MainTabActivity = опубликовано). */
  published: true
}

/** Таймаут одного шага навигации (мс) — ≥90с по правилу проекта. */
const STEP_TIMEOUT_MS = 90_000
/** Число попыток poll-dump на шаг (≥3 по правилу проекта). */
const STEP_DUMP_RETRIES = 6

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Имя файла из device-пути (`/sdcard/DCIM/job-1.mp4` → `job-1.mp4`). */
function basename(devicePath: string): string {
  const parts = devicePath.split("/")
  return parts[parts.length - 1] ?? devicePath
}

/**
 * Poll-dump до появления узла по запросу. Возвращает дерево узлов и найденный
 * узел. Бросает PostingPhaseError(selector_not_found) на phase, если за ретраи
 * узел не появился. Между поллами — короткая пауза на HTTP-уровне (НЕ device-side).
 * На IG всегда `--compressed` (feed/editor анимированы, обычный dump таймаутит).
 */
async function waitForNode(
  imageId: string,
  match: (nodes: UiNode[]) => UiNode | null,
  phase: PostingPhase,
  description: string,
): Promise<{ nodes: UiNode[]; node: UiNode }> {
  const deadline = Date.now() + STEP_TIMEOUT_MS
  let lastNodes: UiNode[] = []
  for (let attempt = 0; attempt < STEP_DUMP_RETRIES && Date.now() < deadline; attempt += 1) {
    lastNodes = await dumpUi(imageId, { compressed: true })
    const found = match(lastNodes)
    if (found) return { nodes: lastNodes, node: found }
    if (attempt < STEP_DUMP_RETRIES - 1) await sleep(1_000)
  }
  throw new PostingPhaseError(
    `Instagram Reel: не дождался экрана «${description}» (${lastNodes.length} узлов в последнем dump)`,
    phase,
    "selector_not_found",
  )
}

/**
 * Тап по найденному узлу, либо fallback по координате из калибровки, если узел
 * не нашёлся. Возвращает true, если тапнули по узлу (а не по координате).
 */
async function tapNodeOrCoord(
  imageId: string,
  node: UiNode | null,
  fallback: { x: number; y: number },
): Promise<boolean> {
  if (node) {
    await tapNode(imageId, node)
    return true
  }
  await tapXY(imageId, fallback.x, fallback.y)
  return false
}

/** Открывает Create свайпом вправо по feed (НЕ кнопкой — у IG её нет в навбаре). */
async function openCreateBySwipe(imageId: string): Promise<void> {
  await swipe(
    imageId,
    CREATE_SWIPE.x1,
    CREATE_SWIPE.y1,
    CREATE_SWIPE.x2,
    CREATE_SWIPE.y2,
    CREATE_SWIPE.durationMs,
  )
}

/**
 * Публикует Instagram Reel по доказанному калибровкой flow:
 * launch IG → permissions(notifications) → свайп(Create) → permissions(камера/
 * микрофон/photos) → ПОВТОРИТЬ свайп → REEL → Gallery → выбор видео → Next →
 * dismissPromos → caption → Next → dismissPromos → Share → success по activity.
 */
export async function postInstagramReel(
  params: PostInstagramReelParams,
): Promise<PostInstagramReelResult> {
  const { imageId, deviceVideoPath, caption } = params
  const filename = basename(deviceVideoPath)

  // --- Шаг 1: launch IG (re-launch — приложение могло свернуться за время заливки). ---
  await launchApp(imageId, INSTAGRAM_PKG)

  // --- Шаг 2: permission notifications (при первом запуске; «DON'T ALLOW»/allow — любой). ---
  await handlePermissions(imageId, { maxRounds: 1 })

  // --- Шаг 3: открыть Create свайпом вправо. ---
  await openCreateBySwipe(imageId)

  // --- Шаги 4-5: permissions камера/микрофон/photos (при первом create — ПРЕРЫВАЮТ свайп). ---
  await handlePermissions(imageId, { maxRounds: 4 })

  // --- Шаг 6: ПОВТОРИТЬ свайп вправо (permissions вернули нас на feed). ---
  await openCreateBySwipe(imageId)

  // --- Шаг 7-8: camera-create → tab REEL. ---
  {
    const found = await waitForNode(
      imageId,
      (nodes) => findNode(nodes, { contentDesc: "REEL" }),
      "navigate_upload",
      "camera-create → REEL",
    ).catch(() => null)
    await tapNodeOrCoord(imageId, found?.node ?? null, COORD.reel)
  }

  // --- Шаг 9: открыть Gallery. ---
  {
    const found = await waitForNode(
      imageId,
      (nodes) => findNode(nodes, { contentDesc: "Gallery" }),
      "navigate_upload",
      "Reel-камера → Gallery",
    ).catch(() => null)
    await tapNodeOrCoord(imageId, found?.node ?? null, COORD.gallery)
  }

  // --- Шаг 10: выбор нашего видео в галерее (content-desc содержит имя файла ИЛИ «Video thumbnail»). ---
  {
    const { node } = await waitForNode(
      imageId,
      (nodes) =>
        nodes.find((n) => n.contentDesc.includes(filename)) ??
        nodes.find((n) => n.contentDesc.toLowerCase().includes("video thumbnail")) ??
        null,
      "file_upload",
      `галерея → выбор ${filename}`,
    )
    await tapNode(imageId, node)
  }

  // --- Шаг 11: Reel editor → Next (preview играет → dump --compressed внутри waitForNode). ---
  {
    const found = await waitForNode(
      imageId,
      (nodes) => findNode(nodes, { contentDesc: "Next" }),
      "caption",
      "Reel-editor → Next",
    ).catch(() => null)
    await tapNodeOrCoord(imageId, found?.node ?? null, COORD.nextEditor)
  }

  // --- Шаг 12: закрыть промо после editor (reuse «OK» и т.п.). ---
  await dismissPromos(imageId, { maxRounds: 3 })

  // --- Шаг 13: caption — тап по полю, ввод текста, закрыть клавиатуру. ---
  {
    const found = await waitForNode(
      imageId,
      (nodes) =>
        findNode(nodes, { contentDesc: "Write a caption" }) ??
        nodes.find((n) => n.text.toLowerCase().includes("write a caption")) ??
        null,
      "caption",
      "details → Write a caption",
    ).catch(() => null)
    await tapNodeOrCoord(imageId, found?.node ?? null, COORD.caption)
    if (caption.trim()) {
      await inputText(imageId, caption.trim())
      await keyevent(imageId, KEYCODE_BACK) // закрыть экранную клавиатуру
    }
  }

  // --- Шаг 14: details → Next. ---
  {
    const found = await waitForNode(
      imageId,
      (nodes) => findNode(nodes, { contentDesc: "Next" }),
      "submit",
      "details → Next",
    ).catch(() => null)
    await tapNodeOrCoord(imageId, found?.node ?? null, COORD.nextDetails)
  }

  // --- Шаг 15: закрыть промо/audio-диалог перед Share (НЕ «Turn off and share»). ---
  await dismissPromos(imageId, { maxRounds: 3 })

  // --- Шаг 16: Share — публикация. ---
  {
    const found = await waitForNode(
      imageId,
      (nodes) => findNode(nodes, { contentDesc: "Share" }),
      "submit",
      "audio-confirm → Share",
    ).catch(() => null)
    await tapNodeOrCoord(imageId, found?.node ?? null, COORD.share)
  }

  // --- Шаг 17: success-detection по activity (dump uploading таймаутит). ---
  await verifyPublished(imageId)

  return { published: true }
}

/**
 * Проверяет факт публикации по resumed-активности. После Share IG загружает Reel
 * и возвращается на главный таб → ResumedActivity = MainTabActivity. dump в этот
 * момент таймаутит (uploading-анимация), поэтому проверяем через `currentActivity`
 * (dumpsys), а не по UI-дереву. Не дождались MainTabActivity за таймаут →
 * PostingPhaseError(extract_url) — публикация не доказана.
 */
async function verifyPublished(imageId: string): Promise<void> {
  const deadline = Date.now() + STEP_TIMEOUT_MS
  let last = ""
  for (let attempt = 0; attempt < STEP_DUMP_RETRIES && Date.now() < deadline; attempt += 1) {
    last = await currentActivity(imageId)
    if (last.includes(MAIN_TAB_ACTIVITY)) return
    if (attempt < STEP_DUMP_RETRIES - 1) await sleep(2_000)
  }
  throw new PostingPhaseError(
    `Instagram Reel: после Share не вернулись на ${MAIN_TAB_ACTIVITY} ` +
      `(текущая activity: «${last || "неизвестна"}») — публикация не подтверждена`,
    "extract_url",
    "selector_not_found",
  )
}
