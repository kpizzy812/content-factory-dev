# Subtitle Presets — каталог стилей субтитров

Subtitle preset — это законченный шаблон оформления субтитров (шрифт, цвет, обводка,
анимация входа, акцентная анимация на ключевых словах). Применяется на этапе сборки
видео в `assembleVideo()`.

В системе 10 публичных пресетов плюс 4 legacy-алиаса для backward-compat существующих
записей в БД.

---

## Каталог

### `classic` — Классика (Drawtext fast path)

Белый текст с чёрной обводкой. Рендерится через FFmpeg drawtext (без libass), поэтому
самый быстрый. Без анимаций. Универсал, работает на любом фоне. Дефолт для новых видео.

- Шрифт: системный (NotoSans / DejaVu, fallback)
- Использовать когда: нужна максимальная скорость рендера, нет требований к word-by-word
- Renderer: drawtext

---

### `tiktok_white` — TikTok White

Жирный белый Montserrat с короткой fade-анимацией входа. Универсал для любого
TikTok/Reels-видео.

- Шрифт: Montserrat-Bold (storage/fonts/)
- Анимация: fade-in 150мс
- AI keywords: нет
- Renderer: ass (libass)

---

### `tiktok_neon` — TikTok Neon

Циановый neon-glow на ключевых словах. AI выделяет важные слова автоматически (числа,
эмоции, бренды).

- Шрифт: Montserrat-Bold
- Эффект: glow (`\blur4` + cyan border)
- AI keywords: ДА (Anthropic Haiku, ~$0.001/видео)
- Renderer: ass

---

### `karaoke` — Karaoke

Слова по очереди подсвечиваются (sweep-эффект через `\kf`). Активное слово белое,
остальные серые.

- Шрифт: Montserrat-Bold
- Эффект: word-by-word karaoke sweep
- AI keywords: нет (используются word-timings)
- Renderer: ass
- Зависимость: word-level timings. Сейчас pipeline их не извлекает — fallback на
  равномерное распределение длительности по словам.

---

### `hormozi` — Hormozi

Жирный Anton ВСЕ ЗАГЛАВНЫЕ + жёлтый pop на ключевых словах. Стиль Алекса Хормози.

- Шрифт: Anton (Google Fonts OFL, кириллица OK)
- Анимация: pop-in (масштаб 60%→100%) + uppercase forced
- Emphasis: цвет #FFE500 + scale 130%→100% на keyword словах
- AI keywords: ДА
- Renderer: ass

---

### `beast` — Beast

Anton CAPS + красный акцент + slide-up. Для high-energy crypto/business контента.

- Шрифт: Anton
- Анимация: slide-up (вход снизу)
- Emphasis: цвет #FF4500 + scale на keywords
- AI keywords: ДА
- Renderer: ass

---

### `wave` — Wave

Лёгкое волнообразное вращение строки (sine через `\frz\t`). Для дрим/lo-fi/моушн контента.

- Шрифт: Montserrat-Bold
- Эффект: `\frz` 0→3→0→-3→0 на длительность сегмента
- AI keywords: нет
- Renderer: ass

---

### `popup` — Popup

Слова появляются с pop-эффектом (масштаб 60%→100% за 200мс). Для динамичной озвучки.

- Шрифт: Montserrat-Bold
- Анимация: pop-in
- AI keywords: нет
- Renderer: ass

---

### `minimal_subtle` — Minimal

Тонкий Inter, мягкий fade 300мс. Для cinematic / premium / lifestyle.

- Шрифт: Inter-Regular
- Анимация: fade 300мс
- AI keywords: нет
- Renderer: ass

---

### `boxed` — Boxed

Inter-Bold на тёмной полупрозрачной плашке (BorderStyle=3) + жёлтый акцент.
Максимум читаемости даже на пёстром фоне.

- Шрифт: Inter-Bold
- Background: #000000 @ 70% alpha
- Emphasis: #FFE500 на keyword
- AI keywords: ДА
- Renderer: ass

---

## Legacy aliases

Эти ключи остаются принимаемыми API (старые записи в БД продолжают работать), но в
UI-picker не показываются. Резолвятся в новые пресеты через `LEGACY_ALIASES`.

| Старый ключ | Новый ключ | Визуально |
|-------------|------------|-----------|
| `tiktok_classic` | `classic` | Идентично |
| `tiktok_bold_yellow` | `hormozi` | Похожий жёлтый бренд + caps |
| `tiktok_boxed` | `boxed` | Похожая плашка + box style |
| `minimal` | `minimal_subtle` | Идентично, тонкая типографика |

---

## Performance

ASS-рендер через `subtitles=` filter медленнее чем drawtext в 1.3-2× — для типового
30-секундного видео это +3-8 секунд к assembly. Drawtext fast-path остаётся для пресета
`classic` и используется как fallback при ошибке генерации ASS.

При rerunVideoStep('assembly') без изменения текста ASS-файл переиспользуется через
hash-based filename (`storage/uploads/subtitles/{videoId}/{key}-{hash12}.ass`).

---

## Шрифты

Шрифты лежат в `storage/fonts/`. Подхватываются libass через параметр `fontsdir=`,
системная установка не требуется. См. `storage/fonts/README.md` для списка и лицензий.

---

## Как добавить кастомный пресет

1. Откройте `server/utils/subtitles/preset-registry.ts`.
2. Добавьте новый ключ в `SubtitlePresetKey` union (`shared/types/subtitle-preset.ts`).
3. Добавьте описание в `PRESETS: Record<SubtitlePresetKey, FullSubtitlePreset>` —
   опишите fontFamily, цвета, анимации (entrance/emphasis/effect).
4. Если пресет требует кастомный шрифт — положите .ttf/.otf в `storage/fonts/` и проверьте
   что family-name внутри файла совпадает с `fontFamily` пресета.
5. Запустите `bun run scripts/generate-subtitle-samples.ts` чтобы перегенерировать
   sample-mp4 для нового пресета.
6. UI подхватит автоматически — `useSubtitlePresets` дёргает `/api/subtitles/presets`.

---

## Как сгенерировать sample-mp4

```bash
bun run scripts/generate-subtitle-samples.ts
```

Скрипт берёт фразу "Это секрет миллионеров", генерирует 3-секундный testsrc-фон и
накладывает каждый пресет. Результат пишется в `public/subtitle-presets/{key}.mp4`.

Если каких-то пресетов не оказалось в выводе — скрипт печатает причину в stderr (обычно
отсутствует libass или соответствующий шрифт). UI в этом случае показывает CSS-имитацию
вместо видео.

---

## Fallback логика

Если ASS-генерация упала (битый input, отсутствует libass) — `tryRenderAssFilter`
возвращает `null`, и `assembleVideo` фолбэкается на drawtext-pipeline с пресетом
`classic`. Видео всегда соберётся, даже если выбран сломанный ASS-пресет.

Если `ENABLE_PAID_APIS=false` — keyword-detector не вызывается, ass-builder использует
heuristic-разметку (числа, ALL CAPS, словарь "free/секрет/никогда/...").
