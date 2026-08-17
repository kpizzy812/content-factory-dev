# Записи ведущего и нарезка под речь — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Длинная запись ведущего сохраняется нормализованной и переживает падение ingest, а фрагмент под кадр вырезается из неё по фактической длине реплики — вместо подбора готового клипа с допуском ±1 с; повторное использование считается по интервалам записи, а не по счётчику на клипе.

**Architecture:** Появляется модель `PresenterRecording` — нормализованный файл в объектном хранилище, дедуп по sha1 **оригинала** и статус ingest, по которому нарезку можно перезапустить без повторной заливки двух гигабайт. `PresenterSourceClip` получает необязательную ссылку на запись-родителя; существующие клипы остаются с `null` и работают прежним путём. Учёт использования переезжает с клипов на произвольные интервалы записи (`PresenterRecordingUsage`), потому что при нарезке по требованию единица использования — окно, а не файл. На маршруте audio-first lip-sync сначала спрашивает запись-родителя и режет из неё окно ровно под длину вырезанного куска трека; записи нет — работает прежний подбор клипа по длительности. Жизненный цикл записей (автоочистка `auto`, холодный класс, повторная нарезка) закрывает рост хранилища до ~110 ГБ в месяц.

**Tech Stack:** Nuxt 4 / Nitro, Bun, TypeScript, Prisma + PostgreSQL 16, Vitest (DB-free сьюта — `vitest.pure.config.ts`, с БД — `vitest.config.ts`), FFmpeg через `fluent-ffmpeg` и прямой `runFfmpeg` в `presenter/ffmpeg-adapter.ts`, объектное хранилище через `getStorageDriver()`.

**Spec:** `docs/superpowers/specs/2026-08-16-audio-first-editing-design.md` (§6.1, §6.2; план работ §11 пункты 4a, 4b, 4c)

**Предшествующие планы:**
- `docs/superpowers/plans/2026-08-16-audio-first-timing.md` — выполнен, часть 1 спеки (единый трек, транскрипция, выравнивание).
- `docs/superpowers/plans/2026-08-17-audio-first-preflight.md` — семь задач до включения флага. **Этот план идёт после него.**

## Global Constraints

- Пакетный менеджер — **Bun**, не npm (`AGENTS.md`). Тесты: `bunx vitest run ...`.
- БД меняется **только миграциями**, `prisma db push` запрещён.
- Replicate — основной провайдер; fal только как явно настроенный fallback.
- Модель без цены, подтверждённой страницей модели, остаётся `integrated: false` и в смету не попадает.
- **Все долгие и платные операции идемпотентны и переживают рестарт процесса** (`AGENTS.md`). Повторный заход не платит второй раз и не теряет уже полученный результат.
- **Платные вызовы начинаются с одного canary job**; готовность интеграции не заявляется без реального или контрактного подтверждения (`AGENTS.md`).
- Комментарии и сообщения об ошибках — по-русски, как в окружающем коде.
- Не создавать файлы-монстры: новая логика живёт отдельными модулями в `server/utils/presenter/`.
- DB-free тесты должны попадать в `vitest.pure.config.ts` — там явный `include`.
- Старый маршрут не ломается и не удаляется: он остаётся основным до canary-сравнения (§2 спеки).

## Решения, которые этот план не переоткрывает

Из `docs/operations/handoff-2026-08-17-audio-first.md` §4:

1. Транскрипция на audio-first обязательна; доступность модели проверяется до оплаты трека.
2. Маршрут начатого ролика не меняется задним числом.
3. Ключ переиспользования куска считается по границам, притянутым к кадру.
4. Короткий кусок добивается тишиной, а не растягивается по треку.
5. Длительность трека измеряется ffprobe.
6. Порог «расхождение больше секунды — сбой» применим только к сверке заказа с ответом lip-sync.
7. Модель транскрипции стоит `integrated: false`; на стенде включается `MEDIA_MODEL_TRANSCRIPTION`.

## Что уже проверено фактически (не перепроверять)

Снято с кода при подготовке плана:

- `POST /api/characters/[id]/source-recordings/index.post.ts` пишет запись во временный каталог (`mkdtemp`), режет её `ingestPresenterRecording` и в `finally` **удаляет каталог целиком**. От исходника остаётся только `PresenterSourceClip.sourceRecording` (имя файла) и `sourceStartSec`. Сам файл не сохраняется никуда.
- `PresenterSourceClip` (`prisma/schema.prisma:336-369`) уже имеет `usageCount`, `lastUsedAt`, `perceptualHash`, `sourceRecording`, `sourceStartSec`, уникальность `@@unique([characterId, sha1])` и индекс `@@index([characterId, perceptualHash])`.
- `reservePresenterSourceClip` (`server/utils/presenter-source-selector.ts`) резервирует клип в `Serializable`-транзакции с тремя попытками на `P2034`, окно длительностей строит `buildPresenterDurationWindow`, выбор — `pickClosestPresenterCandidate`. Дефолт допуска `DEFAULT_PRESENTER_MAX_DELTA_SEC = 1`.
- `adjustAudioTempo` в lip-sync **уже не вызывается на маршруте audio-first**: ветка ускорения обёрнута в `if (!useAvatarRoute && !segmentPlan)` (`server/utils/lip-sync-runner.ts:1073`), а `planSpeechFitToModel` в подборе фрагмента — в `else`-ветке `if (segmentPlan) {...} else {...}` (`lip-sync-runner.ts:855-885`). Прочие вызовы `adjustAudioTempo` живут в старом шаге озвучки (`video-pipeline-steps.ts:1491,1499,1520`) и в `render.ts:815` (сама функция).
- `lip-sync-runner.ts:1053-1059` печатает WARN «кусок трека длиннее исходника … исходник под звук нарезает план 2» — это ровно та дыра, которую закрывает Task 5 этого плана.
- `buildPresenterCutArgs` (`server/utils/presenter/ffmpeg-adapter.ts:87`) уже режет с перекодированием (`-ss` до `-i`, `-t`, libx264, 30 fps, aac) и вписывает кадр в 1080x1920 через `force_original_aspect_ratio=decrease`. Для окна под речь нужна та же схема аргументов, но без потолка модели по длительности.
- `ffmpegIngestDependencies` (`ffmpeg-adapter.ts:162`) — готовый набор зависимостей ingest: `probeDuration`, `detectScenes`, `detectSilence`, `cutSegment`, `grayscaleThumbnail`.
- `dHashFromGrayscale`, `areFramesSimilar`, `hammingDistance`, `DEFAULT_SIMILARITY_THRESHOLD = 6` — `server/utils/presenter/perceptual-hash.ts`.
- `StorageKeys.presenterSourceClip(appId, characterId, sha1, ext)` существует (`server/utils/storage/keys.ts:71`); ключа для записи целиком нет.
- `snapSecToFrame(sec, fps)` и `trackEndFrame(trackDurationSec, fps)` экспортируются из `server/utils/voiceover/segment-cut.ts` — притяжка к границе кадра уже написана, дублировать её нельзя.
- `TIMELINE_FPS = 30` живёт в `shared/types/video-runtime.ts:249`.
- `ALTER TYPE ... ADD VALUE` в проекте применялся (`prisma/migrations/20260425070159_add_video_lip_sync/migration.sql`); **использовать** новое значение enum в той же миграции нельзя.
- В `vitest.pure.config.ts` каталога `tests/unit/presenter/**` нет — там перечислены плоские файлы `tests/unit/presenter-*.spec.ts`.
- `docs/PROJECT_CONTEXT.md` §7 требует «cooldown повторного использования фрагмента» и «perceptual hash и история использования» — именно это ломается при переходе на нарезку по требованию, если не ввести учёт интервалов.

## File Structure

**Создаётся:**

| Файл | Ответственность |
|---|---|
| `server/utils/presenter/recording-window.ts` | Чистый выбор окна реза внутри записи: длина, притяжка к кадру, перекрытие с занятыми интервалами, давность |
| `server/utils/presenter/recording-normalize.ts` | Аргументы ffmpeg нормализации записи (H.264/30fps/AAC/1920 по большей стороне, соотношение сохраняется) |
| `server/utils/presenter/recording-store.ts` | Запись в БД и хранилище: дедуп по sha1 оригинала, статусы ingest, повторная нарезка |
| `server/utils/presenter-recording-selector.ts` | Атомарное резервирование окна записи (`Serializable`, retry на `P2034`) |
| `server/utils/presenter/recording-retention.ts` | Чистое правило автоочистки и холодного класса |
| `server/api/characters/[id]/recordings/index.get.ts` | Список записей персонажа с занимаемым объёмом |
| `server/api/characters/[id]/recordings/[recordingId]/reingest.post.ts` | Повторная нарезка / перезапуск упавшего ingest |
| `server/api/characters/[id]/recordings/[recordingId]/retention.put.ts` | Пометка `keep` / `auto` |
| `server/plugins/presenter-retention.ts` | Планировщик автоочистки |
| `prisma/migrations/20260818000000_add_presenter_recording/migration.sql` | `PresenterRecording`, `PresenterRecordingUsage`, `PresenterSourceClip.recordingId` |
| `tests/unit/presenter/recording-window.spec.ts` | Тесты выбора окна |
| `tests/unit/presenter/recording-normalize.spec.ts` | Тесты аргументов нормализации |
| `tests/unit/presenter/recording-retention.spec.ts` | Тесты правила очистки |
| `tests/integration/presenter-recording.spec.ts` | С БД: дедуп, перезапуск ingest, резервирование окна, cooldown |

**Модифицируется:**

| Файл | Что меняется |
|---|---|
| `prisma/schema.prisma` | Две новые модели, `recordingId` на клипе, обратные связи у `Character` |
| `server/utils/storage/keys.ts` | `presenterRecording(...)` |
| `server/api/characters/[id]/source-recordings/index.post.ts` | Сохранение записи до нарезки, `recordingId` на созданных клипах |
| `server/utils/presenter/ffmpeg-adapter.ts` | Нормализация записи, вырезка окна произвольной длины |
| `server/utils/lip-sync-runner.ts` | На audio-first сначала окно записи, потом прежний подбор клипа |
| `vitest.pure.config.ts` | Каталог `tests/unit/presenter/**` |
| `docs/operations/presenter-library.md` | Раздел про записи, retention и повторную нарезку |

