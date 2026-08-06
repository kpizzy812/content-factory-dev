<script setup lang="ts">
/**
 * Интеграции. Макет: design-preview/catalog/08-settings-admin.dc.html
 *
 * В макете здесь сетка карточек с ключами, порогами и кнопкой «Проверить все».
 * Ни ключей, ни проверок в API нет: секреты живут в окружении, а состояния
 * сервисов не отдаёт ни один endpoint. Поэтому страница говорит прямо, где
 * настраивается каждая зона, и ведёт туда, где её состояние действительно видно.
 */
definePageMeta({ middleware: ['admin-access'] })
useHead({ title: 'Интеграции' })

const { data: modulesData } = await useFetch<{ data: Record<string, boolean> }>('/api/product-modules')

const legacy = computed(() => modulesData.value?.data ?? {})

interface IntegrationRow {
  name: string
  purpose: string
  icon: string
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
    href: '/admin/balances',
    hrefLabel: 'Балансы',
    note: 'Ключ задаётся в окружении. Остаток и расход видны в балансах.',
  },
  {
    name: 'Anthropic',
    purpose: 'сценарии и критик',
    icon: 'mingcute:document-line',
    href: '/admin/balances',
    hrefLabel: 'Балансы',
    note: 'Ключ задаётся в окружении. Расход виден в балансах.',
  },
  {
    name: 'Telegram',
    purpose: 'уведомления и бот',
    icon: 'mingcute:send-plane-line',
    href: '/admin/telegram',
    hrefLabel: 'Настроить',
    note: 'Чаты, шаблоны и доставка — на своей странице.',
  },
  {
    name: 'Хранилище',
    purpose: 'готовые ролики и кадры',
    icon: 'mingcute:folder-line',
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
    </div>

    <p
      class="flex items-start gap-2 rounded-md border border-info-border bg-info-bg px-2.5 py-2 text-sm text-fg"
    >
      <Icon name="mingcute:information-line" class="mt-0.5 shrink-0 text-info" />
      <span>
        Ключи сервисов задаются переменными окружения и в интерфейс не выводятся —
        ни целиком, ни маской. Здесь только карта: где что настраивается и где
        видно, что оно работает.
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
