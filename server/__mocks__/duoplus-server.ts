/**
 * Mock-сервер DuoPlus (cloud phone) — эмулирует `openapi.duoplus.net`.
 *
 * Назначение: воспроизводимая среда разработки фаз P1-P5 Этапа 3 (DuoPlus-интеграция)
 * БЕЗ платных прогонов реального устройства. Зеркалит контракты, подтверждённые
 * LIVE-POC (см. researcher/duoplus_integration_research.md, секция LIVE-POC):
 *
 *   POST /api/v1/cloudPhone/list      → { code:200, data:{ list:[...], page,pagesize,total,total_page }, message:"Success" }
 *   POST /api/v1/cloudPhone/powerOn   { image_ids:[...] } → { code:200, data:{ success:[...], fail:[], fail_reason:{} }, message }
 *   POST /api/v1/cloudPhone/powerOff  { image_ids:[...] } → аналогично powerOn
 *   POST /api/v1/cloudPhone/command   { image_id, command } → { code:200, data:{ success:true, content:"<stdout>", message:"" } }
 *   POST /api/v1/cloudPhone/initProxy { image_id, ... } → { code:200, data:{ success:true }, message }
 *
 * КРИТИЧНО (как на боевом API):
 * - HTTP-код всегда 200; реальный успех — в `data.success` (boolean у command,
 *   массив у power*). Ошибка выполнения команды → `data.success:false` +
 *   `message:"...sshExecError..."`, при этом HTTP=200.
 * - Заголовок аутентификации — `DuoPlus-API-Key`.
 * - Переход статуса при powerOn: 2 (выкл) → 10 (включается) → 1 (вкл).
 *   Поле `adb` пусто до status=1, заполняется адресом при status=1.
 *
 * Статусы устройства (`status`):
 *   0 не настроен · 1 включён · 2 выключен · 3 истёк · 4 просрочена оплата
 *   · 10 включается · 11 конфигурируется · 12 ошибка конфигурации.
 *
 * Сценарии (query `?scenario=` или header `X-Mock-Scenario`):
 *   happy          — всё работает (default)
 *   sshExecError   — POST /command вернёт data.success:false + sshExecError
 *   device_offline — powerOn вернёт устройство в fail[]
 * Также: env DUOPLUS_MOCK_SCENARIO задаёт сценарий по умолчанию для процесса.
 *
 * Запуск как отдельный процесс:  npm run mock:duoplus  (порт 35011, override MOCK_DUOPLUS_PORT)
 * Использование в тестах:        import { createDuoplusMockServer } — in-process handle.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

// --- Статусы устройства DuoPlus ---
export const DUOPLUS_STATUS = {
  UNCONFIGURED: 0,
  ON: 1,
  OFF: 2,
  EXPIRED: 3,
  UNPAID: 4,
  POWERING_ON: 10,
  CONFIGURING: 11,
  CONFIG_ERROR: 12,
} as const

export interface MockDuoplusDevice {
  id: string
  name: string
  status: number
  os: string
  size: string
  created_at: string
  expired_at: string
  ip: string
  area: string
  remark: string
  adb: string
  adb_password: string
  group: string
  /** Внутреннее: сколько poll-list осталось до перехода в ON (эмуляция ~75с). */
  _ticksToOn?: number
  /**
   * Внутреннее (P4): текущий экран YouTube Short-flow для эмуляции последовательности
   * dump-ответов. Имя экрана из YT_SCREEN_ORDER. undefined = не в flow (главный home).
   */
  _ytScreen?: string
  /** Внутреннее (P4): имя файла видео, выбранного в галерее (для caption-проверки). */
  _ytVideoFile?: string
  /** Внутреннее (P4): caption, введённый в поле «Caption your Short». */
  _ytCaption?: string
  /**
   * Внутреннее (P8): текущий экран Instagram Reel-flow. Имя экрана из IG_SCREEN_ORDER.
   * undefined = не в IG-flow.
   */
  _igScreen?: string
  /** Внутреннее (P8): имя файла видео в IG-галерее (от curl media-push). */
  _igVideoFile?: string
  /** Внутреннее (P8): caption, введённый в поле «Write a caption». */
  _igCaption?: string
  /**
   * Внутреннее (P8): «текущая» resumed-активность для `dumpsys activity`. После
   * Share выставляется в MainTabActivity (success-detection IG-постера).
   */
  _igActivity?: string
}

export interface DuoplusMockOptions {
  /** Порт. CLI: env MOCK_DUOPLUS_PORT ?? 35011. Тесты: 0 → авто-порт. */
  port?: number
  /** Сценарий по умолчанию для всех запросов (перебивается query/header). */
  defaultScenario?: string
  /** Сколько list-поллов powerOn остаётся в статусе 10 перед ON. Дефолт 1 (быстро для тестов). */
  powerOnTicks?: number
  /** Начальный набор устройств. По умолчанию — два US-устройства Android 15 (как боевой аккаунт). */
  seedDevices?: MockDuoplusDevice[]
}

export interface DuoplusMockHandle {
  port: number
  baseUrl: string
  server: Server
  /** Прямой доступ к state устройств — для ассертов в тестах. */
  devices: Map<string, MockDuoplusDevice>
  close: () => Promise<void>
}

const ADB_ADDRESS_POOL = ["98.98.125.9:27777", "76.76.21.5:27778"]

