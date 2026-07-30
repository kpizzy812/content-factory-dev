# ContentFactory project rules

## Communication

- Общаться на русском языке, если пользователь явно не попросил иначе.
- Писать прямо и кратко, без корпоративных формулировок.

## Product boundaries

- ContentFactory - универсальный продукт. Не добавлять названия и бизнес-логику конкретного клиента в доменные модели.
- Клиентские сервисы подключать только через порты и адаптеры.
- Replicate - обязательный основной провайдер медиа-моделей. fal.ai допускается только как явно настроенный fallback.
- Публикация в социальные сети выполняется только через официальные API.
- Не добавлять ADB, облачные телефоны, антидетект, приватные Instagram API, фермы аккаунтов и обходы лимитов.
- Tracking token должен сохраняться на всем пути от гипотезы до conversion sink.

## Sources of truth

- Согласованный контекст: `docs/PROJECT_CONTEXT.md`.
- Архитектура: `docs/superpowers/specs/2026-07-22-content-factory-design.md`.
- Дизайн-флоу: `docs/superpowers/specs/2026-07-22-global-design-feature-skill-design.md`.
- Старые документы и код VideoCamp/ZavodCamp являются исторической справкой и не переопределяют новые решения.

## Commands

| Command | Purpose |
| --- | --- |
| `bun install --frozen-lockfile` | Установить зависимости из `bun.lock`. |
| `bun run dev` | Запустить Nuxt dev server. |
| `bun run build` | Собрать production bundle. |
| `bun run test` | Запустить все Vitest suites. |
| `bun run test:unit` | Запустить unit tests. |
| `bun run test:integration` | Запустить integration tests с Nuxt/Nitro. |
| `bun run test:api` | Запустить HTTP contract tests. |
| `bun run test:e2e:install` | Установить Chromium для Playwright. |
| `bun run test:e2e` | Запустить Playwright E2E на порту 3100. |

Bun должен быть доступен в `PATH`; если его нет, не устанавливать его и не переходить на npm без разрешения.
В проекте нет отдельной lint-команды. Не подменять проверку случайным formatter или чужим package manager.

## Architecture

- `app/pages`, `app/components`, `app/stores` - Nuxt UI, переиспользуемые компоненты и клиентское состояние.
- `server/api` - Nitro HTTP endpoints; endpoint должен делегировать доменную работу, а не содержать длинный pipeline inline.
- `server/utils` - текущие pipeline, провайдеры и инфраструктура; при расширении сохранять узкие модульные границы вместо роста файлов-монстров.
- `server/plugins` - startup workers, schedulers, recovery и storage initialization.
- `server/automation` - унаследованная device-automation зона; не расширять её способами, запрещёнными в Product boundaries.
- `shared/types`, `shared/schemas`, `shared/utils` - контракты и чистая логика, общие для UI и server.
- `prisma/schema.prisma`, `prisma/migrations` - схема и единственный допустимый путь изменения БД.
- `tests/{unit,integration,api,e2e}` - тесты по уровням; общая настройка лежит в `tests/setup.ts` и `tests/global-setup.ts`.
- `design-preview` - изолированные дизайн-артефакты `$design-feature`; это не продуктовый runtime-код.

## UI design workflow

- Перед новой страницей, разделом, workflow или существенным UX-редизайном запускать глобальный `$design-feature`.
- Порядок обязателен: ImageGen-референсы, интерактивный HTML-макет, Playwright на desktop/tablet/mobile, четыре независимых критика, итерационные исправления, `implementation-spec.md`.
- Дизайн-задача пишет только в `design-preview/` и завершается после зелёного E2E и критериев ревью. Не подключать макет к `app/`, API или БД в той же задаче.
- Интеграция в продукт выполняется отдельной задачей по `implementation-spec.md` с повторной проверкой реального приложения.
- Если существует `design-preview/_system`, сначала читать его map, glossary, components и tokens; обновлять систему вместе с новым разделом.
- Если `$design-feature` недоступен, сообщить об этом явно, а не молча пропускать дизайн-флоу.

## Engineering

- Использовать Bun, не npm.
- Не создавать файлы-монстры. Разделять домен, провайдеры, адаптеры и UI.
- Все долгие и платные операции делать идемпотентными и восстанавливаемыми после рестарта.
- Сохранять результаты внешних генераций в постоянное объектное хранилище.
- Не хранить секреты в Git, логах, URL и клиентском bundle.
- Для БД использовать только миграции. `prisma db push` запрещен.
- До удаления старого пути сначала подтвердить работу его официальной замены.
- Не менять несвязанный код и сохранять пользовательские изменения.

## Verification

- Vitest работает в `singleThread`: очистка тестовой БД делает `TRUNCATE` всей public schema, поэтому параллелить suites нельзя.
- Playwright читает `.env.test`, поднимает Nuxt на `127.0.0.1:3100` и по умолчанию отключает платные API, social posting и schedulers.
- Использовать mock-интеграции для тестов без расходов; не переносить production secrets в `.env.test`.
- Платные вызовы начинать с одного canary job.
- Перед масштабированием проверять партию 10-20 роликов и симуляцию 300 задач в сутки.
- Не заявлять о готовности интеграции без реального или контрактного подтверждения.
