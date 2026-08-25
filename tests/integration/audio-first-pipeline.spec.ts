/**
 * Сквозной прогон маршрута «монтаж от звука» на моках (Task 13).
 *
 * Модульные тесты проверяют куски маршрута по отдельности: выравнивание,
 * нарезку кусков трека, подгон длин, субтитры. Ни один из них не доказывает,
 * что маршрут СОБИРАЕТ РОЛИК. Здесь прогоняется настоящий `runVideoPipeline`
 * на настоящей тестовой БД, настоящем ffmpeg и настоящем хранилище — подменены
 * только внешние провайдеры, и подменены их штатными мок-режимами
 * (`REPLICATE_MOCK_MODE`, `ANTHROPIC_MOCK_MODE`, `FAL_MOCK_MODE`). Ни одного
 * платного вызова: `ENABLE_PAID_APIS=false` остаётся из `.env.test`.
 *
 * Что доказывается:
 *  1. шаги выполнены в порядке audio-first;
 *  2. озвучка синтезирована и ОПЛАЧЕНА ровно один раз;
 *  3. транскрипт сохранён и переживает повтор прогона;
 *  4. повторный прогон не создал новых оплаченных задач;
 *  5. финальный файл существует и его длина совпадает с длиной трека;
 *  6. НЕСУЩАЯ МЕХАНИКА МАРШРУТА: границы выравнивания → вырезанный из общего
 *     трека кусок → клип lip-sync его длины → склейка. Ролику для этого задан
 *     персонаж с библиотекой исходников и включён lip-sync: сцены с репликой в
 *     кадре снимает ведущая, звук им не синтезируется заново, а режется из
 *     трека, и повторный прогон не режет и не платит второй раз.
 *
 * До 17.08.2026 пункт 6 этот файл обходил: `runLipSyncStep` идёт только через
 * Replicate, а мок Replicate писал вместо медиа JSON-заглушку под именем `.mp4`
 * (её ffmpeg не склеит), и lip-sync приходилось выключать. Теперь мок выбирает
 * вид заглушки по СПОСОБНОСТИ и отдаёт видео заказанной длины
 * (`server/utils/mock/fal-mock.ts`, `tests/unit/fixes/fal-mock-placeholder.spec.ts`).
 *
 * Той же датой пункт 6 оказался вакуумным ещё в одном месте: проверка «кусок
 * вырезан ПО ГРАНИЦАМ СЦЕНЫ» (:660) сравнивала длину куска с
 * `Math.max(aligned.endSec - aligned.startSec, LIP_SYNC_MIN_SEC)`, а мок TTS
 * отдавал трек фиксированной ~1-секундной длины — интервал ЛЮБОЙ сцены
 * оказывался короче `LIP_SYNC_MIN_SEC`, и `Math.max` ВСЕГДА возвращал
 * константу-пол независимо от границ выравнивания. Ролик с кусками,
 * вырезанными не оттуда, этот тест прошёл бы тоже. Правка — `SCENE_PAUSE_SEC`
 * (фикстура, не мок): три настоящие паузы (`[пауза Nс]`, реальный ffmpeg)
 * растягивают ИЗМЕРЕННЫЙ трек, интервал сцены (~2.6 с) уже больше пола, и
 * `Math.max` берёт границу выравнивания, а не константу.
 *
 * ЧЕГО ЭТОТ ТЕСТ ВСЁ ЕЩЁ НЕ ПРОВЕРЯЕТ (сузившееся предупреждение):
 *  - lip-sync поверх СГЕНЕРИРОВАННОГО клипа: здесь у каждой сцены с репликой
 *    есть фрагмент ведущей, и ветка «исходник из clip_generation» не исполняется;
 *  - аватарный маршрут (`speech_to_video`) — он включается переменной
 *    `PRESENTER_ROUTE=avatar` и живёт на своих модульных тестах;
 *  - верхнее зажатие куска (`clampedToModel === "max"`): интервал сцены здесь
 *    калиброван узко — ровно настолько выше `LIP_SYNC_MIN_SEC`, чтобы остаться
 *    в окне подбора короткого исходника ведущей (см. `SCENE_PAUSE_SEC`), а не
 *    настолько, чтобы упереться в потолок модели (10 с). Ветка обрезки по
 *    потолку модели проверяется модульно (`tests/unit/voiceover/segment-cut.spec.ts`);
 *  - маршрут-специфичные ключи отказа (`track_segment_empty`,
 *    `track_segment_failed`): счастливый путь их не проходит по определению, они
 *    живут на `tests/unit/fixes/lip-sync-skip-reasons.spec.ts`;
 *  - притяжка границ куска к кадру здесь ИСПОЛНЯЕТСЯ, но не утверждается:
 *    сдвиг меньше 1/fps тонет в допуске, без которого нельзя — перекодировка в
 *    mp3 даёт свой хвост в десятки миллисекунд. Проверяется модульно там же,
 *    в `segment-cut.spec.ts`.
 *
 * Почему globalThis: `server/utils/**` рассчитан на авто-импорты Nitro
 * (`prisma`, `logAgent`, `ensureDir`, `getAssetsDir`, `assembleVideo`…).
 * Вне Nuxt-процесса их подставляет тест — НАСТОЯЩИМИ реализациями из тех же
 * модулей, а не заглушками: подменять здесь что-либо значило бы проверять не
 * маршрут, а собственные моки.
 *
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { prisma } from "../../server/utils/prisma"
import * as render from "../../server/utils/render"
import { logAgent } from "../../server/utils/agent-logger"
import { downloadFile } from "../../server/utils/video-helpers"
import { getStorageDriver, resetStorageDriver } from "../../server/utils/storage"
import { StorageKeys } from "../../server/utils/storage/keys"
import { createError } from "h3"

const globals = globalThis as Record<string, unknown>

/**
 * Файлы `server/utils/**`, которые НЕ являются модулями-библиотеками и авто-импорту
 * не подлежат: у них нет ни одного экспорта, зато есть работа на верхнем уровне.
 *
 * `pipeline-code-worker.ts` — точка входа worker_threads: при импорте он сразу
 * выполняется и пишет в `parentPort`. Под пулом vitest'а `threads` (штатный для
 * репозитория) сам тестовый воркер И ЕСТЬ worker_thread, `parentPort` не пуст, и
 * это сообщение прилетает в канал tinypool: прогон умирает целиком с
 * `Unexpected message on Worker: { success: false, error: '"undefined" is not
 * valid JSON' }` ещё до первого теста. Под `forks` `parentPort` пуст, модуль
 * падает внутри try и молча пропускается — поэтому разницы не видно, пока не
 * прогонишь штатной командой.
 *
 * Nitro такие файлы тоже не подтягивает: авто-импорт собирает ЭКСПОРТЫ, а их тут
 * ноль. Так что исключение — не костыль теста, а повторение боевого поведения.
 */