function defaultSeed(): MockDuoplusDevice[] {
  const now = new Date().toISOString()
  const later = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
  return [
    {
      id: "M2Hxh",
      name: "US-Device-1",
      status: DUOPLUS_STATUS.OFF,
      os: "Android 15",
      size: "1080x1920",
      created_at: now,
      expired_at: later,
      ip: "98.98.125.9",
      area: "US",
      remark: "",
      adb: "",
      adb_password: "",
      group: "default",
    },
    {
      id: "4kwGy",
      name: "US-Device-2",
      status: DUOPLUS_STATUS.OFF,
      os: "Android 15",
      size: "1080x1920",
      created_at: now,
      expired_at: later,
      ip: "76.76.21.5",
      area: "US",
      remark: "",
      adb: "",
      adb_password: "",
      group: "default",
    },
  ]
}

// --- Эмуляция YouTube Short-flow для cloudPhone/command (P4, stateful) ---
//
// `uiautomator dump` + `cat` отдают UI-XML текущего экрана (`device._ytScreen`).
// Переход на следующий экран происходит, когда `input tap` попадает в «advance»-
// зону текущего экрана (по координатам узла из его же XML). Это воспроизводит
// реальный flow калибровки: launch → Create → permissions → Import → permissions
// → выбор видео → Next → trim Done → editing Next → caption → Upload Short → канал.
//
// Имена экранов:
//   home          — главный, виден «Create» (nav-bar)
//   perm_camera   — диалог камеры (ALLOW)
//   perm_mic      — диалог микрофона (ALLOW)
//   short_camera  — экран Short-камеры, виден «Import video from photo library»
//   perm_photos   — диалог photos (ALLOW ALL)
//   gallery       — галерея, виден thumbnail видео по content-desc=<filename>
//   trim          — trim-редактор (играет preview), виден «Done»
//   editing       — экран Text/Effects/Filters (preview), виден «Next»
//   details       — экран деталей, видны «Caption your Short» + «Upload Short»
//   channel       — канал после публикации, виден Short по caption + «No views»

const YT_HOME_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.google.android.youtube" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="com.google.android.youtube:id/fab_create" content-desc="Create" class="android.widget.ImageView" text="" clickable="true" bounds="[432,1776][648,1920]" />
    <node index="1" resource-id="com.google.android.youtube:id/title" content-desc="" class="android.widget.TextView" text="Home" clickable="false" bounds="[40,80][300,140]" />
  </node>
</hierarchy>`

function permXml(label: string): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.android.permissioncontroller" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="" content-desc="" class="android.widget.TextView" text="Allow YouTube to access the ${label}?" clickable="false" bounds="[80,400][1000,520]" />
    <node index="1" resource-id="com.android.permissioncontroller:id/permission_allow_all_button" content-desc="" class="android.widget.Button" text="WHILE USING THE APP" clickable="true" bounds="[300,940][780,1054]" />
    <node index="2" resource-id="com.android.permissioncontroller:id/permission_deny_button" content-desc="" class="android.widget.Button" text="DON'T ALLOW" clickable="true" bounds="[300,1100][780,1214]" />
  </node>
</hierarchy>`
}

const YT_SHORT_CAMERA_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.google.android.youtube" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="" content-desc="Import video from photo library" class="android.widget.ImageView" text="" clickable="true" bounds="[0,1476][216,1740]" />
    <node index="1" resource-id="" content-desc="Record" class="android.widget.ImageView" text="" clickable="true" bounds="[432,1600][648,1816]" />
  </node>
</hierarchy>`

function permPhotosXml(): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.android.permissioncontroller" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="" content-desc="" class="android.widget.TextView" text="Allow access to photos and videos?" clickable="false" bounds="[80,400][1000,520]" />
    <node index="1" resource-id="com.android.permissioncontroller:id/permission_allow_all_button" content-desc="" class="android.widget.Button" text="ALLOW ALL" clickable="true" bounds="[300,1118][780,1234]" />
    <node index="2" resource-id="com.android.permissioncontroller:id/permission_deny_button" content-desc="" class="android.widget.Button" text="DON'T ALLOW" clickable="true" bounds="[300,1280][780,1394]" />
  </node>
</hierarchy>`
}

function galleryXml(filename: string): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.google.android.youtube" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="" content-desc="${filename}" class="android.widget.ImageView" text="" clickable="true" bounds="[0,200][360,560]" />
    <node index="1" resource-id="" content-desc="other_clip.mp4, 0:42" class="android.widget.ImageView" text="" clickable="true" bounds="[360,200][720,560]" />
    <node index="2" resource-id="" content-desc="" class="android.widget.Button" text="Next" clickable="true" bounds="[552,1732][1032,1879]" />
  </node>
</hierarchy>`
}

// trim/editing — на реальном устройстве dump ТАЙМАУТИТ если preview играет;
// эмулируем это: пока превью не «на паузе» (см. _ytPreviewPaused), cat отдаёт
// частичное дерево (без кнопки Done/Next). pausePreview-тап ставит на паузу.
const YT_TRIM_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.google.android.youtube" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="" content-desc="" class="android.widget.TextView" text="Adjust" clickable="false" bounds="[48,1758][240,1866]" />
    <node index="1" resource-id="" content-desc="" class="android.widget.Button" text="Done" clickable="true" bounds="[839,1758][1032,1866]" />
  </node>
</hierarchy>`

const YT_EDITING_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.google.android.youtube" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="" content-desc="Text" class="android.widget.ImageView" text="" clickable="true" bounds="[48,1600][240,1740]" />
    <node index="1" resource-id="" content-desc="" class="android.widget.Button" text="Next" clickable="true" bounds="[558,1770][1032,1890]" />
  </node>
