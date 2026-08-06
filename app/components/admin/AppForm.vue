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

/** Откуда взялось поле: разобрано из страницы, дописано моделью или не найдено. */
function requiredFieldClass(field: string): string {
  const src = requiredFieldSource(field)
  if (!src) return 'border-danger-border bg-danger-bg text-danger'
  if (src.source === 'ai_fallback') return 'border-warning-border bg-warning-bg text-warning'
  if (src.source.startsWith('parser_')) return 'border-success-border bg-success-bg text-success'
  return 'border-divider text-muted'
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
  if (source === 'ai_fallback') return 'border-warning-border bg-warning-bg text-warning'
  if (source === 'user') return 'border-info-border bg-info-bg text-info'
  if (source === 'default') return 'border-divider text-subtle'
  return 'border-success-border bg-success-bg text-success'
}

const GEO_OPTIONS = [
  { value: '', label: 'Не указано' },
  { value: 'US', label: 'US — США' },
  { value: 'GB', label: 'GB — Великобритания' },
  { value: 'DE', label: 'DE — Германия' },
  { value: 'FR', label: 'FR — Франция' },
  { value: 'NL', label: 'NL — Нидерланды' },
  { value: 'ES', label: 'ES — Испания' },
  { value: 'IT', label: 'IT — Италия' },
  { value: 'BR', label: 'BR — Бразилия' },
  { value: 'IN', label: 'IN — Индия' },
  { value: 'JP', label: 'JP — Япония' },
  { value: 'KR', label: 'KR — Южная Корея' },
  { value: 'TR', label: 'TR — Турция' },
  { value: 'KZ', label: 'KZ — Казахстан' },
  { value: 'UA', label: 'UA — Украина' },
  { value: 'BY', label: 'BY — Беларусь' },
  { value: 'RU', label: 'RU — Россия' },
]

const LANGUAGE_OPTIONS = [
  { value: '', label: 'Не указано' },
  { value: 'EN', label: 'EN — English' },
  { value: 'RU', label: 'RU — Русский' },
  { value: 'ES', label: 'ES — Español' },
  { value: 'DE', label: 'DE — Deutsch' },
  { value: 'FR', label: 'FR — Français' },
  { value: 'PT', label: 'PT — Português' },
  { value: 'JA', label: 'JA — 日本語' },
  { value: 'KO', label: 'KO — 한국어' },
]

const ENRICHMENT_LABELS: Record<string, string> = {
  completed: 'Данные подтянуты',
  partial: 'Подтянуто частично',
  running: 'Разбираем страницу',
  failed: 'Разбор упал',
  idle: 'Не разбиралось',
}

