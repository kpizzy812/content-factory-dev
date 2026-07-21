<script setup lang="ts">
import type { AdminApp } from '~~/shared/types/app'

const props = defineProps<{
  app?: AdminApp | null
}>()

const emit = defineEmits<{
  saved: [app: unknown]
  cancel: []
}>()

const isEdit = computed(() => !!props.app)
const { enriching, enrichResult, enrichError, enrichmentMeta, enrich, enrichPreview } = useAppEnrich()

// --- Form state ---
const form = ref({
  name: props.app?.name ?? '',
  description: props.app?.description ?? '',
  keywordsText: props.app?.keywords?.join('\n') ?? '',
  geo: props.app?.geo ?? '',
  language: props.app?.language ?? '',
  // Store URLs
  appStoreUrl: props.app?.appStoreUrl ?? '',
  playStoreUrl: props.app?.playStoreUrl ?? '',
  // Metadata
  productName: props.app?.productName ?? '',
  subtitle: props.app?.subtitle ?? '',
  longDescription: props.app?.longDescription ?? '',
  developer: props.app?.developer ?? '',
  categoriesText: props.app?.categories?.join(', ') ?? '',
  targetAudience: props.app?.targetAudience ?? '',
  pricingNotes: props.app?.pricingNotes ?? '',
  iconUrl: props.app?.iconUrl ?? '',
  // Media
  screenshotUrls: props.app?.screenshotUrls ?? [] as string[],
  heroImageUrl: props.app?.heroImageUrl ?? '',
  // AI context
  featureBulletsText: props.app?.featureBullets?.join('\n') ?? '',
  asoKeywordsText: props.app?.asoKeywords?.join('\n') ?? '',
  onboardingSummary: props.app?.onboardingSummary ?? '',
  aiSummary: props.app?.aiSummary ?? '',
  brandTone: props.app?.brandTone ?? '',
  visualCues: props.app?.visualCues ?? '',
  forbiddenClaimsText: props.app?.forbiddenClaims?.join('\n') ?? '',
  riskyClaimsText: props.app?.riskyClaims?.join('\n') ?? '',
  transformationPromise: props.app?.transformationPromise ?? '',
  corePain: props.app?.corePain ?? '',
  coreOutcome: props.app?.coreOutcome ?? '',
})

// JSON-поля, которые не редактируются напрямую, но должны пройти через create/update flow
const jsonFields = ref({
  creativeAngles: props.app?.creativeAngles ?? null as unknown,
  scenarioContext: props.app?.scenarioContext ?? null as unknown,
  storePlatforms: props.app?.storePlatforms ?? [] as string[],
})

const saving = ref(false)
const error = ref('')
// Если включено — geo/язык извлекаются из локали в App Store URL (apps.apple.com/ru/…),
// иначе используется дефолт US/EN.
const useUrlLocale = ref(true)

const enrichmentStatus = computed(() => props.app?.enrichmentStatus ?? null)
const lastEnrichedAt = computed(() => {
  if (!props.app?.lastEnrichedAt) return null
  return new Date(props.app.lastEnrichedAt).toLocaleString('ru-RU')
})

const storeUrlForEnrich = computed(() => form.value.appStoreUrl || form.value.playStoreUrl)

// --- Enrich ---
async function handleEnrich() {
  const url = storeUrlForEnrich.value
  if (!url) return

  if (isEdit.value && props.app) {
    // Existing app: enrich and save to DB
    const { app: updatedApp } = await enrich(props.app.id, url)
    if (updatedApp) {
      applyAppToForm(updatedApp)
    }
  } else {
    // New app: enrich preview (in memory, no DB save yet)
    const { formFields } = await enrichPreview(url, {
      appName: form.value.name || undefined,
      description: form.value.description || undefined,
      keywords: textToArray(form.value.keywordsText),
      geo: form.value.geo || undefined,
      language: form.value.language || undefined,
      useUrlLocale: useUrlLocale.value,
    })
    if (formFields) {
      applyFormFields(formFields)
    }
  }
}

