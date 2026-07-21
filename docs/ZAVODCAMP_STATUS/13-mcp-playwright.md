# 13. MCP Playwright

**MCP Playwright** — отдельный Model Context Protocol сервер, который даёт агентам прямой контроль над браузером Chromium. Это полноценный инструмент тестирования и автоматизации, **более полезный, чем многие автоматизированные тесты**, потому что:

- Реальный браузер → реальное состояние страницы (CSS, JS, networkidle, rendering)
- Вижуал-тестинг через скриншоты + Vision-модель
- Воспроизведение пользовательских сценариев (клики, ввод, scrolling)
- Доступ к console logs, network requests, DOM-инспекция
- Многошаговые workflow без хрупкости classical selenium

---

## Доступные `browser_*` инструменты (35)

### Навигация и состояние

| Инструмент | Назначение |
|-----------|-----------|
| `browser_navigate` | Открыть URL (`page.goto`) |
| `browser_navigate_back` | Назад в истории |
| `browser_resize` | Изменить размер viewport (для responsive аудита) |
| `browser_close` | Закрыть браузер (обязательно в конце) |
| `browser_wait_for` | Ожидание: `networkidle`, селектор, таймаут, текст |
| `browser_snapshot` | Снять текущее состояние DOM (для анализа) |

### Скриншоты и медиа

| Инструмент | Назначение |
|-----------|-----------|
| `browser_take_screenshot` | Полный скриншот страницы (`fullPage: true` для длинных) или конкретного элемента |

### Взаимодействие — мышь и тачскрин

| Инструмент | Назначение |
|-----------|-----------|
| `browser_click` | Клик по селектору |
| `browser_hover` | Hover (полезно для tooltip, dropdown) |
| `browser_drag` / `browser_drop` | Drag-n-drop |
| `browser_mouse_click_xy` | Клик по координатам |
| `browser_mouse_move_xy` | Перемещение мыши |
| `browser_mouse_down` / `browser_mouse_up` | Низкоуровневые события |
| `browser_mouse_drag_xy` | Drag по координатам |
| `browser_mouse_wheel` | Прокрутка |

### Клавиатура и ввод

| Инструмент | Назначение |
|-----------|-----------|
| `browser_type` | Ввод текста в input/textarea |
| `browser_press_key` | Нажатие клавиши (Enter, Tab, Escape) |
| `browser_fill_form` | Заполнение формы целиком |
| `browser_select_option` | Выбор в `<select>` |
| `browser_file_upload` | Загрузка файла |

### Диалоги и табы

| Инструмент | Назначение |
|-----------|-----------|
| `browser_handle_dialog` | accept/dismiss confirm/alert/prompt |
| `browser_tabs` | Управление вкладками |

### Программный доступ

