# tests/visual/

Хранилище отчётов и скриншотов **visual-audit skill**.

Skill: `.claude/skills/visual-audit/SKILL.md`.

## Структура

```
tests/visual/
├── README.md                      # этот файл
├── .gitkeep                       # держит директорию в git'е
├── 2026-05-04-proxies.md          # отчёт по фиче "proxies" от 2026-05-04
├── 2026-05-04-accounts-health.md  # отчёт по дашборду состояния аккаунтов
└── screenshots/                   # ИГНОРИРУЕТСЯ git'ом (см. .gitignore)
    └── 2026-05-04/
        ├── proxies_list_desktop_xl.png
        ├── proxies_list_desktop_md.png
        ├── proxies_list_tablet.png
        ├── proxies_list_mobile.png
        └── ...
```

- **Отчёты** (`.md`) коммитятся, чтобы история визуальных дефектов была видна в PR-ах.
- **Скриншоты** (`screenshots/`) НЕ коммитятся — это бинарные артефакты, раздувающие репо.
  Если нужно сохранить конкретный референс — приложи его к PR description или Linear-тикету.

## Naming convention

### Отчёты

`{YYYY-MM-DD}-{feature-slug}.md`

- `feature-slug` — кебаб-кейс, без пробелов и кириллицы:
  `proxies`, `accounts-health`, `pipeline-monitor`, `social-upload-modal`.
- Если аудитов одной фичи несколько за день — добавлять суффикс:
  `2026-05-04-proxies-iter2.md`.

### Скриншоты

`screenshots/{YYYY-MM-DD}/{page-slug}_{viewport}.png`

`viewport` ∈ `desktop_xl | desktop_md | tablet | mobile`
(соответствует 1920×1080 / 1280×800 / 768×1024 / 375×812).

`page-slug` описывает то, что видно на экране:
- `proxies_list` — страница `/proxies` со списком
- `proxies_modal_add` — открыта модалка добавления прокси
- `accounts_health_summary` — карточки с суммарной статистикой
- `accounts_edit_indigo_tab` — открыт таб Indigo в AccountEditModal

## Как читать отчёт

Каждый отчёт начинается с метаданных и summary, потом — findings по severity:

| Severity | Что значит | Действие |
|----------|------------|----------|
| **BLOCKER** | Юзер не сможет использовать функцию (overflow обрезает критичную кнопку, модалка вне viewport, недоступный tap target на mobile) | Обязательная переделка ДО мерджа |
| **MAJOR** | Юзер сможет, но интерфейс выглядит непрофессионально (кривые gap'ы, разная высота иконок, отсутствующие hover-state'ы) | Создать TODO/issue, починить в течение спринта |
| **MINOR** | Косметика (1-2px сдвиг, опечатка, капитализация) | Опционально, бэклог |

Финальный вердикт audit'а — одно из:

- **NEEDS REWORK** — есть BLOCKER, переделать обязательно
- **PASS WITH NOTES** — только MAJOR/MINOR, можно мерджить с TODO
- **CLEAN** — проблем не найдено

## Когда пишется новый отчёт

- После любой UI-фичи (новая страница, новые компоненты, модалки, формы).
- В DoD трека из `.claude/agent-memory/architect/track_*_complete.md`.
- При reggression-проверке после рефакторинга стилей.

## Когда удалять старые отчёты

Не удалять — это история визуальных дефектов, полезная для:
- сравнения "было / стало" после правок
- анализа повторяющихся паттернов (например, постоянные overflow на mobile в модалках)
- onboarding'а новых членов команды (что у нас хрупкое)

Старые скриншоты собирать удалять не нужно — они уже в `.gitignore`.

## Как запустить аудит

В разговоре с агентом:

```
Запусти visual-audit skill для страницы /proxies (включая ProxyAddModal и ProxyRevealCredentialsModal).
```

Дальше skill сам:
1. Поднимет Playwright MCP браузер.
2. Прогонит каждый экран на 4 viewport'ах.
3. Соберёт скриншоты и сырые findings (overflow / tap-target / modal-overflow).
4. Проанализирует через Vision и выдаст structured report.
5. Сохранит отчёт в `tests/visual/{date}-{feature}.md`.

Требования: запущенный сервер на `:3100` (тестовый, рекомендуется) или `:3000` (dev).
