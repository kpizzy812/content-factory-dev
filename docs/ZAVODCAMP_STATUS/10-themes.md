# 10. Темы и стили

## Источник истины

**Единственный файл стилей:** `app/assets/css/main.css`

Конфигурация Tailwind v4 + DaisyUI 5 — целиком в CSS, без `tailwind.config.js` (Tailwind v4 не использует JS-конфиг).

```css
@import "tailwindcss";
@plugin "daisyui" {
  themes: bumblebee --default, coffee --prefersdark, halloween, luxury, caramellatte;
}
```

---

## Доступные темы (7)

| Тема | Тип | Источник | Показывается в UI |
|------|-----|---------|-------------------|
| `bumblebee` | light | DaisyUI встроенная (default) | ✅ |
| `coffee` | dark | DaisyUI встроенная (prefersdark) | ✅ |
| `luxury` | dark | DaisyUI встроенная | ✅ |
| `nightfly` | dark (custom) | Custom alias на основе halloween | ✅ |
| `caramelwork` | light (custom) | Custom alias на основе caramellatte | ✅ |
| `halloween` | dark | DaisyUI встроенная | ❌ (база для nightfly) |
| `caramellatte` | light | DaisyUI встроенная | ❌ (база для caramelwork) |

> **Из user memory:** Halloween и Caramellatte не показывать в UI — они служат базой для кастомных тем nightfly/caramelwork.

---

## Активные темы — детально

### bumblebee (light, default)
- Палитра: жёлтый primary, чёрный neutral
- Используется как fallback и preference

### coffee (dark, prefersdark)
- Палитра: тёплая коричневая
- Срабатывает при `prefers-color-scheme: dark`

### luxury (dark)
- Палитра: фиолетовая/золотая

### nightfly (custom, dark)
Кастомная тёмная тема с OKLCH-цветами:

```css
[data-theme="nightfly"] {
  color-scheme: dark;
  --color-base-100: oklch(21% 0.006 56.043);     /* тёмный с тёплым оттенком */
  --color-base-200: oklch(14% 0.004 49.25);
  --color-base-300: oklch(0% 0 0);
  --color-base-content: oklch(84.955% 0 0);

  --color-primary: oklch(77.48% 0.204 60.62);    /* жёлто-оранжевый */
  --color-primary-content: oklch(19.693% 0.004 196.779);

  --color-secondary: oklch(45.98% 0.248 305.03); /* фиолетовый */
  --color-accent: oklch(64.8% 0.223 136.073);    /* жёлто-зелёный */
  --color-neutral: oklch(24.371% 0.046 65.681);

  --color-info: oklch(54.615% 0.215 262.88);     /* синий */
  --color-success: oklch(62.705% 0.169 149.213); /* зелёный */
  --color-warning: oklch(66.584% 0.157 58.318);  /* оранжевый */
  --color-error: oklch(65.72% 0.199 27.33);      /* красный */

  --radius-selector: 1rem;
  --radius-field: 0.5rem;
  --radius-box: 1rem;
  --border: 1px;
  --depth: 1;
  --noise: 0;
}
```

### caramelwork (custom, light)
Светлая тема с кремовым background и тёплыми коричнево-оранжевыми акцентами:

```css
[data-theme="caramelwork"] {
  color-scheme: light;
  --color-base-100: oklch(98% 0.016 73.684);   /* кремовый */
  --color-base-200: oklch(95% 0.038 75.164);
  --color-base-300: oklch(90% 0.076 70.697);

  --color-primary: oklch(0% 0 0);              /* чёрный */
  --color-secondary: oklch(22.45% 0.075 37.85); /* тёмный коричневый */
  --color-accent: oklch(46.44% 0.111 37.85);    /* оранжево-коричневый */

  --color-info: oklch(42% 0.199 265.638);
  --color-success: oklch(43% 0.095 166.913);
  --color-warning: oklch(82% 0.189 84.429);
  --color-error: oklch(70% 0.191 22.216);

  --radius-selector: 2rem;     /* более скруглённый */
  --radius-field: 0.5rem;
  --radius-box: 1rem;
  --border: 2px;               /* толще бордер */
  --depth: 1;
  --noise: 1;                  /* шум для аутентичной текстуры */
}
```

---

## CSS-переменные в темах

Каждая тема устанавливает набор переменных DaisyUI 5:

### Цвета
- `--color-base-100/200/300` — три уровня фона
- `--color-base-content` — основной текст
- `--color-primary` + `--color-primary-content`
- `--color-secondary` + `--color-secondary-content`
- `--color-accent` + `--color-accent-content`
- `--color-neutral` + `--color-neutral-content`
- `--color-info` + `--color-info-content`
- `--color-success` + `--color-success-content`
- `--color-warning` + `--color-warning-content`
- `--color-error` + `--color-error-content`

### Геометрия
- `--radius-selector` — radius для checkbox/radio
- `--radius-field` — для input/select
- `--radius-box` — для card/modal
- `--size-selector` — размер checkbox
- `--size-field` — размер input
- `--border` — толщина бордера

### Эффекты
- `--depth` — глубина (тени)
- `--noise` — текстура шума

---

## @source inline — принудительная генерация utilities

