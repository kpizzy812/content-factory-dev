<script setup lang="ts">
/**
 * Интеграции. Макет: design-preview/catalog/08-settings-admin.dc.html
 *
 * Ключей на странице нет и не будет: секреты живут в окружении и в интерфейс
 * не выводятся ни целиком, ни маской. А вот состояние сервиса — выводится:
 * `/api/admin/integrations` дёргает у каждого бесплатный endpoint и говорит,
 * отвечает он или нет. Генерации там нет, поэтому «Проверить все» ничего не стоит.
 */
import { INTEGRATION_STATE_META } from '~/components/admin/IntegrationStateMap'

definePageMeta({ middleware: ['admin-access'] })
useHead({ title: 'Интеграции' })

const { data: modulesData } = await useFetch<{ data: Record<string, boolean> }>('/api/product-modules')

const legacy = computed(() => modulesData.value?.data ?? {})

interface IntegrationHealthRow {
  key: string
  label: string
  purpose: string
  state: keyof typeof INTEGRATION_STATE_META
  detail: string
  durationMs: number | null
}

// Проверка ходит наружу и занимает секунды, поэтому только в браузере и лениво:
// страница-карта должна открываться мгновенно.
const {
  data: healthData,
  pending: healthPending,
  refresh: refreshHealth,
} = useFetch<{ data: { services: IntegrationHealthRow[]; okCount: number; total: number; checkedAt: string } }>(
  '/api/admin/integrations',
  { key: 'admin-integrations-health', server: false, lazy: true },
)

const health = computed(() => healthData.value?.data ?? null)
const healthByKey = computed(() =>
  new Map((health.value?.services ?? []).map(s => [s.key, s])),
)

/** Своё состояние: `pending` на сервере false, а в браузере сразу true. */
const checking = ref(false)
async function checkAll() {
  checking.value = true
  try {
    await refreshHealth()
  }
  finally {
    checking.value = false
  }
}

function checkedAtLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU')
}

interface IntegrationRow {
  name: string
  purpose: string
  icon: string
  /** Ключ в ответе проверки; без него карточка только объясняет, где настроить. */
  healthKey?: string
  /** Куда идти за состоянием и настройкой. */
  href?: string
  hrefLabel?: string
  /** Флаг окружения, включающий зону. */
  flag?: string
  enabled?: boolean
  note: string
}

