/**
 * YouTube Short-постер для DuoPlus ADB-движка (Этап 3, фаза P4).
 *
 * Калибровка ДОКАЗАНА на реальном устройстве — Short опубликован
 * (см. researcher/duoplus_youtube_poster_calibration.md). Весь flow идёт через
 * REST `cloudPhone/command` (стратегия A1) — БЕЗ adb-клиента/Appium/браузера.
 *
 * Навигация — по семантике (`findNode` по text / content-desc / resource-id);
 * координаты из калибровки оставлены fallback'ом, когда узел не нашёлся (UI
 * YouTube местами без текстовых меток). Editor-шаги (trim / editing) дампятся
 * через `dumpUi --compressed` ПОСЛЕ `pausePreview` — обычный dump там таймаутит
 * (играет preview, UI never-idle → 10с-лимит → sshExecError; урок P4).
 *
 * Каждая device-команда атомарна (≤10с): dump отдельно от ожидания, ожидание
 * следующего экрана = повторный dump (poll), НЕ sleep-в-команде. Таймауты flow
 * ≥90с, переходы — с retry (правило проекта).
 *
 * Visibility по умолчанию = Private (доказано калибровкой). Public/Unlisted —
 * отдельный шаг detail-экрана, НЕ калибровался → см. TODO ниже.
 */

import {
  dumpUi,
  findNode,
  handlePermissions,
  inputText,
  keyevent,
  launchApp,
  pausePreview,
  swipe,
  tapNode,
  tapXY,
  type UiNode,
} from "../adb-shell"
import { PostingPhaseError, type PostingPhase } from "../../posters/types"
import { extractYoutubeShortUrl } from "../../../utils/posting/youtube-post-url"

/** Package YouTube-приложения. */
const YOUTUBE_PKG = "com.google.android.youtube"

/** KEYCODE_BACK — закрыть экранную клавиатуру после ввода caption. */
const KEYCODE_BACK = 4

/** Координаты-fallback из калибровки (1080×1920). Используются, если findNode не нашёл узел. */
const COORD = {
  create: { x: 540, y: 1848 }, // нижний нав-бар «Create»
  importVideo: { x: 108, y: 1608 }, // «Import video from photo library» (низ-лево)
  next: { x: 792, y: 1805 }, // «Next» после выбора видео
  trimDone: { x: 935, y: 1812 }, // «Done» в trim-редакторе
  editingNext: { x: 795, y: 1830 }, // «Next» на экране Text/Effects/Filters
  caption: { x: 686, y: 336 }, // «Caption your Short»
  uploadShort: { x: 801, y: 1824 }, // «Upload Short» — публикация
} as const

/** Параметры YouTube Short-постинга. */
export interface PostYouTubeShortParams {
  /** image_id устройства DuoPlus. */
  imageId: string
  /** Путь к уже залитому видео на устройстве (`/sdcard/DCIM/<jobId>.mp4`, от P3 media-push). */
  deviceVideoPath: string
  /** Подпись Short (caption). Вводится в поле «Caption your Short». */
  caption: string
  /**
   * Handle канала (`@camil_smith` → `camil_smith`) для best-effort захвата URL
   * поста серверным fetch публичной страницы канала. null → URL не извлекаем.
   */
  channelHandle?: string | null
}