const NOT_A_MODULE = ["/pipeline-code-worker.ts"]

/**
 * Авто-импорты Nitro, которых нет в голом vitest.
 *
 * В бою Nitro раскладывает по глобальной области ВСЕ экспорты `server/utils/**`,
 * и пайплайн этим пользуется (`prisma`, `logAgent`, `ensureDir`, `getAssetsDir`,
 * `generateSceneImagePrompts`…). Перечислять их руками — гарантированная гонка
 * с кодом: любой новый авто-импорт ломал бы тест `ReferenceError`'ом далеко от
 * причины. Поэтому раскладываем ровно тем же способом — по всем модулям.
 *
 * Модуль, который не импортируется (ждёт своё окружение), пропускается: он
 * заведомо не участвует в маршруте, иначе прогон упал бы на его функции.
 */
async function installNitroAutoImports(): Promise<void> {
  const modules = import.meta.glob("../../server/utils/**/*.ts")
  for (const path of Object.keys(modules).sort()) {
    if (NOT_A_MODULE.some(tail => path.endsWith(tail))) continue
    try {
      const loaded = await modules[path]!() as Record<string, unknown>
      for (const [name, value] of Object.entries(loaded)) {
        if (name === "default") continue
        if (!(name in globals)) globals[name] = value
      }
    } catch { /* модуль вне маршрута — его отсутствие проявится падением по делу */ }
  }
  // h3 тоже авто-импортится в Nitro: без него paid-guard падает
  // `createError is not defined` вместо своего внятного отказа.
  globals.createError = createError
  // Настоящие реализации важнее случайного порядка глоба.
  globals.prisma = prisma
  globals.logAgent = logAgent
  globals.downloadFile = downloadFile
  globals.ensureDir = render.ensureDir
  globals.safeUnlink = render.safeUnlink
  globals.getAssetsDir = render.getAssetsDir
  globals.getVideosDir = render.getVideosDir
  globals.assembleVideo = render.assembleVideo
}

/** Три сцены с репликами ведущей в кадре — ради них маршрут и существует. */
const SPOKEN_LINES = [
  "Первая сцена рассказывает про запуск проекта",
  "Вторая сцена показывает результат за неделю",
  "Третья сцена зовёт написать кодовое слово",
]

/**
 * Пауза, которую `spokenLine` каждой сцены несёт ДОПОЛНИТЕЛЬНО к чистому
 * тексту — `[пауза Nс]` `buildTrackRequest` (`voiceover/track-builder.ts`)
 * вырезает из произносимого текста и превращает в настоящую тишину
 * (`insertVoiceoverPauses`, реальный ffmpeg, не мок).
 *
 * Без неё синтез — заглушка фиксированной 1-секундной длины (мок TTS не умеет
 * заказанную длительность, в отличие от video/lip-sync после 17.08.2026), и
 * весь текст сценария укладывается в эту секунду. Интервал КАЖДОЙ сцены
 * тогда короче `LIP_SYNC_MIN_SEC`, и `Math.max(interval, LIP_SYNC_MIN_SEC)`
 * в проверке ниже ВСЕГДА возвращает константу-пол: граница выравнивания в
 * сравнение фактически не участвует, и ролик с кусками, вырезанными не
 * оттуда, этот тест прошёл бы тоже.
 *
 * Три паузы по `SCENE_PAUSE_SEC` растягивают ИЗМЕРЕННЫЙ трек до ~10 с;
 * мок транскрипта (`buildMockTranscript`) раскладывает слова сценария
 * РАВНОМЕРНО по этой длине — интервал сцены с шестью словами выходит около
 * 2.6 с, то есть строго больше пола, и `Math.max` берёт границу, а не пол.
 * Число подобрано намеренно узко: интервал обязан остаться в окне подбора
 * исходника `±DEFAULT_PRESENTER_MAX_DELTA_SEC` (1 с) вокруг `PRESENTER_CLIP_SEC`
 * (2 с) — иначе подбор ушёл бы на `PRESENTER_CLIP_TOO_LONG_SEC` вместо
 * короткого клипа, и сломалась бы соседняя проверка (:629).
 */