const rows = computed<IntegrationRow[]>(() => [
  {
    name: 'Replicate',
    purpose: 'генерация видео и lip-sync',
    icon: 'mingcute:video-line',
    healthKey: 'replicate',
    href: '/admin/balances',
    hrefLabel: 'Балансы',
    note: 'Ключ задаётся в окружении. Остаток и расход видны в балансах.',
  },
  {
    name: 'fal.ai',
    purpose: 'кадры и клипы',
    icon: 'mingcute:pic-line',
    healthKey: 'fal.ai',
    href: '/admin/balances',
    hrefLabel: 'Балансы',
    note: 'Резервный провайдер медиа-моделей, подключается явной настройкой.',
  },
  {
    name: 'Anthropic',
    purpose: 'сценарии и критик',
    icon: 'mingcute:document-line',
    healthKey: 'anthropic',
    href: '/admin/balances',
    hrefLabel: 'Балансы',
    note: 'Ключ задаётся в окружении. Расход виден в балансах.',
  },
  {
    name: 'Apify',
    purpose: 'парсинг трендов',
    icon: 'mingcute:fire-line',
    healthKey: 'apify',
    href: '/trends?tab=profiles',
    hrefLabel: 'Профили парсинга',
    note: 'Токен задаётся в окружении. Что и где искать — в профилях парсинга.',
  },
  {
    name: 'Telegram',
    purpose: 'уведомления и бот',
    icon: 'mingcute:send-plane-line',
    healthKey: 'telegram',
    href: '/admin/telegram',
    hrefLabel: 'Настроить',
    note: 'Чаты, шаблоны и доставка — на своей странице.',
  },
  {
    name: 'Хранилище',
    purpose: 'готовые ролики и кадры',
    icon: 'mingcute:folder-line',
    healthKey: 'storage',
    href: '/admin/storage-health',
    hrefLabel: 'Здоровье',
    note: 'Драйвер и бакет задаются в окружении, заполненность — на своей странице.',
  },
  {
    name: 'Google Drive',
    purpose: 'исходники ведущего',
    icon: 'mingcute:cloud-line',
    href: '/google-drive',
    hrefLabel: 'Раздел',
    flag: 'LEGACY_GOOGLE_DRIVE_ENABLED',
    enabled: legacy.value.googleDrive ?? false,
    note: 'Унаследованный контур: без флага раздел скрыт.',
  },
  {
    name: 'Платформы публикации',
    purpose: 'Meta · TikTok · Google',
    icon: 'mingcute:share-forward-line',
    href: '/accounts',
    hrefLabel: 'Аккаунты',
    note: 'Токены живут у аккаунтов: у каждого свой срок и своё состояние.',
  },
])
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-semibold">Интеграции</h1>
      <span class="tnum font-mono text-sm text-subtle">{{ rows.length }} сервисов</span>
      <ClientOnly>
        <span v-if="health" class="tnum text-sm text-muted">
          {{ health.okCount }} из {{ health.total }} в норме
        </span>
        <span v-if="health" class="tnum font-mono text-micro text-subtle">
          проверено {{ checkedAtLabel(health.checkedAt) }}
        </span>
      </ClientOnly>
      <span class="flex-1" />
      <UiButton :loading="checking" @click="checkAll">
        <Icon v-if="!checking" name="mingcute:refresh-2-line" />
        Проверить все
      </UiButton>
    </div>

    <p
      class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-fg"
    >
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
      <span>
        Ключи сервисов задаются переменными окружения и в интерфейс не выводятся —
        ни целиком, ни маской. Проверка дёргает у каждого сервиса бесплатный
        endpoint: она отвечает «работает или нет» и ничего не стоит.
      </span>
    </p>

    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <section
        v-for="row in rows"
        :key="row.name"
        class="flex flex-col gap-2 rounded-lg border border-border bg-panel p-3"
      >
        <div class="flex items-center gap-2.5">
          <span class="flex size-[30px] shrink-0 items-center justify-center rounded-md border border-border bg-card">
            <Icon :name="row.icon" class="text-muted" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ row.name }}</span>
            <span class="block truncate text-micro text-subtle">{{ row.purpose }}</span>
          </span>
          <span
            v-if="row.flag"
            class="inline-flex h-5 items-center gap-1.5 rounded-sm border px-[7px] text-sm"
            :class="row.enabled
              ? 'border-success-border bg-success-bg text-success'
              : 'border-divider bg-transparent text-subtle'"
          >
            <span class="size-1.5 rounded-full bg-current" />
            {{ row.enabled ? 'включено' : 'выключено' }}
          </span>
        </div>

        <ClientOnly>
          <div v-if="row.healthKey" class="flex flex-wrap items-center gap-2">
            <template v-if="healthByKey.get(row.healthKey)">
              <UiStatusBadge
                :status="INTEGRATION_STATE_META[healthByKey.get(row.healthKey)!.state].entity"
                size="xs"
                icon-only
              />
              <span class="text-sm text-fg">
                {{ INTEGRATION_STATE_META[healthByKey.get(row.healthKey)!.state].label }}
              </span>
              <span class="min-w-0 flex-1 truncate text-micro text-subtle" :title="healthByKey.get(row.healthKey)!.detail">
                {{ healthByKey.get(row.healthKey)!.detail }}
              </span>
              <span
                v-if="healthByKey.get(row.healthKey)!.durationMs != null"
                class="tnum font-mono text-micro text-subtle"
              >{{ healthByKey.get(row.healthKey)!.durationMs }} мс</span>
            </template>
            <span v-else-if="healthPending" class="text-sm text-subtle">проверяем…</span>
          </div>
        </ClientOnly>

        <p class="text-sm text-muted">{{ row.note }}</p>
        <p v-if="row.flag && !row.enabled" class="font-mono text-micro text-subtle">
          включает {{ row.flag }}=true
        </p>

        <NuxtLink v-if="row.href" :to="row.href" class="mt-auto w-fit text-sm">
          {{ row.hrefLabel }} →
        </NuxtLink>
      </section>
    </div>
  </div>
</template>
