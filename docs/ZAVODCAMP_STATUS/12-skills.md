# 12. Скиллы

В `.claude/skills/` живут **10 скиллов** — переиспользуемые наборы инструкций, которые загружаются по триггерам в работе с кодом или вызываются явно.

Скилл = `SKILL.md` файл + (опционально) подкаталоги с references / scripts / templates.

---

## Активные скиллы проекта

| Скилл | Триггер | Назначение |
|-------|---------|-----------|
| `web-dev` | При работе с кодом | Обязательные правила стека и подходы (Vue/Nuxt/Pinia/Tailwind/DaisyUI/Prisma) |
| `daisyUI` | При создании UI | Полный llms.txt DaisyUI 5 с компонентами и API |
| `daisyui-v5` | Альтернативный триггер | Структурированный справочник компонентов с references/ |
| `tailwind-4-docs` | Tailwind v4 вопросы | Snapshot документации Tailwind v4 |
| `commit` | Голосовая команда коммита | Стиль и правила git-коммитов |
| `visual-audit` | После UI-изменений | Playwright MCP визуальный аудит на 4 viewport'ах |
| `webapp-testing` | Тестирование локальных webapp | Python Playwright скрипты (универсальный) |
| `webapp-testing-extended` | Работа с тестами проекта | Vitest + @nuxt/test-utils + Playwright + supertest (ZavodCamp-специфика) |
| `frontend-design` | Создание дизайна | Производство distinctive UI (production-grade) |
| `skill-creator` | Создание/изменение скиллов | Мета-скилл для редактирования других скиллов |

---

## web-dev — Правила разработки

**Файл:** `.claude/skills/web-dev/SKILL.md`
**Триггер:** любая работа с кодом (страницы, компоненты, стили, логика)

### Стек проекта
- Nuxt 4 (SSR, file-based routing, auto-imports)
- Vue 3 (Composition API, `<script setup>`)
- Pinia (через `@pinia/nuxt`)
- Tailwind CSS 4 (утилитарные стили)
- DaisyUI 5 (отдельный скилл)
- Prisma 7 (только на сервере)
- nuxt-auth-utils (аутентификация)
- @formkit/auto-animate, @vueuse/motion, vue-draggable-plus
- @nuxt/icon + @iconify-json/mingcute
- @nuxtjs/color-mode

### Правила
**Обязательно:**
- DaisyUI компоненты вместо самописных (проверять через скилл `daisyUI`)
- При сомнениях в API — context7 MCP
- Стили только Tailwind, кастом CSS если объективно не справляется
- `<script setup lang="ts">` + Composition API
- Серверная логика только в `server/`

**Запрещено:**
- Options API, mixins, filters
- Самописные UI при наличии DaisyUI-аналога
- Inline-стили, `<style scoped>` для того, что решается Tailwind
- Установка новых deps без явного запроса

---

## daisyUI — Компонентная библиотека

**Файл:** `.claude/skills/daisyUI/SKILL.md`
**Триггер:** при создании UI-элементов

Полная выгрузка llms.txt от DaisyUI 5 (5.5.x). Содержит:
- Install notes (DaisyUI 5 требует Tailwind 4, без `tailwind.config.js`)
- Usage rules (component + part + style + color + modifier классы)
- 53 компонента (btn, card, modal, drawer, menu, tab, table, form inputs, alert, badge, progress и т.д.)
- Color system (primary, secondary, accent, neutral, base, info/success/warning/error)
- Theming с `@plugin` syntax

### Базовые принципы
1. Компонент = component class + опциональные part/style/color/size/modifier
2. Кастомизация через Tailwind utilities
3. Только daisyUI классы + Tailwind utilities — никакого custom CSS
4. Flex/grid с responsive prefixes
5. **НЕ** добавлять `bg-base-100 text-base-content` на body без надобности
6. **НЕ** использовать `dark:` prefix с DaisyUI цветами — темы сами справляются

---

