<script setup lang="ts">
import type { DeviceProfileDto, DeviceTestPushResult } from "~~/shared/types/device-profile"

const props = defineProps<{
  profile: DeviceProfileDto
}>()

const emit = defineEmits<{
  updated: []
  deleted: []
  edit: []
  /** Открыть test/diagnostic модалку с указанным результатом */
  testResult: [result: DeviceTestPushResult]
  /** Успешный запуск. port=null когда устройство стартует standalone (non-automation). */
  launched: [port: number | null]
}>()

const {
  stopProfile,
  deleteProfile,
  resyncProfile,
  testProfilePush,
  isBusy,
  error,
  lastActionError,
} = useDeviceActions()

// Start flow с visible stepper - заменяет старый одиночный startProfile вызов.
// При CORE_DOWNLOADING_STARTED показывает progress вместо error модалки.
const {
  state: startFlowState,
  start: startFlow,
  cancel: cancelStartFlow,
  reset: resetStartFlow,
} = useDeviceStartFlow()

const showDeleteConfirm = ref(false)
const isStarting = ref(false)
const isStopping = ref(false)
const isResyncing = ref(false)
const isTesting = ref(false)
const automation = ref(false)
const resyncToast = ref<{ kind: "success" | "error"; message: string } | null>(null)

async function handleStart() {
  // useDeviceStartFlow управляет всеми переходами visible stepper'а.
  // CORE_DOWNLOADING_STARTED больше не идёт в error модалку - превращается в
  // step 'downloading_core' с automatic polling каждые 5s.
  isStarting.value = true
  try {
    await startFlow(props.profile.id, automation.value)
    if (startFlowState.value.step === "running") {
      emit("launched", startFlowState.value.port)
      emit("updated")
    }
  } finally {
    isStarting.value = false
  }
}

function handleStartFlowErrorDetail() {
  const err = startFlowState.value.error
  if (!err) return
  emit("testResult", {
    ok: false,
    status: 0,
    method: "start",
    url: "",
    requestBody: {},
    responseBody: err.indigoBody ?? null,
    error: err.message,
    phase: err.phase,
  })
}

async function handleStop() {
  isStopping.value = true
  try {
    const ok = await stopProfile(props.profile.id)
    // Эмитим updated ВСЕГДА: server-side stopProfile обновляет БД даже при
    // launcher fail (см. client.ts:stopProfile). UI должен перечитать профиль
    // чтобы кнопка Stop разблокировалась и появилась Start.
    emit("updated")
    if (!ok && lastActionError.value) {
      emit("testResult", lastActionError.value)
    }
  } finally {
    isStopping.value = false
  }
}

async function handleResync() {
  isResyncing.value = true
  resyncToast.value = null
  try {
    const res = await resyncProfile(props.profile.id)
    if (res) {
      resyncToast.value = { kind: "success", message: "Профиль перепушен в облако" }
      emit("updated")
    } else {
      resyncToast.value = { kind: "error", message: error.value ?? "Не удалось запушить в облако" }
    }
  } finally {
    isResyncing.value = false
    setTimeout(() => { resyncToast.value = null }, 5000)
  }
}

async function handleTest() {
  isTesting.value = true
  try {
    const res = await testProfilePush(props.profile.id)
    if (res) emit("testResult", res)
  } finally {
    isTesting.value = false
  }
}

async function handleDelete() {
  const ok = await deleteProfile(props.profile.id)
  if (ok) {
    showDeleteConfirm.value = false
    emit("deleted")
  }
}
</script>