const SCENE_PAUSE_SEC = 3

/**
 * Четвёртая сцена — перебивка: реплики в кадре нет, звучит закадровая строка.
 *
 * Она здесь не для полноты картины, а чтобы ролик НЕ был «целиком снятым
 * ведущей»: у такого ролика оркестратор пропускает и промпты, и кадры, и клипы
 * (`presenterOnly`), и сквозной прогон потерял бы весь платный контур
 * `text_to_image` вместе с ним. С перебивкой в прогоне остаются и кадры, и
 * сцена, которую lip-sync законно не трогает.
 */
const NARRATION_LINE = "Закадровый голос подводит итог недели"

/** Все реплики ролика в порядке звучания — из них мок собирает трек и транскрипт. */
const SCENE_LINES = [...SPOKEN_LINES, NARRATION_LINE]

/** Длина фрагмента ведущей в библиотеке персонажа. */
const PRESENTER_CLIP_SEC = 2
/**
 * Второй фрагмент — заведомо мимо: интервал сцены с паузами (`SCENE_PAUSE_SEC`)
 * ложится в окно подбора `±DEFAULT_PRESENTER_MAX_DELTA_SEC` (1 с) вокруг
 * `PRESENTER_CLIP_SEC` (2 с), то есть максимум около 3 с — пятисекундный
 * фрагмент в это окно не попадает ни при каких раскладах. Он в фикстуре ради
 * того, чтобы выбор исходника был выбором, а не единственным вариантом.
 */
const PRESENTER_CLIP_TOO_LONG_SEC = 5
/** Минимум длительности исходника у kling-lip-sync — до него добивается кусок трека. */
const LIP_SYNC_MIN_SEC = 2
/** Длина видео-заглушки мока по умолчанию: заказанная длина обязана отличаться от неё. */
const PLACEHOLDER_DEFAULT_SEC = 3

function storyPlan() {
  return {
    version: "story-driven-1.0",
    storyArc: {
      template: "discovery",
      premise: "p",
      conflict: "c",
      turningPoint: "t",
      resolution: "r",
      emotionalJourney: ["curiosity", "excitement", "satisfaction"],
    },
    scenes: SCENE_LINES.map((line, index) => ({
      order: index + 1,
      purpose: `сцена ${index + 1}`,
      setting: "студия",
      action: "ведущий говорит в камеру",
      whatChanges: "меняется тема",
      emotionalState: "спокойствие",
      appIntegrationBeat: null,
      visualPromptGuidance: `studio shot, presenter, scene ${index + 1}`,
      // Субтитр и spokenLine намеренно расходятся: пауза едет только в
      // произносимый текст (её видит `buildTrackRequest`, вырезает и превращает
      // в тишину), субтитр остаётся ЧИСТЫМ текстом реплики — маркер паузы в
      // кадре зритель видеть не должен.
      subtitleCopy: line,
      subtitlePlacement: { position: "bottom", alignment: "center", avoidZones: [] },
      voiceoverLine: index < SPOKEN_LINES.length ? null : line,
      spokenLine: index < SPOKEN_LINES.length ? `${line} [пауза ${SCENE_PAUSE_SEC}с]` : null,
      continuityNotes: "",
      duration: "5s",
      cameraAngle: "medium",
      props: [],
    })),
    voiceoverPlan: {
      enabled: true,
      narratorPersona: null,
      pacing: "moderate",
      emotionalContour: [],
      syncGuidance: "",
      lines: [{
        sceneOrder: SCENE_LINES.length,
        text: NARRATION_LINE,
        emotion: "neutral",
        pauseAfter: "none",
      }],
    },
    subtitleStyle: null,
    globalVisualSystem: {
      stylePrompt: "clean studio, soft key light",
      colorPalette: ["#101010", "#f5f5f5"],
      mood: "уверенный",
      lighting: "мягкий свет",
    },
    protagonist: {
      type: "person",
      description: "ведущий",
      initialState: "сомневается",
      finalState: "уверен",
      visualIdentifiers: ["тёмная толстовка"],
    },
    continuityBible: { protagonistLock: "", environmentLock: "", propsLock: [], forbidden: [] },
    appIntegrationStrategy: "мельком",
    negativeConstraints: [],
    fullScript: SCENE_LINES.join(" "),
  }
}

interface Fixture {
  videoId: number
  scenarioId: number
  appId: number
  characterId: string
}

/**
 * Чёрный клип нужной длины НАСТОЯЩИМ ffmpeg.
 *
 * Собирается своим вызовом, а не через `generateMockPlaceholder`: длина
 * фрагмента ведущей — эталон, с которым сверяется длина клипа после lip-sync.
 * Возьми мы эталон у той же заглушки, которую проверяем, сравнение доказывало бы
 * только её самосогласованность.
 */
function renderBlackClip(outPath: string, durationSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-f", "lavfi", "-i", `color=black:size=1080x1920:duration=${durationSec}:rate=30`,
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-shortest",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
      "-c:a", "aac", "-b:a", "96k",
      outPath,
    ], { stdio: "ignore" })
    proc.once("error", reject)
    proc.once("exit", code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)))
  })
}