</hierarchy>`

function detailsXml(): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.google.android.youtube" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="" content-desc="" class="android.widget.EditText" text="Caption your Short" clickable="true" bounds="[329,279][1044,393]" />
    <node index="1" resource-id="" content-desc="" class="android.widget.Button" text="Upload Short" clickable="true" bounds="[558,1764][1044,1884]" />
  </node>
</hierarchy>`
}

function channelXml(caption: string): string {
  const desc = `${caption}, No views, ${caption} - play Short`
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.google.android.youtube" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="" content-desc="Shorts" class="android.widget.TextView" text="Shorts" clickable="false" bounds="[40,400][300,460]" />
    <node index="1" resource-id="" content-desc="${desc}" class="android.widget.ImageView" text="" clickable="true" bounds="[0,500][360,1140]" />
  </node>
</hierarchy>`
}

/** Возвращает UI-XML для текущего экрана устройства в YouTube Short-flow. */
function ytScreenXml(dev: MockDuoplusDevice): string {
  switch (dev._ytScreen) {
    case "perm_camera":
      return permXml("camera")
    case "perm_mic":
      return permXml("microphone")
    case "short_camera":
      return YT_SHORT_CAMERA_XML
    case "perm_photos":
      return permPhotosXml()
    case "gallery":
      return galleryXml(dev._ytVideoFile ?? "video.mp4")
    case "trim":
      return YT_TRIM_XML
    case "editing":
      return YT_EDITING_XML
    case "details":
      return detailsXml()
    case "channel":
      return channelXml(dev._ytCaption ?? "")
    case "home":
    default:
      return YT_HOME_XML
  }
}

/** Тап-координата (x,y) из команды `input tap X Y`, либо null. */
function parseTap(c: string): { x: number; y: number } | null {
  const m = c.match(/^input\s+tap\s+(\d+)\s+(\d+)/)
  if (!m) return null
  return { x: Number(m[1]), y: Number(m[2]) }
}

/** Попадает ли тап (x,y) в bounds [x1,y1][x2,y2]. */
function inBounds(t: { x: number; y: number }, x1: number, y1: number, x2: number, y2: number): boolean {
  return t.x >= x1 && t.x <= x2 && t.y >= y1 && t.y <= y2
}

/**
 * Продвигает YouTube Short-flow при тапе. Каждый экран имеет «advance»-зону —
 * bounds кнопки, продвигающей flow вперёд. Координаты совпадают с XML экрана.
 */
function advanceYtFlow(dev: MockDuoplusDevice, c: string, command: string): void {
  const t = parseTap(c)
  if (!t) {
    // Не тап — но launchApp сбрасывает на home (re-launch перед навигацией).
    if (/monkey\s+-p\s+com\.google\.android\.youtube/.test(command)) {
      dev._ytScreen = "home"
    }
    return
  }
  switch (dev._ytScreen) {
    case undefined:
    case "home":
      // Create [432,1776][648,1920] → диалог камеры.
      if (inBounds(t, 432, 1776, 648, 1920)) dev._ytScreen = "perm_camera"
      break
    case "perm_camera":
      // ALLOW [300,940][780,1054] → диалог микрофона.
      if (inBounds(t, 300, 940, 780, 1054)) dev._ytScreen = "perm_mic"
      break
    case "perm_mic":
      // ALLOW → Short-камера.
      if (inBounds(t, 300, 940, 780, 1054)) dev._ytScreen = "short_camera"
      break
    case "short_camera":
      // Import video [0,1476][216,1740] → диалог photos.
      if (inBounds(t, 0, 1476, 216, 1740)) dev._ytScreen = "perm_photos"
      break
    case "perm_photos":
      // ALLOW ALL [300,1118][780,1234] → галерея.
      if (inBounds(t, 300, 1118, 780, 1234)) dev._ytScreen = "gallery"
      break
    case "gallery":
      // Next [552,1732][1032,1879] → trim. (Тап по thumbnail flow не двигает.)
      if (inBounds(t, 552, 1732, 1032, 1879)) dev._ytScreen = "trim"
      break
    case "trim":
      // Done [839,1758][1032,1866] → editing. (pausePreview-тап ~540,700 — no-op.)
      if (inBounds(t, 839, 1758, 1032, 1866)) dev._ytScreen = "editing"
      break
    case "editing":
      // Next [558,1770][1032,1890] → details.
      if (inBounds(t, 558, 1770, 1032, 1890)) dev._ytScreen = "details"
      break
    case "details":
      // Upload Short [558,1764][1044,1884] → канал (публикация).
      if (inBounds(t, 558, 1764, 1044, 1884)) dev._ytScreen = "channel"
      break
    default:
      break
  }
}

// --- Эмуляция Instagram Reel-flow для cloudPhone/command (P8, stateful) ---
//
// Flow калибровки IG: feed → [свайп вправо] → permissions(камера/микрофон/photos)
// прерывают свайп → feed → [повторный свайп] → camera(REEL) → gallery → editor →
// promo(reuse) → caption → details → audio-confirm(Share) → MainTabActivity.
//
// IG Create открывается СВАЙПОМ ВПРАВО (`input swipe 150 960 950 960`), не кнопкой.
// dump на uploading/feed таймаутит — success проверяется через `dumpsys activity`
// (MainTabActivity = вернулись на главный = опубликовано). Здесь dumpsys читает
// `dev._igActivity`, которая выставляется в MainTabActivity при тапе Share.
//
// Имена экранов:
//   ig_feed         — главный feed (свайп вправо открывает create)
//   ig_perm_camera  — диалог камеры (ALLOW)
//   ig_perm_mic     — диалог микрофона (ALLOW)
//   ig_perm_photos  — диалог photos (ALLOW ALL) → после него возврат на feed
//   ig_camera       — camera-create, виден таб «REEL»
//   ig_gallery      — Reel-камера с Gallery + thumbnail видео
//   ig_editor       — Reel-editor, виден «Next»
//   ig_promo        — промо «reuse» (виден «OK»)
//   ig_caption      — поле «Write a caption» + «Next»
//   ig_details      — детали (Next)
//   ig_audio        — audio-confirm, виден «Share»

const IG_FEED_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.instagram.android" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="" content-desc="Home" class="android.widget.ImageView" text="" clickable="true" bounds="[0,1820][216,1920]" />
    <node index="1" resource-id="" content-desc="Search and explore" class="android.widget.ImageView" text="" clickable="true" bounds="[216,1820][432,1920]" />
    <node index="2" resource-id="" content-desc="Profile" class="android.widget.ImageView" text="" clickable="true" bounds="[864,1820][1080,1920]" />
  </node>
</hierarchy>`

function igPermXml(label: string): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.android.permissioncontroller" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="" content-desc="" class="android.widget.TextView" text="Allow Instagram to access the ${label}?" clickable="false" bounds="[80,400][1000,520]" />
    <node index="1" resource-id="com.android.permissioncontroller:id/permission_allow_all_button" content-desc="" class="android.widget.Button" text="WHILE USING THE APP" clickable="true" bounds="[147,877][933,1045]" />
    <node index="2" resource-id="com.android.permissioncontroller:id/permission_deny_button" content-desc="" class="android.widget.Button" text="DON'T ALLOW" clickable="true" bounds="[147,1183][933,1351]" />
  </node>
</hierarchy>`
}

function igPermPhotosXml(): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.android.permissioncontroller" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="" content-desc="" class="android.widget.TextView" text="Allow access to photos and videos?" clickable="false" bounds="[80,400][1000,520]" />
    <node index="1" resource-id="com.android.permissioncontroller:id/permission_allow_all_button" content-desc="" class="android.widget.Button" text="ALLOW ALL" clickable="true" bounds="[300,1118][780,1234]" />
    <node index="2" resource-id="com.android.permissioncontroller:id/permission_deny_button" content-desc="" class="android.widget.Button" text="DON'T ALLOW" clickable="true" bounds="[300,1280][780,1394]" />
  </node>
</hierarchy>`
}

