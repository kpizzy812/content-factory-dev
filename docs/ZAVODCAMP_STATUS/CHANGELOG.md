# CHANGELOG — ZAVODCAMP STATUS

История изменений документа. Каждая запись = одно обновление (атомарный коммит).

Формат: `YYYY-MM-DD — что обновлено — кто (агент/пользователь)`.

---

## 2026-05-21 — Версия 1.0 — первичное создание документа

Создана полная структура `docs/ZAVODCAMP_STATUS/`:

- `README.md` — индекс
- `01-overview.md` — обзор проекта (миссия, RBAC, связь с MarketingCamp)
- `02-stack.md` — стек, библиотеки, npm scripts, конфиги, env vars
- `03-structure.md` — иерархия файлов с детальной разбивкой каждой папки
- `04-pages.md` — 42 страницы с маршрутами/middleware/composables
- `05-components.md` — 194 компонента по 19 категориям
- `06-composables-stores.md` — 85 composables, 16 Pinia stores, middleware, plugins
- `07-api.md` — 311 endpoints в 28 разделах
- `08-server.md` — 66 utils, 9 файлов automation, 6 schedulers
- `09-database.md` — 75+ моделей Prisma, 89 миграций, шифрование
- `10-themes.md` — DaisyUI 5 темы + кастомные nightfly/caramelwork
- `11-agents.md` — 7 агентов команды разработки
- `12-skills.md` — 10 скиллов
- `13-mcp-playwright.md` — MCP Playwright для тестирования и визуального аудита
- `14-functionality.md` — карта реализованного функционала по модулям

Источники данных:
- Прямое чтение кода (`app/`, `server/`, `prisma/`, `.claude/`)
- `.claude/agent-memory/tester/MEMORY.md` (история фич)
- `docs/SPEC.md`, `docs/PIPELINE_SPEC.md`, `docs/accounts-feature.md`, `docs/indigo-code-state.md`, `docs/proxy-history.md`
- `.claude/skills/web-dev/SKILL.md` и остальные скиллы
- `package.json`, `nuxt.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `Dockerfile`, `entrypoint.sh`, `.env.example`

---

## Правила ведения CHANGELOG

### Когда добавлять запись

- Новая фича / новый API / новая модель БД → обновить `14-functionality.md` + соответствующий раздел + запись здесь
- Архитектурное изменение (структура папок, RBAC, конвенции) → `01-overview.md` или `03-structure.md` + запись
- Новый стек / библиотека / версия → `02-stack.md` + запись
- Новый агент / скилл → `11-agents.md` или `12-skills.md` + запись
- Новая тема → `10-themes.md` + запись

### Формат записи

```markdown
## YYYY-MM-DD — Краткое описание — Автор

- Что обновлено в `XX-name.md` — конкретные секции
- Что добавлено в `YY-other.md`
- Изменения в `README.md` индексе (если есть)

Причина: [почему понадобилось обновление — фича, рефакторинг, исправление]
```

### Чего не делать

- Не дублировать содержание обновлённых разделов — только ссылки и краткое описание
- Не описывать миграции БД здесь (только в `09-database.md`)
- Не описывать процесс разработки (только результат)

### Шаблон обновления документа после фичи

1. Реализована фича X в коммите Y
2. Тестировщик обновил `.claude/agent-memory/tester/MEMORY.md`
3. Обновляется `docs/ZAVODCAMP_STATUS/`:
   - `14-functionality.md` — раздел модуля X получает новые возможности
   - `04-pages.md` — если появились новые страницы
   - `05-components.md` — если появились новые компоненты
   - `07-api.md` — если появились новые endpoints
   - `09-database.md` — если появились новые модели/миграции
   - `README.md` — обновить метрики если изменились значения (количество страниц/API/etc.)
4. Запись в этом CHANGELOG

---

## Roadmap документа

Возможные расширения в будущих версиях:

- **15-deployment.md** — детали production deploy (Saturn.ac / Render / Fly.io)
- **16-monitoring.md** — observability, метрики, алёрты
- **17-known-issues.md** — лента известных проблем (отделить от `ERRORS.md` analyzer'а)
- **18-roadmap.md** — что планируется (бэклог фич)
- **19-glossary.md** — словарь терминов (RBAC, FSM, DAG, ASS, и т.д.)

Эти файлы создаются по мере необходимости — не плодить раньше времени.
