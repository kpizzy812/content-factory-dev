# Replicate в ContentFactory

Replicate — основной провайдер медиа-моделей. Через него идут lip-sync (`kwaivgi/kling-lip-sync`) и синтез речи (`minimax/speech-02-turbo`). fal.ai не включается автоматически и используется только при `MEDIA_PROVIDER_FALLBACK=fal` после исчерпания повторов Replicate.

## Переменные окружения

```env
REPLICATE_API_TOKEN=
REPLICATE_WEBHOOK_SIGNING_SECRET=
REPLICATE_WEBHOOK_BASE_URL=https://factory.example.com
REPLICATE_DEFAULT_LIPSYNC_MODEL=kwaivgi/kling-lip-sync
REPLICATE_DEFAULT_TTS_MODEL=minimax/speech-02-turbo
REPLICATE_TTS_PRICE_USD_PER_1K_CHARS=0.06
REPLICATE_RECOVERY_ENABLED=true
MEDIA_PROVIDER_FALLBACK=
SCHEDULERS_ENABLED=true
ENABLE_PAID_APIS=true
```

`REPLICATE_WEBHOOK_BASE_URL` содержит только публичный origin без завершающего `/`. Итоговый адрес webhook:

```text
https://factory.example.com/api/webhooks/replicate
```

Signing secret получают тем же API token, под которым запускаются predictions:

```bash
curl -s -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  https://api.replicate.com/v1/webhooks/default/secret
```

Значение поля `key` из ответа записывается в `REPLICATE_WEBHOOK_SIGNING_SECRET`. Токен и signing secret нельзя коммитить или выводить в логи.

## Как проходит задача

1. ContentFactory считает SHA-256 исходного клипа и TTS-аудио.
2. Из video ID, scene order, хэшей файлов и модели строится стабильный idempotency key.
3. Локальные файлы загружаются через Replicate Files API.
4. Prediction создаётся асинхронно и сразу записывается в `MediaPrediction`.
5. Завершение приходит на подписанный webhook. Повторная доставка безопасна.
6. Если webhook потерялся, recovery-поллинг запрашивает prediction по ID.
7. Успешный output сразу копируется в настроенное постоянное хранилище.
8. Pipeline получает локальную копию сохранённого результата и продолжает FFmpeg/Remotion-сборку.

URL файлов результата Replicate временные, поэтому состояние `succeeded` не считается готовым для pipeline, пока не заполнен `persistedStorageKey`.

## Ограничения текущей модели

- видео: `.mp4` или `.mov`, меньше 100 МБ;
- длительность одного исходного клипа: от 2 до 10 секунд;
- разрешение: 720p-1080p, допустимые размеры 720-1920 px;
- аудио: `.mp3`, `.wav`, `.m4a` или `.aac`, меньше 5 МБ;
- цена: `$0.014` за секунду выходного видео;
- входные данные обрабатываются Replicate и поставщиком модели Kuaishou, поэтому нельзя отправлять материалы без нужных прав и согласий.

Ограничение 2-10 секунд относится к сцене, а не ко всему ролику. Ролик длиной 70-90 секунд собирается из нескольких коротких сцен.

## Синтез речи

Русская озвучка идёт через `minimax/speech-02-turbo`. Раньше в реестре стояла `fal-ai/kokoro/russian`, но такого эндпоинта не существует: fal.ai отдаёт на него 404, а у самого Kokoro русского языка нет — только английский, японский, китайский, испанский, французский, хинди, итальянский и португальский. Запись Kokoro осталась в реестре с `integrated: false`, чтобы старые `Video` с этим `voiceoverModelId` падали внятно, а не уходили молча в английский голос.

Синтез проходит тем же путём, что и lip-sync: `MediaPrediction`, вебхук, recovery-поллинг, копирование в постоянное хранилище. Idempotency key считается по самому запросу — модель, текст, голос, скорость и язык. Одна и та же реплика тем же голосом второй раз денег не стоит, даже если её просит другая сцена или другой ролик.

Голос задаётся идентификатором MiniMax (`Wise_Woman` по умолчанию), а не ISO-кодом языка. Язык передаётся отдельным полем `language_boost`.

Цена берётся из `REPLICATE_TTS_PRICE_USD_PER_1K_CHARS`, потому что Replicate не отдаёт её через публичный API. Значение по умолчанию — `0.06` за 1000 символов; перед пакетным запуском его нужно сверить с личным кабинетом, иначе аудит стоимости будет врать.

## Сцены ведущей не покупаются дважды

Сцена, у которой в сценарии заполнен `spokenLine`, снимается живой ведущей: фрагмент из библиотеки исходников идёт прямо в lip-sync. Для таких сцен не запускается ни text-to-video, ни генерация превью-кадра — платить за клип, который тут же выбрасывается, незачем. Раньше пайплайн делал именно это.

Следствие: ролик, целиком собранный из сцен ведущей, не обращается к fal вообще и работает на одном `REPLICATE_API_TOKEN`. Смешанный ролик (ведущая плюс B-roll) по-прежнему требует ключа fal, пока генерация картинок и клипов не переедет на Replicate.

## Mock-режим

Для разработки и CI:

```env
REPLICATE_MOCK_MODE=true
SCHEDULERS_ENABLED=false
ENABLE_PAID_APIS=false
STORAGE_DRIVER=mock
```

Mock создаёт детерминированный prediction ID, проходит те же состояния и не вызывает сеть. Для быстрой проверки новых модулей используется `vitest.pure.config.ts`; интеграционный тест использует отдельную test-БД.

## Recovery и fallback

Recovery запускается только когда одновременно выставлены:

```env
SCHEDULERS_ENABLED=true
REPLICATE_RECOVERY_ENABLED=true
```

Он обрабатывает задачи ограниченными пачками, восстанавливает потерянные webhook и повторяет незавершённое копирование output. Несколько процессов не должны сохранять один результат дважды: перед копированием берётся атомарная lease в БД.

По умолчанию fallback выключен. Чтобы разрешить fal.ai:

```env
MEDIA_PROVIDER_FALLBACK=fal
FAL_KEY=...
```

Fallback срабатывает только для retryable-ошибки Replicate после двух попыток. Ошибки конфигурации, валидации, БД и хранилища не маскируются переключением провайдера.

## Canary перед пакетным запуском

1. Применить Prisma-миграции и проверить подключение к постоянному хранилищу.
2. Настроить token, signing secret и публичный webhook URL.
3. Оставить `MEDIA_PROVIDER_FALLBACK` пустым, чтобы увидеть настоящую ошибку Replicate.
4. Взять один клип длиной 2-10 секунд и одно короткое TTS-аудио допустимого формата.
5. Запустить одну сцену, не пакет и не очередь на сотни роликов.
6. Проверить в `MediaPrediction`: один `externalId`, `status=succeeded`, `persistenceStatus=persisted`, заполненный `persistedStorageKey` и отсутствие секрета в snapshot.
7. Проверить итоговый клип глазами и на слух: синхронность губ, лицо, артефакты, звук и длительность.
8. Повторить тот же запрос и убедиться, что новый платный prediction не появился.
9. Только после успешного canary включать небольшую партию и затем увеличивать параллелизм.

Официальная документация: [async predictions](https://replicate.com/docs/topics/predictions/create-a-prediction), [проверка webhook](https://replicate.com/docs/topics/webhooks/verify-webhook/), [входные файлы](https://replicate.com/docs/topics/predictions/input-files), [временные output-файлы](https://replicate.com/docs/topics/predictions/output-files), [схема Kling Lip Sync](https://replicate.com/kwaivgi/kling-lip-sync/api/schema).