const IG_CAMERA_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.instagram.android" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="" content-desc="POST" class="android.widget.Button" text="" clickable="true" bounds="[265,1635][434,1736]" />
    <node index="1" resource-id="" content-desc="STORY" class="android.widget.Button" text="" clickable="true" bounds="[455,1635][624,1736]" />
    <node index="2" resource-id="" content-desc="REEL" class="android.widget.Button" text="" clickable="true" bounds="[646,1635][815,1736]" />
  </node>
</hierarchy>`

function igGalleryXml(filename: string): string {
  // Пустое имя файла = видео не залито → галерея без video-thumbnail (только Gallery-кнопка
  // и фото). Постер не найдёт ни basename, ни «Video thumbnail» → file_upload-ошибка.
  const videoThumb = filename
    ? `<node index="1" resource-id="" content-desc="Video thumbnail created at ${filename}" class="android.widget.ImageView" text="" clickable="true" bounds="[0,200][360,560]" />`
    : ""
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.instagram.android" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="" content-desc="Gallery" class="android.widget.Button" text="" clickable="true" bounds="[0,1590][204,1776]" />
    ${videoThumb}
    <node index="2" resource-id="" content-desc="Photo other_clip 0:42" class="android.widget.ImageView" text="" clickable="true" bounds="[360,200][720,560]" />
  </node>
</hierarchy>`
}

const IG_EDITOR_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.instagram.android" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="" content-desc="Audio" class="android.widget.ImageView" text="" clickable="true" bounds="[48,1646][240,1776]" />
    <node index="1" resource-id="" content-desc="Next" class="android.widget.Button" text="" clickable="true" bounds="[822,1646][1044,1776]" />
  </node>
</hierarchy>`

const IG_PROMO_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.instagram.android" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="" content-desc="" class="android.widget.TextView" text="Reuse this Reel template?" clickable="false" bounds="[80,1000][1000,1200]" />
    <node index="1" resource-id="" content-desc="" class="android.widget.Button" text="OK" clickable="true" bounds="[48,1382][1032,1514]" />
  </node>
</hierarchy>`

function igCaptionXml(): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.instagram.android" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="" content-desc="Write a caption" class="android.widget.EditText" text="" clickable="true" bounds="[48,1171][1032,1315]" />
    <node index="1" resource-id="" content-desc="Next" class="android.widget.Button" text="" clickable="true" bounds="[564,1584][1032,1716]" />
  </node>
</hierarchy>`
}

const IG_AUDIO_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.instagram.android" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="" content-desc="" class="android.widget.TextView" text="Update on your original audio" clickable="false" bounds="[80,1000][1000,1200]" />
    <node index="1" resource-id="" content-desc="Share" class="android.widget.Button" text="" clickable="true" bounds="[96,1464][984,1596]" />
  </node>
</hierarchy>`

