/**
 * ADB-shell хелперы поверх DuoPlus `cloudPhone/command` (Этап 3, фаза P2,
 * стратегия A1 — REST-only). Каждая команда атомарна (≤10с на стороне DuoPlus,
 * иначе sshExecError) — НЕ используем `sleep` внутри команды. Ожидание загрузки
 * экрана = повторный `dumpUi` (poll), НЕ sleep (урок LIVE-POC: первый dump после
 * тапа ловит переходное состояние — нав-бар без контента).
 *
 * Все примитивы идут через `getDuoplusClient().command(imageId, cmd)`:
 *   - launchApp   — `monkey -p <pkg> -c android.intent.category.LAUNCHER 1`
 *   - dumpUi      — `uiautomator dump` + `cat` (две атомарные команды) → парсинг XML
 *   - findNodes   — фильтр по resourceId / text / contentDesc / textContains
 *   - tapXY / tapNode (по center) / inputText (пробел = %s) / keyevent
 *   - dumpUiWithRetry — poll-dump до достаточного числа узлов (замена sleep)
 *   - screencap   — отладка
 *
 * UI-tree парсится regex'ом по плоскому списку <node ... /> — uiautomator XML
 * не вложенный для наших целей (нам нужны листовые кликабельные узлы), а парсер
 * без браузера и без зависимостей быстрый и устойчивый к форме дерева.
 */

import { getDuoplusClient } from "../../utils/posting-provider/duoplus-client"