function applyAppToForm(app: AdminApp) {
  form.value.productName = app.productName ?? ''
  form.value.description = app.description ?? form.value.description
  form.value.subtitle = app.subtitle ?? ''
  form.value.longDescription = app.longDescription ?? ''
  form.value.developer = app.developer ?? ''
  form.value.categoriesText = app.categories?.join(', ') ?? ''
  form.value.targetAudience = app.targetAudience ?? ''
  form.value.pricingNotes = app.pricingNotes ?? ''
  form.value.iconUrl = app.iconUrl ?? ''
  form.value.screenshotUrls = app.screenshotUrls ?? []
  form.value.heroImageUrl = app.heroImageUrl ?? ''
  form.value.featureBulletsText = app.featureBullets?.join('\n') ?? ''
  form.value.asoKeywordsText = app.asoKeywords?.join('\n') ?? ''
  form.value.onboardingSummary = app.onboardingSummary ?? ''
  form.value.aiSummary = app.aiSummary ?? ''
  form.value.brandTone = app.brandTone ?? ''
  form.value.visualCues = app.visualCues ?? ''
  form.value.forbiddenClaimsText = app.forbiddenClaims?.join('\n') ?? ''
  form.value.riskyClaimsText = app.riskyClaims?.join('\n') ?? ''
  form.value.transformationPromise = app.transformationPromise ?? ''
  form.value.corePain = app.corePain ?? ''
  form.value.coreOutcome = app.coreOutcome ?? ''
  form.value.appStoreUrl = app.appStoreUrl ?? ''
  form.value.playStoreUrl = app.playStoreUrl ?? ''
  // JSON-поля
  jsonFields.value.creativeAngles = app.creativeAngles ?? null
  jsonFields.value.scenarioContext = app.scenarioContext ?? null
  jsonFields.value.storePlatforms = app.storePlatforms ?? []
}

/** Применяет formFields из enrich-preview к форме. */
function applyFormFields(fields: Record<string, unknown>) {
  const s = (v: unknown) => typeof v === 'string' ? v : ''
  const a = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

  if (fields.productName) form.value.productName = s(fields.productName)
  if (fields.description) form.value.description = s(fields.description)
  if (fields.subtitle) form.value.subtitle = s(fields.subtitle)
  if (fields.longDescription) form.value.longDescription = s(fields.longDescription)
  if (fields.developer) form.value.developer = s(fields.developer)
  if (fields.categories) form.value.categoriesText = a(fields.categories).join(', ')
  if (fields.targetAudience) form.value.targetAudience = s(fields.targetAudience)
  if (fields.pricingNotes) form.value.pricingNotes = s(fields.pricingNotes)
  if (fields.iconUrl) form.value.iconUrl = s(fields.iconUrl)
  if (fields.featureBullets) form.value.featureBulletsText = a(fields.featureBullets).join('\n')
  if (fields.asoKeywords) form.value.asoKeywordsText = a(fields.asoKeywords).join('\n')
  if (fields.onboardingSummary) form.value.onboardingSummary = s(fields.onboardingSummary)
  if (fields.aiSummary) form.value.aiSummary = s(fields.aiSummary)
  if (fields.brandTone) form.value.brandTone = s(fields.brandTone)
  if (fields.visualCues) form.value.visualCues = s(fields.visualCues)
  if (fields.forbiddenClaims) form.value.forbiddenClaimsText = a(fields.forbiddenClaims).join('\n')
  if (fields.riskyClaims) form.value.riskyClaimsText = a(fields.riskyClaims).join('\n')
  if (fields.transformationPromise) form.value.transformationPromise = s(fields.transformationPromise)
  if (fields.corePain) form.value.corePain = s(fields.corePain)
  if (fields.coreOutcome) form.value.coreOutcome = s(fields.coreOutcome)
  if (fields.appStoreUrl) form.value.appStoreUrl = s(fields.appStoreUrl)
  if (fields.playStoreUrl) form.value.playStoreUrl = s(fields.playStoreUrl)

  // Media
  if (fields.screenshotUrls) form.value.screenshotUrls = a(fields.screenshotUrls)
  if (fields.heroImageUrl) form.value.heroImageUrl = s(fields.heroImageUrl)

  // JSON-поля (не редактируются в форме, но передаются при сохранении)
  if (fields.creativeAngles) jsonFields.value.creativeAngles = fields.creativeAngles
  if (fields.scenarioContext) jsonFields.value.scenarioContext = fields.scenarioContext
  if (fields.storePlatforms) jsonFields.value.storePlatforms = a(fields.storePlatforms)

  // Geo / language — применяем если форма пуста (user-provided имеет приоритет)
  if (fields.geo && !form.value.geo) form.value.geo = s(fields.geo)
  if (fields.language && !form.value.language) form.value.language = s(fields.language)

  // Auto-fill name из productName если имя ещё пустое
  if (!form.value.name && fields.productName) form.value.name = s(fields.productName)
}