---

### Task 1: Схема записей и учёта интервалов

Две модели и одно поле на клипе. Одной задачей, потому что миграция одна: раздельные миграции по одной таблице оставили бы промежуточное состояние, в котором `PresenterRecordingUsage` ссылается на несуществующую таблицу.

**Files:**
- Modify: `prisma/schema.prisma` (после `model PresenterSourceClip`, строки 336-369)
- Create: `prisma/migrations/20260818000000_add_presenter_recording/migration.sql`
- Modify: `server/utils/storage/keys.ts:71`
- Test: `tests/integration/presenter-recording.spec.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: prisma-модели `PresenterRecording`, `PresenterRecordingUsage`; поле `PresenterSourceClip.recordingId: string | null`; `StorageKeys.presenterRecording(appId, characterId, sha1, ext): string`.

- [ ] **Step 1: Написать падающий тест схемы**

Создать `tests/integration/presenter-recording.spec.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest"

import { prisma } from "~~/server/utils/prisma"

let appId: number
let characterId: string

beforeAll(async () => {
  const app = await prisma.app.create({ data: { name: "presenter-recording-test" } })
  appId = app.id
  const character = await prisma.character.create({
    data: { appId, name: "Ведущая" },
  })
  characterId = character.id
})

describe("схема записей ведущего", () => {
  it("хранит нормализованную запись с дедупом по оригиналу", async () => {
    const created = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: `apps/${appId}/characters/${characterId}/recordings/aaaa1111bbbb2222.mp4`,
        storageProvider: "gcs",
        sha1: "aaaa1111bbbb2222",
        durationSec: 612.4,
        fps: 30,
        width: 1080,
        height: 1920,
        bytes: 340_000_000,
        originalName: "dubl-01.mov",
        originalBytes: 1_900_000_000,
      },
    })

    expect(created.retention).toBe("auto")
    expect(created.ingestStatus).toBe("pending")

    // Повторная заливка того же ОРИГИНАЛА не создаёт вторую запись.
    await expect(prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "любой другой ключ",
        sha1: "aaaa1111bbbb2222",
        durationSec: 612.4,
        originalName: "dubl-01-copy.mov",
      },
    })).rejects.toThrow()
  })

  it("связывает клип с записью-родителем, но не требует её", async () => {
    const recording = await prisma.presenterRecording.findFirst({ where: { characterId } })

    const withParent = await prisma.presenterSourceClip.create({
      data: {
        characterId,
        recordingId: recording!.id,
        fileUrl: "https://cdn/clip-1.mp4",
        sha1: "clip1111",
        durationSec: 4.2,
      },
    })
    const orphan = await prisma.presenterSourceClip.create({
      data: {
        characterId,
        fileUrl: "https://cdn/clip-2.mp4",
        sha1: "clip2222",
        durationSec: 3.1,
      },
    })

    expect(withParent.recordingId).toBe(recording!.id)
    // Клипы, залитые до этой работы, живут без записи и продолжают работать.
    expect(orphan.recordingId).toBeNull()
  })

  it("пишет использованный интервал записи", async () => {
    const recording = await prisma.presenterRecording.findFirst({ where: { characterId } })
    const scenario = await prisma.scenario.create({ data: { status: "draft" } })
    const video = await prisma.video.create({ data: { scenarioId: scenario.id } })

    const usage = await prisma.presenterRecordingUsage.create({
      data: {
        recordingId: recording!.id,
        startSec: 12.5,
        endSec: 17.25,
        videoId: video.id,
      },
    })

    expect(usage.usedAt).toBeInstanceOf(Date)
  })

  it("удаление записи уносит её интервалы, но не клипы", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: "tmp",
        sha1: "cccc3333",
        durationSec: 30,
        originalName: "tmp.mov",
      },
    })
    const clip = await prisma.presenterSourceClip.create({
      data: { characterId, recordingId: recording.id, fileUrl: "u", sha1: "clip3333", durationSec: 3 },
    })
    await prisma.presenterRecordingUsage.create({
      data: { recordingId: recording.id, startSec: 0, endSec: 3 },
    })

    await prisma.presenterRecording.delete({ where: { id: recording.id } })

    expect(await prisma.presenterRecordingUsage.count({ where: { recordingId: recording.id } })).toBe(0)
    // Клип переживает удаление записи: файл клипа лежит отдельно и уже
    // использован в роликах — снести его вместе с исходником значит сломать
    // историю.
    const survived = await prisma.presenterSourceClip.findUnique({ where: { id: clip.id } })
    expect(survived?.recordingId).toBeNull()
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run tests/integration/presenter-recording.spec.ts`
Expected: FAIL — `prisma.presenterRecording` не существует.

- [ ] **Step 3: Описать модели в схеме**

В `prisma/schema.prisma` сразу после `model PresenterSourceClip` (заканчивается на строке 369):

```prisma
/// Длинная исходная запись ведущего, нормализованная и сохранённая целиком.
///
/// До 17.08.2026 запись жила во временном каталоге запроса и удалялась вместе с
/// ним: падение ingest на середине означало повторную заливку до двух гигабайт,
/// а перенарезка библиотеки по новым правилам была невозможна в принципе.
/// Хранение записи — условие нарезки фрагмента под фактическую длину реплики
/// (spec 2026-08-16-audio-first-editing §6.1).
model PresenterRecording {
  id              String    @id @default(cuid())
  characterId     String
  character       Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
  /// Нормализованный файл: H.264, 30 fps, AAC, 1920 по большей стороне.
  storageKey      String
  storageProvider String    @default("gcs")
  /// sha1 ОРИГИНАЛА до нормализации: повторная заливка того же файла не создаёт
  /// вторую запись, даже если нормализация даст другие байты.
  sha1            String
  durationSec     Float
  fps             Float?
  width           Int?
  height          Int?
  /// Размер нормализованного файла.
  bytes           Int?
  originalName    String?
  originalBytes   Int?
  /// keep — защищено от автоочистки вручную; auto — попадает под неё.
  retention       String    @default("auto")
  /// pending | running | completed | failed. Позволяет перезапустить нарезку
  /// без повторной заливки.
  ingestStatus    String    @default("pending")
  ingestError     String?
  ingestStartedAt DateTime?
  ingestFinishedAt DateTime?
  /// Момент перевода в холодный класс хранения. null — файл ещё горячий.
  cooledAt        DateTime?
  uploadedById    Int?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  clips           PresenterSourceClip[]
  usages          PresenterRecordingUsage[]

  @@unique([characterId, sha1])
  @@index([characterId, retention, createdAt])
  @@index([ingestStatus])
}

/// Использованный интервал записи.
///
/// Пока единицей был готовый клип, cooldown держался на PresenterSourceClip.
/// При нарезке по требованию единица — произвольное окно записи, у которого
/// счётчика нет: без этой таблицы требование docs/PROJECT_CONTEXT.md §7
/// («cooldown повторного использования фрагмента») перестаёт выполняться ровно
/// там, где включается главная фича.
model PresenterRecordingUsage {
  id          String             @id @default(cuid())
  recordingId String
  recording   PresenterRecording @relation(fields: [recordingId], references: [id], onDelete: Cascade)
  startSec    Float
  endSec      Float
  videoId     Int?
  usedAt      DateTime           @default(now())

  @@index([recordingId, usedAt])
  @@index([videoId])
}
```

В `model PresenterSourceClip` добавить связь (поля `sourceRecording` и `sourceStartSec` **оставить**: по ним читается история старых клипов):

```prisma
  /// Запись-родитель. null у клипов, залитых до появления PresenterRecording, —
  /// они продолжают подбираться прежним путём по длительности.
  recordingId     String?
  recording       PresenterRecording? @relation(fields: [recordingId], references: [id], onDelete: SetNull)
```

и индекс в конце модели:

```prisma
  @@index([recordingId])
```

В `model Character` добавить обратную связь рядом с `sourceClips`:

```prisma
  recordings      PresenterRecording[]
```

- [ ] **Step 4: Создать миграцию**

Создать `prisma/migrations/20260818000000_add_presenter_recording/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "PresenterRecording" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'gcs',
    "sha1" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "fps" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "originalName" TEXT,
    "originalBytes" INTEGER,
    "retention" TEXT NOT NULL DEFAULT 'auto',
    "ingestStatus" TEXT NOT NULL DEFAULT 'pending',
    "ingestError" TEXT,
    "ingestStartedAt" TIMESTAMP(3),
    "ingestFinishedAt" TIMESTAMP(3),
    "cooledAt" TIMESTAMP(3),
    "uploadedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PresenterRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresenterRecordingUsage" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "videoId" INTEGER,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PresenterRecordingUsage_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "PresenterSourceClip" ADD COLUMN     "recordingId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PresenterRecording_characterId_sha1_key" ON "PresenterRecording"("characterId", "sha1");

-- CreateIndex
CREATE INDEX "PresenterRecording_characterId_retention_createdAt_idx" ON "PresenterRecording"("characterId", "retention", "createdAt");

-- CreateIndex
CREATE INDEX "PresenterRecording_ingestStatus_idx" ON "PresenterRecording"("ingestStatus");

-- CreateIndex
CREATE INDEX "PresenterRecordingUsage_recordingId_usedAt_idx" ON "PresenterRecordingUsage"("recordingId", "usedAt");

-- CreateIndex
CREATE INDEX "PresenterRecordingUsage_videoId_idx" ON "PresenterRecordingUsage"("videoId");

-- CreateIndex
CREATE INDEX "PresenterSourceClip_recordingId_idx" ON "PresenterSourceClip"("recordingId");

-- AddForeignKey
ALTER TABLE "PresenterRecording" ADD CONSTRAINT "PresenterRecording_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresenterRecordingUsage" ADD CONSTRAINT "PresenterRecordingUsage_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "PresenterRecording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresenterSourceClip" ADD CONSTRAINT "PresenterSourceClip_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "PresenterRecording"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

`ON DELETE SET NULL` у клипа — не вкус: файл клипа лежит отдельным объектом в хранилище и уже уехал в готовые ролики. Каскад снёс бы историю ради экономии одной строки.

- [ ] **Step 5: Применить миграцию и перегенерировать клиент**

