<script setup lang="ts">
/**
 * Сбор метрик публикаций.
 *
 * Ходит в социальные платформы, поэтому это главное действие раздела и стоит
 * видимой кнопкой, а не пунктом меню: прятать его глубже, чем удаление,
 * вредно. Денег сбор не стоит — тарифицируется только Apify-сбор профилей,
 * а он живёт на вкладке аккаунтов.
 */
const { can } = usePermissions()

const emit = defineEmits<{ collected: [] }>()

const { collectMetrics, isCollecting, collectError, collectResult } = useAnalyticsActions()

async function handleCollect() {
  const result = await collectMetrics()
  if (result) emit('collected')
}
</script>

<template>
  <div v-if="can('canRunAgent')" class="flex flex-wrap items-center gap-2.5">
    <UiButton :loading="isCollecting" @click="handleCollect">
      <Icon v-if="!isCollecting" name="mingcute:refresh-2-line" />
      Собрать метрики
    </UiButton>

    <span v-if="collectResult" class="text-sm text-muted">
      собрано {{ collectResult.collected }}<template v-if="collectResult.errorsCount > 0">
        · <span class="text-danger">ошибок {{ collectResult.errorsCount }}</span>
      </template>
    </span>

    <span v-if="collectError" role="alert" class="flex items-center gap-1.5 text-sm text-danger">
      <Icon name="mingcute:warning-line" />
      {{ collectError }}
    </span>
  </div>
</template>