## daisyui-v5 — Структурированный справочник

**Файл:** `.claude/skills/daisyui-v5/SKILL.md`
**Триггер:** daisyUI, daisy-ui, Tailwind CSS components, btn class, card class

Альтернатива `daisyUI`-скиллу — с подкаталогом `references/` где компоненты разбиты по файлам для grep'а.

```
.claude/skills/daisyui-v5/
├── SKILL.md
└── references/
    ├── btn.md
    ├── card.md
    ├── modal.md
    └── ...
```

Использование: `grep references/` для поиска нужного компонента перед ответом.

---

## tailwind-4-docs — Tailwind v4 docs

**Файл:** `.claude/skills/tailwind-4-docs/SKILL.md`
**Триггер:** Tailwind v4 вопросы, выбор utilities/variants, миграция v3→v4

Требует инициализации через скрипт:
```bash
python skills/tailwind-4-docs/scripts/sync_tailwind_docs.py --accept-docs-license
```

Снапшот загружается из `tailwindlabs/tailwindcss.com` (source-available, не open-source).

После инициализации:
- `references/docs/` — MDX-документация
- `references/docs-index.tsx` — категории и slugs
- `references/engineering-playbook.md` — implementation guide
- `references/gotchas.md` — миграционные подводные камни

**Если snapshot старше 1 недели** — попросить пользователя запустить sync.

---

## commit — Стиль коммитов

**Файл:** `.claude/skills/commit/SKILL.md`
**Триггер:** голосовая команда пользователя ("коммить", "гит", "грузи на гит")

### Правила
1. Только маленькие тире `-`, не длинные
2. Максимум 4 предложения
3. Стиль: "Что за фичи сделаны, каких коснулись компонентов и как сделаны"

### Команды
```bash
git add --all
git commit -m "Сообщение особого вида"
```

### Примеры стиля (из реальных коммитов)
- "Иконки, размерность и улучшение фильтров"
- "Анимации и улучшенный коллапсер, новый функционал и связка функционалов на страницы Сотрудников и скоупов."
- "Сбор статистики аккаунтов через Apify. Новый таб Статистика в карточке аккаунта с метриками подписчиков/просмотров/engagement..."
- "Накладные изменения, ниже описание базовой логики и техдолга"

---

## visual-audit — Визуальный аудит UI

**Файл:** `.claude/skills/visual-audit/SKILL.md`
**Триггер:** после любой UI-задачи (страница, компонент, модалка, форма, стили)
**applyTo:** `tests/visual/**, app/pages/**, app/components/**`

### Что делает
Автоматизирует обнаружение проблем вёрстки через **Playwright MCP** до того, как их увидит пользователь.

### Viewport-стандарт (совпадает с playwright.config.ts)

| Project | Размер | Назначение |
|---------|--------|-----------|
| `desktop_xl` | 1920×1080 | Большие мониторы |
| `desktop_md` | 1280×800 | Стандартный ноутбук |
| `tablet` | 768×1024 | iPad portrait |
| `mobile` | 375×812 | iPhone 13 / типовой смартфон |

### Workflow

1. **Подготовка:** сервер на :3100 (test) или :3000 (dev), Playwright MCP подключён, аутентификация через `x-test-auth-token`, fixtures в БД
2. **Plan:** список pages × modals × states × viewports
3. **Скриншоты:** `browser_resize` → `browser_navigate` → `browser_wait_for(networkidle)` → отключение анимаций через `browser_evaluate` → `browser_take_screenshot`
4. **Анализ:** Vision + программные сниппеты (overflow detection, tap target size ≥44px, modal viewport check, контраст)
5. **Report:** `tests/visual/{YYYY-MM-DD}-{feature}.md` с findings по severity
6. **Передача:** BLOCKER → NEEDS REWORK (back to implementer); MAJOR/MINOR → PASS WITH NOTES; ничего → CLEAN

### Severity