| Инструмент | Назначение |
|-----------|-----------|
| `browser_evaluate` | Выполнить JS на странице (для DOM-инспекции, отключения анимаций, эмуляции toast'ов) |
| `browser_run_code_unsafe` | Unsafe JS execution (с привилегиями) |
| `browser_console_messages` | Получить console logs (error/warn/info) |
| `browser_network_request` | Один запрос (детали) |
| `browser_network_requests` | Все запросы сессии |

---

## Сценарии использования в проекте

### 1. Визуальный аудит UI

Самый частый use-case. Скилл [`visual-audit`](12-skills.md#visual-audit) использует MCP Playwright:

```
1. browser_resize({ width: 1920, height: 1080 })       // viewport
2. browser_navigate('http://127.0.0.1:3100/proxies')
3. browser_wait_for({ state: 'networkidle' })
4. browser_evaluate(/* disable animations */)
5. browser_click('button:has-text("Добавить")')          // открыть модалку
6. browser_wait_for({ selector: '.modal-box' })
7. browser_take_screenshot({ fullPage: true, path: '.../proxies_modal_mobile.png' })
8. browser_close()
```

Прогоняется на 4 viewport'ах для responsive проверки.

### 2. E2E-тесты конкретного сценария

Например, создание аккаунта через multi-step wizard:

```
1. Login через test-bypass headers
2. Navigate /accounts
3. Click "Добавить аккаунт"
4. Fill wizard step 1 (платформа, displayName)
5. Click "Далее"
6. Fill step 2 (login/password)
7. Click "Далее"
8. Step 3 (proxy + Indigo)
9. Click "Создать"
10. Verify: account создан, EditModal auto-open, БД содержит запись
```

### 3. Smoke-тесты после деплоя

Прогон критических путей:
- Логин → Дашборд
- /trends → создание профиля → запуск парсинга
- /scenarios → генерация → variant table
- /videos → генерация → progress polling
- /uploads → создание → mock-публикация

### 4. Debug в development

Когда фронт ведёт себя странно:
```
browser_console_messages()  // что в console
browser_network_requests()  // что в сети
browser_snapshot()          // что в DOM
browser_take_screenshot()   // как выглядит
```

Это быстрее чем переключаться в DevTools вручную.

### 5. AI-управляемый browser flow

Vision-модель смотрит скриншот, решает что нажать дальше:
```
1. screenshot → AI видит "карточку с кнопкой 'Запустить'"
2. browser_click('button:has-text("Запустить")')
3. screenshot → AI видит "stepper с шагами"
4. browser_wait_for({ selector: '.step-success' })
```

Это близко к тому, что делает Claude Computer Use, но через специализированный MCP.

---

## Преимущества над classical e2e тестами

### Классический Playwright тест (`tests/e2e/*.spec.ts`)
```ts
import { test, expect } from '@playwright/test'
test('account creation', async ({ page }) => {
  await page.goto('/accounts')
  await page.click('button:has-text("Добавить")')
  // ... hardcoded steps
})
```

**Минусы:**
- Хрупкие селекторы (`button:has-text` ломается при изменении текста)
- Не воспринимает контекст экрана
- Нужно поддерживать спеки при каждой UI-итерации
- Не показывает agent'у, что фактически на экране

### MCP Playwright подход
```
agent: browser_navigate('/accounts')
agent: browser_snapshot()  → видит actual DOM
agent: browser_click('...') // выбирает селектор по контексту
agent: browser_take_screenshot() → проверяет результат визуально
```

**Плюсы:**
- Адаптивен — агент сам подстраивается под изменения
- Vision-проверка результата (не нужны искусственные `expect()`)
- Один и тот же подход для smoke / audit / debug
- Не требует написания и поддержки спеков

### Когда что использовать

| Use case | Подход |
|----------|--------|
| Regression тесты в CI | Classical Playwright spec'и в `tests/e2e/` |
| Visual audit при разработке | MCP Playwright + visual-audit скилл |
| Smoke после деплоя | MCP Playwright (быстро + flexible) |
| Debug одной фичи | MCP Playwright (быстрее переключаться) |
| Многошаговый wizard верификация | MCP Playwright (агент сам справится) |
| Контрактные тесты API | supertest + Vitest (НЕ Playwright) |

---

## Лучшие практики

### 1. Всегда ждать networkidle

```
browser_navigate('/page')
browser_wait_for({ state: 'networkidle' })  // ОБЯЗАТЕЛЬНО для SPA
```

Иначе DOM не успеет смонтироваться → false negatives.

### 2. Отключать анимации перед скриншотами

```
browser_evaluate(() => {
  document.head.insertAdjacentHTML('beforeend', `
    <style>
      *, *::before, *::after {
        transition: none !important;
        animation: none !important;
      }
    </style>
  `)
})
```

Иначе одни и те же скриншоты получают разный hash из-за in-flight transitions.

### 3. Закрывать браузер

```
// в конце scenario
browser_close()
```

Иначе ресурсы утекают, страница висит в памяти.

### 4. Использовать viewports из playwright.config.ts

4 стандартных размера (1920, 1280, 768, 375). Не выдумывать свои — иначе данные несравнимы с e2e.

### 5. Auth через test-bypass

Для test-сервера (`NODE_ENV=test`, `TEST_AUTH_BYPASS=1`):

```
browser_evaluate(() => {
  document.cookie = `x-test-auth-token=${testToken}`
  document.cookie = `x-test-user-id=${userId}`
})
```

Или через `browser_set_extra_http_headers` (если есть в MCP).

### 6. fullPage для длинных страниц

```
browser_take_screenshot({ fullPage: true, path: '...' })
```

Иначе на /pipeline/[id] или /analytics будет обрезано.

### 7. Vision-инспекция

После скриншота просить модель проанализировать визуально:
- Все элементы видны?
- Контраст читаемый?
- Иконки и текст не налезают?
- На mobile tap targets ≥44px?

---

## Output папка

Все скриншоты по умолчанию идут в `.playwright-mcp-output/` (gitignore). Для visual audit — в `tests/visual/screenshots/{YYYY-MM-DD}/`.

**Из user memory:** скриншоты сохранять в `screens/`, не в корень проекта.

---

## Известные ограничения

1. **Vision не видит мелкий текст:** при 1920 viewport текст 12px на скриншоте может быть нечитаем. Делать дополнительные element-скриншоты.
2. **Анимации:** даже с отключённым `transition` toast/modal могут начать рендериться через RAF → добавить `browser_wait_for(200ms)`.
3. **Reduced motion:** MCP не проверяет `@media (prefers-reduced-motion)`. Ручная проверка через DevTools.
4. **WebKit/Firefox:** по умолчанию Chromium. Safari/iOS-специфичные баги (sticky, backdrop-filter) не ловятся.
5. **Тёмная тема:** для полного аудита прогонять каждую тему через `data-theme` атрибут.

---

## Сводные команды Playwright MCP

| Действие | Инструмент |
|----------|-----------|
| Открыть страницу | `browser_navigate` |
| Подождать загрузку | `browser_wait_for` |
| Скриншот | `browser_take_screenshot` |
| Кликнуть | `browser_click` |
| Ввести текст | `browser_type` |
| Выбрать в select | `browser_select_option` |
| Прокрутить | `browser_mouse_wheel` |
| Получить console logs | `browser_console_messages` |
| Получить network requests | `browser_network_requests` |
| Выполнить JS | `browser_evaluate` |
| Закрыть | `browser_close` |

Полный список — в начале файла (35 инструментов).

---

## Интеграция с агентами

| Агент | Использование MCP Playwright |
|-------|------------------------------|
| `tester` | Финальная проверка фич, smoke-тесты, debug |
| `stylist` | Скриншоты в каждой теме для проверки контраста |
| `implementer` | Debug в процессе разработки |
| `analyzer` | Аудит при обнаружении проблем пользователем |

Critic, architect, researcher напрямую MCP Playwright обычно не используют.

---

## Связанные скиллы

- [`visual-audit`](12-skills.md#visual-audit) — основной потребитель MCP Playwright
- [`webapp-testing`](12-skills.md#webapp-testing) — Python Playwright (альтернатива)
- [`webapp-testing-extended`](12-skills.md#webapp-testing-extended) — для classical e2e в `tests/e2e/`
