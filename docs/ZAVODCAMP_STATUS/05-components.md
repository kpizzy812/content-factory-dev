# 05. Компоненты

Всего **194 компонента** в 19 категориях. Все автоматически импортируются Nuxt — в шаблонах используются как `<TrendCard />` (PascalCase).

---

## shared/ — Универсальные (11)

| Компонент | Назначение |
|-----------|-----------|
| `EmptyState.vue` | Заглушка для пустых списков (иконка, заголовок, описание) |
| `Pagination.vue` | Постраничная навигация (номера, стрелки) |
| `AsyncSelect.vue` | Select с асинхронной загрузкой опций |
| `FieldHint.vue` | Подсказка для поля формы (tooltip) |
| `AiSuggestButton.vue` | Кнопка AI-подсказок в формах |
| `PageGuide.vue` | Встроенное руководство для страницы (коллапс) |
| `TaxonomyPicker.vue` | Выбор из таксономии (dropdown с иерархией) |
| `TaxonomyManager.vue` | Управление таксономией (add/edit/delete) |
| `TagInput.vue` | Ввод тегов с автодополнением |
| `TagPicker.vue` | Выбор тегов из списка |
| `RunPipelineFilterBadge.vue` | Badge фильтра по запуску/конвейеру |

---

## trend/ — Тренды (17)

| Компонент | Назначение |
|-----------|-----------|
| `TrendCard.vue` | Карточка тренда (миниатюра, заголовок, статус, платформа) |
| `TrendFilters.vue` | Фильтры: статус, платформа, поиск, язык, гео, хештеги |
| `TrendStatusBadge.vue` | Badge статуса (new, processing, ready, published, rejected) |
| `TrendPlatformBadge.vue` | Badge платформы (TikTok/Instagram Reels/YouTube/Telegram) |
| `TrendSourceBadge.vue` | Badge источника (Apify, manual import) |
| `TrendDetailSidebar.vue` | Сайдбар детали тренда |
| `TrendBriefCard.vue` | Творческий бриф |
| `TrendInsightCard.vue` | Карточка инсайта (legacy) |
| `TrendAiAnalyzeButton.vue` | Кнопка AI-анализа |
| `TrendMetrics.vue` | Метрики тренда |
| `AppSelector.vue` | Выбор приложения (платформы) |
| `ProfileCard.vue` | Карточка профиля парсинга Apify |
| `ProfileForm.vue` | Форма CRUD профиля парсинга |
| `ScheduleForm.vue` | Расписание (cron) |
| `RunHistory.vue` | История запусков парсинга |
| `RunDetail.vue` | Детали одного запуска |
| `TrendStatusActions.vue` | Действия со статусом (mark ready/rejected) |

---

## scenario/ — Сценарии (14)

| Компонент | Назначение |
|-----------|-----------|
| `ScenarioCard.vue` | Карточка сценария |
| `ScenarioFilters.vue` | Фильтры |
| `ScenarioStatusBadge.vue` | Badge статуса (generating/ready/selected/rejected) |
| `VariantStatusBadge.vue` | Badge статуса варианта |
| `ScenarioDetail.vue` | Полное отображение варианта (hook, body, CTA, стиль) |
| `ScenarioEditor.vue` | Редактор варианта |
| `ScenarioVariantTabs.vue` | Табы вариантов с оценкой critic |
| `ScenarioActions.vue` | Select/Reject/Edit/Regenerate |
| `ScenarioGenerateButton.vue` | Запуск генерации |
| `ScenarioCriticBadge.vue` | Badge AI-оценки |
| `ScenarioCriticReportModal.vue` | Детальный отчёт критика |
| `ScenarioFeedbackForm.vue` | Обратная связь продюсера |
| `ScenarioReviewHistory.vue` | История ревью |
| `ScenarioStoryPlan.vue` | План истории сценария |

---

## video/ — Видео (14)

| Компонент | Назначение |
|-----------|-----------|
| `VideoCard.vue` | Карточка видео |
| `VideoFilters.vue` | Фильтры |
| `VideoStatusBadge.vue` | Badge статуса |
| `VideoPlayer.vue` | HTML5 плеер |
| `VideoGenerateButton.vue` | Запуск генерации |
| `VideoActions.vue` | Скачать/Удалить/Пересоздать |
| `VideoProgress.vue` | Прогресс генерации (stage, %) |
| `VideoOutputConfig.vue` | Формат/разрешение/FPS/стиль |
| `VideoImageLightbox.vue` | Лайтбокс для превью |
| `VideoSubtitleEditor.vue` | Редактор субтитров (импорт/правка/стиль) |
| `VideoSubtitlePresetCard.vue` | Карточка пресета (шрифт/цвет/позиция) |
| `VideoSubtitlePresetPicker.vue` | Выбор пресета |
| `VideoAiVisualButton.vue` | AI-рекомендации стиля |
| `VideoUniqueVariantsSection.vue` | Уникализированные варианты per-platform |
| `VideoCaptionsSection.vue` | Управление подписями |