**BLOCKER (must-fix):**
- Текст обрезан без ellipsis
- Кнопка/инпут вылезает за границу
- Модалка больше viewport
- Скрытые элементы из-за z-index
- Mobile (375): tap target <44px
- Critical button ниже fold
- Контраст <3:1

**MAJOR:**
- Несогласованный gap
- Иконки разного размера в строке
- Кривой padding/margin
- Loading state == empty state визуально
- Error не выделен цветом
- Hover state отсутствует
- DaisyUI классы перекрыты raw tailwind

**MINOR:**
- Сдвиг 1-2px
- Опечатка
- Капитализация

### Шаблоны программных проверок

**Overflow detection:**
```js
Array.from(document.querySelectorAll('*'))
  .filter(el => el.scrollWidth > el.clientWidth + 1)
  .slice(0, 30)
  .map(el => ({ tag: el.tagName, cls: el.className.slice(0, 80), diff: el.scrollWidth - el.clientWidth }))
```

**Tap target size (для mobile):**
```js
Array.from(document.querySelectorAll('button, a, [role="button"]'))
  .filter(el => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44)
  })
```

**Modal viewport check:**
```js
const modal = document.querySelector('[role="dialog"], .modal-box, dialog[open]')
if (modal) {
  const rect = modal.getBoundingClientRect()
  return {
    overflowsX: rect.width > window.innerWidth,
    overflowsY: rect.height > window.innerHeight
  }
}
```

Подробнее об MCP-инструментах — в [13-mcp-playwright.md](13-mcp-playwright.md).

---

## webapp-testing — Python Playwright

**Файл:** `.claude/skills/webapp-testing/SKILL.md`

Универсальный скилл для тестирования локальных webapp. Использует **Python Playwright** (не MCP).

### Helper-скрипты
- `scripts/with_server.py` — управление жизненным циклом сервера (одного или нескольких)

### Decision tree
- Статический HTML → читать файл, писать Playwright скрипт
- Динамический webapp → reconnaissance-then-action (navigate → networkidle → screenshot/inspect → execute)

### Пример
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')
    page.screenshot(path='/tmp/inspect.png', full_page=True)
    browser.close()