/**
 * Персонаж с библиотекой исходников — то, из чего lip-sync снимает сцену
 * ведущей. Фрагменты кладём в то же постоянное хранилище, откуда их берёт шаг:
 * подмена драйвера здесь означала бы проверку собственного мока.
 */
async function createPresenterCharacter(appId: number, workDir: string): Promise<string> {
  const character = await prisma.character.create({
    data: { appId, name: "Ведущая сквозного прогона", role: "protagonist" },
  })

  for (const durationSec of [PRESENTER_CLIP_SEC, PRESENTER_CLIP_TOO_LONG_SEC]) {
    const localPath = join(workDir, `presenter_${durationSec}s.mp4`)
    await renderBlackClip(localPath, durationSec)
    const bytes = await readFile(localPath)
    const sha1 = createHash("sha1").update(bytes).digest("hex")
    const storageKey = StorageKeys.presenterSourceClip(appId, character.id, sha1)
    await getStorageDriver().uploadBuffer(storageKey, bytes, { contentType: "video/mp4" })
    // В БД кладём ИЗМЕРЕННУЮ длительность: по ней шаг строит окно подбора, и
    // номинал ffmpeg с ней расходится на сотые доли.
    const measured = await render.probeMediaDuration(localPath)
    expect(measured).not.toBeNull()

    await prisma.presenterSourceClip.create({
      data: {
        characterId: character.id,
        name: `presenter_${durationSec}s.mp4`,
        fileUrl: `/api/files/${encodeURIComponent(storageKey)}`,
        storageKey,
        storageProvider: getStorageDriver().providerName,
        sha1,
        mimeType: "video/mp4",
        bytes: bytes.length,
        durationSec: measured!,
        width: 1080,
        height: 1920,
        tags: [],
      },
    })
  }

  return character.id
}

async function createVideoFixture(workDir: string): Promise<Fixture> {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const app = await prisma.app.create({
    data: { name: `AudioFirstApp ${seed}`, description: "фикстура сквозного прогона", keywords: [] },
  })
  const characterId = await createPresenterCharacter(app.id, workDir)
  const scenario = await prisma.scenario.create({
    data: { appId: app.id, status: "selected" as never },
  })
  const variant = await prisma.scenarioVariant.create({
    data: {
      scenarioId: scenario.id,
      variantIndex: 0,
      status: "accepted" as never,
      title: "Сквозной прогон",
      hook: "Хук ролика",
      body: "Тело ролика",
      cta: "Пиши слово",
      fullScript: SCENE_LINES.join(" "),
      visualStyleText: "чистый студийный свет",
      storyPlan: storyPlan() as never,
    },
  })
  await prisma.scenario.update({
    where: { id: scenario.id },
    data: { selectedVariantId: variant.id },
  })

  const video = await prisma.video.create({
    data: {
      scenarioId: scenario.id,
      variantId: variant.id,
      status: "pending" as never,
      format: "portrait" as never,
      // Маршрут фиксируется на ролике при создании — ровно как это делает
      // эндпоинт запуска (Task 12).
      editPipeline: true,
      voiceoverEnabled: true,
      voiceoverModelId: "fal-ai/elevenlabs/tts/turbo-v2.5",
      voiceoverVoiceId: "Rachel",
      voiceoverLanguage: "ru",
      voiceoverPacing: "moderate",
      // Кадры и клипы — через fal, это дефолт реестра. Replicate в этом прогоне
      // исполняет транскрипцию и lip-sync, то есть оба маршрутных провайдера
      // работают по-настоящему.
      imageModelId: "fal-ai/flux/dev",
      videoModelId: "fal-ai/kling-video/v3/standard/text-to-video",
      modelStrategy: "auto",
      generateAudio: false,
      musicEnabled: false,
      subtitlesEnabled: true,
      clipDuration: 5,
      imageCount: 3,
      renderQuality: "medium",
      targetPlatform: "tiktok",
      // Несущая механика маршрута: сцены с репликой в кадре снимает ведущая,
      // звук им режется из общего трека. Модель не задаём — шаг берёт
      // интегрированную по умолчанию (Replicate kling-lip-sync).
      lipSyncEnabled: true,
      lipSyncCharacterId: characterId,
      // Important 5 (ревью фикс-раунда 1): политика реконсиляции озвучки —
      // САМАЯ последствия несущая из трёх (единственная, что зовёт
      // extendVideoClip/создаёт *_ext.mp4). На кадровом маршруте она обязана
      // не исполняться вовсе (§8), а не просто совпасть со значением по
      // умолчанию БД — задаём явно, чтобы утверждение ниже проверяло именно
      // ЭТУ политику, а не молчаливое совпадение с дефолтом схемы.
      voiceoverReconciliation: "extend_scene",
    },
  })

  return { videoId: video.id, scenarioId: scenario.id, appId: app.id, characterId }
}

/**
 * Ключи шагов в порядке ФАКТИЧЕСКОГО выполнения.
 *
 * Момент шага — `startedAt`, а у пропущенного шага его нет вовсе (он не
 * запускался): такому берём `finishedAt` — время, когда оркестратор до него
 * дошёл и закрыл. Сортировка по одному `startedAt` уводила бы пропущенные шаги
 * в конец списка и врала про порядок маршрута.
 */
