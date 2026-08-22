/**
 * Приём файла в библиотеку фонов (`BackgroundClip`, спека §5.2/§9 «Библиотека
 * фонов»).
 *
 * Повторяет пайплайн `server/api/characters/[id]/source-recordings/index.post.ts`
 * (sha1-дедуп, `StorageKeys`, `uploadBuffer`, перцептивный хэш первого кадра),
 * но вынесен из эндпоинта отдельным модулем: AGENTS.md запрещает длинный
 * inline-pipeline прямо в `server/api`, эндпоинт обязан только принимать
 * запрос и делегировать.
 *
 * Дедуп — по `(appId, sha1)` оригинального файла: `BackgroundClip.@@unique
 * ([appId, sha1])` в схеме. Повторная заливка БАЙТ-В-БАЙТ того же файла
 * возвращает существующую строку, вторая не создаётся.
 *
 * Похожесть по перцептивному хэшу (дальний родственник: тот же ракурс экрана,
 * та же локация под другим углом) НЕ блокирует заливку — в отличие от дедупа
 * по sha1, это не гарантированный дубль, а быть может ценный второй ракурс
 * одного фона. Ответ только ПОМЕЧАЕТ находку через `similarClipIds` — так же,
 * как ingest ведущего помечает батч через `similarClips`, только форматом
 * списка id, а не счётчика: загрузка фона всегда ОДИН файл за раз, и оператору
 * полезнее увидеть, С ЧЕМ именно он похож, а не просто число совпадений.
 */
import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { BackgroundClip } from "~~/app/generated/prisma/client"
import { getStorageDriver } from "~~/server/utils/storage"
import { StorageKeys } from "~~/server/utils/storage/keys"
import { ffmpegIngestDependencies, probeRecordingMeta } from "~~/server/utils/presenter/ffmpeg-adapter"
import { areFramesSimilar, dHashFromGrayscale } from "~~/server/utils/presenter/perceptual-hash"

/** MIME -> расширение файла и признак «это картинка, а не видео». */
export const ALLOWED_BACKGROUND_MIME: Record<string, { ext: string, isImage: boolean }> = {
  "video/mp4": { ext: "mp4", isImage: false },
  "video/quicktime": { ext: "mov", isImage: false },
  "image/png": { ext: "png", isImage: true },
  "image/jpeg": { ext: "jpg", isImage: true },
  "image/webp": { ext: "webp", isImage: true },
}

/** Библиотека фонов — не запись ведущего на 2 GB; разумный потолок для фона. */
export const BACKGROUND_CLIP_MAX_BYTES = 500 * 1024 * 1024

const BACKGROUND_KINDS = ["screen_recording", "footage", "image"] as const
export type BackgroundClipKind = (typeof BACKGROUND_KINDS)[number]

export interface SaveBackgroundClipInput {
  appId: number
  data: Buffer
  filename: string
  mime: string
  name?: string | null
  tags?: string[]
  /** screen_recording | footage | image. Не задано — выводится из MIME. */
  kind?: string | null
  uploadedById?: number | null
}

export interface SaveBackgroundClipResult {
  clip: BackgroundClip
  /** true — файл БАЙТ-В-БАЙТ уже был в библиотеке этого приложения, новая строка не создана. */
  deduped: boolean
  /** id уже принятых АКТИВНЫХ фонов приложения, чей первый кадр похож на этот. */
  similarClipIds: string[]
}

function resolveKind(requested: string | null | undefined, isImage: boolean): BackgroundClipKind {
  if (requested) {
    if (!BACKGROUND_KINDS.includes(requested as BackgroundClipKind)) {
      throw createError({
        statusCode: 400,
        message: `kind должен быть одним из: ${BACKGROUND_KINDS.join(", ")}`,
      })
    }
    return requested as BackgroundClipKind
  }
  return isImage ? "image" : "footage"
}

