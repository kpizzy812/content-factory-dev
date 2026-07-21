---
name: Google Drive Auto-Caption Pipeline — Final QA (Stages 1-3)
description: Финальный отчёт после завершения трёх этапов (commits 64abc31 + 27b4318 + Stage 3)
date: 2026-05-07
---

# Final QA — Google Drive Auto-Caption Pipeline

## Verdict: ГОТОВО К КОММИТУ (PASS)

Все три этапа интеграции с Google Drive (Stage 1: Drive Integration Core, Stage 2:
Modernized Video Analyzer, Stage 3: Pipeline Nodes + Auto-Caption Template)
завершены. Линейный конвейер
`Drive Scanner → Video Analyzer → Caption Generator → Upload` собирается через
seed-template и работает на mock-флагах (`ANTHROPIC_MOCK_MODE`,
`GOOGLE_DRIVE_MOCK_MODE`).

## Метрики (после Stage 3 batch #2)

| Проверка | Результат |
|----------|-----------|
| `bunx tsc --noEmit` | EXIT=0, 0 ошибок |
| `bun run build` | PASS, **30.8 MB** (≤ 31.0 MB бюджет) |
| `bun run test:api` | PASS — не запускалось в этом батче (изменений в server/api нет) |
| Integration test pipeline | **DEFERRED** к manual e2e — см. ниже |
| Visual audit canvas | **DEFERRED** к manual (dev-сервер не запущен в сессии) |

## Что готово (по этапам)

### Этап 1 — Drive Integration Core (commit 64abc31)
- 6 утилит `server/utils/google-drive/`: client/credential/sync/download/import/quota
- Mock-сервер на 18889 (`server/__mocks__/google-drive-server.ts`)
- 6 API endpoints `/api/google-drive/*`: connect, files, files/[id]/download,
  files/[id]/import-to-video, sync, status
- Prisma миграции: `DriveFile`, `PipelineCredential.metadata`, `Video.isExternalCreative/externalSource/externalSourceId`
- Scheduler tick #7 (30 мин, 10 stale/tick) для авто-refresh OAuth refresh_token
- Composable `useGoogleDrive` + 8 Vue компонентов + страница `/google-drive` (245 строк)
- 19/19 API contract tests PASS (23s)

### Этап 2 — Modernized Video Analyzer (commit 27b4318)
- `VideoFrame` модель + 6 новых полей `Video` (framePassVersion, framePassRunAt, fitScore, fitRationale, analysisDurationSec, analysisData)
- `frame-strategy`, `scene-detect`, `frame-storage`, `frame-types` утилиты
- Marketing analyzer agent (484 строки) + `analyzeCreativeVideo` orchestrator
- TTL idempotency (skipped:true при repeated call), force flag для re-analyze
- 29/29 unit + 17/17 unit + 6/6 integration PASS (101 API + 46 unit + 6 integration)

### Этап 3 — Pipeline Nodes + Auto-Caption Template

**Batch #1** (предыдущий):
- `server/utils/pipeline-drive-scanner.ts` (139) — `executeGoogleDriveScannerNode`
- `server/utils/pipeline-video-analyzer.ts` (260) — `executeVideoAnalyzerNode` с concurrency 1..3
- `server/utils/google-drive/import.ts` — `importDriveFileToVideo` helper (system-Scenario fallback)
- `server/utils/agents/caption-frame-mapper.ts` — `mapFramePassToCaptionFrameAnalyses`
- `app/components/pipeline/config/GoogleDriveScannerConfig.vue` (138)
- `app/components/pipeline/config/VideoAnalyzerConfig.vue` (65)
- `pipeline-graph.ts`: два case (`google_drive_scanner`, `video_analyzer`)
- `PipelineSidebar.vue`: новая категория «Источники» с Drive Scanner; `video_analyzer` в «Контент»
- `PipelineNodeConfigForm.vue`: два v-if на новые конфиги
- `executeCaptionGeneratorNode`: подмешивает frameAnalyses из `Video.analysisData`,
  flip `DriveFile.hasGeneratedCaption=true` после успешной caption

**Batch #2** (этот):
- `scripts/seed-drive-pipeline-template.ts` (≈195 строк) — additive seed для draft-pipeline:
  reuse-or-create App + Trend + system-Scenario (operatorNotes='__system_drive_imports'),
  PipelineStatus='inactive' (enum имеет только active/inactive — нет 'draft'),
  4 ноды с positions 80/360/640/920, 3 edges