async function stepKeysInExecutionOrder(videoId: number): Promise<string[]> {
  const steps = await prisma.videoGenerationStep.findMany({
    where: { videoId },
    select: { id: true, stepKey: true, startedAt: true, finishedAt: true },
  })
  return steps
    .map(step => ({
      key: String(step.stepKey),
      at: (step.startedAt ?? step.finishedAt)?.getTime() ?? Number.MAX_SAFE_INTEGER,
      id: step.id,
    }))
    .sort((a, b) => a.at - b.at || a.id - b.id)
    .map(step => step.key)
}

/**
 * Номера попыток платных шагов: растут ТОЛЬКО когда шаг реально пошёл в
 * провайдера. Шаг, вернувший готовое из снапшота, счётчик не трогает.
 */
async function paidStepAttempts(videoId: number): Promise<Record<string, number>> {
  const steps = await prisma.videoGenerationStep.findMany({
    where: {
      videoId,
      stepKey: {
        in: [
          "voiceover_generation", "transcription", "image_generation",
          "clip_generation", "lip_sync_generation", "music_generation",
        ] as never[],
      },
    },
    select: { stepKey: true, attemptCount: true },
  })
  return Object.fromEntries(steps.map(step => [String(step.stepKey), step.attemptCount]))
}

/** Строки лога шага — по ним видно, ЧТО именно шаг сделал. */
async function stepLog(videoId: number, stepKey: string): Promise<string[]> {
  const step = await prisma.videoGenerationStep.findFirst({
    where: { videoId, stepKey: stepKey as never },
    select: { logs: true },
  })
  const logs = Array.isArray(step?.logs) ? step.logs : []
  return logs.map(entry => String((entry as { msg?: unknown }).msg ?? ""))
}

let storageRoot: string

/**
 * Переменные окружения, которые файл подменяет. Прогон идёт одним процессом,
 * `process.env` общий на всю сьюту: не вернув их, мы оставили бы следующим
 * файлам путь в уже удалённый каталог и чужой драйвер хранилища.
 */
const PATCHED_ENV = [
  "MEDIA_MODEL_TRANSCRIPTION",
  "STORAGE_DRIVER",
  "STORAGE_LOCAL_ROOT",
  "UPLOADS_STORAGE_PATH",
] as const
const previousEnv = new Map<string, string | undefined>()

function patchEnv(name: (typeof PATCHED_ENV)[number], value: string): void {
  if (!previousEnv.has(name)) previousEnv.set(name, process.env[name])
  process.env[name] = value
}

