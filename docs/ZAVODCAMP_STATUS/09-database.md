# 09. База данных

**Postgres + Prisma 7** (через `@prisma/adapter-pg`).
**75+ моделей**, **40+ enum'ов**, **89 миграций** на 2026-05-21.

Полная схема — `prisma/schema.prisma` (источник истины). Этот файл — высокоуровневая навигация.

---

## Доменные области

### 1. RBAC и аутентификация

| Модель | Назначение |
|--------|-----------|
| `ZavodUser` | Локальная копия пользователя из MarketingCamp. 8 RBAC-флагов + `rolePreset` enum + `roleName/rolePresetName` (для UI badge) + `moduleAccess: String[]` + `externalId` (FK к MC) + `isActive` (локальная блокировка) |
| `UserAppAssignment` | Гранулярная модель доступа: `accessLevel` (none/read_only/full), `accounts` (all\|CSV ID), `geos` (all\|CSV), `permissions` (read\|read+write\|...) |

### 2. Apps и приложения

| Модель | Назначение |
|--------|-----------|
| `App` | Приложение (продукт): Telegram-проект, мобильное приложение и т.д. Содержит slug, name, описание, иконку |
| `AppReferenceImage` | Справочные изображения приложения (для AI-промтов) |
| `AppEnrichmentLog` | Лог AI-обогащения метаданных App |

### 3. Тренды

| Модель | Назначение |
|--------|-----------|
| `Trend` | Тренд из соцсети: URL, миниатюра, метрики (views, likes), платформа, статус, AI-анализ |
| `TrendInsight` | AI-инсайт по тренду |
| `CreativeBrief` | Творческий бриф (предмет, целевая аудитория, тон, рекомендации) |
| `TrendwatcherProfile` | Конфиг парсинга Apify: actor, input params, расписание, валидация |
| `TrendwatcherRun` | Запуск парсинга: статус, метрики (foundCount, importedCount, analyzedCount, skipCount, errorCount), длительность |
| `TrendwatcherRunLog` | Логи запуска |

### 4. Идеи и сценарии

| Модель | Назначение |
|--------|-----------|
| `Idea` | Идея: title, description, source (chat/pipeline/manual), externalId (для MC sync), syncStatus, remoteSnapshot |
| `IdeaAnalysis` | AI-анализ идеи |
| `IdeaOperatorAction` | Лог действий оператора (approve/reject/edit) |
| `Scenario` | Сценарий: title, briefId, status, parentTrendId |
| `ScenarioVariant` | Вариант сценария: hook, body, CTA, visualStyle, status, qualityScore + qualityScoreDetails (от AI-критика) |
| `ScenarioBlockRevision` | История изменений блоков (hook/body/CTA) |
| `VisualStyleRevision` | История изменений визуального стиля |
| `ScenarioReviewAction` | Лог ревью: accept/reject/rework + комментарий |
| `ScenarioGenerationProfile` | Шаблон генерации сценариев (для App) |
| `CriticReview` | AI-критика вариантов (6 dimensions: hook strength, narrative coherence, visual appeal, CTA clarity, audience fit, originality). Unique-индекс по `(scenarioId, iteration)` |
| `ScenarioFeedback` | Обратная связь продюсера |

### 5. Видео-продакшн

| Модель | Назначение |
|--------|-----------|
| `Video` | Финальное видео: filePath, storageKey (GCS), duration, format, status, scenarioId, driveFileId, driveCredentialId, voiceoverEnabled, music settings, subtitle preset, clipDuration, imageCount, lipSync |
| `VideoAsset` | Ассеты видео: clip, image, music, voiceover (содержит prompt, model, cost) |
| `VideoGenerationStep` | Per-step tracking: stepType (prompt/image/clip/voiceover/music/assembly), status, started/completed, error info, output |
| `VideoFrame` | Покадровый анализ (для marketing-grade analysis): timestamp, AI-description, ключевые элементы |
| `VideoUniqueVariant` | Уникализированные копии для разных платформ (paramsHash, ffmpeg-инструкции, output storageKey) |
| `Caption` | Per-platform метаданные публикации: title, description, hashtags, status (draft/approved), platformLimits valid |

### 6. Социальные аккаунты и публикация

| Модель | Назначение |
|--------|-----------|
| `SocialAccount` | Аккаунт в соцсети: appId, platform, displayName, platformHandle (`@username`), credentials (зашифрованы), warmupStatus, postingMethod (`api` / `browser_automation`), proxyId, indigoProfileId, styleProfileId |
| `AccountGroup` | Группа аккаунтов (для bulk-операций) |
| `AccountStyleProfile` | Визуальный стиль (цвета, фильтры, эстетика) — для AI-генерации |
| `AccountStyleRevision` | История изменений стиля |
| `AccountMetricsSnapshot` | Снимок метрик аккаунта: followers, posts, engagement_rate, последние посты (idempotent 24h) |
| `Upload` | Публикация: videoId, accountId, platform, status, mediaUrl, externalPostId, scheduledAt |
| `SocialUploadAttempt` | Попытка публикации (для retry tracking) |
| `PostMetrics` | Метрики поста (views, likes, comments, shares, CTR) |
| `PostingJob` | Очередь автоматического постинга через browser_automation: accountId, videoId, captionId, status FSM, retry count, logs, screenshot |