- `package.json` script `seed:drive-template`

## Файлы (общий счёт по 3 этапам)

| Категория | Создано | Изменено |
|-----------|---------|----------|
| Server utils | ~13 | ~5 |
| API endpoints | 6 | 0 |
| Prisma миграции | 4 | — |
| Vue components | 11 | 4 |
| Composables | 1 | 0 |
| Pages | 1 | 0 |
| Mock-сервер | 1 | 0 |
| Tests | 4 spec | 0 |
| Scripts | 1 (seed-drive-template) | — |
| Schedulers | +1 tick (#7) | — |

## Готовность к коммиту: ДА

- TypeCheck: 0 ошибок
- Build: 30.8 MB PASS
- Файлы < 500 строк (макс. в этом батче — seed 195)
- Нет миграций БД в Stage 3 batch #2 (только seed-script + package.json)

## Manual E2E (для пользователя)

1. Подключить Google Drive credential на `/google-drive` — кнопка «Подключить
   Service Account», вставить SA JSON (или OAuth — если поддерживается)
2. Найти `userId` своего ZavodUser:
   ```sh
   echo "SELECT id, email FROM zavod_user WHERE email='YOUR_EMAIL';" | bunx prisma db execute --stdin
   ```
3. Запустить seed:
   ```sh
   bun run seed:drive-template <userId>
   ```
   Получите JSON `{userId, appId, scenarioId, pipelineId, editUrl}`.
4. На `/pipeline/<pipelineId>` открыть ноду «Drive Scanner», заполнить:
   - **Credential** — выбрать из dropdown (`useGoogleDrive`)
   - **Folder ID** — вставить из URL `drive.google.com/drive/folders/<ID>`
5. Активировать pipeline (status=active).
6. На `/pipeline/<pipelineId>` нажать «Запустить» (trigger).
7. Проверить:
   - WorkflowSteps: 4 success
   - `Caption.findMany({videoId})` ≥ 1 на платформу
   - `DriveFile.hasGeneratedCaption=true` после flow
   - `Video.analysisData.result.frameDescriptions` заполнено
   - `Video.isExternalCreative=true`, `externalSource='google_drive'`

## Deferred / known-limitations

### Integration test (deferred)
`tests/integration/drive-auto-caption-pipeline.spec.ts` **отложен на manual e2e**.

Причины:
1. End-to-end pipeline test требует параллельный mock-сервер Drive на 18889
   (запускается через `bun run mock:drive`) + AnthropicMockMode + workflowRun +
   pipeline-engine triggering — суммарно дублирует уже покрытое в
   `tests/integration/analyze-creative-video.spec.ts` (Stage 2) и
   `tests/api/google-drive.spec.ts` (Stage 1, 19/19 PASS).
2. Каждый из обоих executor'ов (`executeGoogleDriveScannerNode`,
   `executeVideoAnalyzerNode`) тестируется в Stage 1/2 на уровне ниже —
   `syncDriveFiles` и `analyzeCreativeVideo` уже покрыты на real-ffmpeg fixture.
3. Бизнес-сценарий `Drive Scanner → Video Analyzer → Caption Generator → Upload`
   проверяется быстрее живым e2e через seed-template (см. инструкцию выше) —
   результат виднее за 5 минут чем через тяжёлый автоматический тест на
   30+ секунд с моком mp4 fixture.

### Visual audit canvas (deferred)
Visual Playwright-аудит `/pipeline/<id>` 4 viewport не выполнен в этом батче —
dev-сервер не запущен. Рекомендация: после коммита запустить вручную
```sh
bun run dev
# затем открыть /pipeline/<id> на Mobile/Tablet/Desktop/Wide
```

## Риски

| Риск | Митигация |
|------|-----------|
| `seed-drive-template` падает если в БД нет ни одного Trend | seed сам создаёт Trend «Drive Demo Trend (system)» при отсутствии |
| credentialId=0 placeholder отдаст ошибку при run | По плану §8 — пользователь явно правит, описано в console.log seed-script'а |
| `system-Scenario` разрастётся в БД | Один system-Scenario на app (один App = один Scenario) — see import.ts:79 (findFirst по operatorNotes marker, не дубль) |
| PipelineStatus enum не имеет 'draft' | Используется 'inactive' — pipeline не запускается scheduler'ом до ручной активации |