---

## idea/ — Идеи (11)

| Компонент | Назначение |
|-----------|-----------|
| `IdeaCard.vue` | Карточка идеи |
| `IdeaFilters.vue` | Фильтры |
| `IdeaStatusBadge.vue` | Badge статуса |
| `IdeaSourceBadge.vue` | Badge источника (chat/pipeline/manual) |
| `IdeaActions.vue` | Approve/Reject/Edit/Delete |
| `IdeaSubmitForm.vue` | Форма создания идеи |
| `IdeaAnalysis.vue` | AI-анализ идеи |
| `IdeaReferenceAnalysis.vue` | Сравнение с референсами |
| `IdeaReferenceProgress.vue` | Прогресс reference-сравнения |
| `IdeaSyncInfo.vue` | Информация о синке с MC |
| `IdeaSyncToolbar.vue` | Toolbar синхронизации |

---

## pipeline/ — Конвейер (27)

| Компонент | Назначение |
|-----------|-----------|
| `PipelineCard.vue` | Карточка конвейера (название, иконка, тег) |
| `PipelineCanvas.vue` | Визуальный редактор (@vue-flow): узлы, рёбра, drag-n-drop |
| `PipelineNode.vue` | Базовый узел |
| `PipelineNoteNode.vue` | Узел-заметка |
| `PipelineStatusBadge.vue` | Badge статуса (active/inactive) |
| `PipelineToolbar.vue` | Toolbar: save, undo/redo, add node |
| `PipelineRightPanel.vue` | Правая панель: конфиг узла, тест |
| `PipelineSidebar.vue` | Левая панель: каталог узлов |
| `PipelineNodeSettings.vue` | Настройки узла |
| `PipelineNodeConfigForm.vue` | Форма конфига по типу |
| `PipelineNodeTestPanel.vue` | Тестирование узла |
| `PipelineNodeLastRun.vue` | Последний запуск узла |
| `PipelineAiAuditLog.vue` | AI-аудит конвейера |
| `PipelineAiAutofill.vue` | AI-автозаполнение |
| `PipelineCreateModal.vue` | Создание (название, иконка, цвет) |
| `PipelineDeleteConfirmModal.vue` | Подтверждение удаления |
| `PipelineUnsavedModal.vue` | Несохранённые изменения |
| `PipelineWebhookModal.vue` | Управление webhook'ом |
| `PipelineScheduleModal.vue` | Расписание (cron) |
| `PipelineVersionsModal.vue` | История версий + rollback |
| `PipelineImportModal.vue` | Импорт из JSON/YAML |
| `PipelinePresetsModal.vue` | Пресеты конвейеров |
| `PipelinePreviewModal.vue` | Превью перед сохранением |
| `PipelineRunCard.vue` | Карточка исполнения |
| `PipelineRunsModal.vue` | История исполнений |
| `PipelineRunStats.vue` | Статистика (success rate, avg time) |
| `PipelineTagPicker.vue` | Выбор тегов |

### pipeline/config/ — Конфигураторы узлов

| Конфиг | Узел |
|--------|------|
| `HttpRequestConfig.vue` | HTTP-вызов внешнего API |
| `CodeConfig.vue` | Sandboxed JS-код |
| `IfConfig.vue` | Условие |
| `LoopConfig.vue` | Цикл |
| `WaitConfig.vue` | Задержка |
| `FilterConfig.vue` | Фильтрация коллекции |
| `SetConfig.vue` | Установка переменных |
| `AnalyticsConfig.vue` | Сбор аналитики |
| `SubPipelineConfig.vue` | Вызов другого pipeline |
| `IdeaConfig.vue` | Создание идеи |
| `ScenarioAppSelector.vue` | Выбор приложения для сценария |

---

## upload/ — Социальные загрузки (7)

| Компонент | Назначение |
|-----------|-----------|
| `UploadCard.vue` | Карточка загрузки |
| `UploadFilters.vue` | Фильтры |
| `UploadStatusBadge.vue` | Badge статуса (pending/published/failed/scheduled) |
| `UploadActions.vue` | Опубликовать/Отменить/Edit |
| `UploadCreateModal.vue` | Создание (выбор видео, платформы) |
| `UploadMetaForm.vue` | Заголовок/описание/хештеги |
| `UploadModuleBanner.vue` | Баннер статуса модуля |

---

## analytics/ — Аналитика (7)

