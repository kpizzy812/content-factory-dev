/**
 * Scene block compiler — собирает SceneBlock[] в текстовый prompt + negative + список
 * референс-изображений для image-to-video. Используется при PUT /api/scenes/:id и
 * POST /api/scenes/:id/generate.
 *
 * Контракт: чистая функция, БД-доступ опционален (для resolving characterId →
 * Character.visualPrompt + referenceImages). Без БД работает в "preview" режиме —
 * placeholder'ы вместо имён персонажей.
 */
import type {
  SceneBlock,
  CharacterSceneBlock,
  StyleSceneBlock,
  EnvironmentSceneBlock,
  ActionSceneBlock,
  AppContextSceneBlock,
  AppScreenSceneBlock,
} from "~~/shared/types/scene"
import type { Character, CharacterReferenceImage, AppReferenceImage } from "../../app/generated/prisma/client"

export interface CompiledScene {
  prompt: string
  negativePrompt: string
  /** Все референс-изображения сцены, собранные из CharacterBlock и AppScreenBlock. */
  referenceImageUrls: string[]
  /** Развёрнутые сведения о референсах — для UI превью и для pipeline image_url. */
  referenceImages: Array<{
    source: "character" | "app_screen" | "scene_ref"
    sourceId: string
    url: string
    kind?: string
    /** AI vision visualDescription (EN) — инжектится в финальный prompt */
    aiVisualDescription?: string | null
  }>
  /** Использованные character ids в порядке появления. */
  characterIds: string[]
}

export interface ComposeContext {
  /** characterId → Character (с referenceImages) */
  characters?: Map<string, Character & { referenceImages: CharacterReferenceImage[] }>
  /** appReferenceImageId → AppReferenceImage */
  appScreens?: Map<string, AppReferenceImage>
  /** appId → App.name (только для app_context fallback) */
  appNames?: Map<number, string>
  /** Эталонные кадры сцены (SceneReferenceImage) — добавляются в output как scene_ref. */
  sceneRefs?: Array<{
    id: string
    fileUrl: string
    kind: string
    aiVisualDescription?: string | null
    aiCaption?: string | null
  }>
}

const DEFAULT_NEGATIVE =
  "blur, distort, low quality, morphing faces, text overlay, watermark, extra limbs, deformed hands"