/** Возвращает UI-XML для текущего экрана устройства в Instagram Reel-flow. */
function igScreenXml(dev: MockDuoplusDevice): string {
  switch (dev._igScreen) {
    case "ig_perm_camera":
      return igPermXml("camera")
    case "ig_perm_mic":
      return igPermXml("microphone")
    case "ig_perm_photos":
      return igPermPhotosXml()
    case "ig_camera":
      return IG_CAMERA_XML
    case "ig_gallery":
      return igGalleryXml(dev._igVideoFile ?? "video.mp4")
    case "ig_editor":
      return IG_EDITOR_XML
    case "ig_promo":
      return IG_PROMO_XML
    case "ig_caption":
      return igCaptionXml()
    case "ig_details":
      // После caption «Next» details показывает audio-confirm сразу (упрощённо).
      return IG_AUDIO_XML
    case "ig_audio":
      return IG_AUDIO_XML
    case "ig_feed":
    default:
      return IG_FEED_XML
  }
}

/** Координаты свайпа `input swipe x1 y1 x2 y2 [dur]`, либо null. */
function parseSwipe(c: string): { x1: number; y1: number; x2: number; y2: number } | null {
  const m = c.match(/^input\s+swipe\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/)
  if (!m) return null
  return { x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]), y2: Number(m[4]) }
}

/**
 * Продвигает Instagram Reel-flow при тапе/свайпе. Свайп вправо (x2 > x1, по центру)
 * на feed открывает create-цепочку: первый свайп уводит в permissions (камера),
 * после photos возврат на feed, второй свайп уже открывает camera(REEL).
 */
function advanceIgFlow(dev: MockDuoplusDevice, c: string, command: string): void {
  // launchApp сбрасывает на feed.
  if (/monkey\s+-p\s+com\.instagram\.android/.test(command)) {
    dev._igScreen = "ig_feed"
    dev._igActivity = "com.instagram.android/.activity.MainTabActivity"
    return
  }
  const swipeT = parseSwipe(c)
  if (swipeT) {
    // Свайп вправо по центру: feed → permissions (первый раз) ИЛИ feed → camera (второй).
    const rightSwipe = swipeT.x2 > swipeT.x1 + 200 && swipeT.y1 > 600 && swipeT.y1 < 1300
    // Свайп вправо с feed открывает camera-create. Permissions в постере вызываются
    // отдельно через handlePermissions (no-op без диалога), поэтому здесь не моделируем
    // прерывание — happy-path test проходит без диалогов, а permissions-логику покрывает
    // отдельный тест с ручным выставлением _igScreen="ig_perm_camera".
    if (rightSwipe && dev._igScreen === "ig_feed") dev._igScreen = "ig_camera"
    return
  }
  const t = parseTap(c)
  if (!t) return
  switch (dev._igScreen) {
    case "ig_perm_camera":
      if (inBounds(t, 147, 877, 933, 1045)) dev._igScreen = "ig_perm_mic"
      break
    case "ig_perm_mic":
      if (inBounds(t, 147, 877, 933, 1045)) dev._igScreen = "ig_perm_photos"
      break
    case "ig_perm_photos":
      // ALLOW ALL → возврат на feed (свайп прерван permissions).
      if (inBounds(t, 300, 1118, 780, 1234)) dev._igScreen = "ig_feed"
      break
    case "ig_camera":
      // REEL [646,1635][815,1736] → gallery.
      if (inBounds(t, 646, 1635, 815, 1736)) dev._igScreen = "ig_gallery"
      break
    case "ig_gallery":
      // Gallery [0,1590][204,1776] открыта; тап по thumbnail [0,200][360,560] → editor.
      if (inBounds(t, 0, 200, 360, 560)) dev._igScreen = "ig_editor"
      break
    case "ig_editor":
      // Next [822,1646][1044,1776] → promo.
      if (inBounds(t, 822, 1646, 1044, 1776)) dev._igScreen = "ig_promo"
      break
    case "ig_promo":
      // OK [48,1382][1032,1514] → caption.
      if (inBounds(t, 48, 1382, 1032, 1514)) dev._igScreen = "ig_caption"
      break
    case "ig_caption":
      // Next [564,1584][1032,1716] → details/audio. (Тап по полю caption flow не двигает.)
      if (inBounds(t, 564, 1584, 1032, 1716)) dev._igScreen = "ig_audio"
      break
    case "ig_details":
    case "ig_audio":
      // Share [96,1464][984,1596] → публикация: возврат на MainTabActivity.
      if (inBounds(t, 96, 1464, 984, 1596)) {
        dev._igScreen = "ig_feed"
        dev._igActivity = "com.instagram.android/.activity.MainTabActivity"
      }
      break
    default:
      break
  }
}