| Компонент | Назначение |
|-----------|-----------|
| `AnalyticsFilters.vue` | Фильтры (статус, аккаунт, период, сортировка) |
| `DashboardStats.vue` | Общие метрики (views, likes, shares) |
| `MetricsHistory.vue` | Линейный график истории |
| `PostsTable.vue` | Таблица постов с sortable колонками |
| `TopCtrList.vue` | Топ постов по CTR |
| `AnalyzeButton.vue` | Запуск анализа |
| `CollectButton.vue` | Сбор метрик (webhook к API соцсети) |

---

## account/ — Аккаунты (22)

| Компонент | Назначение |
|-----------|-----------|
| `AccountCard.vue` | Карточка аккаунта (платформа, ник, аватар, статус) |
| `AccountConnectButton.vue` | Подключение через OAuth |
| `AccountCreateModal.vue` | Создание вручную (multi-step wizard) |
| `AccountEditModal.vue` | Редактирование |
| `AccountGroupCard.vue` | Карточка группы |
| `AccountGroupEditModal.vue` | Редактирование группы |
| `AccountDiagnosticPanel.vue` | Диагностика (последняя ошибка, статус API) |
| `AccountLoginStatusBadge.vue` | Статус входа (online/offline/suspicious) |
| `AccountLoginCheckButton.vue` | Кнопка проверки входа |
| `AccountLoginInstructionsBlock.vue` | Инструкции по ручному входу (для 2FA) |
| `AccountCredentialsForm.vue` | Форма учётных данных (login, password, recovery email) |
| `AccountCredentialRevealModal.vue` | Раскрытие учётных данных (с reason) |
| `AccountMetricsTab.vue` | Таб метрик (followers, engagement rate) |
| `AccountMetricsStatCards.vue` | Карточки со статами |
| `AccountMetricsSparkline.vue` | Mini-графики динамики |
| `AccountMetricsPostsList.vue` | Список постов аккаунта |
| `AccountWarmupTab.vue` | Таб warmup (статус, история) |
| `AccountProxyPicker.vue` | Выбор прокси |
| `AccountPicker.vue` | Селектор аккаунта (для фильтров) |
| `AccountStyleProfileEditor.vue` | Редактор стиль-профиля Indigo |
| `AccountStyleStatusBadge.vue` | Badge статуса стиля |
| `AccountIndigoTab.vue` | Таб управления Indigo для аккаунта |

---

## admin/ — Администрирование (21)

| Компонент | Назначение |
|-----------|-----------|
| `DashboardStatusCard.vue` | Статус системы (uptime, modules) |
| `DashboardVideoStats.vue` | Статистика видео |
| `DashboardAlerts.vue` | Неразрешённые ошибки |
| `DashboardRecentCycles.vue` | Последние циклы |
| `UserCard.vue` | Карточка пользователя |
| `UserRoleEditor.vue` | Редактор роли (read-only из MC, только isActive) |
| `AppCard.vue` | Карточка приложения |
| `AppForm.vue` | CRUD приложения |
| `AppDeleteConfirmModal.vue` | Подтверждение удаления |
| `AppReferenceImagesManager.vue` | Менеджер справочных изображений |
| `AppReferenceImagesModal.vue` | Upload/delete/crop |
| `CycleCard.vue` | Карточка цикла |
| `CycleStartModal.vue` | Запуск нового цикла |
| `LogEntry.vue` | Одна запись лога |
| `LogFilters.vue` | Фильтры логов |
| `AccountsHealthSummary.vue` | Сводка здоровья по платформам |
| `AccountsHealthTable.vue` | Детальная таблица |
| `AccountsHealthByPlatform.vue` | Распределение по платформам |
| `AccountCompletenessBar.vue` | Bar полноты профиля |
| `IndigoOrphanCleanupSection.vue` | Очистка orphan-профилей |

### admin/telegram/ — Telegram-бот (6)

| Компонент | Назначение |
|-----------|-----------|
| `Overview.vue` | Обзор Telegram-интеграции |
| `Diagnostics.vue` | Диагностика бота |
| `Chats.vue` | Управление чатами |
| `Templates.vue` | Шаблоны сообщений |
| `Deliveries.vue` | Доставленные сообщения |
| `Audit.vue` | Аудит команд |
| `ApiKeys.vue` | API-ключи |

---

## indigo/ — Браузер (12)

