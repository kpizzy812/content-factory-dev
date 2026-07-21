<script setup lang="ts">
definePageMeta({ layout: 'default', middleware: 'module-access', moduleSlug: 'social-upload' })

const route = useRoute()
const uploadId = computed(() => route.params.id as string)

const { data, pending, error, refresh } = useUploadDetail(uploadId)

const upload = computed(() => data.value?.data ?? null)

useHead({
  title: computed(() => upload.value?.title ?? 'Загрузка'),
})

const platformLabels: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
}

const platformIcons: Record<string, string> = {
  youtube: 'mingcute:youtube-line',
  tiktok: 'mingcute:tiktok-line',
  instagram: 'mingcute:instagram-line',
}

const dateFormatted = computed(() => {
  if (!upload.value) return ''
  return new Date(upload.value.createdAt).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
})

const scheduledFormatted = computed(() => {
  if (!upload.value?.scheduledAt) return null
  return new Date(upload.value.scheduledAt).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
})

async function onRetried() {
  await refresh()
}
</script>

<template>
  <div class="space-y-4">
    <!-- Назад -->
    <NuxtLink to="/uploads" class="btn btn-ghost btn-sm gap-1">
      <Icon name="mingcute:arrow-left-line" />
      Назад к загрузкам
    </NuxtLink>

    <!-- Loading -->
    <div v-if="pending" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg" />
    </div>

    <!-- Error -->
    <div v-else-if="error" role="alert" class="alert alert-error">
      <Icon name="mingcute:warning-line" />
      <span>Ошибка загрузки: {{ error.message }}</span>
    </div>

    <!-- Content -->
    <template v-else-if="upload">
      <!-- Заголовок -->
      <div class="flex items-center gap-3 flex-wrap">
        <h1 class="text-xl font-bold text-base-content">
          {{ upload.title }}
        </h1>
        <UploadStatusBadge :status="upload.status" />
      </div>

      <div class="card bg-base-100 shadow-sm">
        <div class="card-body gap-4">
          <!-- Аккаунт -->
          <div v-if="upload.socialAccount" class="flex items-center gap-2">
            <Icon
              :name="platformIcons[upload.socialAccount.platform] ?? 'mingcute:share-2-line'"
              class="text-xl"
            />
            <div>
              <p class="font-medium text-base-content">
                {{ upload.socialAccount.displayName }}
              </p>
              <p class="text-xs text-base-content/60">
                {{ platformLabels[upload.socialAccount.platform] ?? upload.socialAccount.platform }}
              </p>
            </div>
          </div>

          <!-- Видео -->
          <div v-if="upload.video" class="flex items-center gap-2">
            <Icon name="mingcute:video-line" class="text-xl text-base-content/50" />
            <NuxtLink
              :to="`/videos/${upload.video.id}`"
              class="link link-primary text-sm"
            >
              Видео #{{ upload.video.id }}
              <template v-if="upload.video.scenario">
                — Сценарий #{{ upload.video.scenario.id }}
              </template>
            </NuxtLink>
          </div>

          <!-- Описание -->
          <div v-if="upload.description">
            <p class="text-xs font-semibold text-base-content/50 uppercase">Описание</p>
            <p class="text-sm text-base-content whitespace-pre-line">{{ upload.description }}</p>
          </div>

          <!-- Хештеги -->
          <div v-if="upload.hashtags?.length > 0">
            <p class="text-xs font-semibold text-base-content/50 uppercase mb-1">Хештеги</p>
            <div class="flex flex-wrap gap-1">
              <span
                v-for="tag in upload.hashtags"
                :key="tag"
                class="badge badge-sm badge-ghost"
              >
                #{{ tag }}
              </span>
            </div>
          </div>

          <!-- Запланировано -->
          <div v-if="scheduledFormatted">
            <p class="text-xs font-semibold text-base-content/50 uppercase">Запланировано на</p>
            <p class="text-sm text-base-content">{{ scheduledFormatted }}</p>
          </div>

          <!-- Дата создания -->
          <p class="text-xs text-base-content/50">
            Создано: {{ dateFormatted }}
          </p>

          <!-- Ошибка загрузки -->
          <div v-if="(upload.status === 'failed' || upload.status === 'blocked_by_env') && upload.errorMessage" role="alert" class="alert" :class="upload.status === 'blocked_by_env' ? 'alert-warning' : 'alert-error'">
            <Icon :name="upload.status === 'blocked_by_env' ? 'mingcute:lock-line' : 'mingcute:warning-line'" />
            <span>{{ upload.errorMessage }}</span>
          </div>

          <!-- Действия -->
          <UploadActions
            :upload-id="upload.id"
            :status="upload.status"
            :platform-post-url="upload.platformPostUrl"
            :blocked-by-env="upload.blockedByEnv"
            :attempt-count="upload.attemptCount"
            @retried="onRetried"
          />

          <!-- История попыток -->
          <div v-if="upload.attempts && upload.attempts.length > 0" class="mt-4">
            <div class="collapse collapse-arrow bg-base-200 rounded-lg">
              <input type="checkbox" />
              <div class="collapse-title text-sm font-medium">
                История попыток ({{ upload.attempts.length }})
              </div>
              <div class="collapse-content">
                <div class="space-y-2 pt-2">
                  <div
                    v-for="attempt in upload.attempts"
                    :key="attempt.id"
                    class="bg-base-100 rounded p-3 text-xs space-y-1"
                  >
                    <div class="flex items-center justify-between">
                      <span class="font-medium">Попытка #{{ attempt.attemptNumber }}</span>
                      <span
                        class="badge badge-xs"
                        :class="{
                          'badge-success': attempt.status === 'published',
                          'badge-error': attempt.status === 'failed',
                          'badge-info': attempt.status === 'running',
                        }"
                      >
                        {{ attempt.status }}
                      </span>
                    </div>
                    <div class="text-base-content/60">
                      {{ new Date(attempt.startedAt).toLocaleString('ru-RU') }}
                      <template v-if="attempt.finishedAt">
                        — {{ new Date(attempt.finishedAt).toLocaleString('ru-RU') }}
                      </template>
                    </div>
                    <div v-if="attempt.errorMessage" class="text-error">
                      {{ attempt.errorMessage }}
                    </div>
                    <div v-if="attempt.externalPostId" class="text-base-content/60">
                      Post ID: {{ attempt.externalPostId }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