Tailwind v4 удаляет неиспользованные классы из output. Для семантических классов DaisyUI это проблема — `bg-primary/20` может не оказаться в финальном CSS если не упомянут в коде явно.

Решение — `@source inline(...)`:

```css
@source inline("bg-primary bg-secondary bg-accent bg-neutral
                bg-info bg-success bg-warning bg-error
                bg-base-300
                bg-primary/5 bg-secondary/5 bg-accent/5
                bg-info/5 bg-success/5 bg-warning/5 bg-error/5
                bg-primary/20 bg-secondary/20 bg-accent/20
                bg-info/20 bg-success/20 bg-warning/20 bg-error/20
                text-primary text-secondary text-accent text-neutral
                text-info text-success text-warning text-error
                text-primary-content text-secondary-content text-accent-content
                text-neutral-content text-info-content text-success-content
                text-warning-content text-error-content
                border-primary/30 border-secondary/30 border-accent/30
                border-info/30 border-info/40 border-success/30
                border-warning/30 border-error/30");
```

Это гарантирует, что классы доступны во всех 5 темах и динамическом коде (если генерируется по условию).

---

## Переключение тем

### В UI

На `/settings` есть селектор темы. Сохраняется в cookie через `@nuxtjs/color-mode`:

```ts
const colorMode = useColorMode()
colorMode.preference = 'nightfly'
```

### Программно

В шаблоне переключение через `data-theme`:

```html
<html data-theme="nightfly">
```

`@nuxtjs/color-mode` автоматически устанавливает атрибут.

### Конфигурация (`nuxt.config.ts`)

```ts
colorMode: {
  preference: 'bumblebee',         // дефолт
  fallback: 'bumblebee',
  dataValue: 'theme',              // <html data-theme="...">
  classSuffix: '',                 // не добавлять суффикс
  storageKey: 'nuxt-color-mode',
  storage: 'cookie'                // persistent через cookies
}
```

---

## Правила использования цветов

### ✅ Хорошо — семантические классы

```html
<div class="bg-base-100 text-base-content">
  <button class="btn btn-primary">Сохранить</button>
  <span class="badge badge-info">Новый</span>
  <div class="alert alert-warning">Внимание</div>
</div>
```

### ❌ Плохо — хардкод цветов

```html
<!-- Не адаптируется к темам -->
<div class="bg-white text-gray-900">
  <button class="bg-blue-500 text-white">Сохранить</button>
  <span class="bg-blue-100 text-blue-800">Новый</span>
</div>
```

### Когда допустим хардкод

Только для декоративных элементов, не связанных с темой (например, фиксированный градиент в баннере, brand colors на лендинге).

### Контраст

Всегда сочетать `*-content` цвет на соответствующем фоне:

```html
<div class="bg-primary text-primary-content">...</div>
<div class="bg-secondary text-secondary-content">...</div>
```

---

## Стилист-агент

Узкоспециализированный агент `stylist` (`.claude/agents/stylist.md`) автоматически проверяет компоненты на:

- Хардкод цветов (`bg-amber-500`, `text-blue-600` где должна быть тема)
- Несоответствие `*-content` цвета
- Использование `bg-white` / `border-gray-200` (надо `bg-base-100` / `border-base-300`)
- Совместимость с каждой темой по отдельности

Стилист правит только классы — не трогает логику и структуру компонента.

Подробнее — в [11-agents.md](11-agents.md#stylist).

---

## Visual Audit для тем

Скилл `visual-audit` (`.claude/skills/visual-audit/SKILL.md`) делает скриншоты страниц на 4 viewport'ах через Playwright MCP. Для тем — отдельный аудит требует прогона `data-theme` через `browser_evaluate`.

Подробнее — в [12-skills.md](12-skills.md#visual-audit) и [13-mcp-playwright.md](13-mcp-playwright.md).

---

## Иконки

Через `@nuxt/icon` + `@iconify-json/mingcute`:

```html
<Icon name="mingcute:add-line" />
<Icon name="mingcute:delete-2-line" class="size-5 text-error" />
```

SVG-режим (не webfont) — каждая иконка рендерится как inline SVG, наследует текущий `currentColor`. Совместимо со всеми темами автоматически.

---

## Анимации

### auto-animate (списки)

```html
<ul v-auto-animate>
  <li v-for="item in items" :key="item.id">{{ item.name }}</li>
</ul>
```

### VueUse Motion (переходы)

```html
<div
  v-motion
  :initial="{ opacity: 0, y: 20 }"
  :enter="{ opacity: 1, y: 0, transition: { duration: 300 } }"
>
  Контент
</div>
```

### CSS transitions (DaisyUI)

`btn`, `card`, `modal`, `drawer` — встроенные transitions в DaisyUI, работают со всеми темами.

---

## Известные особенности тем

1. **OKLCH-цвета** в custom-темах — современный colorspace с лучшим восприятием контраста.
2. **`color-scheme: dark/light`** — браузер сам подкрашивает scrollbars, native input controls.
3. **`--noise: 1`** в caramelwork — добавляет визуальный шум (subtle texture).
4. **`--depth: 1`** — DaisyUI применяет дополнительные тени, делая UI более "depth-y".
5. При создании custom-темы — обязательно проверить все 4 viewport через `visual-audit` (overflow, контраст, mobile tap targets).