Run: `bun run test:db:migrate && bunx prisma generate`
Expected: миграция применена. Если команда падает на отсутствии `.env.test` — скопировать `.env.test.example` в `.env.test` и повторить.

- [ ] **Step 6: Добавить ключ хранилища**

В `server/utils/storage/keys.ts` рядом с `presenterSourceClip` (:71):

```ts
  /** Длинная запись ведущего целиком, нормализованная. Дедуп по sha1 ОРИГИНАЛА. */
  presenterRecording: (appId: number | string, characterId: string, sha1: string, ext = "mp4"): string =>
    `${STORAGE_PATH_PREFIX}apps/${appId}/characters/${characterId}/recordings/${sha1}.${ext}`,
```

- [ ] **Step 7: Запустить тест**

Run: `bunx vitest run tests/integration/presenter-recording.spec.ts`
Expected: PASS, 4 теста.

- [ ] **Step 8: Коммит**

```bash
git add prisma server/utils/storage/keys.ts tests/integration/presenter-recording.spec.ts
git commit -m "feat: модель записи ведущего, учёт интервалов и связь с клипами"
```

---

### Task 2: Нормализация записи и её сохранение при заливке

Нормализуем в H.264 / 30 fps / AAC с ограничением 1920 по большей стороне, **соотношение сторон сохраняем**. Кроп в 9:16 при загрузке уничтожил бы свободу кадрирования, ради которой всё и делается: крупный план, средний план и PiP-окно берутся из одного материала разными кропами, и каждый кроп меняет последовательность перцептивных хэшей (§6.1 спеки).

**Files:**
- Create: `server/utils/presenter/recording-normalize.ts`
- Test: `tests/unit/presenter/recording-normalize.spec.ts`
- Modify: `vitest.pure.config.ts:17-51`
- Modify: `server/utils/presenter/ffmpeg-adapter.ts`
- Create: `server/utils/presenter/recording-store.ts`
- Modify: `server/api/characters/[id]/source-recordings/index.post.ts`

**Interfaces:**
- Consumes: `StorageKeys.presenterRecording` (Task 1).
- Produces:
  - `buildRecordingNormalizeArgs(inputPath: string, outputPath: string, options?: { maxSide?: number, fps?: number }): string[]`
  - `RECORDING_MAX_SIDE = 1920`, `RECORDING_FPS = 30`
  - `normalizeRecording(inputPath: string, outputPath: string): Promise<void>` (в `ffmpeg-adapter.ts`)
  - `probeRecordingMeta(path: string): Promise<{ durationSec: number, fps: number | null, width: number | null, height: number | null }>` (в `ffmpeg-adapter.ts`)
  - `saveRecording(input: SaveRecordingInput): Promise<{ recordingId: string, deduped: boolean }>` (в `recording-store.ts`)

- [ ] **Step 1: Добавить каталог в DB-free сьюту**

В `vitest.pure.config.ts` в массив `include`, рядом с `tests/unit/voiceover/**/*.spec.ts`:

```ts
      "tests/unit/presenter/**/*.spec.ts",
```

- [ ] **Step 2: Написать падающий тест**

Создать `tests/unit/presenter/recording-normalize.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { buildRecordingNormalizeArgs } from "~~/server/utils/presenter/recording-normalize"

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

describe("аргументы нормализации записи ведущего", () => {
  it("ограничивает большую сторону 1920 и НЕ кропает в 9:16", () => {
    const args = buildRecordingNormalizeArgs("/tmp/in.mov", "/tmp/out.mp4")
    const vf = valueAfter(args, "-vf")!

    // decrease вписывает кадр в рамку, не растягивая и не обрезая: кроп при
    // загрузке убил бы крупный план, средний план и PiP из одного материала.
    expect(vf).toContain("force_original_aspect_ratio=decrease")
    expect(vf).toContain("1920")
    expect(vf).not.toContain("crop")
    expect(vf).not.toContain("pad=")
  })

  it("выравнивает стороны до чётных — yuv420p нечётные не кодирует", () => {
    const vf = valueAfter(buildRecordingNormalizeArgs("/tmp/in.mov", "/tmp/out.mp4"), "-vf")!

    expect(vf).toContain("trunc(iw/2)*2")
    expect(vf).toContain("trunc(ih/2)*2")
  })

  it("приводит к H.264 30 fps и AAC", () => {
    const args = buildRecordingNormalizeArgs("/tmp/in.mov", "/tmp/out.mp4")

    expect(valueAfter(args, "-c:v")).toBe("libx264")
    expect(valueAfter(args, "-r")).toBe("30")
    expect(valueAfter(args, "-c:a")).toBe("aac")
    expect(args).toContain("-movflags")
  })

  it("ставит вход и выход в правильном порядке", () => {
    const args = buildRecordingNormalizeArgs("/tmp/in.mov", "/tmp/out.mp4")

    expect(valueAfter(args, "-i")).toBe("/tmp/in.mov")
    expect(args[args.length - 1]).toBe("/tmp/out.mp4")
  })

  it("принимает свои пределы — 4K-материал можно нормализовать иначе", () => {
    const vf = valueAfter(
      buildRecordingNormalizeArgs("/tmp/in.mov", "/tmp/out.mp4", { maxSide: 1280, fps: 25 }),
      "-vf",
    )!

    expect(vf).toContain("1280")
    expect(valueAfter(buildRecordingNormalizeArgs("/tmp/in.mov", "/tmp/out.mp4", { fps: 25 }), "-r")).toBe("25")
  })
})
```

- [ ] **Step 3: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/presenter/recording-normalize.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 4: Написать модуль нормализации**

Создать `server/utils/presenter/recording-normalize.ts`:

```ts
/**
 * Приведение длинной записи ведущего к единому виду перед хранением.
 *
 * Оригинал 4K60 не храним: в ролик уходит 1080p, а разница в объёме кратная
 * (spec §6.1). Но соотношение сторон СОХРАНЯЕМ — кроп в 9:16 при загрузке
 * уничтожил бы свободу кадрирования, ради которой запись и хранится: крупный
 * план, средний план и PiP-окно берутся из одного материала разными кропами, и
 * каждый такой кроп меняет последовательность перцептивных хэшей, то есть
 * работает на уникальность (docs/PROJECT_CONTEXT.md §7).
 *
 * Чистая функция без запуска процесса — по образцу `buildPresenterCutArgs`
 * в `ffmpeg-adapter.ts`: ошибка в порядке `-i`/`-vf` глазами не видна, а
 * стоит перекодирования гигабайтного файла впустую.
 */

/** Потолок большей стороны. 1080p в ролике, запас на кроп — 1920. */
export const RECORDING_MAX_SIDE = 1920

/** Частота нормализованной записи: та же, что у таймлайна сборки (TIMELINE_FPS). */
export const RECORDING_FPS = 30

export interface RecordingNormalizeOptions {
  maxSide?: number
  fps?: number
}

export function buildRecordingNormalizeArgs(
  inputPath: string,
  outputPath: string,
  options: RecordingNormalizeOptions = {},
): string[] {
  const maxSide = options.maxSide ?? RECORDING_MAX_SIDE
  const fps = options.fps ?? RECORDING_FPS

  // Рамка квадратная по большей стороне: и вертикальная, и горизонтальная
  // запись впишется в неё без обрезки, а `decrease` не увеличит маленький кадр.
  const scale = `scale=${maxSide}:${maxSide}:force_original_aspect_ratio=decrease`
    + ",scale=trunc(iw/2)*2:trunc(ih/2)*2"

  return [
    "-hide_banner",
    "-nostats",
    "-y",
    "-i", inputPath,
    "-vf", scale,
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath,
  ]
}
```

- [ ] **Step 5: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/presenter/recording-normalize.spec.ts`
Expected: PASS, 5 тестов.

- [ ] **Step 6: Подключить нормализацию и замер к ffmpeg-адаптеру**

В `server/utils/presenter/ffmpeg-adapter.ts` добавить (рядом с `cutSegment`, используя тот же `runFfmpeg`):

```ts
/** Нормализация записи целиком. Долгая операция: таймаут отдельный. */
const NORMALIZE_TIMEOUT_MS = 60 * 60_000

export async function normalizeRecording(inputPath: string, outputPath: string): Promise<void> {
  await runFfmpeg(buildRecordingNormalizeArgs(inputPath, outputPath), NORMALIZE_TIMEOUT_MS, false)
}

export interface RecordingMeta {
  durationSec: number
  fps: number | null
  width: number | null
  height: number | null
}

/**
 * Параметры нормализованного файла. Длительность берём ffprobe'ом, а не из
 * плана: она станет верхней границей любого окна реза, и врать здесь нельзя.
 */
export async function probeRecordingMeta(path: string): Promise<RecordingMeta> {
  const durationSec = await getVideoDuration(path)
  const { stdout } = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate",
    "-of", "default=noprint_wrappers=1:nokey=1",
    path,
  ])
  const [rawWidth, rawHeight, rawRate] = stdout.toString("utf8").trim().split(/\s+/)
  const [num, den] = (rawRate ?? "").split("/").map(Number)
  return {
    durationSec,
    fps: Number.isFinite(num) && Number.isFinite(den) && den !== 0 ? num / den : null,
    width: Number.parseInt(rawWidth ?? "", 10) || null,
    height: Number.parseInt(rawHeight ?? "", 10) || null,
  }
}
```

Если `runFfprobe` в файле ещё нет — добавить его по образцу существующего `runFfmpeg` (тот же способ запуска процесса, бинарь `ffprobe`), не заводя новый модуль.

- [ ] **Step 7: Написать сохранение записи**

Создать `server/utils/presenter/recording-store.ts`:

```ts
/**
 * Запись ведущего в хранилище и в БД.
 *
 * Дедуп идёт по sha1 ОРИГИНАЛА, а не нормализованного файла: нормализация
 * недетерминирована по байтам (кодек, версия ffmpeg), и дедуп по её выходу
 * пропускал бы повторную заливку того же дубля. Оригинал же приходит от
 * пользователя как есть.
 *
 * Порядок операций: сначала строка в БД со статусом `pending`, потом заливка,
 * потом `completed`. Обратный порядок оставлял бы объект в хранилище без
 * строки — сироту вне каскада удаления.
 */

import { createHash } from "node:crypto"
import { stat } from "node:fs/promises"