/** Результат публикации Short. */
export interface PostYouTubeShortResult {
  /** Подтверждено ли по dump канала (Short найден по caption + «No views»/«play Short»). */
  published: true
  /** URL опубликованного Short (best-effort, серверный fetch канала). undefined если не извлёкся. */
  platformPostUrl?: string
  /** Чем доказана публикация: плитка канала на устройстве или серверный fetch канала. */
  verificationMethod: "device_tile" | "channel_fetch"
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
 */
async function waitForNode(
  imageId: string,
  match: (nodes: UiNode[]) => UiNode | null,
  phase: PostingPhase,
  description: string,
  options: { compressed?: boolean; pausePreviewBefore?: boolean } = {},
): Promise<{ nodes: UiNode[]; node: UiNode }> {
  const deadline = Date.now() + STEP_TIMEOUT_MS
  let lastNodes: UiNode[] = []
  for (let attempt = 0; attempt < STEP_DUMP_RETRIES && Date.now() < deadline; attempt += 1) {
    if (options.pausePreviewBefore) await pausePreview(imageId)
    lastNodes = await dumpUi(imageId, { compressed: options.compressed })
    const found = match(lastNodes)
    if (found) return { nodes: lastNodes, node: found }
    // Ожидание следующего кадра — пауза на HTTP-уровне, НЕ device-sleep.
    if (attempt < STEP_DUMP_RETRIES - 1) await sleep(1_000)
  }
  throw new PostingPhaseError(
    `YouTube Short: не дождался экрана «${description}» (${lastNodes.length} узлов в последнем dump)`,
    phase,
    "selector_not_found",
  )
}

/**
 * Тап по найденному узлу, либо fallback по координате из калибровки, если узел
 * не нашёлся (UI YouTube местами без текстовых меток). Возвращает true, если
 * тапнули по узлу (а не по координате).
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

/**
 * Публикует YouTube Short по доказанному калибровкой flow (шаги 5-17):
 * launch → Create → permissions → Import → permissions(ALLOW ALL) → выбор видео →
 * Next → trim(Done) → editing Next → caption → Upload Short → проверка по каналу.
 */
export async function postYouTubeShort(
  params: PostYouTubeShortParams,
): Promise<PostYouTubeShortResult> {
  const { imageId, deviceVideoPath, caption, channelHandle } = params
  const filename = basename(deviceVideoPath)

  // --- Шаг 5: launch YouTube (re-launch — приложение могло свернуться за время заливки). ---
  await launchApp(imageId, YOUTUBE_PKG)

  // --- Шаг 6: главный → Create (нижний нав-бар). ---
  {
    const { node } = await waitForNode(
      imageId,
      (nodes) => findNode(nodes, { contentDesc: "Create" }),
      "navigate_upload",
      "главный экран → Create",
    )
    await tapNode(imageId, node)
  }

  // --- Шаги 7-8: permission камера/микрофон (только при первом Create). ---
  await handlePermissions(imageId, { maxRounds: 3 })

  // --- Шаг 9: Short-камера → «Import video from photo library». ---
  {
    const found = await waitForNode(
      imageId,
      (nodes) => findNode(nodes, { contentDesc: "Import video from photo library" }),
      "navigate_upload",
      "Short-камера → Import video",
    ).catch(() => null)
    await tapNodeOrCoord(imageId, found?.node ?? null, COORD.importVideo)
  }

  // --- Шаг 10: permission photos (ALLOW ALL). ---
  await handlePermissions(imageId, { maxRounds: 2 })

  // --- Шаг 11: галерея → выбор нашего видео по имени файла. ---
  {
    const { node } = await waitForNode(
      imageId,
      (nodes) =>
        findNode(nodes, { contentDesc: filename }) ??
        // content-desc галереи часто содержит имя + метаданные → подстрочный поиск.
        nodes.find((n) => n.contentDesc.includes(filename)) ??
        null,
      "file_upload",
      `галерея → выбор ${filename}`,
    )
    await tapNode(imageId, node)
  }

  // --- Шаг 12: Next → trim-редактор. ---
  {
    const found = await waitForNode(
      imageId,
      (nodes) => findNode(nodes, { text: "Next" }),
      "file_upload",
      "Next (после выбора видео)",
    ).catch(() => null)
    await tapNodeOrCoord(imageId, found?.node ?? null, COORD.next)
  }

  // --- Шаг 13: trim Done. Editor играет preview → pausePreview + dump --compressed. ---
  {
    const found = await waitForNode(
      imageId,
      (nodes) => findNode(nodes, { text: "Done" }),
      "caption",
      "trim-редактор → Done",
      { compressed: true, pausePreviewBefore: true },
    ).catch(() => null)
    await tapNodeOrCoord(imageId, found?.node ?? null, COORD.trimDone)
  }

  // --- Шаг 14: editing Next (экран Text/Effects/Filters, preview играет). ---
  {
    const found = await waitForNode(
      imageId,
      (nodes) => findNode(nodes, { text: "Next" }),
      "caption",
      "editing-экран → Next",
      { compressed: true, pausePreviewBefore: true },
    ).catch(() => null)
    await tapNodeOrCoord(imageId, found?.node ?? null, COORD.editingNext)
  }

  // --- Шаг 15: caption — тап по полю, ввод текста, закрыть клавиатуру. ---
  {
    const found = await waitForNode(
      imageId,
      (nodes) =>
        findNode(nodes, { text: "Caption your Short" }) ??
        nodes.find((n) => n.text.toLowerCase().includes("caption")) ??
        null,
      "caption",
      "детали → Caption your Short",
    ).catch(() => null)
    await tapNodeOrCoord(imageId, found?.node ?? null, COORD.caption)
    if (caption.trim()) {
      await inputText(imageId, caption.trim())
      await keyevent(imageId, KEYCODE_BACK) // закрыть экранную клавиатуру
    }
  }

  // TODO(P-visibility): выбор Public/Unlisted на detail-экране ДО Upload.
  // Калибровка дала default = Private (доказано) и этот шаг НЕ калибровался —
  // не реализуем сейчас. Когда понадобится — добавить шаг между caption и Upload:
  // найти селектор visibility, тап → выбрать значение из params.visibility.

  // --- Шаг 16: публикация — Upload Short. ---
  {
    const found = await waitForNode(
      imageId,
      (nodes) => findNode(nodes, { text: "Upload Short" }),
      "submit",
      "детали → Upload Short",
    ).catch(() => null)
    await tapNodeOrCoord(imageId, found?.node ?? null, COORD.uploadShort)
  }

  // --- Шаг 16.5: ДОЖДАТЬСЯ завершения заливки ПЕРЕД powerOff устройства. ---
  // Engine делает powerOff СРАЗУ после постера (finally). Без этого ожидания
  // заливка длинного видео (26с+) обрывается на полпути → Short виснет «uploading»,
  // в канал не попадает (доказано на проде: 14с успевали, 26с — нет). Это НЕ
  // success-сигнал — просто ждём завершения; публикацию подтверждает verifyPublished.
  await waitUploadComplete(imageId)

  // --- Шаг 17: подтверждение публикации (success-detection). verifyPublished даёт
  // ДВА независимых доказательства: плитка Short на канале в UI устройства ЛИБО
  // серверный fetch публичной страницы канала (он же dedup-guard от дублей). Метод +
  // URL возвращаются. Ни одно не подтвердило → upload_failed (retry). ---
  const verified = await verifyPublished(imageId, caption, channelHandle ?? null)

  return {
    published: true,
    platformPostUrl: verified.platformPostUrl,
    verificationMethod: verified.method,
  }
}

/**
 * Признаки свежей плитки опубликованного Short на канале (просмотров ещё нет) —
 * мультиязычно. Раньше был только английский «No views» — на не-en локали ломалось.
 */
const FRESH_TILE_MARKERS = [
  "no views", // en: «No views» / «No views yet» (приватный Short остаётся «No views»)
  "0 views",
  "просмотров нет", // ru: «Просмотров нет»
  "нет просмотров",
  "0 просмотров",
] as const

/**
 * Мин. длина caption-якоря для device_tile. Короткое/типовое слово («Лайфхак»)
 * совпало бы подстрокой со СТАРЫМ Short того же шаблона → ложный success. Короче
 * порога — плиткой не доказываем (решает channel_fetch / upload_failed-ретрай).
 */
const MIN_TILE_CAPTION_LEN = 6

/** Пауза между поллами dump при verify (мс). Override в тестах через YT_VERIFY_POLL_MS. */
const VERIFY_POLL_MS = Number(process.env.YT_VERIFY_POLL_MS) || 1_500

/**
 * Подтверждает факт публикации Short ДВУМЯ независимыми доказательствами:
 *
 *  1) Плитка Short на канале в UI устройства (dumpUi): content-desc содержит caption
 *     (сильный якорь) И признак свежести (просмотров нет). ПУСТОЙ caption НЕ матчим —
 *     иначе любой «No views» на экране давал ложный success (корневая причина
 *     фейкового «Опубликовано» при пустом caption).
 *  2) Серверный fetch публичной страницы канала (extractYoutubeShortUrl): если Short
 *     уже виден по caption — публикация доказана надёжнее UI, И это dedup-guard
 *     (видео реально залилось → НЕ ретраим, не зальём второй раз).
 *
 * Ни одно не подтвердило → upload_failed (RETRYABLE): на residential-прокси заливка
 * нестабильна (виснет «uploading»), авто-ретрай до успешной заливки.
 */
async function verifyPublished(
  imageId: string,
  caption: string,
  channelHandle: string | null,
): Promise<{ method: "device_tile" | "channel_fetch"; platformPostUrl?: string }> {
  const needle = caption.trim().toLowerCase()

  // Доказательство 1: плитка опубликованного Short в UI канала.
  if (await waitForPublishedTile(imageId, needle)) {
    // Плитка найдена — публикация доказана. URL добиваем best-effort серверным fetch.
    const url = await extractYoutubeShortUrl(channelHandle, caption).catch(() => undefined)
    return { method: "device_tile", platformPostUrl: url }
  }

  // Доказательство 2 (fallback + dedup): серверный fetch страницы канала по caption.
  if (needle && channelHandle) {
    const url = await extractYoutubeShortUrl(channelHandle, caption).catch(() => undefined)
    if (url) return { method: "channel_fetch", platformPostUrl: url }
  }

  throw new PostingPhaseError(
    "YouTube Short: публикация не подтверждена — ни плитка канала на устройстве, ни "
      + "страница канала не показали Short (видео не дозалилось на residential-прокси) → ретрай",
    "extract_url",
    "upload_failed",
  )
}

/**
 * Поллит dump канала до появления плитки опубликованного Short. true — найдена,
 * false — не появилась за ретраи (БЕЗ throw: решение о fallback/ретрае принимает
 * verifyPublished). Между поллами скроллим сетку Shorts вверх (плитка может быть не
 * первой — раньше скролла не было вовсе). Пустой caption → сразу false (UI-плитку без
 * якоря не доказать — пусть решает channel_fetch).
 */
async function waitForPublishedTile(imageId: string, needle: string): Promise<boolean> {
  if (needle.length < MIN_TILE_CAPTION_LEN) return false
  const retries = Number(process.env.YT_VERIFY_TILE_RETRIES) || STEP_DUMP_RETRIES
  for (let attempt = 0; attempt < retries; attempt += 1) {
    let nodes: UiNode[]
    try {
      nodes = await dumpUi(imageId)
    } catch {
      await sleep(VERIFY_POLL_MS)
      continue
    }
    if (nodes.some((n) => isFreshPublishedTile(n, needle))) return true
    if (attempt < retries - 1) {
      // Плитка не первая? Скроллим сетку Shorts вверх (best-effort) и пробуем снова.
      await swipe(imageId, 540, 1400, 540, 700, 300).catch(() => {})
      await sleep(VERIFY_POLL_MS)
    }
  }
  return false
}

/** Узел = свежая плитка опубликованного Short: caption-якорь + признак «просмотров нет». */
function isFreshPublishedTile(node: UiNode, needle: string): boolean {
  const desc = node.contentDesc.toLowerCase()
  if (!desc.includes(needle)) return false
  return FRESH_TILE_MARKERS.some((m) => desc.includes(m))
}

/**
 * Ждёт ЗАВЕРШЕНИЯ заливки Short ПЕРЕД powerOff устройства. После «Upload Short»
 * видео заливается на сервер YouTube; навбар «You»/оверлей показывает индикатор
 * «uploading». Engine делает powerOff СРАЗУ после постера (finally) — без этого
 * ожидания заливка обрывается на полпути, Short виснет «uploading» и НЕ попадает
 * в канал (доказано на проде). Это НЕ success-сигнал — просто ожидание;
 * публикацию подтверждает verifyPublished ПОСЛЕ.
 *
 * Каждый dump атомарен; пауза между поллами — на HTTP-уровне (НЕ device-sleep).
 *   - «couldn't upload»/«upload failed» → заливка провалилась → выходим (verify
 *     не найдёт → честный selector_not_found → retry).
 *   - индикатор «uploading» виден → appeared=true, продолжаем ждать.
 *   - индикатор пропал ПОСЛЕ появления → заливка завершена ✓.
 *   - индикатор не появился за APPEAR-окно → upload мгновенный/не стартовал;
 *     не блокируем — отдаём verifyPublished.
 */
async function waitUploadComplete(imageId: string): Promise<void> {
  const appearMs = Number(process.env.YT_UPLOAD_APPEAR_MS) || 45_000
  const waitMs = Number(process.env.YT_UPLOAD_WAIT_MS) || 360_000
  const pollMs = Number(process.env.YT_UPLOAD_POLL_MS) || 8_000
  const start = Date.now()
  const deadline = start + waitMs
  const elapsed = (): number => Math.round((Date.now() - start) / 1000)
  let appeared = false
  while (Date.now() < deadline) {
    let nodes: UiNode[]
    try {
      nodes = await dumpUi(imageId)
    } catch {
      await sleep(pollMs)
      continue
    }
    const blob = (n: UiNode): string => `${n.contentDesc} ${n.text}`.toLowerCase()
    if (nodes.some((n) => /couldn't upload|upload failed|can't upload/.test(blob(n)))) {
      console.log(`[waitUpload ${imageId}] заливка ПРОВАЛИЛАСЬ (couldn't upload, ${elapsed()}с) → verify даст retry`)
      return
    }
    const uploading = nodes.some((n) => {
      const b = blob(n)
      return /uploading|processing/.test(b) && !/couldn't/.test(b)
    })
    if (uploading) {
      appeared = true
      console.log(`[waitUpload ${imageId}] заливка идёт… (${elapsed()}с)`)
    } else if (appeared) {
      console.log(`[waitUpload ${imageId}] заливка завершена ✓ (${elapsed()}с)`)
      return
    } else if (Date.now() - start > appearMs) {
      console.log(
        `[waitUpload ${imageId}] индикатор заливки не появился за ${Math.round(appearMs / 1000)}с → отдаём verify`,
      )
      return
    }
    await sleep(pollMs)
  }
  console.log(`[waitUpload ${imageId}] таймаут ожидания заливки ${Math.round(waitMs / 1000)}с → отдаём verify`)
}