<template>
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body p-4 gap-3">
      <h3 class="font-semibold flex items-center gap-2">
        <Icon name="mingcute:settings-3-line" />
        Действия
      </h3>

      <!-- ⚠️ Платность устройства DuoPlus: показываем когда устройство можно включить. -->
      <DeviceCostWarning
        v-if="profile.indigoId && profile.sessionState !== 'running' && startFlowState.step === 'idle'"
        variant="alert"
      />

      <!-- Start automation checkbox - hidden пока flow active (нельзя менять
           параметры в процессе старта). -->
      <label
        v-if="profile.sessionState !== 'running' && startFlowState.step === 'idle'"
        class="label cursor-pointer justify-start gap-2 py-0"
      >
        <input v-model="automation" type="checkbox" class="checkbox checkbox-sm" />
        <span class="label-text text-sm">Automation (Selenium WebDriver)</span>
      </label>

      <!-- Start flow progress (visible stepper) - показывается когда оператор
           кликнул Start и flow active (launcher_call → downloading_core → running/failed).
           CORE_DOWNLOADING_STARTED больше не идёт в error модалку - это нормальный
           шаг. После 'running' или 'failed' оператор кликает ОК → reset → обычный UI. -->
      <div v-if="startFlowState.step !== 'idle'" class="mb-2">
        <DeviceStartProgressStepper
          :state="startFlowState"
          @cancel="cancelStartFlow"
          @error-detail="handleStartFlowErrorDetail"
        />
        <div
          v-if="startFlowState.step === 'running' || startFlowState.step === 'failed'"
          class="mt-2 flex justify-end"
        >
          <button class="btn btn-sm btn-ghost" @click="resetStartFlow">ОК</button>
        </div>
      </div>

      <!-- Primary actions.
           Start виден когда не running И flow в idle, Stop виден ВСЕГДА (recovery
           pathway если БД desync'нулась с Indigo state). Secondary actions
           (Test/Re-sync/Edit/Delete) остаются доступны даже во время flow. -->
      <div class="flex items-center gap-2 flex-wrap">
        <!-- Start hidden если !indigoId - сначала Запушить, потом Start.
             Защита от 409 'local_only' при попытке startProfile на не-pushed профиль. -->
        <button
          v-if="profile.sessionState !== 'running' && startFlowState.step === 'idle' && profile.indigoId"
          class="btn btn-sm btn-success btn-outline gap-1"
          :disabled="isStarting || isBusy"
          title="Включить устройство DuoPlus — платно, тарифицируется поминутно"
          @click="handleStart"
        >
          <span v-if="isStarting" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:play-circle-line" />
          Включить
        </button>
        <button
          v-if="profile.indigoId"
          class="btn btn-sm btn-warning btn-outline gap-1"
          :disabled="isStopping || isBusy"
          :title="profile.sessionState === 'running' ? 'Выключить устройство (останавливает тарификацию)' : 'Выключить — синхронизация если БД рассинхронизирована'"
          @click="handleStop"
        >
          <span v-if="isStopping" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:pause-circle-line" />
          Выключить
        </button>

        <!-- Прогрев для постинга — поднимает профиль на сервере (automation:true),
             чтобы poster-runner session_start нашёл его готовым. Виден только когда
             ещё не запущен и flow в idle (иначе дублировал бы Start-stepper выше). -->
        <DeviceWarmupForPostingButton
          v-if="profile.sessionState !== 'running' && startFlowState.step === 'idle'"
          :profile-id="profile.id"
          :pushed-to-cloud="Boolean(profile.indigoId)"
          :platform-type="profile.platformType"
          size="sm"
          @warmed="(port: number | null) => emit('launched', port)"
          @updated="emit('updated')"
          @error-detail="(r: DeviceTestPushResult) => emit('testResult', r)"
        />

        <button
          class="btn btn-sm btn-ghost gap-1"
          :disabled="isTesting || isBusy"
          title="Dry-run push в облако для диагностики"
          @click="handleTest"
        >
          <span v-if="isTesting" class="loading loading-spinner loading-xs" />
          <Icon v-else name="mingcute:test-tube-line" />
          Тест
        </button>

        <!-- Re-sync / Push кнопка - всегда видима. Dynamic label по indigoId.
             См. DeviceProfileCard для деталей. -->
        <button
          class="btn btn-sm btn-ghost gap-1"
          :disabled="isResyncing || isBusy"
          :title="profile.indigoId ? 'Перепушить актуальное состояние в облако' : 'Создать профиль в облаке (push local → remote)'"
          @click="handleResync"
        >
          <span v-if="isResyncing" class="loading loading-spinner loading-xs" />
          <Icon
            v-else
            :name="profile.indigoId ? 'mingcute:refresh-2-line' : 'mingcute:upload-line'"
          />
          {{ profile.indigoId ? "Re-sync" : "Запушить" }}
        </button>

        <button
          class="btn btn-sm btn-ghost gap-1"
          @click="emit('edit')"
        >
          <Icon name="mingcute:edit-line" />
          Редактировать
        </button>

        <div class="grow" />

        <button
          class="btn btn-sm btn-error btn-outline gap-1"
          :disabled="isBusy"
          @click="showDeleteConfirm = true"
        >
          <Icon name="mingcute:delete-2-line" />
          Удалить
        </button>
      </div>

      <div v-if="error" role="alert" class="alert alert-error alert-soft text-sm">
        <Icon name="mingcute:warning-line" />
        <span>{{ error }}</span>
      </div>

      <div
        v-if="resyncToast"
        role="alert"
        class="alert alert-soft text-sm"
        :class="resyncToast.kind === 'success' ? 'alert-success' : 'alert-error'"
      >
        <Icon
          :name="resyncToast.kind === 'success' ? 'mingcute:check-circle-line' : 'mingcute:warning-line'"
        />
        <span>{{ resyncToast.message }}</span>
      </div>
    </div>

    <dialog class="modal" :class="{ 'modal-open': showDeleteConfirm }">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Удалить профиль устройства?</h3>
        <p class="py-4 text-base-content/70">
          Профиль <strong>{{ profile.name }}</strong> будет удалён локально.
          <span v-if="profile.indigoId">
            Также будет удалён в облаке (best-effort).
          </span>
          <span v-if="profile.accounts.length > 0" class="block mt-2 text-warning">
            Привязанные аккаунты ({{ profile.accounts.length }}) останутся,
            но потеряют связь с этим профилем устройства.
          </span>
        </p>
        <div class="modal-action">
          <button class="btn btn-sm" @click="showDeleteConfirm = false">Отмена</button>
          <button class="btn btn-sm btn-error" :disabled="isBusy" @click="handleDelete">
            <span v-if="isBusy" class="loading loading-spinner loading-xs" />
            Удалить
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="showDeleteConfirm = false">close</button>
      </form>
    </dialog>
  </div>
</template>