### 7. Indigo (anti-detect браузеры)

| Модель | Назначение |
|--------|-----------|
| `IndigoProfile` | Профиль браузера: indigoProfileId (внешний), fingerprint config, cookies snapshot, sessionState, syncStatus |
| `IndigoProfileAccount` | Привязка профиля к аккаунту (M:N с primary флагом) |

### 8. Прокси

| Модель | Назначение |
|--------|-----------|
| `Proxy` | Прокси: host/port/username/password (зашифрованы), type (http/https/socks5), status, country, isResidential |
| `ProxyHealthCheck` | История проверок: latency_ms, success, error_code, IP geo |

### 9. Warmup (разогрев аккаунтов)

| Модель | Назначение |
|--------|-----------|
| `WarmupKeywordPool` | Пул ключевых слов: name, keywords[], category (general_en/ru, tech_en, lifestyle_en и т.д.) |
| `WarmupSession` | Сеанс разогрева: accountId, scheduledAt, status, plannedActions[], actualActions[] |

### 10. Конвейер (Pipeline)

| Модель | Назначение |
|--------|-----------|
| `Pipeline` | Конвейер: name, description, icon, color, markdownDescription, graphData (JSON), webhookToken, webhookSecret, schedule, sharedWith[], lastEditedAt |
| `PipelineVersion` | Версия конвейера (для rollback) |
| `PipelineSchedule` | Cron-расписание |
| `PipelineTag` | Тег (M:N с Pipeline) |
| `PipelineCredential` | Шифрованные креды для нод (Google Drive SA, HTTP API keys, OAuth) |
| `WorkflowRun` | Запуск pipeline'а: status, startedAt, completedAt, error info, statistics |
| `WorkflowStep` | Выполнение узла: nodeCanvasId, status, startedAt, completedAt, input, output, errorInfo |
| `WebhookLog` | Лог входящих webhook'ов: sourceIp, userAgent, payload, statusCode |

### 11. Аналитика

| Модель | Назначение |
|--------|-----------|
| `AnalyticsEvent` | Событие аналитики (опционально) |

### 12. Google Drive

| Модель | Назначение |
|--------|-----------|
| `DriveFile` | Файл из Drive: googleFileId, mimeType, name, status (detected/downloaded/imported/failed), localPath, importedVideoId, credentialId |

### 13. Telegram

| Модель | Назначение |
|--------|-----------|
| `TelegramChat` | Чат-получатель: chatId, name, routingTags[], isActive |
| `TelegramMessageTemplate` | Шаблон сообщения: name, body (с переменными `{{...}}`), platform, lang |
| `TelegramDelivery` | Лог доставок: chatId, templateId, status, response, errorMsg |
| `TelegramCommand` | Реакция на команду |
| `TelegramCommandAudit` | Аудит выполнения команд |
| `TelegramApiKey` | API-ключ бота (с rotation) |

### 14. Логирование и аудит

| Модель | Назначение |
|--------|-----------|
| `AgentLog` | Лог AI-агентов (entityType, entityId, level, message, payload) |
| `AiAuditLog` | Все AI-предложения: action, nodeType, model, prompt, suggestions, blockedFields, rejectedFields, appliedFields, status, costUsd |
| `SecretAccessLog` | Append-only: каждая расшифровка с reason |
| `WebhookLog` | Уже описан выше |

### 15. Прочее

| Модель | Назначение |
|--------|-----------|
| `ProductionCycle` | Цикл генерации контента: appId, groupId, status, startedById, статистика (trendsFound/scenariosGen/videosGen/uploadsCount) |
| `FavoritePrompt` | Лучшие промты с AI pattern-анализом (Kling pattern) |
| `ServiceBalanceEntry` | Ручные остатки: fal.ai, anthropic, indigo, nodemaven, mubert |
| `TaxonomyItem` | Словарь терминов: strategy, hook_style, prompt_pattern, pipeline_category, kling_pattern |
| `Reference` | Справочный образец (URL, расшифровка, анализ) |
| `ReferenceBreakdown` | Детальный анализ референса |

---

## Главные enum'ы