| Компонент | Назначение |
|-----------|-----------|
| `IndigoProfileCard.vue` | Карточка профиля браузера |
| `IndigoProfileEditModal.vue` | Редактирование (прокси, fingerprint) |
| `IndigoProfileLinkModal.vue` | Привязка к аккаунту |
| `IndigoSessionStatusBadge.vue` | Статус сеанса (running/idle/error) |
| `IndigoSyncStatusBadge.vue` | Статус синхронизации |
| `IndigoFingerprintSection.vue` | Browser fingerprints (UA, Canvas) |
| `IndigoTestResultModal.vue` | Результаты теста профиля |
| `IndigoCredentialsModal.vue` | Учётные данные Indigo API |
| `IndigoDevicePresetSelector.vue` | Preset устройства (iPhone/Desktop/Android) |
| `IndigoStartProgressStepper.vue` | Stepper запуска сеанса |
| `IndigoSanityPanel.vue` | Health check |
| `IndigoLauncherFallbackModal.vue` | Fallback если не удалось запустить |

---

## proxy/ — Прокси (6)

| Компонент | Назначение |
|-----------|-----------|
| `ProxyCard.vue` | Карточка прокси (адрес, порт, ping) |
| `ProxyHealthBadge.vue` | Здоровье (ok/slow/down) |
| `ProxyAddModal.vue` | Добавление |
| `ProxyCheckHistoryModal.vue` | История пингов |
| `ProxyRevealCredentialsModal.vue` | Раскрытие пароля |
| `ProxyDiagnoseModal.vue` | Диагностика (прямой пинг, тест через API) |

---

## warmup/ — Разогрев (6)

| Компонент | Назначение |
|-----------|-----------|
| `WarmupSessionCard.vue` | Карточка сеанса разогрева |
| `WarmupSessionStatusBadge.vue` | Статус сеанса |
| `WarmupKeywordPoolCard.vue` | Пул ключевых слов |
| `WarmupKeywordPoolEditor.vue` | Редактор пула |
| `WarmupPlanPreviewModal.vue` | Превью плана |
| `WarmupActionList.vue` | Лист действий (follow/like/comment) |

---

## posting/ — Постинг (5)

| Компонент | Назначение |
|-----------|-----------|
| `PostingJobCard.vue` | Карточка задачи |
| `PostingJobStatusBadge.vue` | Статус (pending/queued/posting/done/failed) |
| `PostingJobLogsModal.vue` | Логи публикации |
| `PostingJobRetryConfirm.vue` | Подтверждение retry |
| `PostingJobCancelModal.vue` | Отмена |

---

## favorite-prompt/ — Промты (4)

| Компонент | Назначение |
|-----------|-----------|
| `FavoritePromptCard.vue` | Карточка промта (текст, категория, рейтинг) |
| `FavoritePromptModal.vue` | Редактирование |
| `FavoritePromptButton.vue` | Добавить в избранное |
| `FavoritePromptFilters.vue` | Фильтры (категория, рейтинг, поиск) |

---

## google-drive/ — GDrive (7)

Регистрируется без префикса (`Drive*` компоненты).

| Компонент | Назначение |
|-----------|-----------|
| `DriveCredentialsSection.vue` | Управление credentials |
| `DriveCredentialCard.vue` | Карточка credential (email, статус) |
| `DriveBrowserSection.vue` | Браузер папок/файлов |
| `DriveFileRow.vue` | Строка файла |
| `DriveFolderPicker.vue` | Выбор папки для синка |
| `DriveImportToVideoModal.vue` | Импорт файла в видео |
| `ServiceAccountSetupModal.vue` | Инструкции setup Service Account |

---

## creative/ — Креативы (2)

| Компонент | Назначение |
|-----------|-----------|
| `CreativeCard.vue` | Карточка креатива |
| `CreativeFilters.vue` | Фильтры (тип/источник/статус) |

---

## reference/ — Справочники (1)

| Компонент | Назначение |
|-----------|-----------|
| `ReferenceCard.vue` | Карточка образца для вдохновения |

---

## settings/ — Настройки (1)

| Компонент | Назначение |
|-----------|-----------|
| `IntegrationCard.vue` | Карточка интеграции на странице настроек |

---

## Конвенции компонентов

- **Только `<script setup lang="ts">`** + Composition API
- **DaisyUI 5** компоненты перед самописными (btn, card, modal, drawer, table, ...)
- **Tailwind 4 утилиты** для customization; кастомный CSS — только если объективно недостижимо
- **Семантические цвета** DaisyUI (`bg-primary`, `text-base-content/70`) — никаких хардкод-цветов
- **Иконки** через `<Icon name="mingcute:..." />` от `@nuxt/icon` + `@iconify-json/mingcute`
- **Auto-animate** для списков (`v-auto-animate`)
- **VueUse Motion** для переходов
- **Props down, events up** — стандартный Vue data flow
- **Локальный стейт** в `ref/reactive`; глобальный — в Pinia stores
- **Шаблоны иммутабельны** в SSR — никаких `window` без `import.meta.client`
