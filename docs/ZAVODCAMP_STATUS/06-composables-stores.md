# 06. Composables, Stores, Middleware, Plugins

## Composables (85)

Все composables в `app/composables/` автоматически импортируются. Большинство — обёртки `useFetch`/`$fetch` с reactive query, watch, key для кеширования.

### Тренды и парсинг

| Composable | Назначение |
|-----------|-----------|
| `useTrends` | Загрузка списка трендов с фильтрами (status, platform, search, hashtags, geo, language, viewCountMin/Max, analysisStatus, page, sort) |
| `useTrendDetail` | Детали тренда, refresh при изменении ID |
| `useTrendStats` | Статистика (total, recent count за 24h) |
| `useTrendwatcherProfiles` | CRUD профилей Apify (create, update, delete, run) |
| `useTrendwatcherRuns` | История запусков парсинга + polling активных |
| `useCreatives` | Каталог креативов |

### Сценарии и идеи

| Composable | Назначение |
|-----------|-----------|
| `useScenarios` | Список сценариев (с фильтром по тренду) |
| `useScenarioDetail` | Детали + варианты + AI-критика |
| `useScenarioActions` | Select, reject, regenerate |
| `useGenerateScenarios` | Запуск генерации вариантов |
| `useIdeas` | Список идей |
| `useIdeaDetail` | Детали + анализ |
| `useIdeaActions` | Approve, reject |
| `useIdeaSync` | Синхронизация с MarketingCamp (external sync) |
| `useFavoritePrompts` | Лучшие промты |
| `useFavoritePromptDetail` | Один промт с AI-pattern анализом |
| `useFavoritePromptActions` | Save, delete, rate, reanalyze |

### Видео

| Composable | Назначение |
|-----------|-----------|
| `useVideos` | Список видео (фильтр по сценарию/формату) |
| `useVideoDetail` | Детали + ассеты + промты |
| `useVideoActions` | Скачать, удалить, пересоздать |
| `useVideoProgress` | Polling прогресса генерации (stage, %) |
| `useVideoPlayback` | Управление проигрыванием |
| `useVideoVariants` | Уникальные варианты per-platform |
| `useVideoVariantActions` | Действия над вариантами |
| `useSubtitlePresets` | 10 пресетов субтитров (Opus.pro style) |
| `useVideoStorageStatus` | Статус GCS хранилища, очистка, recover |

### Загрузки и постинг

| Composable | Назначение |
|-----------|-----------|
| `useUploads` | Список загрузок |
| `useUploadDetail` | Детали + статус на каждой платформе |
| `useUploadActions` | Опубликовать, отменить, retry |
| `useUploadModuleStatus` | Статус модуля (ENABLE_SOCIAL_POSTING) |
| `usePostingJobs` | Очередь постинга |
| `usePostingJobActions` | Retry, cancel, view logs |

### Аккаунты

| Composable | Назначение |
|-----------|-----------|
| `useAccounts` | Список соц-аккаунтов (фильтр по app/platform) |
| `useAccountGroups` | Группы аккаунтов |
| `useAccountActions` | OAuth подключение/отключение |
| `useAccountCredentials` | Сохранение/raw reveal учётных данных |
| `useAccountMetrics` | Метрики (followers, engagement rate, post stats) |
| `useAccountsHealth` | Дашборд здоровья (/admin) |
| `useLoginCheck` | Проверка статуса входа |
| `useTotp` | 2FA-коды (генерация/верификация) |

### Аналитика

| Composable | Назначение |
|-----------|-----------|
| `useAnalyticsDashboard` | Сводка: views, engagement, CTR |
| `useAnalyticsPosts` | Таблица постов (sortable) |
| `useAnalyticsDetail` | Метрики конкретной загрузки (история) |
| `useAnalyticsActions` | Запуск сбора метрик |

### Конвейер

| Composable | Назначение |
|-----------|-----------|
| `usePipelines` | Список конвейеров |
| `usePipelineDetail` | Детали (граф, конфигурация) |
| `usePipelineActions` | Save, delete, version control |
| `usePipelineRuns` | История исполнений |
| `usePipelineRunDetail` | Детали запуска (логи узлов) |
| `usePipelineMonitor` | Панель мониторинга (каталог + история) |
| `usePipelineMonitorUrlSync` | URL ↔ state синхронизация |
| `useRunPipelineFilter` | Фильтр по запуску/конвейеру в URL |

### Indigo и инфраструктура

| Composable | Назначение |
|-----------|-----------|
| `useIndigoProfiles` | CRUD профилей |
| `useIndigoActions` | Sync с workspace, cleanup duplicates |
| `useIndigoStartFlow` | Запуск сеанса (stepper) |
| `useProxies` | Список прокси |
| `useProxyActions` | Health checks, диагностика |
| `useWarmupSessions` | История сеансов разогрева |
| `useWarmupKeywords` | Пулы ключевых слов |
| `useWarmupActions` | Запуск плана warmup |

### Администрирование