const ENRICHMENT_TONE: Record<string, string> = {
  completed: 'border-success-border bg-success-bg text-success',
  partial: 'border-warning-border bg-warning-bg text-warning',
  running: 'border-info-border bg-info-bg text-info',
  failed: 'border-danger-border bg-danger-bg text-danger',
  idle: 'border-divider text-subtle',
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
  <div class="flex flex-col gap-3.5">
    <!-- Разбор страницы магазина -->
    <section class="rounded-lg border border-border bg-surface p-3.5">
      <div class="mb-2.5 flex flex-wrap items-center gap-2">
        <Icon name="mingcute:store-2-line" class="text-accent" />
        <h3 class="text-sm font-medium">Заполнить из магазина приложений</h3>
        <span
          v-if="isEdit && enrichmentStatus"
          class="rounded-sm border px-1.5 py-0.5 text-micro"
          :class="ENRICHMENT_TONE[enrichmentStatus] ?? 'border-divider text-subtle'"
        >
          {{ ENRICHMENT_LABELS[enrichmentStatus] ?? enrichmentStatus }}
        </span>
        <span v-if="lastEnrichedAt" class="tnum font-mono text-micro text-subtle">{{ lastEnrichedAt }}</span>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <UiField label="Ссылка в App Store">
          <UiInput v-model="form.appStoreUrl" type="url" placeholder="https://apps.apple.com/…" />
        </UiField>
        <UiField label="Ссылка в Google Play">
          <UiInput v-model="form.playStoreUrl" type="url" placeholder="https://play.google.com/store/apps/…" />
        </UiField>
      </div>

      <div class="mt-2.5 flex flex-wrap items-center gap-3">
        <UiButton
          variant="primary"
          :disabled="!storeUrlForEnrich"
          :loading="enriching"
          @click="handleEnrich"
        >
          <Icon v-if="!enriching" name="mingcute:sparkles-2-line" />
          {{ enriching ? 'Читаем страницу' : 'Разобрать и заполнить' }}
        </UiButton>

        <UiToggle
          v-model="useUrlLocale"
          label="Гео из ссылки"
          title="Брать страну и язык из локали в ссылке (apps.apple.com/ru/…). Иначе US и английский."
        />
      </div>

      <div
        v-if="enrichError"
        role="alert"
        class="mt-2.5 flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
      >
        <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
        <span>{{ enrichError }}</span>
      </div>

      <div
        v-if="enrichResult"
        role="status"
        class="mt-2.5 flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm"
        :class="enrichResult.status === 'completed'
          ? 'border-success-border bg-success-bg text-success'
          : enrichResult.status === 'partial'
            ? 'border-warning-border bg-warning-bg text-warning'
            : 'border-danger-border bg-danger-bg text-danger'"
      >
        <Icon
          :name="enrichResult.status === 'completed'
            ? 'mingcute:check-circle-line'
            : enrichResult.status === 'partial' ? 'mingcute:information-line' : 'mingcute:alert-line'"
          class="mt-0.5 shrink-0"
        />
        <span>{{ enrichResult.message }}</span>
      </div>

      <!-- Откуда взялось каждое поле -->
      <div v-if="enrichResult?.extractionReport" class="mt-2.5 flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2 text-micro text-muted">
          <span>
            со страницы
            <span class="tnum font-mono text-fg">{{ enrichResult.extractionReport.found.length }}</span>
          </span>
          <span>
            не нашлось
            <span class="tnum font-mono text-fg">{{ enrichResult.extractionReport.missing.length }}</span>
          </span>
          <span v-if="enrichResult.extractionReport.aiBackfilled?.length">
            дописала модель
            <span class="tnum font-mono text-warning">{{ enrichResult.extractionReport.aiBackfilled.length }}</span>
          </span>
        </div>

        <div class="flex flex-wrap gap-1">
          <span
            v-for="field in ['productName', 'longDescription', 'developer', 'iconUrl']"
            :key="field"
            class="flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-micro"
            :class="requiredFieldClass(field)"
            :title="requiredFieldTitle(field)"
          >
            <Icon :name="requiredFieldIcon(field)" />
            {{ requiredFieldLabel(field) }}
          </span>
        </div>

        <UiDisclosure
          :title="`Разбор по полям`"
          :count="Object.keys(enrichResult.extractionReport.sources).length"
        >
          <div class="flex flex-col gap-0.5">
            <div
              v-for="(prov, fieldName) in enrichResult.extractionReport.sources"
              :key="fieldName"
              class="flex items-center gap-2 text-micro"
            >
              <span class="min-w-36 font-mono text-muted">{{ fieldName }}</span>
              <span class="rounded-sm border px-1.5 py-0.5" :class="sourceBadgeClass(prov.source)">
                {{ sourceLabel(prov.source) }}
              </span>
              <span v-if="prov.confidence !== undefined" class="tnum font-mono text-subtle">
                {{ Math.round((prov.confidence ?? 0) * 100) }}%
              </span>
            </div>
            <div
              v-for="field in enrichResult.extractionReport.requiredMissing"
              :key="`missing-${field}`"
              class="flex items-center gap-2 text-micro"
            >
              <span class="min-w-36 font-mono text-danger">{{ field }}</span>
              <span class="rounded-sm border border-danger-border bg-danger-bg px-1.5 py-0.5 text-danger">
                не найдено
              </span>
            </div>
          </div>
        </UiDisclosure>
      </div>
    </section>

    <!-- Основное -->
    <UiField label="Название">
      <UiInput v-model="form.name" placeholder="Название приложения" />
    </UiField>

    <UiField label="Описание">
      <UiTextarea v-model="form.description" :rows="2" placeholder="Коротко, для операторов" />
    </UiField>

    <div class="grid gap-3 sm:grid-cols-2">
      <UiField label="Гео">
        <UiSelect v-model="form.geo" :options="GEO_OPTIONS" />
      </UiField>
      <UiField label="Язык">
        <UiSelect v-model="form.language" :options="LANGUAGE_OPTIONS" />
      </UiField>
    </div>

    <!-- Данные из магазина -->
    <UiDisclosure
      title="Данные из магазина"
      icon="mingcute:cellphone-line"
      icon-tone="text-accent"
      :default-open="!!form.productName"
    >
      <div class="flex flex-col gap-3">
        <div class="grid gap-3 sm:grid-cols-2">
          <UiField label="Публичное название">
            <UiInput v-model="form.productName" placeholder="Как называется в магазине" />
          </UiField>
          <UiField label="Подзаголовок">
            <UiInput v-model="form.subtitle" placeholder="Слоган из карточки" />
          </UiField>
        </div>

        <UiField label="Полное описание из магазина">
          <UiTextarea v-model="form.longDescription" :rows="3" placeholder="Текст карточки приложения" />
        </UiField>

        <div class="grid gap-3 sm:grid-cols-2">
          <UiField label="Разработчик">
            <UiInput v-model="form.developer" placeholder="Издатель" />
          </UiField>
          <UiField label="Категории" hint="Через запятую">
            <UiInput v-model="form.categoriesText" placeholder="Здоровье, Фитнес" />
          </UiField>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <UiField label="Аудитория">
            <UiInput v-model="form.targetAudience" placeholder="Женщины 25–45, интересуются…" />
          </UiField>
          <UiField label="Монетизация">
            <UiInput v-model="form.pricingNotes" placeholder="Подписка $9.99 в месяц" />
          </UiField>
        </div>

        <UiField label="Ссылка на иконку">
          <div class="flex items-center gap-2">
            <img v-if="form.iconUrl" :src="form.iconUrl" class="size-8 shrink-0 rounded-md" :alt="form.name">
            <UiInput v-model="form.iconUrl" type="url" placeholder="https://…" />
          </div>
        </UiField>

        <div v-if="form.screenshotUrls.length">
          <div class="mb-1 text-[11.5px] text-muted">Скриншоты · {{ form.screenshotUrls.length }}</div>
          <div class="flex gap-2 overflow-x-auto pb-1">
            <img
              v-for="(url, i) in form.screenshotUrls.slice(0, 5)"
              :key="i"
              :src="url"
              class="h-20 rounded-md border border-border"
              :alt="`Скриншот ${i + 1}`"
            >
          </div>
        </div>

        <div v-if="form.heroImageUrl">
          <div class="mb-1 text-[11.5px] text-muted">Обложка</div>
          <img :src="form.heroImageUrl" class="h-16 rounded-md border border-border" alt="Обложка">
        </div>
      </div>
    </UiDisclosure>

    <!-- Контекст для генерации -->
    <UiDisclosure
      title="Контекст для генерации"
      icon="mingcute:ai-line"
      icon-tone="text-accent"
      :default-open="!!form.aiSummary"
    >
      <div class="flex flex-col gap-3">
        <UiField label="Сводка для моделей">
          <UiTextarea v-model="form.aiSummary" :rows="3" placeholder="Что за продукт и как о нём говорить" />
        </UiField>

        <UiField label="Ключевые возможности" hint="По одной на строку">
          <UiTextarea v-model="form.featureBulletsText" :rows="3" placeholder="Что умеет приложение" />
        </UiField>

        <div class="grid gap-3 sm:grid-cols-2">
          <UiField label="Тон бренда">
            <UiInput v-model="form.brandTone" placeholder="Дружелюбный, экспертный" />
          </UiField>
          <UiField label="Визуальные подсказки">
            <UiInput v-model="form.visualCues" placeholder="Яркие цвета, минимализм" />
          </UiField>
        </div>

        <UiField label="Как им пользуются">
          <UiTextarea v-model="form.onboardingSummary" :rows="2" placeholder="Типичный сценарий" />
        </UiField>
      </div>
    </UiDisclosure>

    <!-- Боль и результат -->
    <UiDisclosure
      title="Боль и результат"
      icon="mingcute:target-line"
      icon-tone="text-accent"
      :default-open="!!form.corePain"
    >
      <div class="flex flex-col gap-3">
        <UiField label="Боль пользователя">
          <UiInput v-model="form.corePain" placeholder="Не может похудеть, теряет мотивацию" />
        </UiField>
        <UiField label="Результат">
          <UiInput v-model="form.coreOutcome" placeholder="Привычка заниматься" />
        </UiField>
        <UiField label="Обещание «до и после»">
          <UiTextarea
            v-model="form.transformationPromise"
            :rows="2"
            placeholder="Из домоседа — в человека, который тренируется каждый день"
          />
        </UiField>
      </div>
    </UiDisclosure>

    <!-- Ограничения и ASO -->
    <UiDisclosure
      title="Ограничения и ASO"
      icon="mingcute:shield-line"
      icon-tone="text-warning"
      :default-open="!!form.forbiddenClaimsText || !!form.asoKeywordsText"
    >
      <div class="flex flex-col gap-3">
        <UiField label="Запрещённые утверждения" hint="По одному на строку — в ролики не попадут">
          <UiTextarea v-model="form.forbiddenClaimsText" :rows="2" placeholder="Гарантия результата" />
        </UiField>
        <UiField label="Рискованные утверждения" hint="По одному на строку — потребуют проверки">
          <UiTextarea v-model="form.riskyClaimsText" :rows="2" placeholder="Результат за 30 дней" />
        </UiField>
        <UiField label="Ключевые слова проекта" hint="По одному на строку">
          <UiTextarea v-model="form.keywordsText" :rows="3" placeholder="фитнес трекер" />
        </UiField>
        <UiField label="ASO-ключи" hint="По одному на строку">
          <UiTextarea v-model="form.asoKeywordsText" :rows="3" placeholder="тренировки дома" />
        </UiField>
      </div>
    </UiDisclosure>

    <div
      v-if="error"
      role="alert"
      class="flex items-start gap-2 rounded-md border border-danger-border bg-danger-bg px-2.5 py-2 text-sm text-danger"
    >
      <Icon name="mingcute:alert-line" class="mt-0.5 shrink-0" />
      <span>{{ error }}</span>
    </div>

    <div class="flex gap-1.5">
      <UiButton variant="primary" :loading="saving" @click="submit">
        {{ isEdit ? 'Сохранить' : 'Создать' }}
      </UiButton>
      <UiButton variant="ghost" @click="emit('cancel')">Отмена</UiButton>
    </div>
  </div>
</template>
