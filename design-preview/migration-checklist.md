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
| `+` | `scenarios/index.vue` | сортировки нет — API её не принимает |
| `+` | `ideas/index.vue` | форма добавления и панель синхронизации переписаны |
| `+` | `videos/index.vue` | факт стоимости, оценка только пока факта нет |
| `+` | `uploads/index.vue` | ошибка публикации подсказкой в строке |
| `—` | `accounts/index.vue` | колонки лимитов — см. макет 06 |
| `—` | `posting-jobs/index.vue` | |
| `+` | `characters/index.vue` | галерея, превью 4:3 |
| `+` | `scenes/index.vue` | галерея, превью собранного промпта |
| `+` | `creatives/index.vue` | карточки; три сущности в одном списке |
| `+` | `prompts-library/index.vue` | карточка промта, теги, подтверждение удаления |
| `+` | `proxies/index.vue` | зона выключена — пишем, какой флаг включает |
| `+` | `devices/index.vue` | зона выключена — пишем, какой флаг включает |
| `+` | `references/index.vue` | карточки |
| `+` | `google-drive/index.vue` | зона выключена; свои тосты заменены общими |
| `—` | `pipeline/index.vue` | |
| `—` | `admin/apps/index.vue` | |
| `—` | `admin/users/index.vue` | |
| `—` | `admin/cycles/index.vue` | |
| `—` | `admin/logs/index.vue` | виртуализация, `UiLogRow` |

## Детальные — по эталону `detail/`

| | Файл | Заметки |
| --- | --- | --- |
| `+` | `videos/[id].vue` | эталон; проверена на готовом, упавшем и идущем ролике |
| `+` | `trends/[id].vue` | статус и удаление в меню шапки, бриф табами |
| `+` | `scenarios/[id].vue` | варианты и критик; отчёт критика на живых данных не проверен — оценок в базе нет |
| `+` | `ideas/[id].vue` | пять вкладок, прогресс разбора референса |
| `+` | `characters/[id].vue` | фото в трёх состояниях разбора, ClientOnly из-за `server: false` |
| `—` | `scenes/[id].vue` | композитор сцен, 1800 строк в `scene/` |
| `+` | `uploads/[id].vue` | попытки публикации, выключенный постинг отдельной подачей |
| `—` | `devices/[id].vue` | унаследованный контур, ~2200 строк в `device/` |
| `—` | `admin/apps/[id].vue` | `AppForm` 702 строки |
| `+` | `admin/users/[id].vue` | права из MC только на просмотр |
| `+` | `admin/cycles/[id].vue` | логи на `UiLogRow` |
| `+` | `analytics/[uploadId].vue` | метрик в базе нет — история проверена только пустым состоянием |

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

Демо-данные для проверки глазами (только тестовая БД):

```
bun run scripts/seed-videos-demo.ts      # тренды → сценарии → ролики в трёх состояниях
bun run scripts/seed-accounts-demo.ts    # три аккаунта, один намеренно не готов публиковать
bun run scripts/seed-ideas-demo.ts       # идеи: разобранная, разбирающаяся, упавшая, с конфликтом синхронизации
bun run scripts/seed-uploads-demo.ts     # публикации: опубликована, упала с попытками, запланирована, заблокирована
bun run scripts/seed-characters-demo.ts  # персонажи с фото в трёх состояниях разбора
bun run scripts/seed-cycles-demo.ts      # циклы: завершённый с логами, идущий, упавший
```

Сиды рассчитаны на порядок: `seed-uploads-demo` берёт ролики и аккаунты из двух
первых, `seed-characters-demo` и `seed-cycles-demo` — приложение из базы.

Разделы `proxies`, `devices`, `google-drive` и `posting-jobs` относятся к
унаследованному контуру: без `LEGACY_*_ENABLED` их API отдаёт 404, и страницы
показывают «зона выключена». Это ожидаемое состояние, а не поломка.

**Кириллицу в теле запроса передавать файлом**, а не аргументом `-d`: оболочка на
Windows ломает её в U+FFFD, и получается ложный вывод о битой кодировке в приложении.