function emulateCommandStdout(command: string, dev: MockDuoplusDevice | undefined): string {
  const c = command.trim()
  if (/^echo\b/.test(c)) {
    const m = c.match(/^echo\s+(.*)$/)
    return m ? m[1]!.replace(/^['"]|['"]$/g, "") : "ok"
  }
  if (/wm\s+size/.test(c)) return "Physical size: 1080x1920"
  if (/getprop/.test(c)) return "15"
  if (/pm\s+list\s+packages/.test(c)) {
    // Запрос конкретного пакета ADBKeyboard (ensureAdbKeyboard) → как установленный,
    // чтобы happy-path Unicode-ввода не уходил в curl/pm install.
    if (/adbkeyboard/.test(c)) return "package:com.android.adbkeyboard"
    return [
      "package:com.google.android.youtube",
      "package:com.zhiliaoapp.musically",
      "package:com.instagram.android",
    ].join("\n")
  }
  // Устройство в IG-flow, если запущен IG-монки или уже выставлен _igScreen.
  const inIgFlow = !!dev && (dev._igScreen !== undefined || /monkey\s+-p\s+com\.instagram\.android/.test(command))
  if (/monkey\s+-p/.test(c)) {
    if (dev) {
      if (/com\.instagram\.android/.test(command)) advanceIgFlow(dev, c, command)
      else advanceYtFlow(dev, c, command)
    }
    return "bash arg: -p\nEvents injected: 1\n## Network stats: elapsed time=42ms"
  }
  if (/dumpsys\s+activity\s+activities/.test(c)) {
    // success-detection IG: ResumedActivity текущей активности устройства.
    const act = dev?._igActivity ?? "com.android.launcher/.Launcher"
    return `  ResumedActivity: ActivityRecord{abc123 u0 ${act} t42}`
  }
  if (/uiautomator\s+dump/.test(c)) return "UI hierchary dumped to: /sdcard/window_dump.xml"
  if (/cat\s+\/sdcard\/window_dump\.xml/.test(c)) {
    if (!dev) return YT_HOME_XML
    return inIgFlow ? igScreenXml(dev) : ytScreenXml(dev)
  }
  if (/^input\s+text\b/.test(c)) {
    // Запоминаем caption. input text "<caption>" (%s=пробел).
    if (dev) {
      const m = c.match(/^input\s+text\s+"(.*)"/)
      if (m) {
        const decoded = m[1]!.replace(/\\(.)/g, "$1").replace(/%s/g, " ")
        if (inIgFlow) dev._igCaption = decoded
        else dev._ytCaption = decoded
      }
    }
    return ""
  }
  if (/^input\s+(tap|swipe|keyevent)/.test(c)) {
    if (dev) {
      if (inIgFlow) advanceIgFlow(dev, c, command)
      else advanceYtFlow(dev, c, command)
    }
    return ""
  }
  // ADBKeyboard Unicode-ввод: `am broadcast -a ADB_INPUT_B64 --es msg <base64>`.
  // Декодируем base64 → caption (как input text, но для кириллицы/эмодзи).
  if (/am\s+broadcast\s+-a\s+ADB_INPUT_B64/.test(c)) {
    if (dev) {
      const m = c.match(/--es\s+msg\s+"?([A-Za-z0-9+/=]+)"?/)
      if (m) {
        const decoded = Buffer.from(m[1]!, "base64").toString("utf-8")
        if (inIgFlow) dev._igCaption = decoded
        else dev._ytCaption = decoded
      }
    }
    return "Broadcasting: Intent { act=ADB_INPUT_B64 }\nBroadcast completed: result=0"
  }
  if (/am\s+broadcast/.test(c)) {
    return "Broadcasting: Intent { act=android.intent.action.MEDIA_SCANNER_SCAN_FILE }\nBroadcast completed: result=0"
  }
  if (/^curl\b/.test(c)) {
    // Заливка видео: curl -L -o /sdcard/DCIM/<jobId>.mp4 '<url>' → запоминаем имя
    // файла, чтобы галерея показала thumbnail с content-desc=<filename> (P3/P4).
    if (dev) {
      const m = c.match(/-o\s+(\S+\.mp4)/)
      if (m) {
        const fname = m[1]!.split("/").pop() ?? m[1]!
        dev._ytVideoFile = fname
        dev._igVideoFile = fname
      }
    }
    return ""
  }
  if (/^ls\b/.test(c)) {
    if (/\.mp4/.test(c)) return "-rw-rw---- 1 u0_a123 media_rw 5242880 2026-06-12 12:00 video.mp4"
    return "DCIM\nDownload\nMovies"
  }
  if (/^rm\b/.test(c)) return ""
  return ""
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = ""
    req.setEncoding("utf-8")
    req.on("data", (chunk) => {
      buf += chunk
      if (buf.length > 5_000_000) {
        req.destroy()
        reject(new Error("body too large"))
      }
    })
    req.on("end", () => resolve(buf))
    req.on("error", reject)
  })
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, DuoPlus-API-Key, X-Mock-Scenario")
  res.end(payload === null ? "" : JSON.stringify(payload))
}

function pickScenario(req: IncomingMessage, url: URL, fallback: string): string {
  const fromQuery = url.searchParams.get("scenario")
  if (fromQuery) return fromQuery
  const fromHeader = req.headers["x-mock-scenario"]
  if (typeof fromHeader === "string" && fromHeader) return fromHeader
  return fallback
}

interface MockContext {
  devices: Map<string, MockDuoplusDevice>
  defaultScenario: string
  powerOnTicks: number
  /** Cloud Drive: fileId → имя файла (push-модель заливки медиа). */
  cloudFiles: Map<string, string>
}

function deviceToListItem(
  d: MockDuoplusDevice,
): Omit<
  MockDuoplusDevice,
  | "_ticksToOn"
  | "_ytScreen"
  | "_ytVideoFile"
  | "_ytCaption"
  | "_igScreen"
  | "_igVideoFile"
  | "_igCaption"
  | "_igActivity"
> {
  const {
    _ticksToOn,
    _ytScreen,
    _ytVideoFile,
    _ytCaption,
    _igScreen,
    _igVideoFile,
    _igCaption,
    _igActivity,
    ...rest
  } = d
  void _ticksToOn
  void _ytScreen
  void _ytVideoFile
  void _ytCaption
  void _igScreen
  void _igVideoFile
  void _igCaption
  void _igActivity
  return rest
}