// --- Provenance helpers ---
const PARSER_KEY_FOR_REQUIRED: Record<string, string> = {
  productName: 'productName',
  longDescription: 'description',
  developer: 'developer',
  iconUrl: 'iconUrl',
}

function requiredFieldLabel(field: string): string {
  return { productName: 'Название', longDescription: 'Описание', developer: 'Разработчик', iconUrl: 'Иконка' }[field] ?? field
}

function requiredFieldSource(field: string) {
  const report = enrichResult.value?.extractionReport
  if (!report) return null
  const parserKey = PARSER_KEY_FOR_REQUIRED[field]
  return parserKey ? report.sources[parserKey] ?? null : null
}

function requiredFieldClass(field: string): string {
  const src = requiredFieldSource(field)
  if (!src) return 'badge-error badge-outline'
  if (src.source === 'ai_fallback') return 'badge-warning'
  if (src.source.startsWith('parser_')) return 'badge-success badge-outline'
  return 'badge-ghost'
}

function requiredFieldIcon(field: string): string {
  const src = requiredFieldSource(field)
  if (!src) return 'mingcute:close-circle-line'
  if (src.source === 'ai_fallback') return 'mingcute:ai-line'
  return 'mingcute:check-line'
}

function requiredFieldTitle(field: string): string {
  const src = requiredFieldSource(field)
  if (!src) return `${requiredFieldLabel(field)} не извлечено`
  return `Источник: ${sourceLabel(src.source)}${src.confidence ? ` • ${Math.round(src.confidence * 100)}%` : ''}`
}

function sourceLabel(source: string): string {
  return ({
    parser_jsonld: 'JSON-LD',
    parser_structured: 'structured',
    parser_meta: 'meta tags',
    parser_dom: 'DOM',
    parser_regex: 'regex',
    ai_fallback: 'AI',
    user: 'пользователь',
    default: 'default',
  } as Record<string, string>)[source] ?? source
}

function sourceBadgeClass(source: string): string {
  if (source === 'ai_fallback') return 'badge-warning'
  if (source === 'user') return 'badge-info'
  if (source === 'default') return 'badge-ghost'
  return 'badge-success badge-outline'
}

// --- Submit ---
function textToArray(text: string, separator = '\n'): string[] {
  return text.split(separator).map(s => s.trim()).filter(Boolean)
}

