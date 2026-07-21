<script setup lang="ts">
defineProps<{
  unresolvedErrors: number
}>()
</script>

<template>
  <div v-if="unresolvedErrors > 0" role="alert" class="alert alert-error alert-soft">
    <Icon name="mingcute:warning-line" class="text-xl" />
    <div>
      <div class="font-bold">Нерешённые ошибки: {{ unresolvedErrors }}</div>
      <div class="text-sm">Необходимо проверить логи агентов</div>
    </div>
    <NuxtLink to="/admin/logs?level=error&resolved=false" class="btn btn-sm btn-error">
      Перейти к логам
    </NuxtLink>
  </div>

  <div v-else role="alert" class="alert alert-success alert-soft">
    <Icon name="mingcute:check-circle-line" class="text-xl" />
    <span>Нет нерешённых ошибок</span>
  </div>
</template>
