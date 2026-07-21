/**
 * Метаданные типов нод конвейера: метки, описания, иконки.
 * Используется в PipelineNodeSettings и других компонентах.
 */

export const nodeTypeLabels: Record<string, string> = {
  trendwatcher: 'Трендвотчер',
  scenario: 'Генератор сценариев',
  video: 'Генерация видео',
  caption_generator: 'Генератор описаний',
  upload: 'Загрузка в соцсети',
  idea: 'AI-анализ видео',
  analytics: 'Аналитика',
  filter: 'Фильтр / Условие',
  notification: 'Уведомление',
  http_request: 'HTTP запрос',
  code: 'Трансформация (JS)',
  set: 'Установить поля',
  if_switch: 'Условие (If/Switch)',
  loop: 'Цикл',
  wait: 'Ожидание',
  sub_pipeline: 'Подконвейер',
  google_drive_scanner: 'Drive Scanner',
  google_drive_uploader: 'Загрузка в Drive',
  video_analyzer: 'Анализ видео',
  character: 'Персонаж',
  scene_composer: 'Композитор сцены',
  note: 'Заметка',
}

export const nodeTypeDescriptions: Record<string, string> = {
  trendwatcher: 'Ищет вирусные ролики по заданным критериям и анализирует их через AI.',
  scenario: 'Генерирует сценарии для видео на основе тренда или идеи.',
  video: 'Создаёт видеоролик из сценария: изображения, клипы, музыка, субтитры.',
  caption_generator: 'Генерирует viral title, description и хэштеги под TikTok / YouTube Shorts / Instagram Reels с учётом контекста сценария и приложения. Подменяют placeholder в Upload при approve.',
  upload: 'Загружает готовое видео в аккаунты соцсетей, привязанные к приложению.',
  idea: 'Анализирует видео: извлекает метаданные, генерирует AI-разбор и CreativeBrief. Работает с URL из потока (после Трендвотчера), по конкретной ссылке или из базы готовых идей.',
  analytics: 'Собирает метрики опубликованных роликов и анализирует результаты.',
  filter: 'Проверяет условие и направляет данные по разным путям конвейера.',
  notification: 'Отправляет уведомление в Telegram при наступлении события.',
  http_request: 'Отправляет HTTP запрос к внешнему API и возвращает ответ.',
  code: 'Изолированная трансформация данных через JavaScript (worker_threads): map, filter, reduce, строки, математика. Без сети, файлов и побочных эффектов. Жёсткий таймаут 5с, лимит памяти 64МБ.',
  set: 'Устанавливает или перезаписывает значения полей в потоке данных.',
  if_switch: 'Проверяет условие и определяет путь выполнения конвейера.',
  loop: 'Итерирует по массиву данных, передавая каждый элемент дальше.',
  wait: 'Ставит конвейер на паузу на заданное время перед продолжением.',
  sub_pipeline: 'Вызывает другой конвейер как подпроцесс. Может ждать завершения или запустить асинхронно.',
  google_drive_scanner: 'Сканирует Google Drive folder и эмитит файлы для дальнейшей обработки.',
  google_drive_uploader: 'Заливает готовые видео из пайплайна в указанный Google Drive folder через Service Account. Требует прав Editor на папку.',
  video_analyzer: 'Marketing-разбор кадров видео через AI: извлекает паттерны, темы, эмоции.',
  character: 'Подгружает персонажа из библиотеки и пробрасывает его реф-фото + visual prompt в сценарий и генерацию видео. Помогает держать одного героя на сериях роликов.',
  scene_composer: 'Готовая сцена из библиотеки композитора: блоки персонажа/стиля/окружения/действия → собранный prompt + референсы → отдаёт следующему блоку (Сценарий или Видео).',
  note: 'Текстовая заметка на полотне. Используется для пояснений, комментариев и документирования логики конвейера. Не участвует в выполнении.',
}

/**
 * Ноды с собственным AI autofill (специализированный endpoint и UI внутри config-формы).
 * Для них универсальный PipelineAiAutofill в PipelineNodeSettings не показывается,
 * чтобы не было двух одинаковых блоков "AI автозаполнение" подряд.
 */
export const nodeTypesWithCustomAiAutofill = new Set<string>([
  'trendwatcher',
])

export const nodeTypeIcons: Record<string, string> = {
  trendwatcher: 'mingcute:eye-line',
  scenario: 'mingcute:document-line',
  video: 'mingcute:video-line',
  caption_generator: 'mingcute:hashtag-line',
  upload: 'mingcute:upload-3-line',
  idea: 'mingcute:bulb-line',
  analytics: 'mingcute:chart-bar-line',
  filter: 'mingcute:filter-line',
  notification: 'mingcute:notification-line',
  http_request: 'mingcute:globe-line',
  code: 'mingcute:code-line',
  set: 'mingcute:edit-2-line',
  if_switch: 'mingcute:git-branch-line',
  loop: 'mingcute:refresh-2-line',
  wait: 'mingcute:time-line',
  sub_pipeline: 'mingcute:route-line',
  google_drive_scanner: 'mingcute:cloud-line',
  google_drive_uploader: 'mingcute:cloud-upload-line',
  video_analyzer: 'mingcute:scan-2-line',
  character: 'mingcute:user-3-line',
  scene_composer: 'mingcute:layers-line',
  note: 'mingcute:notebook-line',
}
