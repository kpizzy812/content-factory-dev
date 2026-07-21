# Visual Audit: Caption Generator

**Date:** 2026-05-06
**Tested by:** visual-audit skill (Claude Opus 4.7)
**Pages tested:** 2 (/videos/[id], /pipeline/[id])
**Screenshots:** 12 (4 viewport × 2 страницы + Instagram alert + caption_generator config + after-fix)
**Verdict:** PASS WITH NOTES

## Summary (после фикса MINOR #2 и #3)

- BLOCKER: 0
- MAJOR:   1 (наследуется от pipeline editor, не специфика трека)
- MINOR:   1 (btn-sm 32px согласован ранее как informational)
- Total:   2
- **Fixed:** 2 (крестик удаления хэштега 12→24px, кнопка «Добавить» btn-xs→btn-sm)

## Audit plan

### Pages
1. `/videos/1` — секция VideoCaptionsSection с 3 captions (TikTok approved, YouTube draft, Instagram over-limits)
2. `/pipeline/1` — canvas с caption_generator нодой и её config-панель

### Viewports
- desktop_xl (1920×1080)
- desktop_md (1280×800)
- tablet (768×1024)
- mobile (375×812)

### States
- TikTok caption approved (зелёный badge ✓, кнопка «Утверждено» зелёная)
- YouTube caption draft (серый badge –, кнопка «Утвердить для постинга» доступна)
- Instagram caption fitsLimits=false (красный badge !, alert «Не укладывается в лимиты», кнопка approve disabled)

## Findings

### MAJOR #1: Pipeline canvas не оптимизирован под mobile/tablet

**Page:** /pipeline/1
**Viewports:** mobile (375), tablet (768)
**Screenshots:** pipeline_canvas_mobile_375.png, pipeline_canvas_tablet_768.png

Canvas зажат между sidebar (блоки) и right panel (руководство), на 375 практически не виден. Конфиг ноды caption_generator на mobile частично обрезается (текст «Подсказки стиля (опциональн…»).

**Impact:** наследуется от общего pipeline editor, не специфично для caption_generator. Та же проблема для всех других нод (video, scenario, upload).

**Recommendation:** не блокирует трек. Pipeline editor исторически desktop-only (как Figma/n8n). При желании оптимизировать mobile — отдельная задача с reflow sidebar→drawer и right panel→bottomsheet.

### MINOR #1: Tap targets кнопок btn-sm = 32px (Apple HIG ≥ 44px)

**Page:** /videos/1
**Viewport:** mobile (375)
**Screenshot:** videos_id_mobile_375.png

В VideoCaptionsSection кнопки «Утверждено», «Сгенерировать заново», «Скопировать», «Удалить» имеют высоту 32px (DaisyUI btn-sm), что меньше Apple HIG минимума 44×44. Tabs (TikTok/YouTube/Instagram) — 40px высоты.

**Impact:** Та же проблема была отмечена ранее при E2E audit (commit 8e75560: «btn-sm 32px<44px Apple HIG — informational, не блокирует»). Согласована как проектный паттерн.

**Recommendation:** оставить как есть для consistency с остальным UI. Если решат поднять — обновлять глобально DaisyUI-конфиг, не точечно.

### ✅ FIXED: MINOR #2 — крестик удаления хэштега

**Page:** /videos/1
**Viewport:** mobile (375)
**Screenshot before:** videos_id_mobile_375.png (12×12px кнопка)
**Screenshot after:** videos_id_mobile_375_after_fix.png (24×24px кнопка)

**Fix:** обернул `<Icon mingcute:close-line>` в `<button class="size-6 rounded-full inline-flex items-center justify-center">` с `aria-label`. Tap-зона выросла в 4 раза (144 → 576 sq.px). Программная проверка после fix: 0 кнопок < 24px в секции captions.

### ✅ FIXED: MINOR #3 — кнопка «Добавить» хэштег

**Page:** /videos/1
**Viewport:** mobile (375)

**Fix:** `btn-xs` → `btn-sm` (24px → 32px высота, 68→82px ширина), и `input input-xs` → `input input-sm` для consistency. Кнопка теперь визуально и тактильно равна остальным action-кнопкам секции (Утвердить / Сгенерировать заново / Скопировать / Удалить).

## Что чисто (CLEAN)

- ✅ TikTok approved badge (зелёный ✓), YouTube draft badge (серый –), Instagram over-limits badge (красный !) — все читаются и различимы
- ✅ Instagram alert «Не укладывается в лимиты» с конкретными цифрами (title 130/125, хэштеги 142/100) — корректно отображается, имеет иконку и контрастный фон
- ✅ Кнопка approve disabled при fitsLimits=false (визуально блёклая, не кликабельная)
- ✅ Counter Title / Хэштеги виден всегда (символы / лимит)
- ✅ Hashtag chips отображают `#`, цвет совпадает с DaisyUI badge-ghost
- ✅ Layout VideoCaptionsSection в стандартном `card.bg-base-100.shadow-sm` контейнере, выровнен с остальными секциями страницы
- ✅ Config caption_generator ноды в pipeline (1280): описание, AI-автозаполнение (skip), Платформы pills с активным состоянием, Стиль captions select, Подсказки textarea — всё отображается без overflow
- ✅ Иконка `mingcute:hashtag-line` в sidebar и в card title — единая
- ✅ Sidebar: «Описания» в категории «Контент» между «Видео» и «Загрузка» — соответствует логической позиции в pipeline

## Screenshots reference

- `screenshots/2026-05-06-captions/videos_id_desktop_1920.png` — full page captions section
- `screenshots/2026-05-06-captions/videos_id_desktop_1280.png` — full page captions section
- `screenshots/2026-05-06-captions/videos_id_tablet_768.png` — full page captions section
- `screenshots/2026-05-06-captions/videos_id_mobile_375.png` — full page captions section
- `screenshots/2026-05-06-captions/videos_id_instagram_overlimit_1280.png` — Instagram tab с alert
- `screenshots/2026-05-06-captions/pipeline_canvas_desktop_1920.png` — canvas с 5 нодами в линию
- `screenshots/2026-05-06-captions/pipeline_canvas_desktop_1280.png` — canvas viewport
- `screenshots/2026-05-06-captions/pipeline_canvas_tablet_768.png` — canvas зажат
- `screenshots/2026-05-06-captions/pipeline_canvas_mobile_375.png` — canvas почти не виден
- `screenshots/2026-05-06-captions/pipeline_caption_config_1280.png` — конфиг caption_generator ноды
- `screenshots/2026-05-06-captions/pipeline_caption_config_mobile_375.png` — конфиг частично обрезан
- `screenshots/2026-05-06-captions/videos_id_mobile_375_after_fix.png` — mobile после фикса tap targets

## Verdict

**PASS WITH NOTES** — ни одного BLOCKER, оставшийся MAJOR унаследован от общей архитектуры pipeline editor (вне scope трека), оставшийся MINOR (btn-sm 32px) — проектный паттерн (commit 8e75560). MINOR #2 и #3 исправлены в ходе аудита: крестик удаления хэштега получил кликабельный wrapper 24×24, кнопка «Добавить» переведена с `btn-xs` на `btn-sm`. Build/typecheck PASS. Трек готов к продакшену.