| Enum | Значения |
|------|----------|
| `RolePreset` | admin, producer, operator, analyst, observer |
| `Platform` | tiktok, youtube, instagram, telegram |
| `TrendStatus` | new, processing, ready, published, rejected |
| `AnalysisStatus` | pending, in_progress, completed, failed |
| `ScenarioStatus` | generating, ready, selected, rejected |
| `VariantStatus` | draft, ready |
| `VideoStatus` | pending, generating, completed, failed, timeout |
| `VideoStepStatus` | pending, in_progress, completed, partial, failed, no_data, timeout |
| `UploadStatus` | pending, scheduled, posting, published, failed |
| `PostingJobStatus` | pending, queued, posting, done, failed, cancelled |
| `PostingMethod` | api, browser_automation |
| `IndigoSessionState` | not_started, running, stopped, error |
| `IndigoSyncStatus` | synced, drift, archived, missing |
| `ProxyType` | http, https, socks5 |
| `ProxyStatus` | active, banned, slow, unknown |
| `WorkflowRunStatus` | pending, running, completed, failed, cancelled, no_data |
| `WorkflowStepStatus` | pending, running, completed, partial, failed, no_data |
| `CycleStatus` | pending, running, completed, failed, stopped |
| `WarmupStatus` | new, planned, in_progress, completed, paused |
| `IdeaStatus` | new, approved, rejected, synced |
| `IdeaSource` | chat, pipeline, manual |
| `IdeaSyncStatus` | local_only, synced, conflict |
| `IdeaSyncDirection` | from_mc, to_mc, both |
| `TaxonomyType` | strategy, hook_style, prompt_pattern, pipeline_category, kling_pattern |

---

## Связи (упрощённая ER-карта)

```
ZavodUser ─┬─ UserAppAssignment ─→ App
           ├─ ProductionCycle (startedBy)
           ├─ Pipeline (owner + sharedWith)
           ├─ FavoritePrompt
           ├─ AiAuditLog
           ├─ SecretAccessLog
           └─ DriveFile

App ─┬─ Trend ─┬─ TrendInsight
     │        ├─ CreativeBrief
     │        └─ Scenario ─┬─ ScenarioVariant ─┬─ ScenarioBlockRevision
     │                     │                   ├─ VisualStyleRevision
     │                     │                   └─ Video ─┬─ VideoAsset
     │                     │                             ├─ VideoGenerationStep
     │                     │                             ├─ VideoFrame
     │                     │                             ├─ VideoUniqueVariant
     │                     │                             ├─ Caption (per-platform)
     │                     │                             └─ Upload ─→ PostMetrics
     │                     ├─ CriticReview
     │                     ├─ ScenarioReviewAction
     │                     └─ ScenarioFeedback
     ├─ SocialAccount ─┬─ AccountGroup
     │                 ├─ AccountStyleProfile
     │                 ├─ AccountMetricsSnapshot
     │                 ├─ WarmupSession ─→ WarmupKeywordPool
     │                 ├─ PostingJob
     │                 ├─ IndigoProfileAccount ─→ IndigoProfile ─→ Proxy
     │                 └─ Proxy
     ├─ Idea ─┬─ IdeaAnalysis
     │       └─ IdeaOperatorAction
     ├─ TrendwatcherProfile ─→ TrendwatcherRun ─→ TrendwatcherRunLog
     └─ AppReferenceImage

Pipeline ─┬─ PipelineVersion
          ├─ PipelineSchedule
          ├─ PipelineTag (M:N)
          ├─ PipelineCredential ─→ DriveFile
          ├─ WebhookLog
          └─ WorkflowRun ─→ WorkflowStep
              ↳ создаёт: Scenario, Trend, Video, Upload, Idea, PostingJob

ProductionCycle ─→ AgentLog

Proxy ─→ ProxyHealthCheck

IndigoProfile ─→ IndigoProfileAccount (M:N с SocialAccount)

DriveFile ─→ Video (importedVideoId)

TelegramChat ─┬─ TelegramDelivery ─→ TelegramMessageTemplate
              └─ TelegramCommandAudit

ServiceBalanceEntry (standalone)
TaxonomyItem (standalone)
Reference ─→ ReferenceBreakdown
```

---

## Шифрование БД

**Алгоритм:** AES-256-GCM
**Файл:** `server/utils/crypto.ts`

**Функции:**
- `encrypt(text)` / `decrypt(cipher)` — низкоуровневые
- `encryptSecret(plain)` / `decryptSecret({ ... })` — с audit-log

**Формат:** `iv:authTag:ciphertext` (hex), IV=16 байт, tag=16 байт, key=32 байта (`ENCRYPTION_KEY`=64 hex)

**Зашифрованные поля:**
- `SocialAccount`: `accessToken`, `refreshToken`, `loginPassword`, `recoveryEmail`, `recoveryPhone`, `twoFASecret`
- `Proxy`: `host`, `username`, `password`
- `IndigoProfile`: `cookiesSnapshot`
- `PipelineCredential`: `encryptedData`
- Некоторые поля `DriveFile`