async function handle(req: IncomingMessage, res: ServerResponse, ctx: MockContext): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost")
  const path = url.pathname
  const method = req.method ?? "GET"
  const scenario = pickScenario(req, url, ctx.defaultScenario)

  if (method === "OPTIONS") return send(res, 204, null)

  // eslint-disable-next-line no-console
  console.log(`[mock-duoplus] ${method} ${path} → scenario=${scenario}`)

  // PUT на «OSS» (Cloud Drive upload, push-модель): дренируем тело файла и
  // подтверждаем загрузку (реальный OSS возвращает callback-ответ DuoPlus).
  if (method === "PUT" && path.startsWith("/oss-put/")) {
    await readBody(req).catch(() => "")
    return send(res, 200, { Status: "OK" })
  }

  if (method !== "POST") {
    return send(res, 404, { code: 404, data: null, message: `Not implemented: ${method} ${path}` })
  }

  const raw = await readBody(req)
  let body: Record<string, unknown> = {}
  if (raw) { try { body = JSON.parse(raw) } catch { body = {} } }

  // --- POST /api/v1/cloudPhone/list ---
  if (path === "/api/v1/cloudPhone/list") {
    const page = Number(body.page ?? 1)
    const pagesize = Number(body.pagesize ?? 20)
    const all = [...ctx.devices.values()].map(deviceToListItem)
    const start = (page - 1) * pagesize
    const slice = all.slice(start, start + pagesize)
    return send(res, 200, {
      code: 200,
      data: {
        list: slice,
        page,
        pagesize,
        total: all.length,
        total_page: Math.max(1, Math.ceil(all.length / pagesize)),
      },
      message: "Success",
    })
  }

  // --- POST /api/v1/cloudPhone/powerOn ---
  if (path === "/api/v1/cloudPhone/powerOn") {
    const ids = Array.isArray(body.image_ids) ? (body.image_ids as string[]) : []
    const success: string[] = []
    const fail: string[] = []
    const failReason: Record<string, string> = {}
    for (const id of ids) {
      const dev = ctx.devices.get(id)
      if (!dev || scenario === "device_offline") {
        fail.push(id)
        failReason[id] = dev ? "device_offline" : "device_not_found"
        continue
      }
      // Переход 2 → 10; ON наступит после N list-поллов (эмуляция ~75с).
      dev.status = DUOPLUS_STATUS.POWERING_ON
      dev._ticksToOn = ctx.powerOnTicks
      success.push(id)
    }
    return send(res, 200, {
      code: 200,
      data: { success, fail, fail_reason: failReason },
      message: fail.length ? "Partial" : "Success",
    })
  }

  // --- POST /api/v1/cloudPhone/powerOff ---
  if (path === "/api/v1/cloudPhone/powerOff") {
    const ids = Array.isArray(body.image_ids) ? (body.image_ids as string[]) : []
    const success: string[] = []
    const fail: string[] = []
    const failReason: Record<string, string> = {}
    for (const id of ids) {
      const dev = ctx.devices.get(id)
      if (!dev) {
        fail.push(id)
        failReason[id] = "device_not_found"
        continue
      }
      dev.status = DUOPLUS_STATUS.OFF
      dev.adb = ""
      dev.adb_password = ""
      dev._ticksToOn = undefined
      success.push(id)
    }
    return send(res, 200, {
      code: 200,
      data: { success, fail, fail_reason: failReason },
      message: fail.length ? "Partial" : "Success",
    })
  }

  // --- POST /api/v1/cloudPhone/command ---
  if (path === "/api/v1/cloudPhone/command") {
    const imageId = typeof body.image_id === "string" ? body.image_id : ""
    const command = typeof body.command === "string" ? body.command : ""
    // Сценарий ошибки выполнения: HTTP всё равно 200, но data.success:false.
    if (scenario === "sshExecError") {
      return send(res, 200, {
        code: 200,
        data: { success: false, content: "", message: "exec failed: sshExecError: command exceeded 10s limit" },
        message: "Success",
      })
    }
    if (!imageId) {
      return send(res, 200, {
        code: 200,
        data: { success: false, content: "", message: "image_id required" },
        message: "Success",
      })
    }
    return send(res, 200, {
      code: 200,
      data: { success: true, content: emulateCommandStdout(command, ctx.devices.get(imageId)), message: "" },
      message: "Success",
    })
  }

  // --- POST /api/v1/cloudPhone/initProxy ---
  if (path === "/api/v1/cloudPhone/initProxy") {
    const imageId = typeof body.image_id === "string" ? body.image_id : ""
    if (!imageId) {
      return send(res, 200, { code: 400, data: { success: false }, message: "image_id required" })
    }
    return send(res, 200, { code: 200, data: { success: true }, message: "Success" })
  }

  // --- Cloud Drive (push-модель заливки медиа) ---

  // POST /api/v1/cloudDisk/signedUrl → presigned PUT-URL (указывает на сам mock).
  if (path === "/api/v1/cloudDisk/signedUrl") {
    const name = typeof body.name === "string" && body.name ? body.name : "file.mp4"
    const fileId = `cf-${name}`
    ctx.cloudFiles.set(fileId, name)
    const host = req.headers.host ?? "localhost"
    return send(res, 200, {
      code: 200,
      data: {
        method: "PUT",
        signedUrl: `http://${host}/oss-put/${encodeURIComponent(name)}`,
        headers: { "x-oss-callback": "mock-cb", "x-oss-callback-var": "mock-var" },
        name,
        original_file_name: name,
      },
      message: "Success",
    })
  }

  // POST /api/v1/cloudDisk/list → файлы Cloud Drive по точному имени (keyword).
  if (path === "/api/v1/cloudDisk/list") {
    const keyword = typeof body.keyword === "string" ? body.keyword : ""
    const list = [...ctx.cloudFiles.entries()]
      .filter(([, n]) => n === keyword)
      .map(([id, n]) => ({ id, name: n, original_file_name: n }))
    return send(res, 200, { code: 200, data: { list, total: list.length }, message: "Success" })
  }

  // POST /api/v1/cloudDisk/pushFiles → «копирует» файл на устройства; запоминаем
  // имя видео на device, чтобы галерея YT/IG показала его (как раньше делал curl).
  if (path === "/api/v1/cloudDisk/pushFiles") {
    const ids = Array.isArray(body.ids) ? (body.ids as string[]) : []
    const imageIds = Array.isArray(body.image_ids) ? (body.image_ids as string[]) : []
    const name = ctx.cloudFiles.get(ids[0] ?? "")
    const success: Array<{ image_id: string; id: string }> = []
    for (const iid of imageIds) {
      const dev = ctx.devices.get(iid)
      if (dev && name) {
        dev._ytVideoFile = name
        dev._igVideoFile = name
      }
      for (const id of ids) success.push({ image_id: iid, id })
    }
    return send(res, 200, {
      code: 200,
      data: { message: "Success", success, fail: [] },
      message: "Success",
    })
  }

  // POST /api/v1/cloudDisk/delFiles → cleanup Cloud Drive.
  if (path === "/api/v1/cloudDisk/delFiles") {
    const ids = Array.isArray(body.ids) ? (body.ids as string[]) : []
    for (const id of ids) ctx.cloudFiles.delete(id)
    return send(res, 200, { code: 200, data: { message: "success" }, message: "Success" })
  }

  return send(res, 404, { code: 404, data: null, message: `Not implemented in mock: ${method} ${path}` })
}

