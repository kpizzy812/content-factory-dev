<script setup lang="ts">
definePageMeta({
  middleware: ["admin-access"],
})
useHead({ title: "Интеграции" })
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-base-content">Интеграции</h1>
      <p class="text-sm text-base-content/60 mt-1">
        Внешние сервисы, используемые ZavodCamp для автоматизации.
      </p>
    </div>

    <!-- Device-провайдер card.
         R6 (миграция DuoPlus): credentials/test-connection/orphan-cleanup удалены
         вместе с браузерной антидетект-функциональностью. Настройка провайдера
         (API-ключ) переедет в env-конфиг и UI Этапа 3. -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-5 gap-3">
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div class="flex items-start gap-3">
            <div class="flex items-center justify-center w-12 h-12 rounded-box bg-base-200">
              <Icon name="mingcute:cellphone-2-line" class="text-2xl text-primary" />
            </div>
            <div>
              <h2 class="font-bold text-lg">Облачные устройства DuoPlus</h2>
              <p class="text-sm text-base-content/70">
                Провайдер облачных устройств (DuoPlus) для управления социальными аккаунтами.
                Один профиль = один аккаунт.
              </p>
            </div>
          </div>
          <span class="badge badge-ghost gap-1">Этап 3</span>
        </div>

        <div role="alert" class="alert alert-info alert-soft text-sm">
          <Icon name="mingcute:information-line" />
          <span>
            Настройка провайдера (API-ключ, подключение) станет доступна в
            <b>Этапе 3</b> миграции. Сейчас профили работают в local-only режиме.
          </span>
        </div>

        <div class="card-actions justify-end mt-2 flex-wrap gap-2">
          <NuxtLink to="/devices" class="btn btn-sm btn-ghost gap-1">
            <Icon name="mingcute:list-check-line" />
            К профилям
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