export async function saveBackgroundClip(input: SaveBackgroundClipInput): Promise<SaveBackgroundClipResult> {
  const meta = ALLOWED_BACKGROUND_MIME[input.mime]
  if (!meta) {
    throw createError({ statusCode: 415, message: `Неподдерживаемый формат: ${input.mime || "unknown"}` })
  }
  if (input.data.length > BACKGROUND_CLIP_MAX_BYTES) {
    throw createError({
      statusCode: 413,
      message: `Файл должен быть не больше ${Math.floor(BACKGROUND_CLIP_MAX_BYTES / (1024 * 1024))} MB`,
    })
  }

  const sha1 = createHash("sha1").update(input.data).digest("hex").slice(0, 16)

  // Дедуп ДО любой работы с диском/ffmpeg/хранилищем — повторная заливка того
  // же файла не должна платить ни временем на перекодирование, ни местом.
  const existing = await prisma.backgroundClip.findUnique({
    where: { appId_sha1: { appId: input.appId, sha1 } },
  })
  if (existing) {
    // Дедуп находит строку НЕЗАВИСИМО от isActive: `@@unique([appId, sha1])`
    // не различает погашенный и живой фон — это один и тот же файл. Если бы
    // мы просто возвращали погашенную строку как есть, оператор увидел бы
    // "всё в порядке, фон уже есть" (200, deduped: true), а по факту файл
    // остался бы невидимым в GET и планировщике НАВСЕГДА: эндпоинта
    // "восстановить" не существует, а единственный путь мимо DELETE — сюда,
    // и он бы каждый раз утыкался в ту же погашенную строку. Повторная
    // заливка того же файла — это и есть операция "верните фон в библиотеку":
    // оператор явно принёс файл снова, значит хочет его обратно в списке.
    if (!existing.isActive) {
      const reactivated = await prisma.backgroundClip.update({
        where: { id: existing.id },
        data: { isActive: true },
      })
      return { clip: reactivated, deduped: true, similarClipIds: [] }
    }
    return { clip: existing, deduped: true, similarClipIds: [] }
  }

  const workDir = await mkdtemp(join(tmpdir(), "background-clip-"))
  const filePath = join(workDir, `background.${meta.ext}`)

  try {
    await writeFile(filePath, input.data)

    // Один и тот же ffmpeg-приём достаёт первый кадр что у видео, что у
    // статичной картинки (см. grayscaleThumbnail в ffmpeg-adapter.ts) —
    // отдельной ветки для image/* не нужно.
    const [thumbnail, probed] = await Promise.all([
      ffmpegIngestDependencies.grayscaleThumbnail(filePath),
      probeRecordingMeta(filePath),
    ])
    const perceptualHash = dHashFromGrayscale(thumbnail)

    const activeClips = await prisma.backgroundClip.findMany({
      where: { appId: input.appId, isActive: true, perceptualHash: { not: null } },
      select: { id: true, perceptualHash: true },
    })
    const similarClipIds = activeClips
      .filter(clip => areFramesSimilar(clip.perceptualHash as string, perceptualHash))
      .map(clip => clip.id)

    const storage = getStorageDriver()
    const storageKey = StorageKeys.backgroundClip(input.appId, sha1, meta.ext)
    await storage.uploadBuffer(storageKey, input.data, { contentType: input.mime })

    const clip = await prisma.backgroundClip.create({
      data: {
        appId: input.appId,
        name: input.name?.trim() || input.filename,
        storageKey,
        storageProvider: storage.providerName,
        sha1,
        mimeType: input.mime,
        bytes: BigInt(input.data.length),
        // null у статичной картинки: getVideoDuration (внутри probeRecordingMeta)
        // возвращает 0 для файлов без потока длительности вместо ошибки (см.
        // server/utils/video-tools/ffmpeg.ts) — 0 здесь не длительность, а
        // признак «длительности тут нет по построению», и монтаж обязан
        // получить именно null, а не поверить в нулевой кадр.
        durationSec: meta.isImage || probed.durationSec <= 0 ? null : probed.durationSec,
        width: probed.width,
        height: probed.height,
        kind: resolveKind(input.kind, meta.isImage),
        tags: input.tags ?? [],
        perceptualHash,
        uploadedById: input.uploadedById ?? null,
      },
    })

    return { clip, deduped: false, similarClipIds }
  }
  finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
