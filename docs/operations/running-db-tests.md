# Прогон тестов с базой данных

DB-free сьюта (`vitest.pure.config.ts`) запускается где угодно. Сьюты `tests/unit`, `tests/integration` и `tests/api` требуют Postgres и Bun: `tests/global-setup.ts` вызывает `bunx prisma migrate deploy`.

Если Bun на машине нет, ставить его не нужно — весь прогон делается в контейнере.

## Рецепт

Поднять тестовую базу. Порт именно 5436: `tests/global-setup.ts` отказывается работать с `DATABASE_URL`, в котором нет `:5436/` и подстроки `tests` — это защита от прогона по рабочей базе.

```bash
docker run -d --name cf-tests-pg \
  -e POSTGRES_USER=contentfactory_tests \
  -e POSTGRES_PASSWORD=contentfactory_tests_password \
  -e POSTGRES_DB=contentfactory_tests_db \
  -p 5436:5432 postgres:16-alpine
```

Прогнать сьюту. `node_modules` живёт в именованном томе, потому что зависимости с Windows-хоста собраны под другую платформу:

```bash
docker run --rm \
  -v "$PWD:/app" -v cf-node-modules:/app/node_modules -w /app \
  -e DATABASE_URL="postgresql://contentfactory_tests:contentfactory_tests_password@host.docker.internal:5436/contentfactory_tests_db" \
  --add-host=host.docker.internal:host-gateway \
  oven/bun:1 bash -c "bun install --frozen-lockfile && bunx vitest run tests/unit --pool=forks --poolOptions.forks.singleFork"
```

## Обязательные детали

**`--pool=forks`.** На дефолтном thread-пуле vitest падает под Bun с `TypeError: port.addListener is not a function` — tinypool рассчитывает на `worker_threads` Node. Форки работают.

**`--poolOptions.forks.singleFork`.** `tests/setup.ts` делает `TRUNCATE` всей public-схемы между тестами, поэтому параллелить нельзя. По той же причине нельзя гонять две сьюты одновременно против одной базы.

**`bunx nuxt prepare` для свежего checkout.** Без `.nuxt/tsconfig.node.json` vite падает на загрузке global-setup с `ENOENT`.

**Время.** Полный `tests/unit` на bind-маунте Windows идёт около 31 минуты. Отдельные файлы — считанные минуты. Запускать в фоне.

## Унаследованные падения

На 30 июля 2026 года `tests/unit` даёт 981 проход из 1046 и 62 падения в десяти файлах:

| Файл | Падений |
| --- | --- |
| `pipeline-executors/caption-generator` | 12 |
| `posting-fsm-observer` | 11 |
| `video-fetcher` | 10 |
| `posting-fsm-retry` | 9 |
| `duoplus-sync` | 7 |
| `pipeline-drive-uploader` | 6 |
| `pipeline-executors/upload-node-posting-method` | 2 |
| `duoplus-fsm-integration` | 2 |
| `proxy/fetch-json-through-agent` | 2 |
| `posting-one-to-one-guard` | 1 |

Эти же десять файлов дают **ровно те же числа** на коммите `904bb25`, то есть до порта автономной фабрики. Сьюта приехала красной вместе с копией кодовой базы VideoCamp и здесь не запускалась ни разу. Ни порт фабрики, ни отключение унаследованного контура, ни собственная авторизация их не ломали.

Все десять файлов покрывают выключенную зону: DuoPlus, FSM постинга, прокси, Google Drive, video-fetcher. Чинить их до подтверждённой замены смысла нет — по `docs/superpowers/specs/2026-07-22-content-factory-design.md` §13 шаг 10 этот код удаляется после успешного Meta canary, и тесты уйдут вместе с ним. Смотри `docs/operations/legacy-contour.md`.

**Правило:** прежде чем чинить падение из этой таблицы, проверьте его на `904bb25`. Если падает и там — это унаследованный долг, а не регрессия текущей работы.

> **Таблица устарела — проверено 07.08.2026.** Полный прогон `bun run test:unit` на ветке `feat/frontend-rebuild` дал **110 файлов и 1198 тестов зелёными**; единственное падение — `use-account-readiness` с `deadlock detected` на `TRUNCATE` в `tests/setup.ts`, то есть гонка за тестовую базу с параллельным прогоном, а не логика. Ни один из десяти файлов таблицы не воспроизвёл заявленные падения. Правило про `904bb25` оставлено на случай, если долг всплывёт снова, но исходить из «сьюта приехала красной» больше нельзя: красное падение сегодня — это регрессия, пока не доказано обратное.
>
> **Не запускайте корневой `bun run test`.** Он поднимает `tests/unit`, `tests/integration` и `tests/api` одним прогоном, и это падает целиком: 211 файлов за семь секунд с внутренней ошибкой Vitest «failed to find the current suite» в `tests/setup.ts`. Причина та же, о которой предупреждает раздел выше — сьюты делят одну базу и один `beforeAll`, а `tests/api` вдобавок поднимает Nuxt через `@nuxt/test-utils/e2e`. Гоняйте раздельно: `test:unit`, потом `test:api`, потом `test:integration`.
>
> Про прогон вне контейнера: `bunx vitest run` работает и на Windows-хосте с базой в контейнере. Полная сьюта идёт около 50 минут, поэтому между правками дешевле гонять целевой набор по изменённым модулям — например `bunx vitest run tests/unit/balance-cost-ledger.spec.ts tests/unit/content-factory-batch.spec.ts tests/unit/pipeline-executors` укладывается в полторы минуты. И учтите: `vitest` отдаёт вывод целиком в конце, поэтому `... | tail -N` в фоне держит файл пустым до самого финиша — прогресс так не посмотреть.

## Сравнение с базовой точкой

```bash
git worktree add ../cf-baseline 904bb25
# дальше тот же docker run, но -v "../cf-baseline:/app",
# и первым шагом bunx nuxt prepare
```

Полезно для любого падения, происхождение которого неочевидно. По окончании: `git worktree remove ../cf-baseline`.
