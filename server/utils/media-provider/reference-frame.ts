/**
 * Опорный кадр сцены для способности image_to_video.
 *
 * Источник опорного кадра — не только скриншот приложения. ContentFactory
 * универсален (AGENTS.md, Product boundaries): оживлять нужно портрет ведущего
 * для AI-аватара, референс сцены и кадр приложения одинаковым маршрутом. Поэтому
 * ссылка на кадр нормализуется в пару «источник + id», а загрузка записей идёт
 * через инъекцию — так маршрутизацию можно проверить без БД.
 *
 * Старое поле `appScreenRef` читается как источник `app_screen`: оно лежит в
 * снапшотах уже запущенных роликов и в промпте сценариста, и ломать его нельзя.
 */

/** Откуда взят опорный кадр. Определяет таблицу и способ доставки файла. */
export type ReferenceFrameSource = "app_screen" | "character" | "scene"

const REFERENCE_FRAME_SOURCES: readonly ReferenceFrameSource[] = Object.freeze([
  "app_screen",
  "character",
  "scene",
])

export interface SceneReferenceFrame {
  source: ReferenceFrameSource
  imageId: string
}

/** Запись референса, готовая к доставке файла: storageKey либо локальный путь. */
export interface ResolvedReferenceFrame extends SceneReferenceFrame {
  /** Только у app_screen: legacy-файл лежит в storage/uploads/app-references/{appId}. */
  appId: number | null
  fileUrl: string
  storageKey: string | null
  mimeType: string
}

interface ReferenceRecord {
  id: string
  fileUrl: string
  mimeType: string | null
  storageKey: string | null
}

interface AppReferenceRecord extends ReferenceRecord {
  appId: number
}

export interface ReferenceFrameDeps {
  findAppReferences(ids: string[]): Promise<AppReferenceRecord[]>
  findCharacterReferences(ids: string[]): Promise<ReferenceRecord[]>
  findSceneReferences(ids: string[]): Promise<ReferenceRecord[]>
}

/**
 * Ключ обязан включать источник: id генерируются независимо в трёх таблицах,
 * и совпадение между ними подставило бы сцене чужой кадр.
 */
export function referenceFrameKey(ref: SceneReferenceFrame): string {
  return `${ref.source}:${ref.imageId}`
}

/**
 * Приводит разметку сцены к паре «источник + id». Незнакомый источник и пустой
 * id дают null: такая сцена снимается text-to-video, а не роняет весь шаг.
 */
export function normalizeSceneReferenceFrame(scene: {
  referenceFrame?: { source?: string | null; imageId?: string | null } | null
  appScreenRef?: { imageId?: string | null } | null
}): SceneReferenceFrame | null {
  const explicit = scene.referenceFrame
  if (explicit) {
    const source = explicit.source?.trim()
    const imageId = explicit.imageId?.trim()
    if (imageId && source && (REFERENCE_FRAME_SOURCES as readonly string[]).includes(source)) {
      return { source: source as ReferenceFrameSource, imageId }
    }
    return null
  }

  const legacyId = scene.appScreenRef?.imageId?.trim()
  return legacyId ? { source: "app_screen", imageId: legacyId } : null
}

/**
 * Загружает записи референсов по списку ссылок. Опрашиваются только те таблицы,
 * чьи источники реально встретились: ролик без скриншотов приложения не должен
 * платить лишним запросом и не должен зависеть от чужих данных.
 *
 * Удалённая запись просто не попадает в результат — вызывающий шаг откатывает
 * сцену на text-to-video.
 */
export async function loadReferenceFrames(
  refs: readonly SceneReferenceFrame[],
  deps: ReferenceFrameDeps,
): Promise<Map<string, ResolvedReferenceFrame>> {
  const idsBySource = new Map<ReferenceFrameSource, Set<string>>()
  for (const ref of refs) {
    const bucket = idsBySource.get(ref.source) ?? new Set<string>()
    bucket.add(ref.imageId)
    idsBySource.set(ref.source, bucket)
  }

  const frames = new Map<string, ResolvedReferenceFrame>()

  const appIds = idsBySource.get("app_screen")
  if (appIds?.size) {
    for (const record of await deps.findAppReferences([...appIds])) {
      frames.set(referenceFrameKey({ source: "app_screen", imageId: record.id }), {
        source: "app_screen",
        imageId: record.id,
        appId: record.appId,
        fileUrl: record.fileUrl,
        storageKey: record.storageKey,
        mimeType: detectReferenceMediaType(record.mimeType, record.fileUrl),
      })
    }
  }

  const characterIds = idsBySource.get("character")
  if (characterIds?.size) {
    for (const record of await deps.findCharacterReferences([...characterIds])) {
      frames.set(referenceFrameKey({ source: "character", imageId: record.id }), {
        source: "character",
        imageId: record.id,
        appId: null,
        fileUrl: record.fileUrl,
        storageKey: record.storageKey,
        mimeType: detectReferenceMediaType(record.mimeType, record.fileUrl),
      })
    }
  }

  const sceneIds = idsBySource.get("scene")
  if (sceneIds?.size) {
    for (const record of await deps.findSceneReferences([...sceneIds])) {
      frames.set(referenceFrameKey({ source: "scene", imageId: record.id }), {
        source: "scene",
        imageId: record.id,
        appId: null,
        fileUrl: record.fileUrl,
        storageKey: record.storageKey,
        mimeType: detectReferenceMediaType(record.mimeType, record.fileUrl),
      })
    }
  }

  return frames
}

/**
 * Как доставить файл опорного кадра до платного шага.
 *
 * `storage` — единственный путь, переживающий пересоздание контейнера, поэтому
 * он приоритетный. `legacy_app_file` остаётся ради записей AppReferenceImage,
 * созданных до переезда в объектное хранилище. Запись без storageKey и без
 * внешнего URL доставить нечем — честный null вместо попытки скачать
 * относительный путь и невнятной ошибки внутри платного шага.
 */
export type ReferenceFrameDelivery =
  | { kind: "storage"; storageKey: string }
  | { kind: "legacy_app_file"; appId: number; fileUrl: string }
  | { kind: "http"; url: string }

export function planReferenceFrameDelivery(
  frame: ResolvedReferenceFrame,
): ReferenceFrameDelivery | null {
  if (frame.storageKey) return { kind: "storage", storageKey: frame.storageKey }
  if (frame.source === "app_screen" && frame.appId !== null) {
    return { kind: "legacy_app_file", appId: frame.appId, fileUrl: frame.fileUrl }
  }
  if (/^https?:\/\//i.test(frame.fileUrl)) return { kind: "http", url: frame.fileUrl }
  return null
}

/** mimeType в БД бывает пустым у старых записей — тогда судим по расширению. */
export function detectReferenceMediaType(mimeType: string | null | undefined, fileUrl: string): string {
  if (mimeType) return mimeType
  const lower = fileUrl.toLowerCase()
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".gif")) return "image/gif"
  return "image/png"
}