import { prisma } from "../prisma"
import { getStorageDriver } from "../storage"
import { StorageKeys } from "../storage/keys"
import { normalizeRecording, probeRecordingMeta } from "./ffmpeg-adapter"

export interface SaveRecordingInput {
  appId: number
  characterId: string
  /** Оригинал во временном каталоге запроса. */
  originalPath: string
  /** Куда положить нормализованный файл до заливки. */
  normalizedPath: string
  originalName: string
  originalBytes: number
  uploadedById?: number | null
}

export interface SaveRecordingResult {
  recordingId: string
  /** true — такой оригинал уже заливали, файл повторно не нормализуется. */
  deduped: boolean
  storageKey: string
  durationSec: number
}

/** sha1 файла потоком: запись весит до двух гигабайт, в память её тянуть нельзя. */
export async function sha1OfFile(path: string): Promise<string> {
  const { createReadStream } = await import("node:fs")
  const hash = createHash("sha1")
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on("data", chunk => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve())
  })
  return hash.digest("hex").slice(0, 16)
}

export async function saveRecording(input: SaveRecordingInput): Promise<SaveRecordingResult> {
  const sha1 = await sha1OfFile(input.originalPath)

  const existing = await prisma.presenterRecording.findUnique({
    where: { characterId_sha1: { characterId: input.characterId, sha1 } },
  })
  if (existing) {
    return {
      recordingId: existing.id,
      deduped: true,
      storageKey: existing.storageKey,
      durationSec: existing.durationSec,
    }
  }

  await normalizeRecording(input.originalPath, input.normalizedPath)
  const meta = await probeRecordingMeta(input.normalizedPath)
  const size = await stat(input.normalizedPath)
  const storageKey = StorageKeys.presenterRecording(input.appId, input.characterId, sha1, "mp4")

  const row = await prisma.presenterRecording.create({
    data: {
      characterId: input.characterId,
      storageKey,
      storageProvider: getStorageDriver().providerName,
      sha1,
      durationSec: meta.durationSec,
      fps: meta.fps,
      width: meta.width,
      height: meta.height,
      bytes: size.size,
      originalName: input.originalName,
      originalBytes: input.originalBytes,
      uploadedById: input.uploadedById ?? null,
      ingestStatus: "pending",
    },
  })

  await getStorageDriver().uploadFile(storageKey, input.normalizedPath, { contentType: "video/mp4" })

  return { recordingId: row.id, deduped: false, storageKey, durationSec: meta.durationSec }
}

/** Отметки состояния нарезки — по ним ingest перезапускается с места падения. */
export async function markIngestRunning(recordingId: string): Promise<void> {
  await prisma.presenterRecording.update({
    where: { id: recordingId },
    data: { ingestStatus: "running", ingestError: null, ingestStartedAt: new Date() },
  })
}

export async function markIngestCompleted(recordingId: string): Promise<void> {
  await prisma.presenterRecording.update({
    where: { id: recordingId },
    data: { ingestStatus: "completed", ingestError: null, ingestFinishedAt: new Date() },
  })
}

export async function markIngestFailed(recordingId: string, error: unknown): Promise<void> {
  await prisma.presenterRecording.update({
    where: { id: recordingId },
    data: {
      ingestStatus: "failed",
      ingestError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      ingestFinishedAt: new Date(),
    },
  })
}
```

`uploadFile(key, localPath, opts)` в драйвере есть (`server/utils/storage/types.ts:46`) — использовать именно его. `uploadBuffer` здесь нельзя: он тянет двухгигабайтный файл в память процесса.

- [ ] **Step 8: Подключить сохранение к эндпоинту заливки**

В `server/api/characters/[id]/source-recordings/index.post.ts`:

- до вызова `ingestPresenterRecording` вызвать `saveRecording(...)` и получить `recordingId`;
- обернуть нарезку в `markIngestRunning` / `markIngestCompleted` / `markIngestFailed`;
- при создании `PresenterSourceClip` добавить `recordingId` в `data` (поля `sourceRecording` и `sourceStartSec` **оставить** — по ним читается история);
- в ответе вернуть `recordingId` и `deduped`;
- дедуп-ветка (`deduped: true`) не перезаливает файл, но нарезку выполняет: оператор мог залить ту же запись, чтобы перенарезать её по новым правилам.

- [ ] **Step 9: Прогнать DB-free сьюту и тесты API персонажей**

Run: `bunx vitest run --config vitest.pure.config.ts`
Run: `bunx vitest run tests/integration/presenter-recording.spec.ts`
Expected: PASS.

- [ ] **Step 10: Коммит**

```bash
git add server/utils/presenter server/api/characters vitest.pure.config.ts tests/unit/presenter
git commit -m "feat: запись ведущего сохраняется нормализованной, ingest получает статус"
```

---

### Task 3: Перезапуск ingest и повторная нарезка без повторной заливки

Отдельная операция: перенарезать запись по текущим правилам, не прося пользователя загружать её снова (§6.1). Она же чинит упавший на середине ingest.

**Files:**
- Create: `server/api/characters/[id]/recordings/index.get.ts`
- Create: `server/api/characters/[id]/recordings/[recordingId]/reingest.post.ts`
- Create: `server/api/characters/[id]/recordings/[recordingId]/retention.put.ts`
- Modify: `server/utils/presenter/recording-store.ts`
- Test: `tests/integration/presenter-recording.spec.ts`

**Interfaces:**
- Consumes: `saveRecording`, `markIngest*` (Task 2), `ingestPresenterRecording`, `ffmpegIngestDependencies`.
- Produces: `reingestRecording(recordingId: string, options?: { maxClips?: number }): Promise<{ createdIds: string[], skipped: number, similarClips: number }>`

- [ ] **Step 1: Написать падающий тест**

Дописать в `tests/integration/presenter-recording.spec.ts`:

```ts
describe("повторная нарезка записи", () => {
  it("не создаёт дублей клипов при повторном прогоне", async () => {
    // Тот же материал, те же правила — те же sha1 клипов, а уникальность
    // (characterId, sha1) не даст создать вторую строку. Считаем, что вторая
    // нарезка не добавила ни одной записи.
    const recording = await prisma.presenterRecording.findFirst({
      where: { characterId, ingestStatus: "completed" },
    })
    const before = await prisma.presenterSourceClip.count({ where: { recordingId: recording!.id } })

    await reingestRecording(recording!.id)

    const after = await prisma.presenterSourceClip.count({ where: { recordingId: recording!.id } })
    expect(after).toBe(before)
  })

  it("поднимает упавший ingest из статуса failed", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: `apps/${appId}/characters/${characterId}/recordings/dddd4444.mp4`,
        sha1: "dddd4444",
        durationSec: 20,
        originalName: "broken.mov",
        ingestStatus: "failed",
        ingestError: "процесс убит на середине",
      },
    })

    await reingestRecording(recording.id).catch(() => {})

    const reloaded = await prisma.presenterRecording.findUnique({ where: { id: recording.id } })
    // Статус обязан уйти из failed: либо completed, либо новая честная ошибка.
    expect(reloaded!.ingestStatus).not.toBe("failed")
    expect(reloaded!.ingestStartedAt).not.toBeNull()
  })
})
```

Тест требует реального файла в хранилище: в тестовом окружении подложить короткий mp4 через тот же драйвер (`getStorageDriver().uploadBuffer`) перед вызовом, либо смоделировать `downloadToFile` — способ выбирает исполнитель, но обход самой нарезки недопустим.

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `bunx vitest run tests/integration/presenter-recording.spec.ts`
Expected: FAIL — `reingestRecording` не существует.

- [ ] **Step 3: Написать повторную нарезку**

В `server/utils/presenter/recording-store.ts` добавить:

```ts
/**
 * Перенарезать сохранённую запись по текущим правилам.
 *
 * Ради этого запись и хранится: правила нарезки менялись уже дважды (пороги
 * пауз, дедуп по первому кадру), и раньше единственным способом применить их
 * было попросить пользователя залить два гигабайта заново.
 *
 * Дубли не создаются на уровне схемы: `@@unique([characterId, sha1])` —
 * клип с тем же содержимым просто пропускается, как и при первичной заливке.
 */
