# Шрифты для subtitle-пресетов

Эти TTF/OTF файлы используются ASS-рендерером субтитров. libass находит их через
параметр `fontsdir=` фильтра `subtitles=` в FFmpeg. **Системная установка не требуется** —
fontsdir имеет приоритет над системным fontconfig.

## Состав

| Файл | Family name (для ASS Style.Fontname) | Лицензия | Источник |
|------|--------------------------------------|----------|----------|
| `Anton-Regular.ttf` | `Anton` | SIL OFL 1.1 | https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf |
| `Montserrat-Bold.ttf` | `Montserrat` (style: Bold) | SIL OFL 1.1 | https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-Bold.ttf |
| `Montserrat-Black.ttf` | `Montserrat` (style: Black) | SIL OFL 1.1 | https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-Black.ttf |
| `Inter-Regular.otf` | `Inter` | SIL OFL 1.1 | https://github.com/rsms/inter/releases (release zip) |
| `Inter-Bold.otf` | `Inter` (style: Bold) | SIL OFL 1.1 | https://github.com/rsms/inter/releases (release zip) |
| `Inter-Bold.ttf` | `Inter` (variable, weight 100..900) | SIL OFL 1.1 | https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf |

**Inter TTF vs OTF:** часть libass-сборок (особенно старее n6) хуже читает OTF — ставим
TTF-версию рядом как backup. Файл `Inter-Bold.ttf` — на самом деле variable-шрифт всех
weights (Inter[opsz,wght].ttf переименован), внутри есть Bold weight, который libass
выберет по `Bold=-1` в ASS Style.

Копии лицензий — в `LICENSES/`.

## Кириллица

Anton, Montserrat и Inter все поддерживают кириллицу. Bebas Neue и Poppins исключены
из набора, потому что не имеют кириллических глифов.

## Если файл потерялся

Скачать заново можно командами выше (см. источники). После добавления файла перезапуск
сервера не требуется — `font-resolver.ts` кэширует список на процесс, перезагрузится при
следующем cold start.

## Важно про Style.Fontname в ASS

libass матчит шрифт по **family name внутри файла**, а не по имени файла. Anton TTF имеет
family name `Anton`. Montserrat-Bold.ttf — family `Montserrat`, weight Bold. То есть в
`[V4+ Styles]` пишем `Fontname=Montserrat` и параметр `Bold=-1` отдельно — libass подберёт
правильный вариант.