```

### Common pitfall
❌ Не инспектировать DOM до `networkidle`
✅ Всегда `page.wait_for_load_state('networkidle')`

---

## webapp-testing-extended — ZavodCamp тестовая инфра

**Файл:** `.claude/skills/webapp-testing-extended/SKILL.md`
**applyTo:** `tests/**, vitest.config.ts, playwright.config.ts, .env.test*`

Специфичный для ZavodCamp. Описывает:

### Структура
```
tests/
├── setup.ts                  # dotenv + safety guards + TRUNCATE afterEach
├── global-setup.ts           # prisma migrate deploy (1 раз)
├── helpers/
│   ├── auth.ts               # createTestUser + authHeaders
│   ├── api.ts                # обёртки над $fetch
│   ├── factories.ts          # ZavodUser, App, Proxy, SocialAccount
│   ├── nuxt-env.ts           # env для setup({ server: true })
│   └── test-crypto.ts        # AES-256-GCM как в server/utils/crypto.ts
├── unit/                     # Node-env
├── integration/              # Nuxt env + Prisma + Nitro
├── api/                      # Contract HTTP
└── e2e/                      # Playwright (вне Vitest)
vitest.config.ts
playwright.config.ts
```

### API contract-тесты
Минимум 3 теста на endpoint (happy path, auth=401, validation=400). Если читает/пишет секреты — отдельный `*-security.spec.ts` с проверкой shape и audit-log.

### Безопасность БД (КРИТИЧНО)
`tests/setup.ts` блокирует прогон если:
- Порт ≠ 5436
- Имя БД не содержит "tests"

### Test-bypass
```ts
import { createTestUser, authHeaders } from "~~/tests/helpers/auth"
const user = await createTestUser({ canAdmin: true })
const res = await $fetch("/api/admin/accounts-health", { headers: authHeaders(user.id) })
```

Работает только для endpoint'ов через `getAuthContext`. ~9 endpoint'ов идут через `requireUserSession` напрямую — для них Playwright e2e.

### Schedulers
В `.env.test`: `SCHEDULERS_ENABLED=false`. Иначе тесты получают непредсказуемые writes.

### Команды
```bash
bun run test                  # все
bun run test:unit
bun run test:integration
bun run test:api
bun run test:e2e
bun run test:db:migrate
bun run test:db:reset
```

### Viewports Playwright
- Desktop 1920×1080, 1280×800
- Tablet 768×1024 (iPad gen 7)
- Mobile 375×812 (iPhone 13)

Каждый e2e прогоняется на всех 4-х.

### Порт webServer
**3100** (не 3000 dev, не 3001 MarketingCamp). При изменении — обновить и в config'е, и в документации.

### Known issues
1. `bun run test` падает странно → fallback `npx vitest run`
2. `setup({ server: true })` поднимает Nuxt-процесс на каждый файл (~5-10c overhead)
3. `prisma migrate deploy` падает если набор миграций другой → `test:db:reset`
4. По умолчанию только Chromium
5. `vitest.config.ts` использует `defineConfig`, а не `defineVitestConfig` (Tailwind v4 vite-плагин ломает последний) → нет `#imports` в unit-тестах

---

## frontend-design — Production-grade UI

**Файл:** `.claude/skills/frontend-design/SKILL.md`

Создание distinctive, production-grade интерфейсов. Избегает generic AI-aesthetics.

### Принципы
- **Bold aesthetic direction:** brutalist / maximalist / minimalist / editorial / playful / etc.
- **Typography:** distinctive fonts (не Arial/Inter/Roboto)
- **Color & Theme:** dominant colors с sharp accents
- **Motion:** high-impact моменты (staggered page load > scattered micro-interactions)
- **Spatial Composition:** asymmetry, overlap, diagonal flow
- **Backgrounds:** gradient meshes, noise textures, layered transparencies

### Запреты
- Generic AI aesthetics (purple gradient на white background)
- Inter / Roboto / system fonts
- Cookie-cutter компонентные паттерны
- Predictable layouts

---

## skill-creator — Мета-скилл

**Файл:** `.claude/skills/skill-creator/SKILL.md`

Для создания новых скиллов и итеративного улучшения существующих.

### Процесс
1. Capture intent: что должен делать, когда триггерится, формат вывода
2. Interview & research (через MCP / subagents)
3. Draft + test prompts
4. Eval: generate_review.py + quantitative metrics
5. Rewrite по фидбеку
6. Optimize description (для лучшего триггеринга)

---

## Конвенции скиллов

| Аспект | Правило |
|--------|---------|
| Расположение | `.claude/skills/{name}/SKILL.md` |
| Frontmatter | `name`, `description`, `applyTo` (опц.), `compatibility` (опц.) |
| Триггер | На основе `description` (модель решает по контексту) |
| References | Подкаталог `references/` с детальными файлами для grep |
| Scripts | Подкаталог `scripts/` с исполняемыми утилитами |
| Триггер пользователем | `/skill-name` в чате |

---

## Сводная таблица

| Скилл | Триггер | Кто использует |
|-------|---------|----------------|
| `web-dev` | любая работа с кодом | implementer, critic, architect |
| `daisyUI` | создание UI | implementer, stylist, critic |
| `daisyui-v5` | альт. для UI | implementer |
| `tailwind-4-docs` | Tailwind v4 | implementer |
| `commit` | голосовая команда | пользователь / claude (catch-all) |
| `visual-audit` | после UI-задач | tester, stylist (через MCP Playwright) |
| `webapp-testing` | универсальное тестирование | claude |
| `webapp-testing-extended` | тесты проекта | tester, implementer |
| `frontend-design` | создание дизайна | implementer |
| `skill-creator` | работа со скиллами | редко |