describe("маршрут «монтаж от звука» собирает ролик целиком (моки)", () => {
  beforeAll(async () => {
    // Этот файл — единственный в репозитории, который проходит платный контур
    // целиком. У разработчика с экспортированными ключами и ENABLE_PAID_APIS=true
    // он ушёл бы в живых провайдеров и потратил бы деньги. Проверяем режим ДО
    // первой строки прогона, а не надеемся на .env.test.
    expect(process.env.REPLICATE_MOCK_MODE).toBe("true")
    expect(process.env.ANTHROPIC_MOCK_MODE).toBe("true")
    expect(process.env.FAL_MOCK_MODE).toBe("true")
    expect(process.env.ENABLE_PAID_APIS).not.toBe("true")

    // Модель транскрипции в реестре integrated: false (цена не подтверждена
    // страницей модели). Штатный путь включения до canary — явная переменная:
    // при заданном requestedId реестр проверку integrated не делает.
    patchEnv("MEDIA_MODEL_TRANSCRIPTION", "openai/whisper")
    patchEnv("STORAGE_DRIVER", "local")
    storageRoot = await mkdtemp(join(tmpdir(), "cf-audio-first-"))
    // Два разных корня: STORAGE_LOCAL_ROOT — постоянное хранилище (драйвер),
    // UPLOADS_STORAGE_PATH — рабочий каталог ассетов ролика. Оба уводим из
    // репозитория, чтобы прогон не оставлял мусор в ./storage.
    patchEnv("STORAGE_LOCAL_ROOT", join(storageRoot, "bucket"))
    patchEnv("UPLOADS_STORAGE_PATH", join(storageRoot, "uploads"))
    resetStorageDriver()
    await installNitroAutoImports()
  })

  afterAll(async () => {
    // Порядок важен: сначала вернуть переменные, потом сбросить драйвер, и
    // только потом удалять каталог — иначе закэшированный драйвер останется
    // смотреть в удалённый корень.
    for (const [name, value] of previousEnv) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    previousEnv.clear()
    resetStorageDriver()
    await rm(storageRoot, { recursive: true, force: true }).catch(() => {})
  })

  it("прогон через нарезку трека и lip-sync, повтор прогона и совпадение длины ролика с длиной трека", async () => {
    const { videoId } = await createVideoFixture(storageRoot)
    const { runVideoPipeline } = await import("../../server/utils/video-pipeline")

    await runVideoPipeline(videoId)

    // 1. Шаги выполнены в порядке audio-first.
    expect(await stepKeysInExecutionOrder(videoId)).toEqual([
      "prompt_generation",
      "voiceover_generation",
      "transcription",
      "edit_plan",
      "shot_background",
      "image_generation",
      "clip_generation",
      "lip_sync_generation",
      "music_generation",
      "assembly",
    ])

    // План монтажа реально построен и записан в свою таблицу (не VideoAsset).
    const shotsAfterFirstRun = await prisma.videoShot.findMany({ where: { videoId } })
    expect(shotsAfterFirstRun.length).toBeGreaterThan(0)
    const editPlanCosts = await prisma.aiAuditLog.findMany({
      where: { videoId, stepKey: "edit_plan" },
      select: { costUsd: true },
    })
    expect(editPlanCosts).toHaveLength(1)

    // 2. Озвучка синтезирована ОДИН раз.
    //
    // Считать ассеты микса для этого нельзя: ОБА маршрута пишут его через
    // «найти → обновить, иначе создать» (`runAudioFirstVoiceover`,
    // `runVoiceoverGeneration`), поэтому второго ассета этого типа не бывает
    // никогда — сколько бы раз речь ни синтезировали. Такое утверждение
    // выполняет букву брифа и не проверяет его смысл.
    //
    // Ловим сам ФАКТ оплаченного синтеза, тремя независимыми следами:
    //  - строка расхода в ledger: `logStepCost` дедуплицирует по
    //    (videoId, stepKey, service, ПОПЫТКА), значит второй синтез — вторая
    //    строка, а не перезапись первой;
    //  - `attemptCount` шага: растёт только когда шаг реально пошёл в провайдера;
    //  - ноль ПОСЦЕННЫХ ассетов `voiceover`: их пишет прежний маршрут, и их
    //    появление означало бы, что речь записали второй раз другим способом.
    //
    // `MediaPrediction` здесь не инструмент: `synthesizeSpeech` зовёт
    // `runMediaTask` без `persist`, а fal-ветка пишет prediction только когда
    // результат перенесён в постоянное хранилище (`if (storage && identity)`),
    // так что у TTS записи нет вовсе — проверено прогоном (в ролике только
    // 3 × text_to_image и 1 × transcription).
    expect(await prisma.videoAsset.count({ where: { videoId, type: "voiceover_mix" as never } })).toBe(1)
    expect(await prisma.videoAsset.count({ where: { videoId, type: "voiceover" as never } })).toBe(0)

    const voiceoverCosts = await prisma.aiAuditLog.findMany({
      where: { videoId, stepKey: "voiceover_generation" },
      select: { service: true, costUsd: true },
    })
    expect(voiceoverCosts).toHaveLength(1)
    expect(Number(voiceoverCosts[0]!.costUsd)).toBeGreaterThan(0)

    const voiceoverStep = await prisma.videoGenerationStep.findFirst({
      where: { videoId, stepKey: "voiceover_generation" as never },
      select: { attemptCount: true, status: true },
    })
    expect(voiceoverStep?.status).toBe("completed")
    expect(voiceoverStep?.attemptCount).toBe(1)

    const voiceoverAssets = await prisma.videoAsset.findMany({
      where: { videoId, type: "voiceover_mix" as never },
    })

    // 3. Транскрипт сохранён.
    const transcriptAsset = await prisma.videoAsset.findFirst({
      where: { videoId, type: "transcript" as never },
    })
    expect(transcriptAsset).toBeTruthy()

    const video = await prisma.video.findUnique({ where: { id: videoId } })
    expect(video?.status).toBe("completed")
    expect(video?.filePath).toBeTruthy()

    // Выравнивание сошлось полностью: мок отдаёт слова НАШЕГО ЖЕ сценария, и
    // деградация здесь означала бы поломку разбора или самого выравнивания.
    const transcriptionSnapshot = await prisma.videoGenerationStep.findFirst({
      where: { videoId, stepKey: "transcription" as never },
      select: { outputSnapshot: true, status: true },
    })
    expect(transcriptionSnapshot?.status).toBe("completed")
    const snapshot = transcriptionSnapshot?.outputSnapshot as {
      status?: string
      scenes?: Array<{ order: number, startSec: number, endSec: number, words: unknown[] }>
    }
    expect(snapshot?.status).toBe("completed")
    expect(snapshot?.scenes).toHaveLength(SCENE_LINES.length)

    // 5. Финальный файл существует, и его длина совпадает с длиной трека.
    await expect(stat(video!.filePath!)).resolves.toBeTruthy()
    const trackDurationSec = await render.probeMediaDuration(voiceoverAssets[0]!.filePath!)
    const finalDurationSec = await render.probeMediaDuration(video!.filePath!)
    expect(trackDurationSec).not.toBeNull()
    expect(finalDurationSec).not.toBeNull()
    expect(trackDurationSec!).toBeGreaterThan(0)
    expect(Math.abs(finalDurationSec! - trackDurationSec!)).toBeLessThan(0.5)

    // Совпадение длин — не совпадение случайное. У этого ролика есть план
    // монтажа (`editPlan !== null`: `audioFirst !== null && alignedScenes.length > 0`,
    // ровно условие блока 2c/2d в video-pipeline.ts) — Task 6 включает для
    // него КАДРОВЫЙ маршрут (`shotRouteActive`), и сборка идёт по кадрам, а не
    // по клипам сцен: `fitClipsToTrack`/«Подгон длины клипов под трек» на этом
    // маршруте не вызываются вовсе (Task 6, §8 — кадры по построению уже
    // покрывают трек ровно, подгонять нечего). Вместо старой строки лога —
    // подтверждение, что сборку СОБРАЛИ ИМЕННО КАДРЫ: без этой проверки тест
    // прошёл бы и на ролике, у которого клипы случайно суммировались в длину
    // трека.
    const assemblyLog = await stepLog(videoId, "assembly")
    expect(assemblyLog.some(line => line.startsWith("Подгон длины клипов под трек:"))).toBe(false)
    expect(assemblyLog.some(line => /^Кадровый монтаж: таймлайн собран из \d+ кадров/.test(line))).toBe(true)

    // Сомнение 3 фикс-раунда 1 (ревью): Remotion-оверлеи на кадровом маршруте
    // пропускаются целиком (адресуются позицией клипа, которой на этом
    // маршруте не существует) — потеря обязана быть ВИДНА в логе шага, а не
    // молчаливой.
    expect(assemblyLog.some(line => line.startsWith("Инфографика на кадровом маршруте не строится"))).toBe(true)

    // ── 6. Несущая механика: кусок трека → lip-sync клип → склейка ──
    const lipSyncStep = await prisma.videoGenerationStep.findFirst({
      where: { videoId, stepKey: "lip_sync_generation" as never },
      select: { status: true, outputSnapshot: true },
    })
    expect(lipSyncStep?.status).toBe("completed")
    const lipSync = lipSyncStep?.outputSnapshot as {
      status?: string
      syncedSceneCount?: number
      clipPaths?: string[]
      scenes?: Array<{
        sceneOrder: number
        sceneIndex: number
        outputPath: string | null
        audioPath: string | null
        durationSec: number
        skipped?: string
      }>
    }
    expect(lipSync?.status).toBe("completed")
    // Синхронизированы ровно сцены с репликой в кадре: перебивку lip-sync не
    // трогает, у неё своего голоса нет.
    expect(lipSync?.syncedSceneCount).toBe(SPOKEN_LINES.length)
    expect(lipSync?.scenes).toHaveLength(SPOKEN_LINES.length)

    const alignedByOrder = new Map(
      (snapshot?.scenes ?? []).map(scene => [scene.order, scene] as const),
    )
    /** mtime кусков трека и клипов — по ним видно, резали ли заново на повторе. */
    const producedFileMtimes = new Map<string, number>()

    for (const record of lipSync!.scenes!) {
      expect(record.skipped).toBeUndefined()

      // Звук сцены — ВЫРЕЗАННЫЙ кусок трека, а не повторный синтез. Имя файла
      // куска содержит отпечаток интервала, синтезированной реплики — отпечаток
      // текста и голоса; спутать их нельзя.
      expect(record.audioPath).toMatch(/scene_\d+_track_[0-9a-f]{12}\.mp3$/)
      const segmentSec = await render.probeMediaDuration(record.audioPath!)
      expect(segmentSec).not.toBeNull()

      // Кусок вырезан ПО ГРАНИЦАМ СЦЕНЫ: его длина — интервал выравнивания,
      // добитый тишиной до минимума модели (короче минимума провайдер не примет).
      // Благодаря `SCENE_PAUSE_SEC` интервал (~2.6 с) сам больше минимума
      // (2 с) — `Math.max` берёт ГРАНИЦУ, а не константу-пол, и сравнение
      // ниже действительно проверяет длину куска, а не самосогласованность
      // формулы с собой же (см. докстринг файла).
      const aligned = alignedByOrder.get(record.sceneOrder)
      expect(aligned).toBeTruthy()
      const expectedSegmentSec = Math.max(aligned!.endSec - aligned!.startSec, LIP_SYNC_MIN_SEC)
      expect(expectedSegmentSec).toBeGreaterThan(LIP_SYNC_MIN_SEC)
      expect(Math.abs(segmentSec! - expectedSegmentSec)).toBeLessThan(0.25)

      // Заказ ушёл длиной ИСХОДНИКА ведущей — фрагмента из библиотеки, который
      // подобран под длину куска. Это и есть число, которое обязана вернуть
      // заглушка, и оно намеренно НЕ равно её длине по умолчанию: иначе проверка
      // ниже сравнивала бы константу с константой.
      expect(Math.abs(record.durationSec - PRESENTER_CLIP_SEC)).toBeLessThan(0.25)
      expect(Math.abs(record.durationSec - PLACEHOLDER_DEFAULT_SEC)).toBeGreaterThan(0.5)

      // Клип после lip-sync — настоящий файл ЗАКАЗАННОЙ длины.
      expect(record.outputPath).toBeTruthy()
      const clipSec = await render.probeMediaDuration(record.outputPath!)
      expect(clipSec).not.toBeNull()
      expect(Math.abs(clipSec! - record.durationSec)).toBeLessThan(0.25)

      // …и он уехал В СБОРКУ. Видеоряд сборка берёт из `clipPaths` этого
      // снапшота (`video-pipeline.ts`: `effectiveClipPaths = lipSyncResult.clipPaths`),
      // а не из `filePath` ассетов — у обычной сцены он намеренно продолжает
      // смотреть на несинхронизированный оригинал. Без этой проверки последнее
      // звено цепочки «кусок → клип → склейка» осталось бы на честном слове:
      // совпадение длин само по себе прошло бы и на ролике, собранном из
      // исходников.
      expect(lipSync?.clipPaths?.[record.sceneIndex]).toBe(record.outputPath)

      for (const path of [record.audioPath!, record.outputPath!]) {
        producedFileMtimes.set(path, (await stat(path)).mtimeMs)
      }
    }

    // Куски трека лежат в каталоге ассетов ролика, посценного синтеза нет вовсе,
    // а от атомарной нарезки (temp + rename) не осталось временных огрызков.
    const assetFiles = await readdir(render.getAssetsDir(videoId))
    expect(assetFiles.filter(name => /^scene_\d+_track_/.test(name)))
      .toHaveLength(SPOKEN_LINES.length)
    expect(assetFiles.filter(name => /^scene_\d+_spoken_/.test(name))).toEqual([])
    expect(assetFiles.filter(name => name.includes(".tmp-"))).toEqual([])

    // Important 5 (ревью фикс-раунда 1): прежний ассерт `extendVideoClipCalls === 0`
    // в `shot-route-inertness.spec.ts` был вакуумен — `extendVideoClip` вызывается
    // ЕДИНСТВЕННЫМ местом кодовой базы, `runVoiceoverGeneration`, куда `runAssembly`
    // не ходит ни на каком маршруте, так что ассерт не мог упасть в принципе.
    // Наблюдаемый признак ЗДЕСЬ — прямое следствие политики `extend_scene` (задана
    // явно в фикстуре выше): единственный файловый след её исполнения — `*_ext.mp4`
    // (см. `persistExtendedClipAsset`/`isLipSyncOutputPath` в `presenter/scene-clip-mapping.ts`).
    // Ролик прошёл ПОЛНЫЙ реальный пайплайн (включая voiceover_generation — он
    // просто не вызывался на этом маршруте, см. шаги 1 выше), поэтому отсутствие
    // `*_ext.mp4` в assetsDir — не вакуумная проверка недостижимого кода, а
    // наблюдение за РЕАЛЬНЫМ побочным эффектом (или его отсутствием) целого прогона.
    expect(assetFiles.filter(name => /_ext\.mp4$/.test(name))).toEqual([])

    // Lip-sync оплачен ровно один раз — по строке ledger на попытку.
    const lipSyncCosts = await prisma.aiAuditLog.findMany({
      where: { videoId, stepKey: "lip_sync_generation" },
      select: { costUsd: true },
    })
    expect(lipSyncCosts).toHaveLength(1)
    expect(Number(lipSyncCosts[0]!.costUsd)).toBeGreaterThan(0)

    // 4. Повторный прогон не создал новых оплаченных задач.
    //
    // Меряем тремя независимыми счётчиками: задачи провайдеров
    // (`MediaPrediction`), ассеты ролика и номера попыток платных шагов.
    // Каждый из них ловит свою дыру: первый — второй submit, второй — вторую
    // скачанную картинку, третий — повторный вызов TTS/транскрипции, который
    // ассетов не добавляет (файл перезаписывается по тому же пути).
    const predictionsBefore = await prisma.mediaPrediction.count({ where: { videoId } })
    const assetsBefore = await prisma.videoAsset.count({ where: { videoId } })
    const attemptsBefore = await paidStepAttempts(videoId)

    await runVideoPipeline(videoId)

    expect(await prisma.mediaPrediction.count({ where: { videoId } }) - predictionsBefore).toBe(0)
    expect(await prisma.videoAsset.count({ where: { videoId } }) - assetsBefore).toBe(0)
    expect(await paidStepAttempts(videoId)).toEqual(attemptsBefore)
    // Речь не пересинтезирована: вторая оплата была бы второй строкой ledger'а.
    expect(await prisma.aiAuditLog.count({
      where: { videoId, stepKey: "voiceover_generation" },
    })).toBe(1)

    // План монтажа тоже не пересчитан и не переоплачен: кэш шага (требование 6,
    // отпечаток трека + профиль + число сцен) отдал готовый план, второй
    // ai-audit-строки и второго набора кадров быть не должно.
    expect(await prisma.aiAuditLog.count({
      where: { videoId, stepKey: "edit_plan" },
    })).toBe(1)
    const shotsAfterSecondRun = await prisma.videoShot.findMany({ where: { videoId } })
    expect(shotsAfterSecondRun.length).toBe(shotsAfterFirstRun.length)

    // 6 (вторая половина). Повтор не режет кусок заново и не платит за губы:
    // файлы на месте и НЕ переписаны — mtime тот же, что после первого прогона.
    expect(await prisma.aiAuditLog.count({
      where: { videoId, stepKey: "lip_sync_generation" },
    })).toBe(1)
    for (const [path, mtimeMs] of producedFileMtimes) {
      expect((await stat(path)).mtimeMs).toBe(mtimeMs)
    }

    // 3 (вторая половина). Транскрипт ПЕРЕЖИЛ повтор прогона, трек не пересинтезирован.
    expect(await prisma.videoAsset.count({ where: { videoId, type: "transcript" as never } })).toBe(1)
    expect(await prisma.videoAsset.count({ where: { videoId, type: "voiceover_mix" as never } })).toBe(1)
    const snapshotAfterRerun = await prisma.videoGenerationStep.findFirst({
      where: { videoId, stepKey: "transcription" as never },
      select: { outputSnapshot: true },
    })
    expect((snapshotAfterRerun?.outputSnapshot as { scenes?: unknown[] })?.scenes)
      .toHaveLength(SCENE_LINES.length)
  }, 600_000)
})
