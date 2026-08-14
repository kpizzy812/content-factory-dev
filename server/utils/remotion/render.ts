/**
 * Наложение анимационной инфографики на готовый ролик.
 *
 * ПОЧЕМУ модуль опциональный. Remotion — это рендер через headless Chrome: он
 * тянет за собой браузер и заметное время на кадр. Ролик обязан собираться и
 * без него, поэтому пакет грузится динамически, а его отсутствие даёт понятный
 * отказ, а не падение шага сборки.
 *
 * Включается `REMOTION_ENABLED=true`. По умолчанию выключено: пока пакет не
 * установлен (`bun add remotion @remotion/bundler @remotion/renderer`), включать
 * нечего.
 *
 * Лицензия проверена 14.08.2026: команде до трёх человек Remotion бесплатен и
 * для коммерческого использования; с четырёх сотрудников нужен тариф
 * Automators — $0.01 за рендер при минимуме $100 в месяц.
 */

import { access } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

import type { RemotionOverlayPlan } from "./overlay-plan"

export interface RemotionRenderRequest {
  /** Готовый ролик, поверх которого накладывается графика. */
  inputPath: string
  outputPath: string
  plan: RemotionOverlayPlan
  format: "portrait" | "landscape"
}

export type RemotionRenderOutcome =
  | { status: "rendered", outputPath: string }
  | { status: "skipped", reason: string }

/** Корень композиций Remotion. Отсутствует — значит слой ещё не собран. */
const COMPOSITIONS_ENTRY = join(process.cwd(), "remotion", "index.ts")

const BUNDLER_MODULE = "@remotion/bundler"
const RENDERER_MODULE = "@remotion/renderer"

/**
 * Минимальные контракты пакетов Remotion — ровно то, что вызывается ниже.
 * Полные типы приедут вместе с самими пакетами; держать их здесь нельзя,
 * потому что модуль обязан компилироваться и без установленного Remotion.
 */
interface RemotionBundler {
  bundle(options: { entryPoint: string, publicDir?: string }): Promise<string>
}

interface RemotionComposition {
  id: string
  durationInFrames: number
}

interface RemotionRenderer {
  selectComposition(options: {
    serveUrl: string
    id: string
    inputProps: Record<string, unknown>
  }): Promise<RemotionComposition>
  renderMedia(options: {
    composition: RemotionComposition
    serveUrl: string
    codec: string
    outputLocation: string
    inputProps: Record<string, unknown>
  }): Promise<unknown>
}

/**
 * Слой включён по умолчанию и выключается явным `REMOTION_ENABLED=false` —
 * так же, как смена планов и перебивки. Иначе фича живёт в коде и мертва на
 * стенде. Отсутствие пакетов или композиций всё равно даёт мягкий отказ, так
 * что включённый по умолчанию флаг ничего не ломает.
 */
export function isRemotionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.REMOTION_ENABLED !== "false"
}

/**
 * Накладывает графику, если всё для этого есть. Любая нехватка — это `skipped`
 * с причиной, а не исключение: ролик уже собран и готов к публикации, и терять
 * его из-за необязательного слоя нельзя.
 */
export async function renderRemotionOverlays(
  request: RemotionRenderRequest,
): Promise<RemotionRenderOutcome> {
  if (!isRemotionEnabled()) {
    return { status: "skipped", reason: "REMOTION_ENABLED не выставлен" }
  }
  if (request.plan.overlays.length === 0) {
    return { status: "skipped", reason: "в ролике нет сцен с цифрами — накладывать нечего" }
  }

  try {
    await access(COMPOSITIONS_ENTRY)
  }
  catch {
    return { status: "skipped", reason: `нет композиций Remotion (${COMPOSITIONS_ENTRY})` }
  }

  let bundler: RemotionBundler
  let renderer: RemotionRenderer
  try {
    // Имена модулей лежат в переменных намеренно: пакетов может не быть в
    // установке вовсе, а статический импорт заставил бы TypeScript требовать их
    // типы и уронил бы сборку до того, как кто-то решит включить Remotion.
    bundler = await import(BUNDLER_MODULE) as RemotionBundler
    renderer = await import(RENDERER_MODULE) as RemotionRenderer
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: "skipped", reason: `пакеты Remotion не установлены: ${message}` }
  }

  // Готовый ролик отдаётся композиции как статический файл: publicDir — это
  // каталог самого ролика, а внутри компонента он берётся по имени через
  // staticFile. Абсолютный путь в src браузер бы не открыл.
  const serveUrl = await bundler.bundle({
    entryPoint: COMPOSITIONS_ENTRY,
    publicDir: dirname(request.inputPath),
  })
  const inputProps = {
    videoFileName: basename(request.inputPath),
    overlays: request.plan.overlays,
    durationSec: request.plan.totalDurationSec,
  }
  const composition = await renderer.selectComposition({
    serveUrl,
    id: request.format === "portrait" ? "VerticalOverlays" : "HorizontalOverlays",
    inputProps,
  })

  await renderer.renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: request.outputPath,
    inputProps,
  })

  return { status: "rendered", outputPath: request.outputPath }
}