/**
 * Перед каждым list-ответом продвигаем устройства из POWERING_ON в ON, когда
 * счётчик тиков исчерпан. Это симулирует асинхронную загрузку без таймеров —
 * клиент сам поллит list, и через N поллов получает status=1 + adb-адрес.
 */
function advancePowerOn(ctx: MockContext): void {
  let adbIdx = 0
  for (const dev of ctx.devices.values()) {
    if (dev.status === DUOPLUS_STATUS.POWERING_ON && typeof dev._ticksToOn === "number") {
      if (dev._ticksToOn <= 0) {
        dev.status = DUOPLUS_STATUS.ON
        dev.adb = ADB_ADDRESS_POOL[adbIdx % ADB_ADDRESS_POOL.length]!
        dev.adb_password = "mock-adb-pass"
        dev._ticksToOn = undefined
      } else {
        dev._ticksToOn -= 1
      }
    }
    adbIdx += 1
  }
}

/**
 * Поднимает in-process mock-сервер DuoPlus. Возвращает handle с baseUrl, доступом
 * к state устройств и close(). Если порт занят — поднимает на следующем (+20).
 */
export async function createDuoplusMockServer(opts: DuoplusMockOptions = {}): Promise<DuoplusMockHandle> {
  const desired = opts.port ?? 0
  const devices = new Map<string, MockDuoplusDevice>()
  for (const d of opts.seedDevices ?? defaultSeed()) devices.set(d.id, { ...d })

  const ctx: MockContext = {
    devices,
    defaultScenario: opts.defaultScenario ?? process.env.DUOPLUS_MOCK_SCENARIO ?? "happy",
    powerOnTicks: opts.powerOnTicks ?? 1,
    cloudFiles: new Map(),
  }

  const server = createServer((req, res) => {
    // Продвигаем powerOn перед обработкой list-запросов.
    const url = req.url ?? ""
    if (url.includes("/cloudPhone/list")) advancePowerOn(ctx)
    handle(req, res, ctx).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[mock-duoplus] handler error:", err)
      if (!res.headersSent) {
        res.statusCode = 500
        res.end(JSON.stringify({ code: 500, data: null, message: "mock handler failure" }))
      }
    })
  })

  const port = await new Promise<number>((resolve, reject) => {
    let attempt = desired
    const tryListen = (): void => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && desired !== 0 && attempt < desired + 20) {
          attempt += 1
          server.listen(attempt)
        } else {
          reject(err)
        }
      })
      server.listen(attempt, () => {
        const addr = server.address()
        if (addr && typeof addr === "object") resolve(addr.port)
        else reject(new Error("mock-duoplus: не удалось получить порт"))
      })
    }
    tryListen()
  })

  return {
    port,
    baseUrl: `http://localhost:${port}`,
    server,
    devices,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    }),
  }
}

// --- CLI bootstrap: npm run mock:duoplus ---
const isMain = (() => {
  try {
    const entry = process.argv[1] ?? ""
    return entry.includes("duoplus-server")
  } catch {
    return false
  }
})()

if (isMain) {
  const cliPort = Number(process.env.MOCK_DUOPLUS_PORT ?? 35011)
  createDuoplusMockServer({ port: cliPort })
    .then((handle) => {
      // eslint-disable-next-line no-console
      console.log(`[mock-duoplus] listening on ${handle.baseUrl}`)
      // eslint-disable-next-line no-console
      console.log("[mock-duoplus] scenarios: happy, sshExecError, device_offline")
      // eslint-disable-next-line no-console
      console.log(`[mock-duoplus] usage: DUOPLUS_MOCK_MODE=true DUOPLUS_MOCK_URL=${handle.baseUrl} npm run dev`)

      const shutdown = (): void => {
        // eslint-disable-next-line no-console
        console.log("[mock-duoplus] shutting down")
        handle.close().then(() => process.exit(0))
      }
      process.on("SIGINT", shutdown)
      process.on("SIGTERM", shutdown)
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[mock-duoplus] failed to start:", err)
      process.exit(1)
    })
}