export async function reingestRecording(
  recordingId: string,
  options: { maxClips?: number } = {},
): Promise<{ createdIds: string[], skipped: number, similarClips: number }> {
  const recording = await prisma.presenterRecording.findUnique({
    where: { id: recordingId },
    include: { character: { select: { appId: true } } },
  })
  if (!recording) throw new Error(`Запись ${recordingId} не найдена`)

  await markIngestRunning(recordingId)

  const { mkdtemp, rm, readFile } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const workDir = await mkdtemp(join(tmpdir(), "presenter-reingest-"))
  const localPath = join(workDir, "recording.mp4")

  try {
    await getStorageDriver().downloadToFile(recording.storageKey, localPath)

    const known = await prisma.presenterSourceClip.findMany({
      where: { characterId: recording.characterId, isActive: true, perceptualHash: { not: null } },
      select: { perceptualHash: true },
    })

    const { ingestPresenterRecording } = await import("./ingest-runner")
    const { ffmpegIngestDependencies } = await import("./ffmpeg-adapter")
    const result = await ingestPresenterRecording({
      recordingPath: localPath,
      outputDir: workDir,
      existingHashes: known.map(c => c.perceptualHash!).filter(Boolean),
      maxClips: options.maxClips,
    }, ffmpegIngestDependencies)

    const createdIds: string[] = []
    for (const clip of result.clips) {
      const data = await readFile(clip.filePath)
      const sha1 = createHash("sha1").update(data).digest("hex").slice(0, 16)
      const exists = await prisma.presenterSourceClip.findUnique({
        where: { characterId_sha1: { characterId: recording.characterId, sha1 } },
        select: { id: true },
      })
      if (exists) continue

      const storageKey = StorageKeys.presenterSourceClip(
        recording.character.appId, recording.characterId, sha1, "mp4",
      )
      await getStorageDriver().uploadBuffer(storageKey, data, { contentType: "video/mp4" })
      const row = await prisma.presenterSourceClip.create({
        data: {
          characterId: recording.characterId,
          recordingId: recording.id,
          name: `${recording.originalName ?? "запись"} · ${clip.startSec.toFixed(1)}-${clip.endSec.toFixed(1)}s`,
          fileUrl: storageKey,
          storageKey,
          storageProvider: getStorageDriver().providerName,
          sha1,
          mimeType: "video/mp4",
          bytes: data.length,
          durationSec: clip.durationSec,
          perceptualHash: clip.perceptualHash,
          sourceRecording: recording.originalName,
          sourceStartSec: clip.startSec,
        },
      })
      createdIds.push(row.id)
    }

    await markIngestCompleted(recordingId)
    return { createdIds, skipped: result.skipped.length, similarClips: result.similarClips }
  }
  catch (error) {
    await markIngestFailed(recordingId, error)
    throw error
  }
  finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
```

`fileUrl` здесь заполняется ключом хранилища, как это уже делает первичная заливка через `storageKeyToLegacyUrl` — использовать ту же функцию, чтобы обе ветки давали одинаковые строки.

- [ ] **Step 4: Написать эндпоинты**

`server/api/characters/[id]/recordings/index.get.ts` — список записей с полями `id`, `originalName`, `durationSec`, `bytes`, `retention`, `ingestStatus`, `ingestError`, `createdAt`, числом клипов и **суммарным объёмом записей персонажа** (§6.1: «в UI персонажа видно, сколько занимают его записи»). Доступ — `requireScopedAccess` с `canRead` и `moduleSlug: "script-generator"`, как в существующем `source-clips/index.get.ts`.

`server/api/characters/[id]/recordings/[recordingId]/reingest.post.ts` — вызывает `reingestRecording`, отдаёт `createdIds`, `skipped`, `similarClips`. Доступ — `canWrite`. Если `ingestStatus === "running"` — 409 с текстом «нарезка уже идёт», а не молчаливый второй запуск.

`server/api/characters/[id]/recordings/[recordingId]/retention.put.ts` — принимает `{ retention: "keep" | "auto" }`, любое другое значение — 400. Доступ — `canWrite`.

- [ ] **Step 5: Запустить тесты**

Run: `bunx vitest run tests/integration/presenter-recording.spec.ts`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add server/utils/presenter/recording-store.ts server/api/characters tests/integration/presenter-recording.spec.ts
git commit -m "feat: повторная нарезка записи и перезапуск упавшего ingest"
```

---

### Task 4: Выбор окна записи — чистое правило

Ядро нарезки под речь. Без БД и без ffmpeg: получает длину записи, занятые интервалы и требуемую длительность, отдаёт окно. Здесь же живёт cooldown — он больше не может опираться на `usageCount` клипа, потому что клипа нет.

**Files:**
- Create: `server/utils/presenter/recording-window.ts`
- Test: `tests/unit/presenter/recording-window.spec.ts`

**Interfaces:**
- Consumes: `snapSecToFrame` из `server/utils/voiceover/segment-cut.ts`.
- Produces:
  - `planRecordingWindow(input: RecordingWindowInput): RecordingWindow | null`
  - `RecordingWindowInput { recordingDurationSec: number, requiredSec: number, fps: number, usedIntervals: readonly UsedInterval[], now: number, cooldownMs?: number }`
  - `UsedInterval { startSec: number, endSec: number, usedAtMs: number }`
  - `RecordingWindow { startSec: number, endSec: number, durationSec: number, overlapSec: number, reused: boolean }`
  - `RECORDING_WINDOW_COOLDOWN_MS`

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/presenter/recording-window.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { planRecordingWindow } from "~~/server/utils/presenter/recording-window"

const HOUR = 60 * 60 * 1000
const NOW = 1_700_000_000_000

function base(overrides: Record<string, unknown> = {}) {
  return {
    recordingDurationSec: 100,
    requiredSec: 5,
    fps: 30,
    usedIntervals: [],
    now: NOW,
    ...overrides,
  }
}

describe("выбор окна внутри записи ведущего", () => {
  it("даёт окно ровно требуемой длины", () => {
    const window = planRecordingWindow(base())!

    expect(window.durationSec).toBeCloseTo(5, 3)
    expect(window.endSec - window.startSec).toBeCloseTo(5, 3)
  })

  it("притягивает границы к кадру — сборка режет видео по кадрам", () => {
    const window = planRecordingWindow(base({ requiredSec: 4.017 }))!

    expect(Math.abs(window.startSec * 30 - Math.round(window.startSec * 30))).toBeLessThan(1e-6)
    expect(Math.abs(window.endSec * 30 - Math.round(window.endSec * 30))).toBeLessThan(1e-6)
  })

  it("не берёт участок, занятый сегодня, пока есть нетронутый", () => {
    const window = planRecordingWindow(base({
      usedIntervals: [{ startSec: 0, endSec: 20, usedAtMs: NOW - HOUR }],
    }))!

    expect(window.startSec).toBeGreaterThanOrEqual(20)
    expect(window.overlapSec).toBe(0)
    expect(window.reused).toBe(false)
  })

  it("берёт остывший участок, когда нетронутых не осталось", () => {
    // Вся запись занята, но давно: cooldown прошёл, повтор допустим.
    const window = planRecordingWindow(base({
      usedIntervals: [{ startSec: 0, endSec: 100, usedAtMs: NOW - 60 * 24 * HOUR }],
    }))!

    expect(window.reused).toBe(true)
    expect(window.durationSec).toBeCloseTo(5, 3)
  })

  it("при полностью свежем занятии берёт наименее перекрытый участок, а не первый попавшийся", () => {
    const window = planRecordingWindow(base({
      recordingDurationSec: 30,
      requiredSec: 10,
      usedIntervals: [
        { startSec: 0, endSec: 10, usedAtMs: NOW - HOUR },
        { startSec: 10, endSec: 14, usedAtMs: NOW - HOUR },
      ],
    }))!

    // Хвост 20-30 не занят вовсе — он и должен выиграть.
    expect(window.startSec).toBeGreaterThanOrEqual(14)
    expect(window.overlapSec).toBe(0)
  })

  it("отказывает, когда запись короче требуемого окна", () => {
    // Нельзя вернуть окно короче заказанного: кадр стал бы короче звука, а
    // звук — эталон времени.
    expect(planRecordingWindow(base({ recordingDurationSec: 3, requiredSec: 5 }))).toBeNull()
  })

  it("отказывает на бессмысленном входе, а не выдумывает окно", () => {
    expect(planRecordingWindow(base({ requiredSec: 0 }))).toBeNull()
    expect(planRecordingWindow(base({ requiredSec: Number.NaN }))).toBeNull()
    expect(planRecordingWindow(base({ recordingDurationSec: 0 }))).toBeNull()
  })

  it("без fps работает, просто не притягивает границы", () => {
    const window = planRecordingWindow(base({ fps: 0, requiredSec: 4.017 }))!

    expect(window.durationSec).toBeCloseTo(4.017, 3)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/presenter/recording-window.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Написать правило**

Создать `server/utils/presenter/recording-window.ts`:

```ts
/**
 * Окно реза внутри длинной записи ведущего.
 *
 * Раньше единицей выбора был готовый клип фиксированной длины, и cooldown жил
 * счётчиком на нём (`PresenterSourceClip.usageCount`). При нарезке по требованию
 * единицей становится произвольное окно, у которого счётчика нет: без отдельного
 * учёта требование docs/PROJECT_CONTEXT.md §7 («cooldown повторного
 * использования фрагмента») перестало бы выполняться ровно там, где включается
 * главная фича (spec §6.2).
 *
 * Правило чистое: БД сюда не ходит, время передаётся снаружи. Занятые интервалы
 * и их давность приносит вызывающий из `PresenterRecordingUsage`.
 */

import { snapSecToFrame } from "../voiceover/segment-cut"

/** Сколько окно «остывает» после использования. Сутки — один суточный цикл производства. */
export const RECORDING_WINDOW_COOLDOWN_MS = 24 * 60 * 60 * 1000

export interface UsedInterval {
  startSec: number
  endSec: number
  usedAtMs: number
}

export interface RecordingWindowInput {
  recordingDurationSec: number
  /** Длина кадра, которую надо покрыть. Обычно — длина вырезанного куска трека. */
  requiredSec: number
  /** Частота сборки; <= 0 — притягивать границы не к чему. */
  fps: number
  usedIntervals: readonly UsedInterval[]
  /** Текущее время, мс. Снаружи — чтобы правило оставалось чистым. */
  now: number
  cooldownMs?: number
}

export interface RecordingWindow {
  startSec: number
  endSec: number
  durationSec: number
  /** Сколько секунд окна пересекается с ещё не остывшими интервалами. */
  overlapSec: number
  /** true — нетронутого места не осталось, взят остывший участок. */
  reused: boolean
}

/** Пересечение двух отрезков в секундах. */
function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

export function planRecordingWindow(input: RecordingWindowInput): RecordingWindow | null {
  const { fps, now, recordingDurationSec, requiredSec } = input
  const cooldownMs = input.cooldownMs ?? RECORDING_WINDOW_COOLDOWN_MS

  if (!Number.isFinite(requiredSec) || requiredSec <= 0) return null
  if (!Number.isFinite(recordingDurationSec) || recordingDurationSec <= 0) return null
  if (recordingDurationSec + 1e-6 < requiredSec) return null

  // Горячими считаем только те интервалы, что ещё не остыли: вчерашнее занятие
  // не должно блокировать материал навсегда, иначе библиотека выработается за
  // неделю.
  const hot = input.usedIntervals.filter(interval =>
    Number.isFinite(interval.usedAtMs) && now - interval.usedAtMs < cooldownMs)

  // Кандидаты — начала окон с шагом в один кадр (или полсекунды без fps).
  // Перебор дешёвый: запись десять минут даёт порядка 18 000 позиций, и это
  // одна арифметическая операция на позицию.
  const step = fps > 0 ? 1 / fps : 0.5
  const lastStart = recordingDurationSec - requiredSec

  let best: RecordingWindow | null = null
  for (let start = 0; start <= lastStart + 1e-9; start += step) {
    const snappedStart = Math.max(0, snapSecToFrame(start, fps))
    const snappedEnd = snapSecToFrame(snappedStart + requiredSec, fps)
    if (snappedEnd > recordingDurationSec + 1e-6) break

    let overlapSec = 0
    for (const interval of hot) {
      overlapSec += overlap(snappedStart, snappedEnd, interval.startSec, interval.endSec)
    }

    if (best === null || overlapSec < best.overlapSec) {
      best = {
        startSec: snappedStart,
        endSec: snappedEnd,
        durationSec: snappedEnd - snappedStart,
        overlapSec,
        reused: overlapSec > 0,
      }
      // Нетронутое место найдено — дальше искать нечего, лучше уже не будет.
      if (overlapSec === 0) break
    }
  }

  return best
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/presenter/recording-window.spec.ts`
Expected: PASS, 8 тестов.

- [ ] **Step 5: Коммит**

```bash
git add server/utils/presenter/recording-window.ts tests/unit/presenter/recording-window.spec.ts
git commit -m "feat: выбор окна записи под длину реплики с учётом занятых интервалов"
```

---

### Task 5: Атомарное резервирование окна и нарезка фрагмента

Резервирование окна атомарно так же, как резервирование клипа сегодня: параллельные прогоны не должны получать один и тот же участок (§6.2). Перцептивный хэш первого кадра выбранного окна проверяется против недавно использованных — как при ingest.

**Files:**
- Create: `server/utils/presenter-recording-selector.ts`
- Modify: `server/utils/presenter/ffmpeg-adapter.ts`
- Test: `tests/integration/presenter-recording.spec.ts`

**Interfaces:**
- Consumes: `planRecordingWindow`, `RECORDING_WINDOW_COOLDOWN_MS` (Task 4); `dHashFromGrayscale`, `areFramesSimilar` (`presenter/perceptual-hash.ts`); `buildPresenterCutArgs` (`presenter/ffmpeg-adapter.ts`).
- Produces:
  - `reserveRecordingWindow(input: ReserveRecordingWindowInput): Promise<ReservedRecordingWindow | null>`
  - `ReserveRecordingWindowInput { characterId: string, requiredSec: number, fps: number, videoId: number | null }`
  - `ReservedRecordingWindow { recordingId: string, storageKey: string, startSec: number, endSec: number, durationSec: number, usageId: string, reused: boolean }`
  - `cutRecordingWindow(input: { recordingPath: string, startSec: number, durationSec: number, outputPath: string }): Promise<void>` (в `ffmpeg-adapter.ts`)

- [ ] **Step 1: Написать падающий тест**

Дописать в `tests/integration/presenter-recording.spec.ts`:

```ts
describe("резервирование окна записи", () => {
  it("два параллельных прогона получают разные участки", async () => {
    const recording = await prisma.presenterRecording.create({
      data: {
        characterId,
        storageKey: `apps/${appId}/characters/${characterId}/recordings/eeee5555.mp4`,
        sha1: "eeee5555",
        durationSec: 60,
        originalName: "long.mov",
        ingestStatus: "completed",
      },
    })

    const [first, second] = await Promise.all([
      reserveRecordingWindow({ characterId, requiredSec: 5, fps: 30, videoId: null }),
      reserveRecordingWindow({ characterId, requiredSec: 5, fps: 30, videoId: null }),
    ])

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    // Один и тот же участок двум прогонам — это два одинаковых кадра в двух
    // роликах, ровно тот дубль, который запрещает PROJECT_CONTEXT §7.
    const intersect = Math.min(first!.endSec, second!.endSec) - Math.max(first!.startSec, second!.startSec)
    expect(intersect).toBeLessThanOrEqual(0)
    expect(await prisma.presenterRecordingUsage.count({ where: { recordingId: recording.id } })).toBe(2)
  })

  it("окно вчерашнего ролика не берётся, пока в записи есть нетронутое", async () => {
    const recording = await prisma.presenterRecording.findFirst({
      where: { characterId, sha1: "eeee5555" },
    })
    const taken = await prisma.presenterRecordingUsage.findMany({ where: { recordingId: recording!.id } })

    const next = await reserveRecordingWindow({ characterId, requiredSec: 5, fps: 30, videoId: null })

    for (const used of taken) {
      const intersect = Math.min(next!.endSec, used.endSec) - Math.max(next!.startSec, used.startSec)
      expect(intersect).toBeLessThanOrEqual(0)
    }
  })

  it("возвращает null, когда у персонажа нет ни одной завершённой записи", async () => {
    const other = await prisma.character.create({ data: { appId, name: "Без записей" } })

    expect(await reserveRecordingWindow({
      characterId: other.id, requiredSec: 5, fps: 30, videoId: null,
    })).toBeNull()
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `bunx vitest run tests/integration/presenter-recording.spec.ts`
Expected: FAIL — `reserveRecordingWindow` не существует.

- [ ] **Step 3: Написать резервирование**

Создать `server/utils/presenter-recording-selector.ts`:

```ts
/**
 * Атомарный выбор окна записи ведущего под кадр заданной длины.
 *
 * Устроено так же, как `reservePresenterSourceClip` (тот же файл-сосед):
 * `Serializable` транзакция и три попытки на `P2034`. Причина та же — два
 * параллельных прогона не должны получить один участок: это два одинаковых
 * кадра в двух роликах, то есть дубль по docs/PROJECT_CONTEXT.md §7.
 *
 * Отличие от выбора клипа: единица не строка, а интервал, поэтому «занятость»
 * фиксируется вставкой `PresenterRecordingUsage` внутри той же транзакции.
 * Именно вставка, а не инкремент счётчика, делает резервирование видимым
 * второму прогону.
 */

import { prisma } from "./prisma"
import { planRecordingWindow, RECORDING_WINDOW_COOLDOWN_MS } from "./presenter/recording-window"

const MAX_RESERVATION_ATTEMPTS = 3

export interface ReserveRecordingWindowInput {
  characterId: string
  /** Длина кадра — обычно длина вырезанного куска трека. */
  requiredSec: number
  fps: number
  /** Ролик, за которым закрепляется интервал. null — служебный прогон. */
  videoId: number | null
  now?: number
}

export interface ReservedRecordingWindow {
  recordingId: string
  storageKey: string
  startSec: number
  endSec: number
  durationSec: number
  usageId: string
  /** true — нетронутого места не осталось, взят остывший участок. */
  reused: boolean
}

export async function reserveRecordingWindow(
  input: ReserveRecordingWindowInput,
): Promise<ReservedRecordingWindow | null> {
  const now = input.now ?? Date.now()

  for (let attempt = 1; attempt <= MAX_RESERVATION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Только завершённые записи: у падавшего ingest файл может быть
        // недокачан, и резать из него — это кадр из ниоткуда.
        const recordings = await tx.presenterRecording.findMany({
          where: {
            characterId: input.characterId,
            ingestStatus: "completed",
            durationSec: { gte: input.requiredSec },
          },
          orderBy: [{ createdAt: "asc" }],
          include: {
            usages: {
              where: { usedAt: { gte: new Date(now - RECORDING_WINDOW_COOLDOWN_MS) } },
              select: { startSec: true, endSec: true, usedAt: true },
            },
          },
        })
        if (recordings.length === 0) return null

        let best: (ReservedRecordingWindow & { overlapSec: number }) | null = null
        for (const recording of recordings) {
          const window = planRecordingWindow({
            recordingDurationSec: recording.durationSec,
            requiredSec: input.requiredSec,
            fps: input.fps,
            usedIntervals: recording.usages.map(usage => ({
              startSec: usage.startSec,
              endSec: usage.endSec,
              usedAtMs: usage.usedAt.getTime(),
            })),
            now,
          })
          if (!window) continue

          const candidate = {
            recordingId: recording.id,
            storageKey: recording.storageKey,
            startSec: window.startSec,
            endSec: window.endSec,
            durationSec: window.durationSec,
            usageId: "",
            reused: window.reused,
            overlapSec: window.overlapSec,
          }
          if (best === null || candidate.overlapSec < best.overlapSec) best = candidate
          if (best.overlapSec === 0) break
        }
        if (!best) return null

        const usage = await tx.presenterRecordingUsage.create({
          data: {
            recordingId: best.recordingId,
            startSec: best.startSec,
            endSec: best.endSec,
            videoId: input.videoId,
          },
        })

        const { overlapSec: _overlapSec, ...result } = best
        return { ...result, usageId: usage.id }
      }, { isolationLevel: "Serializable" })
    }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : ""
      if (code !== "P2034" || attempt === MAX_RESERVATION_ATTEMPTS) throw error
    }
  }

  return null
}
```

- [ ] **Step 4: Добавить вырезку окна в адаптер**

В `server/utils/presenter/ffmpeg-adapter.ts`:

```ts
/**
 * Вырезка произвольного окна записи под кадр.
 *
 * Отличается от `cutSegment` (ingest) только тем, что длительность приходит
 * снаружи и потолком модели не ограничена: длину диктует звук, а не библиотека.
 * Аргументы те же — `buildPresenterCutArgs` уже режет с перекодированием и
 * вписывает кадр в пределы lip-sync модели.
 */
export async function cutRecordingWindow(input: {
  recordingPath: string
  startSec: number
  durationSec: number
  outputPath: string
}): Promise<void> {
  await runFfmpeg(
    buildPresenterCutArgs(input.recordingPath, input.startSec, input.durationSec, input.outputPath),
    CUT_TIMEOUT_MS,
    false,
  )
}
```

- [ ] **Step 5: Запустить тесты**

Run: `bunx vitest run tests/integration/presenter-recording.spec.ts`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add server/utils/presenter-recording-selector.ts server/utils/presenter/ffmpeg-adapter.ts tests/integration/presenter-recording.spec.ts
git commit -m "feat: атомарное резервирование окна записи и вырезка фрагмента под кадр"
```

---

### Task 6: Lip-sync берёт фрагмент из записи, а не подбирает клип

Два режима §6.2: есть запись-родитель — фрагмент вырезается под фактическую длину кадра; записи нет — прежний подбор ближайшего клипа по длительности. Второй режим не трогаем вовсе.

**Про `adjustAudioTempo`.** Проверено по коду: на маршруте audio-first ускорение речи **уже не вызывается** — ветка обёрнута в `if (!useAvatarRoute && !segmentPlan)` (`lip-sync-runner.ts:1073`), а `planSpeechFitToModel` в подборе фрагмента стоит в `else`-ветке `if (segmentPlan)` (`lip-sync-runner.ts:855-885`). Эта задача убирает **последствие** его отсутствия: WARN «кусок трека длиннее исходника … исходник под звук нарезает план 2» (`lip-sync-runner.ts:1053-1059`) перестаёт срабатывать, потому что исходник теперь ровно нужной длины. Сами функции `adjustAudioTempo` и `planSpeechFitToModel` из кода **не удаляются** — их вызывает старый маршрут (`video-pipeline-steps.ts:1491,1499,1520` и `lip-sync-runner.ts:1079`), а Global Constraints требуют его не ломать. Их удаление — шаг 12 спеки («удаление `EDIT_PIPELINE` и старой ветки»), не этот план.

**Files:**
- Modify: `server/utils/lip-sync-runner.ts:849-960,1050-1060`
- Test: `tests/unit/fixes/lip-sync-recording-window.spec.ts`

**Interfaces:**
- Consumes: `reserveRecordingWindow` (Task 5), `cutRecordingWindow` (Task 5), `reservePresenterSourceClip` (существует).
- Produces: поведение — на audio-first при наличии завершённой записи длина исходника равна длине куска трека.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/unit/fixes/lip-sync-recording-window.spec.ts` по образцу соседнего `tests/unit/fixes/lip-sync-presenter-slot.spec.ts` (там уже собран весь набор моков модулей, включая `adjustAudioTempo`). Проверяемое:

```ts
  it("на audio-first берёт окно записи ровно под длину куска трека", async () => {
    // Кусок трека 6.40 с. Раньше подбирался готовый клип с допуском ±1 с, и
    // ведущая договаривала в немой кадр либо обрывалась. Теперь окно режется
    // под звук.
    h.reserveRecordingWindow.mockResolvedValue({
      recordingId: "rec-1",
      storageKey: "recordings/rec-1.mp4",
      startSec: 12,
      endSec: 18.4,
      durationSec: 6.4,
      usageId: "usage-1",
      reused: false,
    })

    await runLipSyncStep(inputWithAudioFirstSegment({ segmentSec: 6.4 }))

    expect(h.reserveRecordingWindow).toHaveBeenCalledWith(
      expect.objectContaining({ requiredSec: 6.4, fps: 30 }),
    )
    expect(h.cutRecordingWindow).toHaveBeenCalledWith(
      expect.objectContaining({ startSec: 12, durationSec: 6.4 }),
    )
    // Подбор готового клипа на этом пути не нужен вовсе.
    expect(h.reservePresenterSourceClip).not.toHaveBeenCalled()
  })

  it("без записи-родителя работает прежний подбор клипа", async () => {
    h.reserveRecordingWindow.mockResolvedValue(null)

    await runLipSyncStep(inputWithAudioFirstSegment({ segmentSec: 6.4 }))

    expect(h.reservePresenterSourceClip).toHaveBeenCalled()
  })

  it("на старом маршруте запись не спрашивается вовсе", async () => {
    // Инвариант всей работы: ролик без editPipeline не должен изменить ни
    // одного вызова.
    await runLipSyncStep(inputWithoutAudioFirst())

    expect(h.reserveRecordingWindow).not.toHaveBeenCalled()
  })
```

Хелперы `inputWithAudioFirstSegment` / `inputWithoutAudioFirst` собрать по образцу существующих фикстур `lip-sync-presenter-slot.spec.ts`: `audioFirst` с одной `AlignedScene` нужной длины либо `audioFirst: null`.

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/fixes/lip-sync-recording-window.spec.ts`
Expected: FAIL — окно записи не запрашивается.

- [ ] **Step 3: Встроить окно записи в выбор исходника**

В `server/utils/lip-sync-runner.ts` в ветке `if (videoConfig.lipSyncCharacterId)` — после того, как `presenterTargetSec` посчитан для `segmentPlan` (строки 855-862), **до** вызова `reservePresenterSourceClip` (строка 904):

```ts
        /**
         * Монтаж от звука: сначала пробуем вырезать окно из длинной записи.
         *
         * Готовый клип подбирается по длительности с допуском ±1 с, и этой
         * секунды хватает, чтобы ведущая договаривала в немой кадр или
         * обрывалась на полуслове. Окно записи режется ровно под длину куска
         * трека — картинка подгоняется под голос, а не наоборот (spec §6.2).
         */
        let recordingWindow: Awaited<ReturnType<typeof reserveRecordingWindow>> = null
        if (segmentPlan && !useAvatarRoute) {
          recordingWindow = await reserveRecordingWindow({
            characterId: videoConfig.lipSyncCharacterId,
            requiredSec: presenterTargetSec,
            fps: timelineFps,
            videoId,
          }).catch(async (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err)
            await appendStepLog(step.id, `${sceneTag}: окно записи не зарезервировано (${msg}) — иду прежним подбором клипа`)
            return null
          })
        }

        if (recordingWindow) {
          const localRecordingPath = join(assetsDir, `recording_${recordingWindow.recordingId}.mp4`)
          if (!(await fileExists(localRecordingPath))) {
            await getStorageDriver().downloadToFile(recordingWindow.storageKey, localRecordingPath)
          }
          const windowPath = join(assetsDir, `presenter_window_${sceneIndex}_${recordingWindow.usageId}.mp4`)
          await cutRecordingWindow({
            recordingPath: localRecordingPath,
            startSec: recordingWindow.startSec,
            durationSec: recordingWindow.durationSec,
            outputPath: windowPath,
          })
          sourceVideoPath = windowPath
          presenterSourcePath = windowPath
          await appendStepLog(
            step.id,
            `${sceneTag}: вырезал окно записи ${recordingWindow.startSec.toFixed(2)}-${recordingWindow.endSec.toFixed(2)}с `
            + `(${recordingWindow.durationSec.toFixed(2)}с) под кусок трека`
            + (recordingWindow.reused ? "; нетронутых участков в записи не осталось, взят остывший" : ""),
          )
        }
```

Вызов `reservePresenterSourceClip` обернуть условием `recordingWindow ? null : await reservePresenterSourceClip({...})` — прежний подбор остаётся полноценным фолбэком по §10 спеки («у клипа нет записи-родителя → прежний подбор по длительности»).

- [ ] **Step 4: Снять ставший ложным WARN**

Блок `lip-sync-runner.ts:1053-1059` («исходник под звук нарезает план 2») выполняется, только если `segmentPlan.cut.durationSec > providerDurationSec`. С окном записи это условие больше не выполняется штатно, но при работе через фолбэк — выполняется. Поэтому текст надо поправить, а не удалять: убрать из него отсылку к «плану 2» и оставить причину — «фрагмент подобран из библиотеки, записи-родителя нет».

- [ ] **Step 5: Запустить тесты**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/fixes`
Expected: PASS. Существующие тесты lip-sync обязаны остаться зелёными без правок — если какой-то из них упал, значит задет старый маршрут, и это блокер.

- [ ] **Step 6: Прогнать DB-free сьюту целиком**

Run: `bunx vitest run --config vitest.pure.config.ts`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add server/utils/lip-sync-runner.ts tests/unit/fixes/lip-sync-recording-window.spec.ts
git commit -m "feat: фрагмент ведущего режется из записи под фактическую длину реплики"
```

---

### Task 7: Жизненный цикл записей — автоочистка, холодный класс, объём в UI

Минута нормализованной записи — 30-37 МБ. При потоке около 300 единиц материала в месяц это от ~20 ГБ до ~110 ГБ в месяц (§6.1). Без правила очистки хранилище растёт линейно и навсегда.

**Files:**
- Create: `server/utils/presenter/recording-retention.ts`
- Create: `server/plugins/presenter-retention.ts`
- Test: `tests/unit/presenter/recording-retention.spec.ts`
- Test: `tests/integration/presenter-recording.spec.ts`
- Modify: `docs/operations/presenter-library.md`

**Interfaces:**
- Consumes: prisma-модели (Task 1).
- Produces:
  - `planRecordingRetention(input: RetentionInput): RetentionDecision[]`
  - `RetentionCandidate { id: string, retention: string, activeClipCount: number, createdAtMs: number, cooledAtMs: number | null }`
  - `RetentionDecision { recordingId: string, action: "delete" | "cool" | "keep", reason: string }`
  - `applyRecordingRetention(now?: number): Promise<RetentionDecision[]>`

- [ ] **Step 1: Написать падающий тест правила**

Создать `tests/unit/presenter/recording-retention.spec.ts`:

```ts
import { describe, expect, it } from "vitest"

import { planRecordingRetention } from "~~/server/utils/presenter/recording-retention"

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    retention: "auto",
    activeClipCount: 0,
    createdAtMs: NOW - 200 * DAY,
    cooledAtMs: null,
    ...overrides,
  }
}

describe("правило хранения записей ведущего", () => {
  it("удаляет auto-запись без активных клипов после срока", () => {
    const [decision] = planRecordingRetention({ candidates: [candidate()], now: NOW })

    expect(decision).toMatchObject({ action: "delete" })
  })

  it("не трогает запись, помеченную keep", () => {
    // Ручная пометка — единственная защита ценного материала: пересъёмка стоит
    // дороже гигабайтов.
    const [decision] = planRecordingRetention({
      candidates: [candidate({ retention: "keep" })],
      now: NOW,
    })

    expect(decision).toMatchObject({ action: "keep" })
  })

  it("не удаляет запись, у которой остались живые клипы", () => {
    // Клип уехал в готовые ролики; снести его родителя значит потерять
    // возможность перенарезать материал, ради которой запись и хранится.
    const [decision] = planRecordingRetention({
      candidates: [candidate({ activeClipCount: 4 })],
      now: NOW,
    })

    expect(decision.action).not.toBe("delete")
  })

  it("переводит в холодный класс через 30 дней, а не сразу", () => {
    const fresh = planRecordingRetention({
      candidates: [candidate({ createdAtMs: NOW - 5 * DAY, activeClipCount: 3 })],
      now: NOW,
    })[0]!
    const old = planRecordingRetention({
      candidates: [candidate({ createdAtMs: NOW - 40 * DAY, activeClipCount: 3 })],
      now: NOW,
    })[0]!

    expect(fresh.action).toBe("keep")
    expect(old.action).toBe("cool")
  })

  it("уже охлаждённую запись второй раз не охлаждает", () => {
    const [decision] = planRecordingRetention({
      candidates: [candidate({ createdAtMs: NOW - 40 * DAY, activeClipCount: 3, cooledAtMs: NOW - 3 * DAY })],
      now: NOW,
    })

    expect(decision.action).toBe("keep")
  })

  it("принимает свои сроки — политика настраивается без правки кода", () => {
    const [decision] = planRecordingRetention({
      candidates: [candidate({ createdAtMs: NOW - 10 * DAY })],
      now: NOW,
      deleteAfterMs: 7 * DAY,
    })

    expect(decision.action).toBe("delete")
  })
})
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/presenter/recording-retention.spec.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Написать правило**

Создать `server/utils/presenter/recording-retention.ts`:

```ts
/**
 * Что делать с накопленными записями ведущего.
 *
 * Минута нормализованной записи — 30-37 МБ, поток около 300 единиц материала в
 * месяц: от ~20 ГБ при коротких дублях до ~110 ГБ при десятиминутных (spec
 * §6.1). Без правила хранилище растёт линейно и навсегда.
 *
 * Правило чистое: время и кандидаты приходят снаружи, ни БД, ни хранилища здесь
 * нет. Причина отказа возвращается вместе с решением — по ней в логе видно,
 * почему запись пережила проход, и её же проверяет тест.
 */

/** Срок жизни auto-записи без активных клипов. */
export const RECORDING_DELETE_AFTER_MS = 180 * 24 * 60 * 60 * 1000

/** Возраст, после которого запись уезжает в холодный класс хранения. */
export const RECORDING_COOL_AFTER_MS = 30 * 24 * 60 * 60 * 1000

export interface RetentionCandidate {
  id: string
  retention: string
  /** Сколько клипов этой записи ещё активны в библиотеке. */
  activeClipCount: number
  createdAtMs: number
  /** Когда запись перевели в холодный класс. null — не переводили. */
  cooledAtMs: number | null
}

export interface RetentionDecision {
  recordingId: string
  action: "delete" | "cool" | "keep"
  reason: string
}

export interface RetentionInput {
  candidates: readonly RetentionCandidate[]
  now: number
  deleteAfterMs?: number
  coolAfterMs?: number
}

export function planRecordingRetention(input: RetentionInput): RetentionDecision[] {
  const deleteAfterMs = input.deleteAfterMs ?? RECORDING_DELETE_AFTER_MS
  const coolAfterMs = input.coolAfterMs ?? RECORDING_COOL_AFTER_MS

  return input.candidates.map((candidate) => {
    const ageMs = input.now - candidate.createdAtMs

    if (candidate.retention === "keep") {
      return { recordingId: candidate.id, action: "keep", reason: "помечена keep вручную" }
    }
    if (candidate.activeClipCount > 0) {
      // Клипы уехали в готовые ролики; снос родителя отнимает саму возможность
      // перенарезать материал — то, ради чего запись и хранится.
      return ageMs >= coolAfterMs && candidate.cooledAtMs === null
        ? { recordingId: candidate.id, action: "cool", reason: "старше 30 дней, но клипы живы" }
        : { recordingId: candidate.id, action: "keep", reason: "есть активные клипы" }
    }
    if (ageMs >= deleteAfterMs) {
      return { recordingId: candidate.id, action: "delete", reason: "auto без активных клипов и старше срока" }
    }
    return ageMs >= coolAfterMs && candidate.cooledAtMs === null
      ? { recordingId: candidate.id, action: "cool", reason: "старше 30 дней" }
      : { recordingId: candidate.id, action: "keep", reason: "моложе срока" }
  })
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `bunx vitest run --config vitest.pure.config.ts tests/unit/presenter/recording-retention.spec.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Написать применение правила**

Дописать в `server/utils/presenter/recording-retention.ts`:

```ts
/**
 * Проход очистки: собрать кандидатов, применить правило, выполнить решения.
 *
 * Удаление идёт в порядке «сначала объект в хранилище, потом строка»: обратный
 * порядок при падении между шагами оставил бы объект без строки, то есть
 * сироту вне любого каскада.
 */
export async function applyRecordingRetention(now = Date.now()): Promise<RetentionDecision[]> {
  const { prisma } = await import("../prisma")
  const { getStorageDriver } = await import("../storage")

  const rows = await prisma.presenterRecording.findMany({
    select: {
      id: true,
      retention: true,
      createdAt: true,
      cooledAt: true,
      storageKey: true,
      _count: { select: { clips: true } },
    },
  })

  const decisions = planRecordingRetention({
    candidates: rows.map(row => ({
      id: row.id,
      retention: row.retention,
      activeClipCount: row._count.clips,
      createdAtMs: row.createdAt.getTime(),
      cooledAtMs: row.cooledAt?.getTime() ?? null,
    })),
    now,
  })

  const byId = new Map(rows.map(row => [row.id, row]))
  for (const decision of decisions) {
    const row = byId.get(decision.recordingId)!
    if (decision.action === "delete") {
      await getStorageDriver().delete(row.storageKey).catch(() => {})
      await prisma.presenterRecording.delete({ where: { id: row.id } })
    }
    else if (decision.action === "cool") {
      // Смены класса хранения в драйвере нет (проверено: интерфейс
      // StorageDriver в server/utils/storage/types.ts:42-59 знает только
      // upload/download/delete). Поэтому отмечаем момент и говорим вслух —
      // молча делать вид, что класс сменился, нельзя.
      await prisma.presenterRecording.update({ where: { id: row.id }, data: { cooledAt: new Date(now) } })
    }
  }

  return decisions
}
```

**Про холодный класс.** `StorageDriver` (`server/utils/storage/types.ts:42-59`) содержит `uploadBuffer`, `uploadFile`, `downloadToFile`, `delete`, `deletePrefix` — метода смены класса хранения там нет. Добавлять его в интерфейс ради одной операции внутри этой задачи не нужно: на GCS холодный класс штатно настраивается lifecycle-правилом на bucket по префиксу `recordings/`, и это операционная настройка, а не код. Действие `cool` в правиле остаётся: оно отмечает `cooledAt` и пишет строку в лог, а сама смена класса выполняется правилом bucket. Это должно быть записано в `docs/operations/presenter-library.md` (Step 8), иначе поле `cooledAt` через месяц прочтут как «класс сменил код».

- [ ] **Step 6: Завести планировщик**

Создать `server/plugins/presenter-retention.ts` по образцу существующих плагинов в `server/plugins/` — суточный проход `applyRecordingRetention` с записью решений в `logAgent`. Плагин обязан уважать те же переменные отключения планировщиков, что и соседние (посмотреть в `server/plugins/`), иначе он будет чистить хранилище на стенде и в тестах.

- [ ] **Step 7: Написать тест применения с БД**

Дописать в `tests/integration/presenter-recording.spec.ts`:

```ts
  it("очистка не трогает keep и записи с живыми клипами", async () => {
    const keep = await prisma.presenterRecording.create({
      data: {
        characterId, storageKey: "k", sha1: "keep0001", durationSec: 10,
        retention: "keep", createdAt: new Date(Date.now() - 400 * 24 * 3600 * 1000),
      },
    })
    const withClips = await prisma.presenterRecording.create({
      data: {
        characterId, storageKey: "w", sha1: "with0001", durationSec: 10,
        createdAt: new Date(Date.now() - 400 * 24 * 3600 * 1000),
      },
    })
    await prisma.presenterSourceClip.create({
      data: { characterId, recordingId: withClips.id, fileUrl: "u", sha1: "clipw001", durationSec: 3 },
    })

    await applyRecordingRetention()

    expect(await prisma.presenterRecording.findUnique({ where: { id: keep.id } })).not.toBeNull()
    expect(await prisma.presenterRecording.findUnique({ where: { id: withClips.id } })).not.toBeNull()
  })
```

- [ ] **Step 8: Обновить операционную документацию**

В `docs/operations/presenter-library.md` добавить раздел: где лежат записи, что такое `retention` и `ingestStatus`, как перезапустить упавший ingest, как перенарезать библиотеку, какие сроки у автоочистки и как посмотреть занимаемый объём.

- [ ] **Step 9: Прогнать сьюты**

Run: `bunx vitest run --config vitest.pure.config.ts`
Run: `bunx vitest run tests/integration/presenter-recording.spec.ts`
Expected: PASS.

- [ ] **Step 10: Коммит**

```bash
git add server/utils/presenter/recording-retention.ts server/plugins/presenter-retention.ts tests docs/operations/presenter-library.md
git commit -m "feat: жизненный цикл записей ведущего — автоочистка, холодный класс, объём"
```

---

## Что этот план сознательно НЕ делает

- **Не удаляет `adjustAudioTempo` и `planSpeechFitToModel`.** На audio-first они уже не вызываются (проверено по коду, см. Task 6), а старый маршрут ими живёт. Удаление — шаг 12 спеки, вместе со снятием `EDIT_PIPELINE`.
- **Не трогает подбор готового клипа.** `reservePresenterSourceClip`, `buildPresenterDurationWindow` и `pickClosestPresenterCandidate` остаются как есть: это фолбэк по §10 («у клипа нет записи-родителя → прежний подбор по длительности») и единственный путь для клипов, залитых до этой работы.
- **Не переносит `usageCount`/`lastUsedAt` с клипов.** Они продолжают работать для клипового пути. Учёт интервалов вводится рядом, а не вместо: одновременная переделка обоих механизмов сломала бы cooldown у роликов, идущих старым маршрутом.
- **Не даёт UI записей.** Список, объём, кнопки `keep` и перенарезки — план 4 (§9 спеки). Здесь только API и правила; UI идёт через `$design-feature`.
- **Не делает PiP-кроп из записи.** Кроп, маска и наложение — план 3 (§6.3), и порядок там жёсткий: сначала lip-sync целым кадром, потом композиция.
- **Не планирует canary.** Отдельное решение владельца (`handoff-2026-08-17-audio-first.md` §6).
- **Не чинит нарезку 4K-исходников по времени.** Нормализация десятиминутной 4K60-записи — это десятки минут ffmpeg внутри HTTP-запроса. Задача существует (durable-job для ingest упомянут в шапке `source-recordings/index.post.ts` ещё до этой работы), но она про фоновые задачи вообще, а не про монтаж от звука.