**Аудит:** Все расшифровки → `SecretAccessLog` (userId, entityType, entityId, action, clientIp, userAgent, reason).

---

## Миграции (89 на 2026-05-21)

Ключевые вехи в хронологии:

| Дата | Миграция | Содержимое |
|------|----------|-----------|
| 2026-03-31 | init_schema | Базовые: App, Trend, Scenario, TrendInsight, Video, VideoAsset, Upload, SocialAccount |
| 2026-03-31 | add_zavod_user, add_admin_models, add_telegram_chat, add_ideas | RBAC, admin, Telegram, Ideas |
| 2026-04-01 | add_pipeline, add_trendwatcher_profile, add_pipeline_schedule, add_webhook_token | Pipeline и Trendwatcher |
| 2026-04-06 | add_scenario_variants_and_review, ideas_module_v2 | Variants и MC-sync для Ideas |
| 2026-04-09 | pipeline_production_grade, add_pipeline_credentials, pipeline_hardening_webhook_secret | Pipeline hardening |
| 2026-04-10 | ai_audit_log, add_pipeline_context_to_ai_audit | AI audit-trail |
| 2026-04-15 | story_driven_scenario_pipeline, add_voiceover_runtime | Story-планирование + voiceover |
| 2026-04-16 | add_account_style_profile, add_idea_marketingcamp_sync | Account style, Idea sync |
| 2026-04-17 | add_video_subtitle_preset, add_pipeline_subtitle_style | Субтитры пресеты |
| 2026-04-23 | add_favorite_prompts, add_pipeline_run_tracking | FavoritePrompt + run tracking |
| 2026-04-25 | accounts_pipeline_integration, add_video_lip_sync | Lip-sync |
| 2026-04-29 | social_automation_foundation, add_proxy_protocol | Social automation v1 |
| 2026-04-30 | indigo_profile, posting_jobs | Indigo browser + PostingJob FSM |
| 2026-05-04 | warmup_models, add_video_unique_variants | Warmup planner, уникализация |
| 2026-05-06 | scenario_quality_critic, caption_generator, google_drive_integration | Critic + Caption + GDrive |
| 2026-05-07 | video_analysis_modernization | Video Analyzer Stage 2 |
| 2026-05-08 | extend_user_app_access_and_role_metadata, video_drive_upload_fields | RBAC v2 + Drive upload |
| 2026-05-13 | storage_gcs_migration | Storage на GCS |
| 2026-05-14 | balance_tracking | ServiceBalanceEntry |
| 2026-05-19 | add_indigo_profile_account | M:N Indigo↔Account |
| 2026-05-21 | account_manual_creation, add_social_posting_method, account_metrics_snapshot | Manual creation + posting method + Apify metrics |
| 2026-05-22 | add_login_check_and_posting_diagnostics | Login check diagnostics |

---

## Seed-скрипты

| Скрипт | Что делает |
|--------|-----------|
| `seed-warmup-keywords.ts` | Глобальные WarmupKeywordPool (general_en/ru, tech_en, lifestyle_en, fitness_en, education_en, music_en). Idempotent |
| `seed-caption-audit.ts` | Сид для visual audit Caption Generator. TRUNCATE + создание test-данных (ZavodUser, App, Trend, Scenario, 3 Caption, Pipeline) |
| `seed-drive-pipeline-template.ts` | Draft Pipeline `Drive Scanner → Video Analyzer → Caption Generator → Upload`. Additive (без truncate). Требует `userId` |
| `seed-drive-audit.ts` | Сид для visual audit Drive Auto-Caption. Создаёт ZavodUser, App, Trend, System-Scenario, PipelineCredential (mock SA с RSA), 3 DriveFile, Pipeline. TRUNCATE |
| `seed-admin-logs-demo.ts` | Demo-данные для /admin/logs visual testing. Создаёт записи в 8 log-таблиц. Additive. Проверяет test-БД |

**Запуск:** `bun run scripts/seed-warmup-keywords.ts` и аналогично.

---

## Известные особенности

1. **`prisma db push` ЗАПРЕЩЁН** (см. CLAUDE.md) — удаляет данные. Только `prisma migrate dev` / `prisma migrate deploy`.
2. **Generated client:** в репо коммитится `app/generated/prisma/` (типы) — для type-safety без runtime-импорта.
3. **BigInt counters:** YouTube/TikTok views достигают 10⁹+, используется BigInt. `bigint-serializer.ts` патчит `JSON.stringify`.
4. **GIN-индексы:** на `FavoritePrompt.tags`, `TaxonomyItem.tags` (для поиска по элементу массива).
5. **Composite unique:** `CriticReview(scenarioId, iteration)`, `TaxonomyItem(type, slug)`, `IndigoProfileAccount(indigoProfileId, socialAccountId)`.