| Composable | Назначение |
|-----------|-----------|
| `useAdminDashboard` | Дашборд админа |
| `useAdminApps` | Приложения |
| `useAdminUsers` | Пользователи |
| `useAdminCycles` | Циклы генерации |
| `useAdminLogs` | Унифицированная лента (8 источников) |
| `useAdminTelegram` | Telegram-бот |
| `useAdminBalances` | Остатки сервисов |
| `useRbacConfig` | Конфигурация RBAC |
| `usePermissions` | `can()`, `canAccessModule()` для UI |

### Интеграции

| Composable | Назначение |
|-----------|-----------|
| `useGoogleDrive` | Drive credentials, files, sync |
| `useAppReferenceImages` | Справочные изображения приложения |
| `useAppEnrich` | Обогащение метаданных приложения |
| `useIntegrationStatus` | Статус Indigo/AI/прокси |

### Общие

| Composable | Назначение |
|-----------|-----------|
| `useTaxonomy` | Таксономии по типу (категории, метки) |
| `useReferences` | Справочные образцы |
| `useMarkdownSafe` | Безопасный markdown-рендеринг |
| `useAiSuggest` | AI-саджесты для полей форм |

---

## Stores (Pinia) — 16

Stores в `app/stores/`. Все — фильтры списков или UI-стейт. Паттерн: `computed query` → `resetPage()` → `watch` на URL-sync.

| Store | Stateful поля | Использование |
|-------|---------------|----------------|
| `trendFilters` | status, platform, search, hashtags, geo, language, viewCountMin/Max, analysisStatus, page, sort | `/trends` |
| `scenarioFilters` | status, trendId, page, perPage | `/scenarios` |
| `videoFilters` | status, scenarioId, format, page, perPage | `/videos` |
| `uploadFilters` | status, platform, search, page, perPage | `/uploads` |
| `ideaFilters` | status, trendId, page, perPage | `/ideas` |
| `creativeFilters` | type, source, status, page, perPage | `/creatives` |
| `analyticsFilters` | socialAccountId, platform, sort field, page | `/analytics` |
| `favoritePromptFilters` | search, category, page, perPage | `/prompts-library` |
| `pipelineMonitor` | viewMode (catalog/monitor), catalogPage, filters; localStorage hydration | `/pipeline` |
| `pipelineEditor` | pipelineId, name, nodes[], edges[], webhookToken, isDirty; **undo/redo история до 50 снапшотов** | `/pipeline/[id]` |
| `proxyFilters` | search, status, page | `/proxies` |
| `indigoFilters` | search, status | `/indigo` |
| `postingJobFilters` | status, platform, page | `/posting-jobs` |
| `warmupFilters` | status, accountId, page | `/admin/warmup-keywords` |
| `adminFilters` | level, module, resolved | `/admin/logs` |
| `aiCache` | результаты саджестов, анализов (в памяти) | глобально |

---

## Middleware (3)

### Глобальный

**`auth.global.ts`** — auth guard. Whitelist: `/auth/login`, `/auth/callback`. При отсутствии сессии — `navigateTo('/auth/login')` с redirect-параметром.

### Именованные

**`module-access.ts`** — проверяет наличие модуля в `moduleAccess`:

```ts
definePageMeta({
  middleware: 'module-access',
  moduleSlug: 'pipeline'
})
```

Fail-open на клиенте — серверный RBAC всё равно поймает.

**`admin-access.ts`** — проверяет `can('canAdmin')`. Применяется к `/admin/*`.

```ts
definePageMeta({ middleware: 'admin-access' })
```

---

## Plugins (1)

**`auth-redirect.client.ts`** — client-only. Перехватывает 401-ответы от `$fetch`:

```ts
export default defineNuxtPlugin(() => {
  $fetch.create({
    onResponseError({ response }) {
      if (response.status === 401) {
        clearUserSession()
        navigateTo('/auth/login')
      }
    }
  })
})
```

Решает проблему "stale session" — при логине в другом браузере текущий клиент автоматически выходит.

---

## Type-safety паттерны

### useFetch с типами

```ts
const { data, refresh, status } = await useFetch<{ data: Trend[] }>(
  '/api/trends',
  { query: computed(() => ({ ...filters.query })) }
)
```

### Pinia с TS

```ts
export const useTrendFiltersStore = defineStore('trendFilters', () => {
  const status = ref<TrendStatus | null>(null)
  const query = computed(() => omitEmpty({ status: status.value }))
  return { status, query, reset() { status.value = null } }
})
```

### Composable + shared type

```ts
import type { Trend } from '~~/shared/types/trend'
export function useTrendDetail(id: MaybeRefOrGetter<number>) {
  return useFetch<{ data: Trend }>(() => `/api/trends/${toValue(id)}`)
}
```

---

## Auto-imports

- **Composables**: `useTrends()` без import
- **Components**: `<TrendCard />` без import
- **Stores**: `useTrendFiltersStore()` без import
- **Vue API**: `ref`, `computed`, `watch`, `onMounted` — без import
- **Nuxt utils**: `$fetch`, `useFetch`, `useRoute`, `useRouter`, `navigateTo`, `definePageMeta` — без import
- **Server utils** (только в `server/`): `prisma`, `getAuthContext`, `requirePermission` — без import (из `server/utils/`)

Shared types из `shared/types/` импортируются явно через `import type`.
