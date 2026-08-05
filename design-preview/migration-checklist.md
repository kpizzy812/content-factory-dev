# Чек-лист переноса страниц

Ветка `feat/frontend-rebuild`. Паритет обязателен: ни одна страница не выпадает,
половина переписанного приложения не мержится.

Страница закрывается только после проверки **в реальном приложении**, а не в сборке
и не на витрине. Как получить сессию и открыть страницу — в конце файла.

Обозначения: `—` не начата · `~` переписана, не проверена · `+` проверена вживую

## Оболочка и общее

| | Файл | Эталон | Заметки |
| --- | --- | --- | --- |
| `+` | `app/layouts/default.vue` | AppShell | сайдбар, топбар, ⌘K |
| `+` | `app/layouts/auth.vue` | — | экран логина |
| `~` | `app/pages/auth/login.vue` | — | |

## Списки — по эталону `TrendListView`

| | Файл | Заметки |
| --- | --- | --- |
| `+` | `trends/index.vue` | эталон, проверен на живой базе (SSR); табы «Профили» и «Запуски» ещё на старых компонентах |
| `—` | `scenarios/index.vue` | |
| `—` | `ideas/index.vue` | |
| `—` | `videos/index.vue` | |
| `—` | `uploads/index.vue` | |
| `—` | `accounts/index.vue` | колонки лимитов — см. макет 06 |
| `—` | `posting-jobs/index.vue` | |
| `—` | `characters/index.vue` | |
| `—` | `scenes/index.vue` | |
| `—` | `creatives/index.vue` | режим карточек по умолчанию |
| `—` | `prompts-library/index.vue` | |
| `—` | `proxies/index.vue` | |
| `—` | `devices/index.vue` | |
| `—` | `references/index.vue` | режим карточек по умолчанию |
| `—` | `google-drive/index.vue` | |
| `—` | `pipeline/index.vue` | |
| `—` | `admin/apps/index.vue` | |
| `—` | `admin/users/index.vue` | |
| `—` | `admin/cycles/index.vue` | |
| `—` | `admin/logs/index.vue` | виртуализация, `UiLogRow` |

## Детальные — по эталону `detail/`

| | Файл | Заметки |
| --- | --- | --- |
| `—` | `videos/[id].vue` | эталон, 500 строк: прогресс, варианты, субтитры |
| `—` | `trends/[id].vue` | |
| `—` | `scenarios/[id].vue` | варианты и критик |
| `—` | `ideas/[id].vue` | |
| `—` | `characters/[id].vue` | |
| `—` | `scenes/[id].vue` | |
| `—` | `uploads/[id].vue` | |
| `—` | `devices/[id].vue` | |
| `—` | `admin/apps/[id].vue` | |
| `—` | `admin/users/[id].vue` | |
| `—` | `admin/cycles/[id].vue` | |
| `—` | `analytics/[uploadId].vue` | разбор публикации, макет 07 |

## Сложные экраны — этап 6, из своих макетов

| | Файл | Макет |
| --- | --- | --- |
| `—` | `index.vue` | 01-dashboard |
| `—` | `pipeline/[id]/index.vue` | 04-pipeline-editor |
| `—` | `pipeline/[id]/runs/index.vue` | 05-run-monitor |
| `—` | `pipeline/[id]/runs/[runId].vue` | 05-run-monitor |
| `—` | `analytics/index.vue` | 07-analytics |
| `—` | `settings.vue` | 08-settings-admin |
| `—` | `admin/index.vue` | 08-settings-admin |
| `—` | `admin/integrations/index.vue` | 08-settings-admin |
| `—` | `admin/balances.vue` | 08-settings-admin |
| `—` | `admin/telegram.vue` | 08-settings-admin |
| `—` | `admin/storage-health.vue` | 08-settings-admin |
| `—` | `admin/accounts-health.vue` | 06-accounts-queue |
| `—` | `admin/warmup-keywords.vue` | 08-settings-admin |

## Временные, удалить в этапе 7

- `app/pages/_ui.vue` — витрина дизайн-системы
- `app/pages/_shell.vue` — витрина оболочки
- исключение `/_` в `app/middleware/auth.global.ts`

## Блокеры

1. ~~База не поднята.~~ **Снят.** База на `localhost:5436` отвечает, миграция `20260806090000_add_saved_views` применена, таблица `SavedView` существует — проверено запросом к Postgres.
2. ~~`bun.lock` содержит `daisyui`.~~ **Снят.** Лок-файл очищен.
3. **E2E сломаны все** с этапа 0 — селекторы изменились. Чинятся в этапе 7, раньше ветку нечем проверять автоматически.

## Как проверять страницу вживую

Сессия без MC OAuth — через dev-эндпоинт, он работает только при `NODE_ENV != production`:

```
node node_modules/nuxt/bin/nuxt.mjs dev --host 127.0.0.1 --port 3214
curl -s -X POST http://127.0.0.1:3214/api/dev/set-session \
  -H "Content-Type: application/json" -d '{"userId":1}' -c cookies.txt
curl -s -b cookies.txt http://127.0.0.1:3214/trends
```

В базе один пользователь: `dev@contentfactory.local`, preset `admin`, все модули.
Данных почти нет, поэтому страницы показывают пустые состояния — это тоже проверка.

**Кириллицу в теле запроса передавать файлом**, а не аргументом `-d`: оболочка на
Windows ломает её в U+FFFD, и получается ложный вывод о битой кодировке в приложении.
