/**
 * Схема полей pipeline-нод: типы, подсказки, ограничения, AI-safety флаги.
 * Используется для field hints, AI autofill preview и safety validation.
 */

export interface FieldSchema {
  /** Человекочитаемое название поля */
  label: string
  /** Подсказка: что делает поле, как заполнять */
  hint: string
  /** Тип поля для AI генерации */
  type: 'text' | 'number' | 'select' | 'tags' | 'toggle' | 'json' | 'code' | 'ref' | 'taxonomy'
  /** AI может безопасно заполнять это поле */
  aiSafe: boolean
  /** Причина блокировки AI (если aiSafe=false) */
  aiBlockReason?: string
  /** Максимальная длина AI output */
  maxLength?: number
  /** Допустимые значения (для select/tags) */
  allowedValues?: string[]
  /** Тип taxonomy (если type === 'taxonomy') — значения загружаются из БД */
  taxonomyType?: string
  /** Поле выбора приложения — AI подгружает список приложений из БД */
  appSelectField?: boolean
  /** Пример значения */
  example?: string
}

export type NodeFieldSchema = Record<string, FieldSchema>

export const nodeFieldSchemas: Record<string, NodeFieldSchema> = {
  trendwatcher: {
    profileMode: {
      label: 'Режим',
      hint: 'linked — использовать сохранённый профиль парсинга. inline — собрать конфиг прямо в ноде.',
      type: 'select',
      aiSafe: false,
      aiBlockReason: 'Выбирается пользователем вручную — определяет источник конфигурации',
      allowedValues: ['linked', 'inline'],
    },
    profileId: {
      label: 'Профиль парсинга',
      hint: 'Сохранённый TrendwatcherProfile (выбирается в режиме linked). AI не подбирает профили — создай или выбери вручную.',
      type: 'ref',
      aiSafe: false,
      aiBlockReason: 'Ссылка на системный ресурс — выбирается вручную',
    },
    appId: {
      label: 'Приложение',
      hint: 'ID приложения из которого берутся аккаунты для парсинга. AI получит список доступных приложений и выберет подходящее по названию.',
      type: 'ref',
      aiSafe: true,
      appSelectField: true,
    },
    actorId: {
      label: 'Apify-актор',
      hint: 'Какой Apify scraper запускать. tiktok-scraper для TikTok, instagram-scraper для Reels, youtube-scraper для Shorts.',
      type: 'select',
      aiSafe: true,
      allowedValues: [
        'clockworks/tiktok-scraper',
        'apidojo/tiktok-scraper',
        'apify/instagram-scraper',
        'streamers/youtube-scraper',
        'apidojo/youtube-scraper',
      ],
      example: 'clockworks/tiktok-scraper',
    },
    platforms: {
      label: 'Платформы',
      hint: 'Где искать тренды. Можно выбрать несколько. TikTok — короткие вирусные ролики. Instagram — Reels. YouTube — Shorts.',
      type: 'tags',
      aiSafe: true,
      allowedValues: ['tiktok', 'instagram', 'youtube'],
      example: 'tiktok, instagram',
    },
    keywords: {
      label: 'Ключевые слова',
      hint: 'Темы для поиска трендов. Чем точнее слова — тем релевантнее результаты. Можно добавлять фразы и хештеги.',
      type: 'tags',
      aiSafe: true,
      maxLength: 80,
      example: 'фитнес, здоровое питание, тренировки дома',
    },
    geo: {
      label: 'Гео',
      hint: 'ISO-код страны для поиска. Влияет на локализацию результатов.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['US', 'GB', 'RU', 'DE', 'FR', 'NL', 'ES', 'IT', 'BR', 'IN', 'JP', 'KR', 'TR', 'KZ', 'UA', 'BY'],
      example: 'US',
    },
    language: {
      label: 'Язык',
      hint: 'ISO 639-1 код языка контента для анализа.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['EN', 'RU', 'ES', 'DE', 'FR', 'PT', 'JA', 'KO'],
      example: 'EN',
    },
    viewCountMin: {
      label: 'Мин. просмотров',
      hint: 'Нижняя граница просмотров для отбора вирусного контента. Например 100000 — чтобы отсекать мелкие ролики.',
      type: 'number',
      aiSafe: true,
      example: '100000',
    },
    viewCountMax: {
      label: 'Макс. просмотров',
      hint: 'Верхняя граница просмотров. Обычно не указывается (без ограничений).',
      type: 'number',
      aiSafe: true,
    },
    maxItems: {
      label: 'Макс. результатов',
      hint: 'Лимит возвращаемых трендов за один запуск (1-100). Влияет на стоимость Apify run.',
      type: 'number',
      aiSafe: true,
      example: '20',
    },
    inlineName: {
      label: 'Имя inline-профиля',
      hint: 'Техническое имя для inline-профиля (виден в истории runs). Если сохраняешь как многоразовый — замени на осмысленное.',
      type: 'text',
      aiSafe: true,
      maxLength: 100,
      example: 'TikTok — фитнес UGC',
    },
    saveAsProfile: {
      label: 'Сохранить как переиспользуемый профиль',
      hint: 'При первом запуске inline-конфиг превратится в обычный профиль (enabled=true), видимый в модуле Трендвотчер.',
      type: 'toggle',
      aiSafe: false,
      aiBlockReason: 'Решение о сохранении — за пользователем',
    },
    preset: {
      label: 'Стратегия',
      hint: 'Стратегия поиска трендов. Определяет агрессивность, фильтрацию и фокус парсера.',
      type: 'taxonomy',
      aiSafe: true,
      taxonomyType: 'strategy',
    },
    emptyRetryCount: {
      label: 'Retry при пустом результате',
      hint: 'Сколько раз повторять парсинг, если ничего не найдено (актуально для scheduled runs). 0-3.',
      type: 'number',
      aiSafe: true,
      example: '2',
    },
    emptyRetryDelay: {
      label: 'Пауза между retry, сек',
      hint: 'Задержка между повторными попытками при пустом результате. 10-120 секунд.',
      type: 'number',
      aiSafe: true,
      example: '30',
    },
  },

  scenario: {
    variantsCount: {
      label: 'Количество вариантов',
      hint: 'Сколько вариантов сценария сгенерировать. Больше вариантов = больше выбор, но дольше генерация.',
      type: 'number',
      aiSafe: true,
      allowedValues: ['1', '3', '5'],
      example: '3',
    },
    generationMode: {
      label: 'Режим генерации',
      hint: 'auto — система выбирает оптимальный режим. story_driven — полноценный сторителлинг. simple — быстрая генерация без StoryPlan.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['auto', 'story_driven', 'simple'],
    },
    hookStyles: {
      label: 'Стили хуков',
      hint: 'Как захватить внимание зрителя в первые секунды. Выберите один или несколько стилей подачи.',
      type: 'taxonomy',
      aiSafe: true,
      taxonomyType: 'hook_style',
    },
    // ─── Storytelling section ───
    'storytelling.enabled': {
      label: 'Сторителлинг',
      hint: 'Включить режим сторителлинга — каждый вариант получит StoryPlan с драматургической дугой.',
      type: 'toggle',
      aiSafe: true,
    },
    'storytelling.protagonistMode': {
      label: 'Тип протагониста',
      hint: 'person — реальный человек. object — предмет/продукт. abstract — концепт. auto — система решает.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['person', 'object', 'abstract', 'auto'],
    },
    'storytelling.continuityStrictness': {
      label: 'Строгость continuity',
      hint: 'Насколько жёстко соблюдать визуальную и сюжетную непрерывность между сценами.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['strict', 'moderate', 'relaxed'],
    },
    'storytelling.sceneCountStrategy': {
      label: 'Стратегия количества сцен',
      hint: 'auto — система решает. minimal (3 сцены). detailed (5-6 сцен). cinematic (6+ сцен).',
      type: 'select',
      aiSafe: true,
      allowedValues: ['auto', 'minimal', 'detailed', 'cinematic'],
    },
    'storytelling.transformationArcTemplate': {
      label: 'Шаблон дуги трансформации',
      hint: 'Описание дуги: как герой меняется от начала к концу.',
      type: 'text',
      aiSafe: true,
      maxLength: 300,
    },
    'storytelling.emotionalProgression': {
      label: 'Эмоциональная прогрессия',
      hint: 'Последовательность эмоций по сценам: frustration → curiosity → excitement → satisfaction.',
      type: 'tags',
      aiSafe: true,
    },
    'storytelling.appIntegrationStyle': {
      label: 'Стиль интеграции приложения',
      hint: 'native — органично встроено в сюжет. prominent — приложение центр внимания. subtle — лёгкие упоминания.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['native', 'prominent', 'subtle'],
    },
    'storytelling.environmentCues': {
      label: 'Подсказки окружения',
      hint: 'Визуальные подсказки для среды: "кофейня", "спортзал", "городская улица".',
      type: 'tags',
      aiSafe: true,
    },
    'storytelling.paletteMood': {
      label: 'Палитра / Настроение',
      hint: 'Общее настроение визуала: "тёплый и уютный", "яркий и энергичный", "минималистичный".',
      type: 'text',
      aiSafe: true,
      maxLength: 100,
    },
    'storytelling.variationIntensity': {
      label: 'Интенсивность вариаций',
      hint: 'Насколько сильно варианты должны отличаться друг от друга.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['low', 'medium', 'high'],
    },
    'storytelling.antiLoopRules': {
      label: 'Anti-loop правила',
      hint: 'Правила против повторяющихся клипов и однообразных сцен.',
      type: 'tags',
      aiSafe: true,
    },
    'storytelling.negativeRules': {
      label: 'Глобальные запреты',
      hint: 'Что запрещено визуально/сюжетно: "без насилия", "без политики".',
      type: 'tags',
      aiSafe: true,
    },
    // ─── Favorite prompts section ───
    'favoritePrompts.autoSelect': {
      label: 'Авто-подбор избранных промтов',
      hint: 'AI сам выберет до 5 промтов из библиотеки по пересечению тегов и популярности. Используются как ориентир — не копия.',
      type: 'toggle',
      aiSafe: true,
    },
    'favoritePrompts.manualIds': {
      label: 'Выбранные избранные промты',
      hint: 'Ручной выбор избранных промтов из библиотеки. До 5 штук. Используются как ориентир для сценарного агента.',
      type: 'ref',
      aiSafe: false,
      aiBlockReason: 'Ссылки на конкретные записи — выбираются пользователем в интерфейсе',
    },
    // ─── Subtitles section ───
    'subtitles.enabled': {
      label: 'Субтитры',
      hint: 'Включить генерацию субтитров для каждой сцены.',
      type: 'toggle',
      aiSafe: true,
    },
    'subtitles.readabilityLevel': {
      label: 'Уровень читабельности',
      hint: 'easy — короткие простые фразы. normal — стандартная длина. dense — более плотный текст.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['easy', 'normal', 'dense'],
    },
    'subtitles.maxLineLength': {
      label: 'Макс. длина строки',
      hint: 'Максимальное количество символов в одной строке субтитров.',
      type: 'number',
      aiSafe: true,
      example: '40',
    },
    'subtitles.maxLines': {
      label: 'Макс. строк одновременно',
      hint: 'Сколько строк субтитров показывать одновременно.',
      type: 'number',
      aiSafe: true,
      allowedValues: ['1', '2', '3'],
    },
    'subtitles.placementStrategy': {
      label: 'Размещение субтитров',
      hint: 'auto — система решает на основе содержимого сцены. Или фиксированная позиция.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['auto', 'top', 'center', 'bottom'],
    },
    'subtitles.avoidOcclusion': {
      label: 'Избегать перекрытия',
      hint: 'Субтитры не должны перекрывать лица, UI приложения, продукт.',
      type: 'toggle',
      aiSafe: true,
    },
    'subtitles.autoHighlight': {
      label: 'Авто-выделение ключевых слов',
      hint: 'Автоматически выделять ключевые слова в субтитрах цветом.',
      type: 'toggle',
      aiSafe: true,
    },
    // ─── App context section ───
    'app.appId': {
      label: 'Приложение',
      hint: 'Выбор приложения из библиотеки. AI получит полный контекст приложения для генерации.',
      type: 'ref',
      aiSafe: true,
      appSelectField: true,
    },
    'app.contextMode': {
      label: 'Режим контекста приложения',
      hint: 'full — вся информация (scenarioContext, creativeAngles). light — только name/description. manual_only — только ручной override. off — без контекста.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['full', 'light', 'manual_only', 'off'],
    },
    'app.manualOverrideSummary': {
      label: 'Ручной контекст приложения',
      hint: 'Произвольное описание приложения, если хотите переопределить данные из библиотеки.',
      type: 'text',
      aiSafe: true,
      maxLength: 500,
    },
    'app.appCenterStrength': {
      label: 'Центрированность приложения',
      hint: 'strong — приложение в центре сюжета. soft — мягкая интеграция. background — фоновое упоминание.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['strong', 'soft', 'background'],
    },
    // ─── Voiceover section ───
    'voiceover.enabled': {
      label: 'Озвучка',
      hint: 'Включить генерацию плана озвучки (VoiceoverPlan).',
      type: 'toggle',
      aiSafe: true,
    },
    'voiceover.narratorPersona': {
      label: 'Персона рассказчика',
      hint: 'Описание голоса: "спокойный мужской голос 30 лет", "энергичная женщина".',
      type: 'text',
      aiSafe: true,
      maxLength: 150,
    },
    'voiceover.pacing': {
      label: 'Темп озвучки',
      hint: 'slow — медленно, с паузами. moderate — обычный. fast — быстрый.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['slow', 'moderate', 'fast'],
    },
    'voiceover.syncMode': {
      label: 'Режим синхронизации',
      hint: 'scene — озвучка привязана к сценам. continuous — единый поток. highlights — только ключевые моменты.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['scene', 'continuous', 'highlights'],
    },
  },

  video: {
    format: {
      label: 'Формат',
      hint: 'Вертикальное 9:16 — для TikTok, Instagram Reels, YouTube Shorts. Горизонтальное 16:9 — для обычных видео YouTube.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['vertical', 'horizontal'],
    },
    quality: {
      label: 'Качество',
      hint: '1080p — Full HD, лучшее качество. 720p — быстрее рендер, меньше размер файла.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['720p', '1080p'],
    },
    enableMusic: {
      label: 'Музыка',
      hint: 'Добавить фоновую музыку к видео. Автоматически подбирается под настроение контента.',
      type: 'toggle',
      aiSafe: true,
    },
    modelStrategy: {
      label: 'Стратегия моделей',
      hint: 'auto — система подбирает. budget/fast_draft — дёшево и быстро. balanced — стандарт. story_continuity — для сюжетных видео. high_realism — премиум.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['auto', 'budget', 'fast_draft', 'balanced', 'story_continuity', 'high_realism'],
    },
    imageModelId: {
      label: 'Модель изображений',
      hint: 'Какая модель fal.ai используется для генерации изображений сцен. FLUX Schnell — быстро и дёшево. FLUX Dev — качественнее, но дороже.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['fal-ai/flux/schnell', 'fal-ai/flux/dev'],
    },
    videoModelId: {
      label: 'Модель видео',
      hint: 'Какая модель fal.ai генерирует клипы. Kling Standard — сбалансированно. Kling Pro — выше качество, дороже.',
      type: 'select',
      aiSafe: true,
    },
    sceneCount: {
      label: 'Количество сцен',
      hint: 'Сколько кадров/сцен будет в видео. Больше сцен = больше изображений и клипов = дороже. Переопределяется планом сценария если подключён блок Сценарий.',
      type: 'number',
      aiSafe: true,
      allowedValues: ['2', '3', '4', '5', '6', '7', '8'],
    },
    clipDuration: {
      label: 'Длительность клипа',
      hint: 'Секунд на один клип (3-15). Итог = количество сцен × длительность клипа. Переопределяется планом сценария.',
      type: 'number',
      aiSafe: true,
    },
    generateAudio: {
      label: 'Аудио в клипах',
      hint: 'Kling может генерировать встроенный звук. Отключение экономит ~50% стоимости клипов.',
      type: 'toggle',
      aiSafe: true,
    },
    subtitlesEnabled: {
      label: 'Субтитры',
      hint: 'Накладывать субтитры на итоговое видео (FFmpeg, бесплатно).',
      type: 'toggle',
      aiSafe: true,
    },
    subtitlePreset: {
      label: 'Пресет субтитров',
      hint: 'Fallback стиль если AI не сгенерировал свой. tiktok_classic — белый с обводкой. tiktok_bold_yellow — жёлтый. tiktok_boxed — на плашке. minimal — тонкий.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['tiktok_classic', 'tiktok_bold_yellow', 'tiktok_boxed', 'minimal'],
    },
    voiceoverEnabled: {
      label: 'Озвучка',
      hint: 'Генерировать озвучку через TTS по плану из сценария.',
      type: 'toggle',
      aiSafe: true,
    },
    voiceoverModelId: {
      label: 'Модель TTS',
      hint: 'Kokoro — бесплатный/дешёвый. PlayAI — сбалансирован. ElevenLabs — премиум качество.',
      type: 'select',
      aiSafe: true,
    },
    voiceoverLanguage: {
      label: 'Язык озвучки',
      hint: 'Код языка для TTS. en — English, ru — Русский.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['en', 'ru'],
    },
    voiceoverVoiceId: {
      label: 'ID голоса',
      hint: 'Конкретный голос у провайдера. Пусто = голос по умолчанию.',
      type: 'text',
      aiSafe: false,
      aiBlockReason: 'Зависит от провайдера — выбирается вручную',
    },
    voiceoverPacing: {
      label: 'Темп озвучки',
      hint: 'slow — медленно, с паузами. moderate — обычный. fast — быстро.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['slow', 'moderate', 'fast'],
    },
    voiceoverReconciliation: {
      label: 'Если озвучка длиннее сцены',
      hint: 'compress_audio — ускорить до 1.2x. trim_audio — обрезать по длине клипа.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['compress_audio', 'trim_audio'],
    },
    musicMood: {
      label: 'Настроение музыки',
      hint: 'Влияет на Mubert-подбор: energetic upbeat, calm ambient, dramatic cinematic и т.д.',
      type: 'select',
      aiSafe: true,
      allowedValues: [
        'energetic upbeat',
        'calm ambient',
        'dramatic cinematic',
        'happy positive',
        'dark moody',
        'corporate professional',
      ],
    },
    musicVolume: {
      label: 'Громкость музыки',
      hint: 'Базовая громкость музыки от 0 до 1. При озвучке уменьшается отдельно.',
      type: 'number',
      aiSafe: true,
    },
    musicVolumeWithVoiceover: {
      label: 'Громкость музыки при озвучке',
      hint: 'Насколько приглушить музыку под голос (ducking). 0 = тишина, 0.5 = половина.',
      type: 'number',
      aiSafe: true,
    },
    maxVideos: {
      label: 'Лимит видео',
      hint: 'Максимум видео за один запуск. 0 = без ограничений.',
      type: 'number',
      aiSafe: true,
    },
    targetPlatform: {
      label: 'Целевая платформа',
      hint: 'Влияет на рекомендуемый формат и последующую выгрузку через Upload блок.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['', 'tiktok', 'instagram', 'youtube'],
    },
  },

  caption_generator: {
    platforms: {
      label: 'Платформы',
      hint: 'Для каких соцсетей генерировать captions. TikTok — каждая ≤ 100 символов на хэштеги, ровно 5 тегов. YouTube — title ≤ 100, до 15 тегов. Instagram — до 30 тегов.',
      type: 'tags',
      aiSafe: true,
      allowedValues: ['tiktok', 'youtube', 'instagram'],
      example: 'tiktok, youtube, instagram',
    },
    styleVariant: {
      label: 'Стиль captions',
      hint: 'viral — максимум engagement и hook. informative — фактологичный. storytelling — повествовательный.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['viral', 'informative', 'storytelling'],
      example: 'viral',
    },
    styleHints: {
      label: 'Подсказки оператора (стиль)',
      hint: 'Опционально — что AI должен учесть при генерации (тон бренда, запреты, форматы).',
      type: 'text',
      aiSafe: true,
      maxLength: 500,
    },
    language: {
      label: 'Язык captions',
      hint: 'auto — AI определит сам по контексту. Иначе вернёт title/description на указанном языке. Хэштеги остаются по конвенции платформы.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['auto', 'en', 'ru', 'es'],
      example: 'auto',
    },
    forceRegenerate: {
      label: 'Перегенерировать существующие captions',
      hint: 'Без галки — caption_generator переиспользует уже сгенерированные captions в этом run scope. С галкой — AI вызывается заново независимо.',
      type: 'toggle',
      aiSafe: false,
      aiBlockReason: 'Поведенческий флаг идемпотентности — выбирается вручную',
    },
    failOnNotFitsLimits: {
      label: 'Fail при выходе за лимиты платформы',
      hint: 'Без галки — captions сохраняются с fitsLimits=false, approve blocked. С галкой — step становится failed, можно retry.',
      type: 'toggle',
      aiSafe: false,
      aiBlockReason: 'Поведенческий флаг ошибки — выбирается вручную',
    },
  },

  upload: {
    appId: {
      label: 'Приложение',
      hint: 'Приложение с привязанными аккаунтами соцсетей. Если в графе есть Scenario с appId — наследуется автоматически.',
      type: 'ref',
      aiSafe: false,
      aiBlockReason: 'Ссылка на системный ресурс — выбирается вручную',
    },
    accountMode: {
      label: 'Режим выбора',
      hint: 'Конкретный аккаунт или группа аккаунтов с распределением.',
      type: 'select',
      aiSafe: false,
      allowedValues: ['account', 'group'],
      example: 'account',
    },
    socialAccountId: {
      label: 'Аккаунт',
      hint: 'Конкретный SocialAccount для публикации (режим «Аккаунт»).',
      type: 'ref',
      aiSafe: false,
      aiBlockReason: 'Ссылка на системный ресурс — выбирается вручную',
    },
    accountGroupId: {
      label: 'Группа аккаунтов',
      hint: 'AccountGroup для публикации (режим «Группа»). Стратегия распределения — в groupDispatchMode.',
      type: 'ref',
      aiSafe: false,
      aiBlockReason: 'Ссылка на системный ресурс — выбирается вручную',
    },
    groupDispatchMode: {
      label: 'Распределение группы',
      hint: 'round_robin — следующий по дате последней публикации; all — публикация на все активные; first_active — первый активный.',
      type: 'select',
      aiSafe: false,
      allowedValues: ['round_robin', 'all', 'first_active'],
      example: 'round_robin',
    },
    uploadPlatforms: {
      label: 'Платформы',
      hint: 'Куда публиковать видео. Можно выбрать несколько платформ одновременно.',
      type: 'tags',
      aiSafe: true,
      allowedValues: ['tiktok', 'instagram', 'youtube'],
    },
    title: {
      label: 'Заголовок',
      hint: 'Название видео. Важно для YouTube, для TikTok/Instagram используется меньше. Будьте кратки и ёмки.',
      type: 'text',
      aiSafe: true,
      maxLength: 100,
      example: 'Как похудеть за 30 дней без диет',
    },
    description: {
      label: 'Описание',
      hint: 'Текст под видео. Важен для YouTube SEO. В TikTok/Instagram — первые строки видны в ленте.',
      type: 'text',
      aiSafe: true,
      maxLength: 500,
      example: 'В этом видео я расскажу...',
    },
    hashtags: {
      label: 'Хештеги',
      hint: 'Теги для поиска и рекомендаций. 5-15 штук оптимально. Без символа #, система добавит сама.',
      type: 'tags',
      aiSafe: true,
      maxLength: 30,
      example: 'фитнес, зож, тренировка',
    },
  },

  idea: {
    mode: {
      label: 'Режим работы',
      hint: 'Из потока (input) — берёт URL из предыдущего блока (Трендвотчер). По URL (url) — анализирует один конкретный URL. Из базы (fetch) — загружает готовые идеи.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['input', 'url', 'fetch'],
      example: 'input',
    },
    sourceUrl: {
      label: 'URL видео',
      hint: 'Ссылка на видео для анализа (только в режиме «По URL»). TikTok, Instagram, YouTube.',
      type: 'text',
      aiSafe: true,
      maxLength: 500,
      example: 'https://tiktok.com/@user/video/123',
    },
    urlField: {
      label: 'Поле с URL',
      hint: 'Имя поля во входных данных, содержащего URL (только в режиме «Из потока»). Если пусто — ищет автоматически.',
      type: 'text',
      aiSafe: true,
      maxLength: 100,
      example: 'sourceUrl',
    },
    language: {
      label: 'Язык анализа',
      hint: 'ISO 639-1 код языка для генерации анализа и CreativeBrief.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['EN', 'RU', 'ES', 'DE', 'FR'],
      example: 'EN',
    },
    ideaStatus: {
      label: 'Статус идей',
      hint: 'Какие идеи загружать из базы (только в режиме «Из базы»). Готовые — для генерации сценариев.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['ready', 'pending', 'completed'],
    },
    limit: {
      label: 'Лимит',
      hint: 'Максимальное количество URL или идей для обработки (1-20). Каждый URL = один вызов AI.',
      type: 'number',
      aiSafe: true,
      example: '5',
    },
  },

  analytics: {
    metrics: {
      label: 'Метрики',
      hint: 'Какие показатели собирать. Просмотры и лайки — базовые. CTR и время просмотра — продвинутые. Чем больше метрик — тем полнее картина.',
      type: 'tags',
      aiSafe: true,
      allowedValues: ['views', 'likes', 'shares', 'comments', 'watchTime', 'ctr'],
    },
    referenceThreshold: {
      label: 'Порог для Reference',
      hint: 'Минимальное значение метрики (обычно просмотров), при котором ролик считается успешным.',
      type: 'number',
      aiSafe: true,
      example: '10000',
    },
  },

  filter: {
    filterMetric: {
      label: 'Метрика',
      hint: 'По какому показателю фильтровать данные. Выберите одну метрику для проверки условия.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['views', 'likes', 'shares', 'comments', 'watchThrough', 'ctr'],
    },
    filterOperator: {
      label: 'Оператор',
      hint: 'Как сравнивать метрику с пороговым значением.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['>', '<', '=', '>=', '<='],
    },
    filterValue: {
      label: 'Значение',
      hint: 'Пороговое значение для сравнения. Например: 10000 для фильтра "просмотры > 10000".',
      type: 'number',
      aiSafe: true,
      example: '10000',
    },
  },

  notification: {
    channel: {
      label: 'Канал',
      hint: 'Куда отправлять уведомление. Сейчас поддерживается Telegram.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['telegram'],
    },
    mode: {
      label: 'Режим',
      hint: 'Способ формирования сообщения: написать текст вручную или использовать сохранённый шаблон.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['message', 'template'],
    },
    message: {
      label: 'Сообщение',
      hint: 'Текст уведомления. Можно использовать шаблоны {{ }} для вставки данных из конвейера. Например: "Видео {{title}} опубликовано!"',
      type: 'text',
      aiSafe: true,
      maxLength: 1000,
      example: 'Конвейер завершён! Обработано {{ count }} видео.',
    },
    templateKey: {
      label: 'Ключ шаблона',
      hint: 'Ключ шаблона из раздела Telegram → Шаблоны. Используется в режиме "template".',
      type: 'text',
      aiSafe: true,
      example: 'cycle_complete',
    },
    alertType: {
      label: 'Тип оповещения',
      hint: 'Определяет маршрутизацию: в какие чаты попадёт уведомление (по routing tags).',
      type: 'select',
      aiSafe: true,
      allowedValues: ['cycle_started', 'upload_success', 'critical_error', 'idea_created', 'custom'],
    },
  },

  http_request: {
    method: {
      label: 'Метод',
      hint: 'HTTP метод запроса. GET — получить данные. POST — отправить данные. PUT — обновить. DELETE — удалить.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['GET', 'POST', 'PUT', 'DELETE'],
    },
    url: {
      label: 'URL',
      hint: 'Адрес внешнего API. Поддерживаются шаблоны {{ }} для динамических значений.',
      type: 'text',
      aiSafe: true,
      maxLength: 500,
      example: 'https://api.example.com/data',
    },
    authCredentialId: {
      label: 'Авторизация',
      hint: 'Учётные данные для запроса. Секреты хранятся зашифрованными и не попадают в граф конвейера.',
      type: 'ref',
      aiSafe: false,
      aiBlockReason: 'Содержит секреты — выбирается вручную',
    },
    headers: {
      label: 'Заголовки',
      hint: 'HTTP заголовки в формате JSON. НЕ вставляйте сюда токены и пароли — используйте поле Авторизация.',
      type: 'json',
      aiSafe: false,
      aiBlockReason: 'Может содержать секреты и токены авторизации',
    },
    body: {
      label: 'Тело запроса',
      hint: 'Данные запроса в формате JSON. Отправляется только для POST и PUT методов.',
      type: 'json',
      aiSafe: true,
      maxLength: 2000,
      example: '{"key": "value"}',
    },
  },

  code: {
    code: {
      label: 'JavaScript код',
      hint: 'Код для трансформации данных. Доступны: input (входные данные), config (конфигурация), стандартные JS объекты. Запрещены: сеть, файлы, async.',
      type: 'code',
      aiSafe: false,
      aiBlockReason: 'Исполняемый код — требует ручной проверки пользователем',
    },
  },

  set: {
    fields: {
      label: 'Поля',
      hint: 'Пары "имя поля → значение". Можно использовать шаблоны {{ }} для динамических значений из потока данных.',
      type: 'json',
      aiSafe: true,
      example: '[{"name": "status", "value": "processed"}]',
    },
  },

  if_switch: {
    field: {
      label: 'Поле для проверки',
      hint: 'Имя поля из входных данных для проверки условия. Например: status, count, type.',
      type: 'text',
      aiSafe: true,
      maxLength: 100,
      example: 'status',
    },
    operator: {
      label: 'Оператор',
      hint: 'Тип сравнения. "Содержит" — для текстового поиска внутри строки.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['>', '<', '==', '!=', 'contains'],
    },
    value: {
      label: 'Значение',
      hint: 'С чем сравнивать. Для чисел — числовое значение. Для строк — текст. Результат: main (true) или error (false).',
      type: 'text',
      aiSafe: true,
      maxLength: 200,
      example: 'success',
    },
  },

  loop: {
    arrayField: {
      label: 'Поле с массивом',
      hint: 'Имя поля, содержащего массив. Каждый элемент будет передан следующей ноде как отдельный input.',
      type: 'text',
      aiSafe: true,
      maxLength: 100,
      example: 'items',
    },
  },

  wait: {
    delaySeconds: {
      label: 'Задержка',
      hint: 'Время паузы перед продолжением конвейера. Полезно для rate limiting внешних API.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['5', '30', '60', '300', '900'],
    },
  },

  sub_pipeline: {
    pipelineId: {
      label: 'Целевой конвейер',
      hint: 'Какой конвейер запустить как подпроцесс. Убедитесь, что целевой конвейер активен.',
      type: 'ref',
      aiSafe: false,
      aiBlockReason: 'Ссылка на системный ресурс — выбирается вручную',
    },
    mode: {
      label: 'Режим выполнения',
      hint: 'Ожидать — блокирует родительский конвейер до конца. Запустить и продолжить — не ждёт результата.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['wait', 'fire_and_forget'],
    },
  },

  google_drive_uploader: {
    credentialId: {
      label: 'Учётные данные Drive',
      hint: 'Service Account для Google Drive, у которого есть права writer на целевую папку. Создаётся в /google-drive.',
      type: 'ref',
      aiSafe: false,
      aiBlockReason: 'Ссылка на системный ресурс — выбирается вручную',
    },
    folderId: {
      label: 'Folder ID',
      hint: 'ID целевой папки Drive (из URL: drive.google.com/drive/folders/<ID>). Папка должна быть расшарена на client_email сервис-аккаунта с ролью Editor.',
      type: 'text',
      aiSafe: false,
      aiBlockReason: 'Ссылка на системный ресурс — выбирается вручную',
      maxLength: 200,
    },
    nameTemplate: {
      label: 'Шаблон имени',
      hint: 'Имя файла на Drive. Поддерживаются плейсхолдеры {video.title}, {video.id} и оператор || для fallback.',
      type: 'text',
      aiSafe: true,
      maxLength: 200,
      example: '{video.title || "video-" + video.id}.mp4',
    },
    skipIfAlreadyUploaded: {
      label: 'Пропускать уже залитые',
      hint: 'Если у видео уже есть driveFileId — не перезаливать (идемпотентность).',
      type: 'toggle',
      aiSafe: false,
      aiBlockReason: 'Поведенческий флаг идемпотентности — выбирается вручную',
    },
  },

  character: {
    appId: {
      label: 'Приложение',
      hint: 'Из библиотеки какого приложения брать персонажа. У каждого приложения свой пул персонажей.',
      type: 'ref',
      aiSafe: true,
      appSelectField: true,
    },
    mode: {
      label: 'Стратегия выбора',
      hint: 'fixed — конкретный персонаж по characterId. first — последний обновлённый из пула. random — случайный.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['fixed', 'first', 'random'],
      example: 'first',
    },
    characterId: {
      label: 'Персонаж',
      hint: 'Конкретный персонаж из библиотеки (только в режиме fixed). Выбирается вручную.',
      type: 'ref',
      aiSafe: false,
      aiBlockReason: 'Ссылка на конкретную сущность — выбирается пользователем',
    },
    tag: {
      label: 'Фильтр по тегу',
      hint: 'Опциональный фильтр по тегу персонажа (только в режимах first/random). Пусто — берёт из всего пула.',
      type: 'text',
      aiSafe: true,
      maxLength: 50,
      example: 'female',
    },
  },

  scene_composer: {
    appId: {
      label: 'Приложение',
      hint: 'Из библиотеки какого приложения брать сцену. У каждого приложения свой пул сцен композитора.',
      type: 'ref',
      aiSafe: true,
      appSelectField: true,
    },
    mode: {
      label: 'Стратегия выбора',
      hint: 'fixed — конкретная сцена по sceneId. latest — последняя обновлённая. random — случайная.',
      type: 'select',
      aiSafe: true,
      allowedValues: ['fixed', 'latest', 'random'],
      example: 'latest',
    },
    sceneId: {
      label: 'Сцена',
      hint: 'Конкретная сцена из библиотеки композитора (только в режиме fixed). Выбирается вручную.',
      type: 'ref',
      aiSafe: false,
      aiBlockReason: 'Ссылка на конкретную сущность — выбирается пользователем',
    },
  },

  /**
   * character_entity / scene_entity — это поля МОДЕЛЕЙ (Character/Scene),
   * а НЕ конфиг pipeline-ноды. Используются endpoint'ом /api/ai/suggest/entity
   * для AI-автозаполнения формы в CharacterCreateModal / CharacterEdit / Scene*.
   * Здесь нет ссылок на ресурсы (appId/characterId/sceneId) — только пользовательский
   * контент персонажа/сцены.
   */
  character_entity: {
    name: {
      label: 'Имя',
      hint: 'Короткое имя/прозвище персонажа.',
      type: 'text',
      aiSafe: true,
      maxLength: 100,
    },
    description: {
      label: 'Описание',
      hint: 'Внешность + характер + важные детали (RU).',
      type: 'text',
      aiSafe: true,
      maxLength: 500,
    },
    visualPrompt: {
      label: 'Visual prompt',
      hint: 'Одна строка для video-генератора. EN, без местоимений, конкретные визуальные дескрипторы (возраст, причёска, одежда, мимика).',
      type: 'text',
      aiSafe: true,
      maxLength: 800,
    },
    emotionDefault: {
      label: 'Базовая эмоция',
      hint: 'curious / calm / serious / friendly. EN, одно слово.',
      type: 'text',
      aiSafe: true,
      maxLength: 50,
    },
    ageRange: {
      label: 'Возраст',
      hint: 'Диапазон вида "25-30", "teen", "elderly".',
      type: 'text',
      aiSafe: true,
      maxLength: 50,
    },
    role: {
      label: 'Роль',
      hint: 'main (главный), support (второстепенный), extra (массовка).',
      type: 'select',
      aiSafe: true,
      allowedValues: ['main', 'support', 'extra'],
      example: 'main',
    },
    tags: {
      label: 'Теги',
      hint: 'Массив коротких ярлыков (фитнес, рассказчик, лидер). Каждый тег до 30 символов.',
      type: 'tags',
      aiSafe: true,
      maxLength: 30,
    },
  },

  scene_entity: {
    name: {
      label: 'Название сцены',
      hint: 'Короткое описательное имя сцены (Кухня утром, Финал коммерческого).',
      type: 'text',
      aiSafe: true,
      maxLength: 100,
    },
    description: {
      label: 'Описание',
      hint: 'Атмосфера, действие, ключевые элементы кадра. RU.',
      type: 'text',
      aiSafe: true,
      maxLength: 500,
    },
    tags: {
      label: 'Теги',
      hint: 'Массив ярлыков (утро, indoor, mood). Каждый тег до 30 символов.',
      type: 'tags',
      aiSafe: true,
      maxLength: 30,
    },
  },
}