async function submit() {
  if (!form.value.name.trim()) {
    error.value = 'Название обязательно'
    return
  }

  saving.value = true
  error.value = ''

  const body: Record<string, unknown> = {
    name: form.value.name.trim(),
    description: form.value.description.trim() || undefined,
    keywords: textToArray(form.value.keywordsText),
    geo: form.value.geo.trim() || undefined,
    language: form.value.language.trim() || undefined,
    appStoreUrl: form.value.appStoreUrl.trim() || undefined,
    playStoreUrl: form.value.playStoreUrl.trim() || undefined,
    storePlatforms: jsonFields.value.storePlatforms.length ? jsonFields.value.storePlatforms : undefined,
    productName: form.value.productName.trim() || undefined,
    subtitle: form.value.subtitle.trim() || undefined,
    longDescription: form.value.longDescription.trim() || undefined,
    developer: form.value.developer.trim() || undefined,
    categories: textToArray(form.value.categoriesText, ','),
    targetAudience: form.value.targetAudience.trim() || undefined,
    pricingNotes: form.value.pricingNotes.trim() || undefined,
    iconUrl: form.value.iconUrl.trim() || undefined,
    screenshotUrls: form.value.screenshotUrls.length ? form.value.screenshotUrls : undefined,
    heroImageUrl: form.value.heroImageUrl.trim() || undefined,
    featureBullets: textToArray(form.value.featureBulletsText),
    asoKeywords: textToArray(form.value.asoKeywordsText),
    onboardingSummary: form.value.onboardingSummary.trim() || undefined,
    aiSummary: form.value.aiSummary.trim() || undefined,
    brandTone: form.value.brandTone.trim() || undefined,
    visualCues: form.value.visualCues.trim() || undefined,
    forbiddenClaims: textToArray(form.value.forbiddenClaimsText),
    riskyClaims: textToArray(form.value.riskyClaimsText),
    creativeAngles: jsonFields.value.creativeAngles || undefined,
    transformationPromise: form.value.transformationPromise.trim() || undefined,
    corePain: form.value.corePain.trim() || undefined,
    coreOutcome: form.value.coreOutcome.trim() || undefined,
    scenarioContext: jsonFields.value.scenarioContext || undefined,
  }

  // При создании: передать enrichmentMeta если был enrich-preview
  if (!isEdit.value && enrichmentMeta.value) {
    body.enrichmentMeta = enrichmentMeta.value
  }

  try {
    let result
    if (isEdit.value && props.app) {
      result = await $fetch(`/api/admin/apps/${props.app.id}`, {
        method: 'PUT',
        body,
      })
    }
    else {
      result = await $fetch('/api/admin/apps', {
        method: 'POST',
        body,
      })
    }
    emit('saved', result)
  }
  catch (e: unknown) {
    error.value = (e as Error).message || 'Ошибка сохранения'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Статус обогащения -->
    <div v-if="isEdit && enrichmentStatus" class="flex items-center gap-2 text-sm">
      <span
        class="badge badge-sm"
        :class="{
          'badge-success': enrichmentStatus === 'completed',
          'badge-warning': enrichmentStatus === 'partial' || enrichmentStatus === 'running',
          'badge-error': enrichmentStatus === 'failed',
          'badge-ghost': enrichmentStatus === 'idle',
        }"
      >
        {{ enrichmentStatus === 'completed' ? 'Обогащено' :
           enrichmentStatus === 'partial' ? 'Частично' :
           enrichmentStatus === 'running' ? 'Анализ...' :
           enrichmentStatus === 'failed' ? 'Ошибка' : 'Не обогащено' }}
      </span>
      <span v-if="lastEnrichedAt" class="text-base-content/60">
        Обновлено: {{ lastEnrichedAt }}
      </span>
    </div>

    <!-- === СЕКЦИЯ: Store URL и обогащение (доступна и при создании) === -->
    <div class="card bg-base-200/50">
      <div class="card-body p-4 gap-3">
        <h3 class="card-title text-sm">
          <Icon name="mingcute:store-2-line" class="size-4" />
          {{ isEdit ? 'Обогащение из магазина' : 'Автозаполнение из магазина' }}
        </h3>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">App Store URL</legend>
            <input
              v-model="form.appStoreUrl"
              type="url"
              class="input input-sm w-full"
              placeholder="https://apps.apple.com/..."
            />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Google Play URL</legend>
            <input
              v-model="form.playStoreUrl"
              type="url"
              class="input input-sm w-full"
              placeholder="https://play.google.com/store/apps/..."
            />
          </fieldset>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <button
            class="btn btn-secondary btn-sm"
            :disabled="enriching || !storeUrlForEnrich"
            @click="handleEnrich"
          >
            <span v-if="enriching" class="loading loading-spinner loading-sm" />
            <Icon v-else name="mingcute:sparkles-2-line" class="size-4" />
            Проанализировать и заполнить
          </button>
          <label class="label cursor-pointer gap-2 py-0" title="Извлекать гео и язык из локали в App Store URL (apps.apple.com/ru/...). Если выключено — по умолчанию US/EN.">
            <input v-model="useUrlLocale" type="checkbox" class="checkbox checkbox-xs checkbox-secondary" />
            <span class="label-text text-xs">Гео из ссылки</span>
          </label>
          <span v-if="enriching" class="text-sm text-base-content/60">
            Загрузка страницы и AI-анализ...
          </span>
          <span v-if="!isEdit && enrichResult" class="badge badge-sm" :class="enrichResult.status === 'completed' ? 'badge-success' : enrichResult.status === 'partial' ? 'badge-warning' : 'badge-ghost'">
            {{ enrichResult.status === 'completed' ? 'Данные загружены' : enrichResult.status === 'partial' ? 'Частично загружено' : 'Ожидание' }}
          </span>
        </div>

        <div v-if="enrichError" role="alert" class="alert alert-error alert-soft text-sm py-2">
          <Icon name="mingcute:warning-line" class="size-4" />
          <span>{{ enrichError }}</span>
        </div>

        <div v-if="enrichResult" role="alert" class="alert alert-soft text-sm py-2" :class="enrichResult.status === 'completed' ? 'alert-success' : enrichResult.status === 'partial' ? 'alert-warning' : 'alert-error'">
          <Icon :name="enrichResult.status === 'completed' ? 'mingcute:check-circle-line' : enrichResult.status === 'partial' ? 'mingcute:information-line' : 'mingcute:warning-line'" class="size-4" />
          <span>{{ enrichResult.message }}</span>
        </div>

        <!-- Debug: field-level provenance -->
        <div v-if="enrichResult?.extractionReport" class="space-y-2 mt-2">
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="text-base-content/70">Полей из магазина:</span>
            <span class="badge badge-ghost badge-sm">{{ enrichResult.extractionReport.found.length }}</span>
            <span class="text-base-content/70">Не найдено:</span>
            <span class="badge badge-ghost badge-sm">{{ enrichResult.extractionReport.missing.length }}</span>
            <span v-if="enrichResult.extractionReport.aiBackfilled?.length" class="text-base-content/70">
              AI-backfill:
            </span>
            <span v-if="enrichResult.extractionReport.aiBackfilled?.length" class="badge badge-warning badge-sm">
              {{ enrichResult.extractionReport.aiBackfilled.length }}
            </span>
          </div>

          <!-- Required fields status -->
          <div class="flex flex-wrap gap-1">
            <template v-for="field in ['productName', 'longDescription', 'developer', 'iconUrl']" :key="field">
              <span
                class="badge badge-sm"
                :class="requiredFieldClass(field)"
                :title="requiredFieldTitle(field)"
              >
                <Icon :name="requiredFieldIcon(field)" class="size-3" />
                {{ requiredFieldLabel(field) }}
              </span>
            </template>
          </div>

          <!-- Per-source breakdown -->
          <details class="text-xs">
            <summary class="cursor-pointer text-base-content/60 hover:text-base-content">
              Подробный разбор источников ({{ Object.keys(enrichResult.extractionReport.sources).length }})
            </summary>
            <div class="mt-2 space-y-0.5 pl-2 border-l border-base-300">
              <div
                v-for="(prov, fieldName) in enrichResult.extractionReport.sources"
                :key="fieldName"
                class="flex items-center gap-2"
              >
                <span class="font-mono text-base-content/80 min-w-[9rem]">{{ fieldName }}</span>
                <span class="badge badge-xs" :class="sourceBadgeClass(prov.source)">
                  {{ sourceLabel(prov.source) }}
                </span>
                <span v-if="prov.confidence !== undefined" class="text-base-content/50">
                  {{ Math.round((prov.confidence ?? 0) * 100) }}%
                </span>
              </div>
              <div
                v-for="field in enrichResult.extractionReport.requiredMissing"
                :key="`missing-${field}`"
                class="flex items-center gap-2"
              >
                <span class="font-mono text-error/80 min-w-[9rem]">{{ field }}</span>
                <span class="badge badge-xs badge-error">not found</span>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>

    <!-- === СЕКЦИЯ: Основное === -->
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Название *</legend>
      <input v-model="form.name" type="text" class="input input-sm w-full" placeholder="Название приложения" />
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">Описание</legend>
      <textarea v-model="form.description" class="textarea textarea-sm w-full" rows="2" placeholder="Краткое описание" />
    </fieldset>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Гео</legend>
        <select v-model="form.geo" class="select select-sm w-full">
          <option value="">Не указано</option>
          <option value="US">US — США</option>
          <option value="GB">GB — Великобритания</option>
          <option value="DE">DE — Германия</option>
          <option value="FR">FR — Франция</option>
          <option value="NL">NL — Нидерланды</option>
          <option value="ES">ES — Испания</option>
          <option value="IT">IT — Италия</option>
          <option value="BR">BR — Бразилия</option>
          <option value="IN">IN — Индия</option>
          <option value="JP">JP — Япония</option>
          <option value="KR">KR — Южная Корея</option>
          <option value="TR">TR — Турция</option>
          <option value="KZ">KZ — Казахстан</option>
          <option value="UA">UA — Украина</option>
          <option value="BY">BY — Беларусь</option>
          <option value="RU">RU — Россия</option>
        </select>
      </fieldset>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Язык</legend>
        <select v-model="form.language" class="select select-sm w-full">
          <option value="">Не указано</option>
          <option value="EN">EN — English</option>
          <option value="RU">RU — Русский</option>
          <option value="ES">ES — Español</option>
          <option value="DE">DE — Deutsch</option>
          <option value="FR">FR — Français</option>
          <option value="PT">PT — Português</option>
          <option value="JA">JA — 日本語</option>
          <option value="KO">KO — 한국어</option>
        </select>
      </fieldset>
    </div>

    <!-- === СЕКЦИЯ: Метаданные из магазина === -->
    <div class="collapse collapse-arrow bg-base-200/30">
      <input type="checkbox" :checked="!!form.productName" />
      <div class="collapse-title font-medium text-sm">
        <Icon name="mingcute:app-2-line" class="size-4 mr-1" />
        Данные из магазина
        <span v-if="form.productName" class="badge badge-ghost badge-sm ml-1">заполнено</span>
      </div>
      <div class="collapse-content space-y-3">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Публичное название</legend>
            <input v-model="form.productName" type="text" class="input input-sm w-full" placeholder="Название в store" />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Подзаголовок</legend>
            <input v-model="form.subtitle" type="text" class="input input-sm w-full" placeholder="Слоган / short description" />
          </fieldset>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Полное описание из store</legend>
          <textarea v-model="form.longDescription" class="textarea textarea-sm w-full" rows="3" placeholder="Полное описание из магазина приложений" />
        </fieldset>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Разработчик</legend>
            <input v-model="form.developer" type="text" class="input input-sm w-full" placeholder="Издатель / разработчик" />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Категории (через запятую)</legend>
            <input v-model="form.categoriesText" type="text" class="input input-sm w-full" placeholder="Здоровье, Фитнес" />
          </fieldset>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Целевая аудитория</legend>
            <input v-model="form.targetAudience" type="text" class="input input-sm w-full" placeholder="Женщины 25-45, интересующиеся..." />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Монетизация / Цена</legend>
            <input v-model="form.pricingNotes" type="text" class="input input-sm w-full" placeholder="Freemium, подписка $9.99/мес" />
          </fieldset>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">URL иконки</legend>
          <div class="flex items-center gap-2">
            <img
              v-if="form.iconUrl"
              :src="form.iconUrl"
              class="size-8 rounded-lg"
              :alt="form.name"
            />
            <input v-model="form.iconUrl" type="url" class="input input-sm w-full" placeholder="https://..." />
          </div>
        </fieldset>

        <!-- Скриншоты (readonly, заполняются из enrichment) -->
        <div v-if="form.screenshotUrls.length" class="space-y-1">
          <span class="text-xs text-base-content/60">Скриншоты ({{ form.screenshotUrls.length }})</span>
          <div class="flex gap-2 overflow-x-auto pb-1">
            <img
              v-for="(url, i) in form.screenshotUrls.slice(0, 5)"
              :key="i"
              :src="url"
              class="h-20 rounded-md border border-base-300"
              :alt="`Скриншот ${i + 1}`"
            />
          </div>
        </div>

        <!-- Hero image -->
        <div v-if="form.heroImageUrl" class="space-y-1">
          <span class="text-xs text-base-content/60">Hero image</span>
          <img :src="form.heroImageUrl" class="h-16 rounded-md" alt="Hero" />
        </div>
      </div>
    </div>

    <!-- === СЕКЦИЯ: AI-контекст === -->
    <div class="collapse collapse-arrow bg-base-200/30">
      <input type="checkbox" :checked="!!form.aiSummary" />
      <div class="collapse-title font-medium text-sm">
        <Icon name="mingcute:ai-line" class="size-4 mr-1" />
        AI-контекст и креатив
        <span v-if="form.aiSummary" class="badge badge-ghost badge-sm ml-1">заполнено</span>
      </div>
      <div class="collapse-content space-y-3">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">AI Summary</legend>
          <textarea v-model="form.aiSummary" class="textarea textarea-sm w-full" rows="3" placeholder="AI-сводка для креативного использования" />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Ключевые фичи (по одной на строку)</legend>
          <textarea v-model="form.featureBulletsText" class="textarea textarea-sm w-full" rows="3" placeholder="Фича 1&#10;Фича 2&#10;Фича 3" />
        </fieldset>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Тон бренда</legend>
            <input v-model="form.brandTone" type="text" class="input input-sm w-full" placeholder="Дружелюбный, экспертный" />
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Визуальные подсказки</legend>
            <input v-model="form.visualCues" type="text" class="input input-sm w-full" placeholder="Яркие цвета, минимализм" />
          </fieldset>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Онбординг / use-case</legend>
          <textarea v-model="form.onboardingSummary" class="textarea textarea-sm w-full" rows="2" placeholder="Типичный сценарий использования" />
        </fieldset>
      </div>
    </div>

    <!-- === СЕКЦИЯ: Трансформация и боли === -->
    <div class="collapse collapse-arrow bg-base-200/30">
      <input type="checkbox" :checked="!!form.corePain" />
      <div class="collapse-title font-medium text-sm">
        <Icon name="mingcute:target-line" class="size-4 mr-1" />
        Трансформация и боли
        <span v-if="form.corePain" class="badge badge-ghost badge-sm ml-1">заполнено</span>
      </div>
      <div class="collapse-content space-y-3">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Ключевая боль пользователя</legend>
          <input v-model="form.corePain" type="text" class="input input-sm w-full" placeholder="Не может похудеть, теряет мотивацию" />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Ключевой результат</legend>
          <input v-model="form.coreOutcome" type="text" class="input input-sm w-full" placeholder="Стройная фигура, привычка заниматься" />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Обещание трансформации (до/после)</legend>
          <textarea v-model="form.transformationPromise" class="textarea textarea-sm w-full" rows="2" placeholder="Из ленивого домоседа — в человека, который тренируется каждый день" />
        </fieldset>
      </div>
    </div>

    <!-- === СЕКЦИЯ: Ограничения и ключевые слова === -->
    <div class="collapse collapse-arrow bg-base-200/30">
      <input type="checkbox" :checked="!!form.forbiddenClaimsText || !!form.asoKeywordsText" />
      <div class="collapse-title font-medium text-sm">
        <Icon name="mingcute:shield-line" class="size-4 mr-1" />
        Ограничения и ASO
      </div>
      <div class="collapse-content space-y-3">
        <fieldset class="fieldset">
          <legend class="fieldset-legend text-error">Запрещённые утверждения (по одному на строку)</legend>
          <textarea v-model="form.forbiddenClaimsText" class="textarea textarea-sm w-full" rows="2" placeholder="Гарантия похудения на 10 кг&#10;Лечит заболевания" />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend text-warning">Рискованные утверждения (по одному на строку)</legend>
          <textarea v-model="form.riskyClaimsText" class="textarea textarea-sm w-full" rows="2" placeholder="Результат за 30 дней&#10;Лучше аналогов" />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Ключевые слова проекта (по одному на строку)</legend>
          <textarea v-model="form.keywordsText" class="textarea textarea-sm w-full" rows="3" placeholder="Ключевое слово 1&#10;Ключевое слово 2" />
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">ASO-ключевые слова (по одному на строку)</legend>
          <textarea v-model="form.asoKeywordsText" class="textarea textarea-sm w-full" rows="3" placeholder="фитнес трекер&#10;похудение&#10;тренировки дома" />
        </fieldset>
      </div>
    </div>

    <!-- Ошибки -->
    <div v-if="error" role="alert" class="alert alert-error alert-soft">
      <Icon name="mingcute:warning-line" />
      <span>{{ error }}</span>
    </div>

    <!-- Действия -->
    <div class="flex gap-2">
      <button class="btn btn-primary btn-sm" :disabled="saving" @click="submit">
        <span v-if="saving" class="loading loading-spinner loading-sm" />
        {{ isEdit ? 'Сохранить' : 'Создать' }}
      </button>
      <button class="btn btn-ghost btn-sm" @click="emit('cancel')">
        Отмена
      </button>
    </div>
  </div>
</template>