/** Прямоугольник bounds узла uiautomator (`[x1,y1][x2,y2]`). */
export interface UiBounds {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Узел дерева uiautomator (плоский — один <node>). */
export interface UiNode {
  resourceId: string
  text: string
  contentDesc: string
  className: string
  clickable: boolean
  bounds: UiBounds
  /** Центр узла — точка тапа. */
  center: { x: number; y: number }
}

/** Фильтр поиска узлов. Все поля комбинируются по И (AND). */
export interface FindNodesQuery {
  resourceId?: string
  text?: string
  contentDesc?: string
  /** Подстрочный (case-insensitive) поиск по text. */
  textContains?: string
}

export interface DumpRetryOptions {
  /** Сколько раз повторить dump (всего попыток). По умолчанию 3 (правило проекта ≥3). */
  retries?: number
  /** Минимум узлов в дереве, чтобы считать UI «загруженным». По умолчанию 2. */
  minNodes?: number
}

/** Экранирование `text` для `input text` ADB: пробел → %s, спецсимволы. */
function escapeInputText(text: string): string {
  // input text трактует пробел как разделитель аргументов → %s.
  // Экранируем символы, ломающие shell/`input`.
  return text
    .replace(/(["$`\\])/g, "\\$1")
    .replace(/ /g, "%s")
    .replace(/&/g, "\\&")
    .replace(/'/g, "\\'")
}

/** Парсит атрибут `bounds="[x1,y1][x2,y2]"`. null если формат неожиданный. */
function parseBounds(raw: string | undefined): UiBounds | null {
  if (!raw) return null
  const m = raw.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/)
  if (!m) return null
  const x1 = Number(m[1])
  const y1 = Number(m[2])
  const x2 = Number(m[3])
  const y2 = Number(m[4])
  if ([x1, y1, x2, y2].some((n) => Number.isNaN(n))) return null
  return { x1, y1, x2, y2 }
}

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`))
  return m ? m[1]! : ""
}

/**
 * Парсит сырой uiautomator XML в плоский список узлов. Узлы без валидного
 * bounds пропускаются (тапать по ним нельзя). Без браузера, без зависимостей.
 */
export function parseUiNodes(xml: string): UiNode[] {
  const nodes: UiNode[] = []
  // Каждый <node .../> или <node ...> (самозакрытый и открывающий — атрибуты те же).
  const nodeRe = /<node\b([^>]*?)\/?>/g
  let match: RegExpExecArray | null
  while ((match = nodeRe.exec(xml)) !== null) {
    const tag = match[1] ?? ""
    const bounds = parseBounds(attr(tag, "bounds"))
    if (!bounds) continue
    const center = {
      x: Math.round((bounds.x1 + bounds.x2) / 2),
      y: Math.round((bounds.y1 + bounds.y2) / 2),
    }
    nodes.push({
      resourceId: attr(tag, "resource-id"),
      text: attr(tag, "text"),
      contentDesc: attr(tag, "content-desc"),
      className: attr(tag, "class"),
      clickable: attr(tag, "clickable") === "true",
      bounds,
      center,
    })
  }
  return nodes
}

/** Запуск приложения по package через monkey LAUNCHER-intent. */
export async function launchApp(imageId: string, pkg: string): Promise<void> {
  const out = await getDuoplusClient().command(
    imageId,
    `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`,
  )
  // monkey всегда печатает «Events injected: 1» при успешном запуске.
  if (!/Events injected:\s*1/.test(out)) {
    throw new Error(`launchApp(${pkg}): monkey не подтвердил запуск: ${out.slice(0, 200)}`)
  }
}

/** Опции снимка UI-дерева. */
export interface DumpUiOptions {
  /**
   * `uiautomator dump --compressed` — лёгкий вариант. Обычный dump ТАЙМАУТИТ
   * (>10с → sshExecError) на editor-экранах с играющим video-preview (trim,
   * editing): dump ждёт UI-idle, а preview never-idle. --compressed снимает
   * меньше дерева и часто обходит этот таймаут (урок калибровки P4).
   */
  compressed?: boolean
}

/**
 * Снимок UI-дерева: `uiautomator dump` (в файл) + `cat` (две атомарные команды,
 * НЕ одна тяжёлая). Возвращает плоский список узлов.
 *
 * На editor-экранах (играет preview) передавай `{ compressed: true }` И
 * предварительно вызови `pausePreview` — иначе dump упрётся в 10с-лимит.
 */
export async function dumpUi(imageId: string, options: DumpUiOptions = {}): Promise<UiNode[]> {
  const client = getDuoplusClient()
  const flag = options.compressed ? " --compressed" : ""
  // dump в файл — отдельной командой, чтобы не превысить 10с на одной.
  const cmd = `uiautomator dump${flag} /sdcard/window_dump.xml >/dev/null 2>&1`
  try {
    await client.command(imageId, cmd)
  } catch {
    // uiautomator dump виснет на тяжёлом/анимированном экране (ждёт UI-idle,
    // анимация прогресса never-idle → >10с-лимит → timeout 405). Один повтор
    // обычно укладывается (особенно с отключёнными анимациями — disableAnimations
    // вызывается в начале сессии постинга). НЕ --compressed: probe показал, что он
    // на YouTube МЕДЛЕННЕЕ обычного.
    await client.command(imageId, cmd)
  }
  const xml = await client.command(imageId, "cat /sdcard/window_dump.xml")
  return parseUiNodes(xml)
}

/**
 * Отключает анимации устройства (window/transition/animator scale = 0). Вызывать
 * РАЗ в начале сессии постинга: `uiautomator dump` ждёт UI-idle, а анимации
 * (прогресс загрузки YouTube, переходы) never-idle → dump таймаутит (>10с-лимит
 * command, ошибка 405). Без анимаций экран сразу idle → dump стабилен ~3с
 * (доказано probe на 4kwGy). Best-effort — не валим постинг, если settings не дал.
 */
export async function disableAnimations(imageId: string): Promise<void> {
  await getDuoplusClient()
    .command(
      imageId,
      "settings put global window_animation_scale 0; " +
        "settings put global transition_animation_scale 0; " +
        "settings put global animator_duration_scale 0",
    )
    .catch(() => {})
}

/**
 * Останавливает играющий video-preview перед dump на editor-экранах. YouTube-редактор
 * показывает превью в центре экрана; тап по центру переключает «Tap to pause» →
 * анимация замирает → UI становится idle → `uiautomator dump --compressed` не
 * таймаутит. Координата (540,700) для 1080×1920 — preview-зона над контролами
 * (урок калибровки P4). Тап безвреден, если превью уже на паузе.
 */
export async function pausePreview(imageId: string, x = 540, y = 700): Promise<void> {
  await tapXY(imageId, x, y)
}

export interface HandlePermissionsOptions {
  /**
   * Максимум раундов диалогов. При первом Create их 3 (камера/микрофон/photos),
   * на повторных запусках — 0. По умолчанию 4 (запас).
   */
  maxRounds?: number
}

/** Узнаёт permission-кнопку «разрешить» в текущем дереве (resource-id / text). */
function findPermissionAllowButton(nodes: UiNode[]): UiNode | null {
  // 1) resource-id содержит permission_allow_all_button (Android permission controller).
  const byId = nodes.find((n) => n.resourceId.includes("permission_allow_all_button"))
  if (byId) return byId
  // 2) Текстовые варианты кнопки разрешения.
  const allowTexts = ["while using the app", "allow all", "allow", "allow only this time"]
  const byText = nodes.find((n) => allowTexts.includes(n.text.trim().toLowerCase()))
  if (byText) return byText
  return null
}

/**
 * Обрабатывает цепочку Android permission-диалогов: пока в дереве есть кнопка
 * «разрешить» — тапает её и пере-дампит. Возвращает число обработанных диалогов.
 *
 * При первом `Create` в YouTube их 3 подряд (камера → микрофон → photos); на
 * повторных запусках диалогов нет (вернёт 0 за один dump). Каждый dump атомарен;
 * ожидание следующего диалога — через повторный dump, НЕ sleep (урок P4).
 */
export async function handlePermissions(
  imageId: string,
  options: HandlePermissionsOptions = {},
): Promise<number> {
  const maxRounds = Math.max(0, options.maxRounds ?? 4)
  let handled = 0
  for (let round = 0; round < maxRounds; round += 1) {
    const nodes = await dumpUi(imageId)
    const btn = findPermissionAllowButton(nodes)
    if (!btn) break
    await tapNode(imageId, btn)
    handled += 1
  }
  return handled
}

/**
 * Повторный dump до получения «загруженного» UI. Замена sleep после тапа:
 * UI грузится не мгновенно (урок PoC). Возвращает первый дамп с ≥ minNodes
 * узлов; если так и не набрал — последний дамп (вызывающий сам решит, ошибка ли).
 */
export async function dumpUiWithRetry(
  imageId: string,
  options: DumpRetryOptions = {},
): Promise<UiNode[]> {
  const retries = Math.max(1, options.retries ?? 3)
  const minNodes = Math.max(1, options.minNodes ?? 2)
  let last: UiNode[] = []
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    last = await dumpUi(imageId)
    if (last.length >= minNodes) return last
    // Не sleep — следующий dump сам по себе занимает время round-trip'а REST.
  }
  return last
}

/** Фильтр узлов по resourceId / text / contentDesc / textContains (AND). */
export function findNodes(nodes: UiNode[], query: FindNodesQuery): UiNode[] {
  return nodes.filter((n) => {
    if (query.resourceId !== undefined && n.resourceId !== query.resourceId) return false
    if (query.text !== undefined && n.text !== query.text) return false
    if (query.contentDesc !== undefined && n.contentDesc !== query.contentDesc) return false
    if (
      query.textContains !== undefined &&
      !n.text.toLowerCase().includes(query.textContains.toLowerCase())
    ) {
      return false
    }
    return true
  })
}

/** Первый узел по фильтру или null. */
export function findNode(nodes: UiNode[], query: FindNodesQuery): UiNode | null {
  return findNodes(nodes, query)[0] ?? null
}

/** Тап по абсолютным координатам. */
export async function tapXY(imageId: string, x: number, y: number): Promise<void> {
  await getDuoplusClient().command(imageId, `input tap ${Math.round(x)} ${Math.round(y)}`)
}

/**
 * Свайп между двумя точками (`input swipe`). Длительность задаёт скорость жеста.
 *
 * IG Create открывается свайпом ВПРАВО по feed (`swipe(id, 150, 960, 950, 960, 250)`),
 * а НЕ кнопкой нав-бара (урок калибровки IG: навбар = Home/Reels/Message/Search/Profile,
 * без Create). `durationMs` ≥200 — иначе жест читается как fling, а не controlled swipe.
 */
export async function swipe(
  imageId: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs = 250,
): Promise<void> {
  await getDuoplusClient().command(
    imageId,
    `input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${Math.round(durationMs)}`,
  )
}

/**
 * Имя текущей resumed-активности (`dumpsys activity activities | grep ResumedActivity`).
 *
 * Нужна для success-detection там, где `dumpUi` таймаутит: на IG uploading/feed
 * (анимации, UI never-idle → 10с-лимит → sshExecError). Возвращает полную строку
 * компонента (`com.instagram.android/.activity.MainTabActivity`) либо "" если не
 * распарсилось. Вызывающий проверяет `.includes("MainTabActivity")` и т.п.
 */
export async function currentActivity(imageId: string): Promise<string> {
  const out = await getDuoplusClient().command(
    imageId,
    "dumpsys activity activities | grep ResumedActivity",
  )
  // Строка вида: «ResumedActivity: ActivityRecord{... com.pkg/.Activity t123}».
  // Достаём токен «<pkg>/<activity>» (содержит «/», без пробелов).
  const m = out.match(/ResumedActivity[^\n]*?(\S+\/\S+)/)
  return m ? m[1]! : ""
}

export interface DismissPromosOptions {
  /** Сколько раундов «найди оверлей → закрой» сделать. По умолчанию 3. */
  maxRounds?: number
}

/**
 * Тексты кнопок закрытия неизвестных промо-оверлеев (case-insensitive, по text ИЛИ
 * content-desc). IG сыпет промо между шагами публикации (Instagram map, reuse,
 * audio). «Turn off and share» НЕ закрываем — это деструктивный выбор аудио, не
 * нейтральный dismiss (урок калибровки IG).
 */
const PROMO_DISMISS_LABELS = ["not now", "ok", "skip", "dismiss", "cancel", "later"]

/** Узнаёт кнопку закрытия промо в дереве (по точному совпадению text/content-desc). */
function findPromoDismissButton(nodes: UiNode[]): UiNode | null {
  return (
    nodes.find((n) => {
      const t = n.text.trim().toLowerCase()
      const d = n.contentDesc.trim().toLowerCase()
      return PROMO_DISMISS_LABELS.includes(t) || PROMO_DISMISS_LABELS.includes(d)
    }) ?? null
  )
}

/**
 * Закрывает неизвестные промо-оверлеи: пока в дереве есть кнопка из
 * PROMO_DISMISS_LABELS — тапает её и пере-дампит. Возвращает число закрытых
 * оверлеев. Не нашёл оверлея за раунд → стоп (это не ошибка — промо может не быть).
 *
 * Каждый dump атомарен; ожидание следующего оверлея — повторный dump, НЕ sleep.
 * Не закрывает деструктивные кнопки (например «Turn off and share» аудио).
 */
export async function dismissPromos(
  imageId: string,
  options: DismissPromosOptions = {},
): Promise<number> {
  const maxRounds = Math.max(0, options.maxRounds ?? 3)
  let dismissed = 0
  for (let round = 0; round < maxRounds; round += 1) {
    const nodes = await dumpUi(imageId, { compressed: true })
    const btn = findPromoDismissButton(nodes)
    if (!btn) break
    await tapNode(imageId, btn)
    dismissed += 1
  }
  return dismissed
}

/** Тап по центру узла. */
export async function tapNode(imageId: string, node: UiNode): Promise<void> {
  await tapXY(imageId, node.center.x, node.center.y)
}

/** Ввод текста (пробел → %s, спецсимволы экранируются). */
/** Пакет/IME ADBKeyboard — Unicode-ввод (кириллица/эмодзи), которого `input text` не умеет. */
const ADB_KEYBOARD_PKG = "com.android.adbkeyboard"
const ADB_KEYBOARD_IME = "com.android.adbkeyboard/.AdbIME"
/** Стабильный URL APK ADBKeyboard (raw GitHub master). */
const ADB_KEYBOARD_APK_URL = "https://github.com/senzhk/ADBKeyBoard/raw/master/ADBKeyboard.apk"

/** Текст состоит только из ASCII — нативный `input text` справится. */
function isAsciiText(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(text)
}

/**
 * Гарантирует, что на устройстве установлена и включена ADBKeyboard — IME для
 * Unicode-ввода. Идемпотентно: проверяет `pm list packages`, ставит только если
 * пакета нет (curl APK → pm install). Установка разовая на устройство, `ime enable`
 * вызываем всегда (дёшево, на случай если пакет есть, но IME выключена).
 *
 * Зачем: Android `input text` физически не умеет не-ASCII (кириллица/эмодзи) —
 * нет маппинга в KeyCharacterMap → NPE «length of null array» в sendText.
 * ADBKeyboard принимает текст через broadcast и коммитит через IME API — Unicode ок.
 */
export async function ensureAdbKeyboard(imageId: string): Promise<void> {
  const client = getDuoplusClient()
  const pkgs = await client.command(imageId, `pm list packages ${ADB_KEYBOARD_PKG}`)
  if (!pkgs.includes(ADB_KEYBOARD_PKG)) {
    // На образе DuoPlus ADBKeyboard лежит hidden-остатком (installed=true,
    // hidden=true): `pm list` его НЕ показывает, но он держит подпись → наш APK
    // даёт INSTALL_FAILED_UPDATE_INCOMPATIBLE. Поэтому СНАЧАЛА сносим остаток
    // (best-effort — «not installed» нормально), затем чистая установка.
    // Вся последовательность доказана probe на живом устройстве 4kwGy.
    await client.command(imageId, `pm uninstall ${ADB_KEYBOARD_PKG}`).catch(() => {})
    await client.command(imageId, `pm uninstall --user 0 ${ADB_KEYBOARD_PKG}`).catch(() => {})

    // curl APK на устройство (github через прокси ~6-9с — в пределах 10с-лимита).
    const dl = await client.command(
      imageId,
      `curl -fsSL --max-time 9 -o /sdcard/ADBKeyboard.apk "${ADB_KEYBOARD_APK_URL}" && echo DL_OK || echo DL_FAIL`,
    )
    if (!dl.includes("DL_OK")) {
      throw new Error(`ADBKeyboard: скачивание APK не удалось (curl github/прокси): ${dl.trim()}`)
    }

    // Снять возможную блокировку sideload + session-install (каждый шаг <10с,
    // обходит лимит command). После сноса остатка commit проходит за ~1с.
    await client.command(imageId, `settings put global install_non_market_apps 1`).catch(() => {})
    const created = await client.command(imageId, `pm install-create -r -g`)
    const sidMatch = created.match(/\[(\d+)\]/)
    if (!sidMatch) {
      throw new Error(`ADBKeyboard: install-create не дал session id: ${created.trim()}`)
    }
    const sid = sidMatch[1]
    await client.command(imageId, `pm install-write ${sid} base /sdcard/ADBKeyboard.apk`)
    // commit с захватом stdout+exit: DuoPlus прячет вывод pm при exit≠0 в глухой
    // agentError, поэтому `echo RC=$?` даёт exit 0 и сохраняет реальный текст
    // (Success / Failure [INSTALL_FAILED_…]) для диагностики.
    const commit = await client.command(imageId, `pm install-commit ${sid} 2>&1; echo "RC=$?"`)
    if (!commit.includes("RC=0") && !commit.includes("Success")) {
      throw new Error(`ADBKeyboard: install-commit провалился: ${commit.trim().slice(0, 220)}`)
    }
    const verify = await client
      .command(imageId, `pm list packages ${ADB_KEYBOARD_PKG}`)
      .catch(() => "")
    if (!verify.includes(ADB_KEYBOARD_PKG)) {
      throw new Error("ADBKeyboard: пакет не зарегистрировался после install-commit")
    }
  }
  // Включаем IME (после установки доступна; idempotent, варнинг не критичен).
  await client.command(imageId, `ime enable ${ADB_KEYBOARD_IME}`).catch(() => {})
}

/**
 * Ввод текста в сфокусированное поле. ASCII → нативный `input text` (быстро, без
 * смены IME). Не-ASCII (кириллица/эмодзи) → ADBKeyboard: переключаем IME и шлём
 * текст в base64 через broadcast (ADB_INPUT_B64 переживает любой Unicode и не
 * ломается о shell-экранирование). IME назад НЕ возвращаем — устройство всё равно
 * выключается после постинга (powerOff), следующая сессия стартует с дефолтной.
 */
export async function inputText(imageId: string, text: string): Promise<void> {
  // Пустой текст → `input text ""` валит Android NPE; нечего вводить — выходим.
  if (!text || !text.trim()) return
  const trimmed = text.trim()
  const client = getDuoplusClient()

  if (isAsciiText(trimmed)) {
    await client.command(imageId, `input text "${escapeInputText(trimmed)}"`)
    return
  }

  // Unicode — через ADBKeyboard (нативный input text здесь падает NPE).
  await ensureAdbKeyboard(imageId)
  await client.command(imageId, `ime set ${ADB_KEYBOARD_IME}`)
  const b64 = Buffer.from(trimmed, "utf-8").toString("base64")
  await client.command(imageId, `am broadcast -a ADB_INPUT_B64 --es msg "${b64}"`)
}

/** Системная клавиша (KEYCODE_*). Напр. 66 = ENTER, 4 = BACK, 3 = HOME. */
export async function keyevent(imageId: string, code: number): Promise<void> {
  await getDuoplusClient().command(imageId, `input keyevent ${code}`)
}

/**
 * Скриншот для отладки. `screencap` пишет PNG в файл; base64 через тот же файл.
 * Возвращает stdout команды (для логов; полноценная выгрузка PNG — отдельная
 * задача, здесь — отладочный примитив).
 */
export async function screencap(imageId: string, devicePath = "/sdcard/screen.png"): Promise<string> {
  return getDuoplusClient().command(imageId, `screencap -p ${devicePath}`)
}