/**
 * Получить безопасные для AI поля ноды (для block-level autofill).
 */
export function getAiSafeFields(nodeType: string): Record<string, FieldSchema> {
  const schema = nodeFieldSchemas[nodeType]
  if (!schema) return {}
  return Object.fromEntries(
    Object.entries(schema).filter(([, f]) => f.aiSafe),
  )
}

/**
 * Получить заблокированные для AI поля с причинами.
 */
export function getAiBlockedFields(nodeType: string): Array<{ field: string; label: string; reason: string }> {
  const schema = nodeFieldSchemas[nodeType]
  if (!schema) return []
  return Object.entries(schema)
    .filter(([, f]) => !f.aiSafe)
    .map(([key, f]) => ({ field: key, label: f.label, reason: f.aiBlockReason || 'Небезопасно для AI' }))
}

/**
 * Валидировать AI output по схеме — обрезать длинные значения, отфильтровать невалидные.
 */
export function validateAiOutput(
  nodeType: string,
  output: Record<string, unknown>,
): { safe: Record<string, unknown>; blocked: Array<{ field: string; reason: string }> } {
  const schema = nodeFieldSchemas[nodeType]
  if (!schema) return { safe: {}, blocked: [] }

  const safe: Record<string, unknown> = {}
  const blocked: Array<{ field: string; reason: string }> = []

  for (const [key, value] of Object.entries(output)) {
    const field = schema[key]

    // Поле не в схеме — блокируем
    if (!field) {
      blocked.push({ field: key, reason: 'Неизвестное поле' })
      continue
    }

    // Поле не безопасно для AI
    if (!field.aiSafe) {
      blocked.push({ field: key, reason: field.aiBlockReason || 'Небезопасно для AI' })
      continue
    }

    // Taxonomy поля — валидируются серверно через БД, пропускаем тут
    if (field.type === 'taxonomy') {
      safe[key] = value
      continue
    }

    // Проверка допустимых значений
    if (field.allowedValues?.length) {
      if (Array.isArray(value)) {
        const filtered = (value as string[]).filter(v => field.allowedValues!.includes(String(v)))
        if (filtered.length === 0) {
          blocked.push({ field: key, reason: 'Ни одно значение не входит в допустимые' })
          continue
        }
        safe[key] = filtered
      } else if (!field.allowedValues.includes(String(value))) {
        blocked.push({ field: key, reason: `Значение "${value}" не входит в допустимые: ${field.allowedValues.join(', ')}` })
        continue
      } else {
        safe[key] = value
      }
      continue
    }

    // Проверка длины
    if (field.maxLength && typeof value === 'string' && value.length > field.maxLength) {
      safe[key] = value.slice(0, field.maxLength)
      continue
    }

    if (field.maxLength && Array.isArray(value)) {
      safe[key] = (value as string[]).map(v =>
        typeof v === 'string' && v.length > field.maxLength! ? v.slice(0, field.maxLength!) : v,
      )
      continue
    }

    safe[key] = value
  }

  return { safe, blocked }
}
