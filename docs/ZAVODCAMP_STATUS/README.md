# ZAVODCAMP STATUS — Полное описание проекта

> Тотальный справочник по архитектуре, реализованному функционалу, инфраструктуре, агентам и скиллам проекта ZavodCamp.

**Версия документа:** 1.0
**Создан:** 2026-05-21
**Тип:** живой документ (предназначен для регулярного дополнения)

---

## Назначение

Документ описывает состояние проекта на дату последнего обновления:
- архитектуру (фронт, бэк, БД)
- весь реализованный функционал
- стек, библиотеки, инфраструктуру
- команду агентов Claude и доступные скиллы
- инструменты разработки и тестирования (включая MCP Playwright)

Каждый раздел оформлен как самостоятельный файл — это упрощает обновление и сравнение версий через git.

---

## Структура документа

| № | Файл | Раздел | Что внутри |
|---|------|--------|-----------|
| 01 | [01-overview.md](01-overview.md) | Обзор | Миссия, целевая аудитория, RBAC-философия, связь с MarketingCamp |
| 02 | [02-stack.md](02-stack.md) | Стек | Vue/Nuxt/Prisma/Bun, библиотеки, npm scripts, конфиги |
| 03 | [03-structure.md](03-structure.md) | Структура | Иерархия папок, что где лежит |
| 04 | [04-pages.md](04-pages.md) | Страницы | 42 страницы — маршруты, middleware, composables |
| 05 | [05-components.md](05-components.md) | Компоненты | 194 компонента по 19 категориям |
| 06 | [06-composables-stores.md](06-composables-stores.md) | Composables/Stores | 85 composables, 16 Pinia stores, middleware, plugins |
| 07 | [07-api.md](07-api.md) | REST API | 311 endpoints в 28 разделах |
| 08 | [08-server.md](08-server.md) | Сервер | utils (66), automation (poster-runner и др.), schedulers, mock-серверы |
| 09 | [09-database.md](09-database.md) | База данных | 75+ моделей Prisma, 89 миграций, шифрование AES-256-GCM |
| 10 | [10-themes.md](10-themes.md) | Темы | DaisyUI 5 + кастомные nightfly/caramelwork |
| 11 | [11-agents.md](11-agents.md) | Агенты | architect / implementer / critic / tester / researcher / stylist / analyzer |
| 12 | [12-skills.md](12-skills.md) | Скиллы | web-dev / daisyUI / commit / visual-audit / webapp-testing и т.д. |
| 13 | [13-mcp-playwright.md](13-mcp-playwright.md) | MCP Playwright | Скриншоты, тестирование, browser_* инструменты |
| 14 | [14-functionality.md](14-functionality.md) | Функционал | Карта реализованных фич: пайплайн контента, соц-автоматизация, аналитика |
| — | [CHANGELOG.md](CHANGELOG.md) | Изменения | История изменений документа |

---

## Краткий портрет проекта

**ZavodCamp** — производственная No-Code платформа для полного цикла видеоконтента:

`Тренды → Идея → Сценарий → Видео → Публикация → Аналитика`

Платформа интегрирована с **MarketingCamp** (единый источник RBAC) и закрывает 10 модулей:

| Модуль | Что закрывает |
|--------|---------------|
| `trendwatcher` | Поиск трендов через Apify (TikTok, YouTube, Instagram, Telegram) |
| `script-generator` | AI-генерация сценариев + варианты + критик качества |
| `video-generator` | Pipeline: prompt → image → video → voiceover → music → assembly + субтитры |
| `social-upload` | OAuth + browser-automation (Indigo) для TikTok, YouTube, Instagram |
| `analytics` | Сбор метрик постов, дашборд, CTR |
| `pipeline` | Визуальный конструктор no-code workflow (DAG) с версионированием и webhook'ами |
| `accounts` | Учётка + 2FA + прокси + warmup-планы для соц-аккаунтов |
| `creatives` | Каталог изображений/клипов с привязкой к идеям |
| `prompts-library` | Лучшие промты с AI-анализом паттернов |
| `admin` | Пользователи, приложения, циклы, логи (8 источников), Telegram-бот |

---

## Метрики проекта (на дату)

| Категория | Кол-во |
|-----------|--------|
| Страниц (`app/pages/`) | 42 |
| Компонентов (`app/components/`) | 194 |
| Composables (`app/composables/`) | 85 |
| Pinia stores | 16 |
| API endpoints (`server/api/`) | 311 |
| Server utils (`server/utils/`) | 66 |
| Postgres моделей (Prisma) | 75+ |
| Миграций БД | 89 |
| Shared TypeScript типов | 31 |
| Доступных тем DaisyUI | 5 активных + 2 кастомных |
| Агентов Claude | 7 |
| Скиллов | 10 |
| Mock-серверов | 3 (proxy, indigo, drive) |
| Schedulers (фоновых) | 4 |

---

## Как обновлять документ

1. **При добавлении новой фичи** — обновляется соответствующий раздел (страницы/компоненты/API/функционал).
2. **При архитектурных изменениях** — `01-overview.md` или `03-structure.md`.
3. **При смене стека** — `02-stack.md`.
4. **При появлении нового агента/скилла** — `11-agents.md` / `12-skills.md`.
5. **Любое изменение** — короткая запись в [CHANGELOG.md](CHANGELOG.md): дата + что поменялось + автор.

Внутри файлов поддерживаются якоря секций (`## Заголовок`) — на них можно ссылаться из других файлов: `[Конвейер](04-pages.md#пайплайн)`.

---

## Связанные документы (внешние)

| Документ | Где | Зачем |
|----------|-----|-------|
| `CLAUDE.md` | корень репо | Системные инструкции (язык, RBAC, антипаттерны) |
| `docs/SPEC.md` | docs/ | Базовое ТЗ |
| `docs/PIPELINE_SPEC.md` | docs/ | Спецификация Pipeline-движка |
| `docs/accounts-feature.md` | docs/ | Модуль аккаунтов |
| `docs/indigo-code-state.md` | docs/ | Состояние Indigo-интеграции |
| `docs/proxy-history.md` | docs/ | История прокси-стека |
| `.claude/agent-memory/tester/MEMORY.md` | .claude/ | Лента изменений от тестировщика (per-feature reports) |
| `.claude/agent-memory/architect/MEMORY.md` | .claude/ | Архитектурные планы |
| `.claude/agent-memory/analyzer/ERRORS.md` | .claude/ | Документация ошибок (если есть) |

Этот документ — `docs/ZAVODCAMP_STATUS/` — даёт **горизонтальный срез** (всё про всё), а внешние документы — **вертикальный** (детали одной фичи).
