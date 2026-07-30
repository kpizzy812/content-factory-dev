# Унаследованный контур VideoCamp

ContentFactory собран на кодовой базе VideoCamp, поэтому вместе с полезной частью в репозиторий приехали зоны, которые либо прямо запрещены ТЗ, либо не входят в согласованный контур. Эти зоны выключены по умолчанию и включаются только явным env-флагом.

Код зон не удалён намеренно. `docs/superpowers/specs/2026-07-22-content-factory-design.md` §13 шаг 10 разрешает удаление только после того, как официальная замена подтверждена на живом аккаунте.

## Зоны

### `LEGACY_DEVICE_AUTOMATION_ENABLED` — DuoPlus, ADB, warmup

Постинг через облачные телефоны и эмуляцию действий человека. Прямо запрещён `docs/PROJECT_CONTEXT.md` §4 и `AGENTS.md`.

- API: `/api/device-profiles`, `/api/posting-jobs`, `/api/posting`, `/api/warmup`
- Страницы: `/devices`, `/devices/:id`, `/posting-jobs`, `/admin/warmup-keywords`
- Планировщик: posting worker (`POSTING_WORKER_ENABLED`)
- Код: `server/automation/`
- Модели: `DeviceProfile`, `DeviceProfileAccount`, `PostingJob`, `PostingJobLog`, `WarmupSession`, `WarmupKeywordPool`
- UI: вкладки «Устройство», «Прогрев», «Готовность» в карточке аккаунта; путь `browser_automation` при создании загрузки

### `LEGACY_PROXY_POOL_ENABLED` — пул прокси

Прокси нужны только device-контуру. Официальные API платформ ходят напрямую.

- API: `/api/proxies`
- Страницы: `/proxies`
- Планировщик: proxy health check (`PROXY_HEALTH_CHECK_ENABLED`)
- Модели: `Proxy`, `ProxyHealthCheck`, `ProxyDeepCheckLog`
- UI: вкладка «Прокси» в карточке аккаунта

### `LEGACY_GOOGLE_DRIVE_ENABLED` — Google Drive

Источник исходников из Drive. Не входит в согласованный контур: библиотека ведущего загружается через `/api/characters/:id/source-clips`.

- API: `/api/google-drive`
- Страницы: `/google-drive`
- Планировщик: refresh metadata (`GOOGLE_DRIVE_SCHEDULER_ENABLED`)
- Модели: `DriveFile`
- Узлы конвейера `google_drive_scanner` и `google_drive_uploader` остаются в реестре, но их эндпоинты недоступны при выключенной зоне

### `LEGACY_MARKETING_CAMP_SYNC_ENABLED` — обмен идеями с MarketingCamp

Двусторонняя синхронизация идей и креативов с родительской платформой. По `docs/PROJECT_CONTEXT.md` §11 зависимость от MarketingCamp подлежит замене.

- API: `/api/ideas/sync`
- Код: `server/utils/idea-sync.ts`, `server/utils/marketingcamp.ts`

Авторизация через MarketingCamp этим флагом не управляется — у неё отдельный переключатель, см. `docs/operations/authentication.md`.

## Как это устроено

Единственный источник правды — `shared/utils/legacy-modules.ts`. Его читают три потребителя:

1. `server/middleware/legacy-contour.ts` — отдаёт `404` на путях выключенных зон. Именно `404`, а не `403`: наличие запрещённого контура не должно быть видно снаружи.
2. `server/utils/legacy-scheduler.ts` — не поднимает воркеры выключенных зон. Зона важнее старого флага: при `LEGACY_DEVICE_AUTOMATION_ENABLED=false` значение `POSTING_WORKER_ENABLED=true` ничего не включает. Внутри включённой зоны старый флаг сохраняет право выключить конкретный воркер.
3. `GET /api/product-modules` и composable `useLegacyModules` — интерфейс не показывает то, что сервер отдаёт как 404.

Флаг включается только значением ровно `true`. `1`, `TRUE` и `yes` не работают — так конфигурация не течёт молча.

## Как временно включить зону

Понадобится, если нужно разобрать инцидент на старых данных или доснять метрики со старого постинга:

```dotenv
LEGACY_PROXY_POOL_ENABLED=true
```

После перезапуска процесса API зоны отвечают как раньше, страницы возвращаются в навигацию, планировщики зоны стартуют по своим флагам.

## Тесты

Suites, проверяющие сами зоны, включают их точечно через `setup({ env })`: `proxies-crud`, `proxies-security`, `device-profiles-list`, `device-profile-accounts`, `posting-jobs-api-method-block`, `posting-jobs-proxy-gating`, `posting-jobs-youtube`, `google-drive`. Playwright включает зоны в `playwright.config.ts`, потому что E2E продолжает покрывать легаси-интерфейс, пока код не удалён.

Новые тесты писать против выключенных зон — это соответствует поставке.

## Условия удаления кода

- device-контур и прокси: после подтверждённого Meta canary на живом профессиональном аккаунте, то есть когда официальная публикация доказана не mock-тестом;
- MarketingCamp: после перевода установок на `AUTH_PROVIDER=local` и отказа от обмена идеями;
- Google Drive: после того как библиотека исходников закроет сценарий загрузки материалов.

До этого зоны остаются выключенными, но рабочими.