export function composeScene(blocks: SceneBlock[], ctx: ComposeContext = {}): CompiledScene {
  const sections: string[] = []
  const referenceImageUrls: string[] = []
  const referenceImages: CompiledScene["referenceImages"] = []
  const characterIds: string[] = []
  const negatives: string[] = [DEFAULT_NEGATIVE]

  const characterBlocks = blocks.filter((b): b is CharacterSceneBlock => b.kind === "character")
  const styleBlocks = blocks.filter((b): b is StyleSceneBlock => b.kind === "style")
  const environmentBlocks = blocks.filter((b): b is EnvironmentSceneBlock => b.kind === "environment")
  const actionBlocks = blocks.filter((b): b is ActionSceneBlock => b.kind === "action")
  const appContextBlocks = blocks.filter((b): b is AppContextSceneBlock => b.kind === "app_context")
  const appScreenBlocks = blocks.filter((b): b is AppScreenSceneBlock => b.kind === "app_screen")

  if (characterBlocks.length > 0) {
    const lines: string[] = []
    for (const blk of characterBlocks) {
      const character = ctx.characters?.get(blk.characterId)
      const role = blk.roleOverride ?? character?.role ?? "protagonist"
      const visual = character?.visualPrompt ?? character?.description ?? `character:${blk.characterId}`
      const namePart = character?.name ? `${character.name} (${role})` : `[unknown-character ${role}]`
      const actionPart = blk.action ? `, ${blk.action}` : ""
      const emotionPart = blk.emotion ? `, ${blk.emotion}` : ""
      lines.push(`${namePart}: ${visual}${actionPart}${emotionPart}`)
      characterIds.push(blk.characterId)

      for (const ref of character?.referenceImages ?? []) {
        referenceImageUrls.push(ref.fileUrl)
        referenceImages.push({
          source: "character",
          sourceId: ref.id,
          url: ref.fileUrl,
          kind: ref.kind,
        })
      }
    }
    sections.push(`Characters: ${lines.join("; ")}.`)
  }

  if (actionBlocks.length > 0) {
    const lines = actionBlocks.map((blk) => {
      const dialog = blk.dialog ? ` Dialog: "${blk.dialog}".` : ""
      return `${blk.description}.${dialog}`
    })
    sections.push(`Action: ${lines.join(" ")}`)
  }

  if (environmentBlocks.length > 0) {
    const lines = environmentBlocks.map((blk) => {
      const parts = [blk.location]
      if (blk.timeOfDay) parts.push(blk.timeOfDay)
      if (blk.lighting) parts.push(blk.lighting)
      if (blk.weather) parts.push(blk.weather)
      return parts.join(", ")
    })
    sections.push(`Environment: ${lines.join("; ")}.`)
  }

  if (styleBlocks.length > 0) {
    const lines = styleBlocks.map((blk) => {
      const parts = [blk.visualStyle]
      if (blk.mood) parts.push(`mood: ${blk.mood}`)
      if (blk.camera) parts.push(`camera: ${blk.camera}`)
      return parts.join(", ")
    })
    sections.push(`Style: ${lines.join("; ")}.`)
  }

  if (appContextBlocks.length > 0) {
    const lines = appContextBlocks.map((blk) => blk.focus)
    sections.push(`App context: ${lines.join("; ")}.`)
  }

  if (appScreenBlocks.length > 0) {
    const intents: string[] = []
    for (const blk of appScreenBlocks) {
      const screen = ctx.appScreens?.get(blk.referenceImageId)
      const url = screen?.fileUrl
      if (url) {
        referenceImageUrls.push(url)
        referenceImages.push({
          source: "app_screen",
          sourceId: blk.referenceImageId,
          url,
          kind: "app_screen",
        })
      }
      if (blk.intent) {
        intents.push(blk.intent)
      } else if (screen?.aiCaption) {
        intents.push(screen.aiCaption)
      }
    }
    if (intents.length > 0) {
      sections.push(`App screen reactions: ${intents.join("; ")}.`)
    }
  }

  // Эталонные кадры сцены: визуальное описание → в prompt + сами файлы → в referenceImages.
  const sceneRefs = ctx.sceneRefs ?? []
  if (sceneRefs.length > 0) {
    const visualLines = sceneRefs
      .map(r => r.aiVisualDescription)
      .filter((s): s is string => Boolean(s && s.trim()))
    if (visualLines.length > 0) {
      sections.push(`Reference shots: ${visualLines.join("; ")}.`)
    }
    for (const r of sceneRefs) {
      referenceImageUrls.push(r.fileUrl)
      referenceImages.push({
        source: "scene_ref",
        sourceId: r.id,
        url: r.fileUrl,
        kind: r.kind,
        aiVisualDescription: r.aiVisualDescription ?? null,
      })
    }
  }

  // Character refs с AI-описаниями (если есть) — добавляем как доп. visual cues.
  if (ctx.characters) {
    const charDescriptions: string[] = []
    for (const c of ctx.characters.values()) {
      for (const r of c.referenceImages) {
        const aiDescr = (r as { aiVisualDescription?: string | null }).aiVisualDescription
        if (aiDescr && aiDescr.trim()) {
          charDescriptions.push(aiDescr.trim())
        }
      }
    }
    if (charDescriptions.length > 0) {
      sections.push(`Character look references: ${charDescriptions.join("; ")}.`)
    }
  }

  if (sections.length === 0) {
    sections.push("Empty scene — add blocks to build the prompt.")
  }

  return {
    prompt: sections.join(" "),
    negativePrompt: negatives.join(", "),
    referenceImageUrls: dedupe(referenceImageUrls),
    referenceImages,
    characterIds: dedupe(characterIds),
  }
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

/**
 * Минимальная валидация массива блоков перед записью в БД. Не делает heavy schema-check —
 * полагается на TypeScript типы. Возвращает чистый массив (выбрасывает блоки с неизвестным kind).
 */
export function normalizeBlocks(input: unknown): SceneBlock[] {
  if (!Array.isArray(input)) return []
  const out: SceneBlock[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue
    const obj = raw as Record<string, unknown>
    const kind = obj.kind as SceneBlock["kind"]
    const id = typeof obj.id === "string" && obj.id ? obj.id : cryptoRandomId()
    switch (kind) {
      case "character":
        if (typeof obj.characterId === "string" && obj.characterId) {
          out.push({
            id,
            kind: "character",
            characterId: obj.characterId,
            action: stringOrUndef(obj.action),
            emotion: stringOrUndef(obj.emotion),
            roleOverride: obj.roleOverride === "protagonist" || obj.roleOverride === "support" || obj.roleOverride === "extra"
              ? obj.roleOverride
              : undefined,
          })
        }
        break
      case "style":
        if (typeof obj.visualStyle === "string" && obj.visualStyle) {
          out.push({ id, kind, visualStyle: obj.visualStyle, mood: stringOrUndef(obj.mood), camera: stringOrUndef(obj.camera) })
        }
        break
      case "environment":
        if (typeof obj.location === "string" && obj.location) {
          out.push({
            id,
            kind,
            location: obj.location,
            lighting: stringOrUndef(obj.lighting),
            timeOfDay: stringOrUndef(obj.timeOfDay),
            weather: stringOrUndef(obj.weather),
          })
        }
        break
      case "action":
        if (typeof obj.description === "string" && obj.description) {
          out.push({ id, kind, description: obj.description, dialog: stringOrUndef(obj.dialog) })
        }
        break
      case "app_context":
        if (typeof obj.focus === "string" && obj.focus) {
          out.push({ id, kind, focus: obj.focus })
        }
        break
      case "app_screen":
        if (typeof obj.referenceImageId === "string" && obj.referenceImageId) {
          out.push({ id, kind, referenceImageId: obj.referenceImageId, intent: stringOrUndef(obj.intent) })
        }
        break
    }
  }
  return out
}

function stringOrUndef(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined
}

function cryptoRandomId(): string {
  // Node 20+ Web Crypto API. Не используем uuid пакет ради минимума зависимостей.
  return globalThis.crypto?.randomUUID?.() ?? `blk_${Math.random().toString(36).slice(2, 10)}`
}
