<script setup lang="ts">
const props = defineProps<{
  storyPlan: any
}>()

const protagonistTypeLabels: Record<string, string> = {
  person: 'Персона',
  object: 'Объект',
  abstract: 'Абстракция',
}

const protagonistTypeColors: Record<string, string> = {
  person: 'badge-primary',
  object: 'badge-secondary',
  abstract: 'badge-accent',
}

const arcSteps = computed(() => {
  const arc = props.storyPlan?.storyArc
  if (!arc) return []
  return [
    { label: 'Завязка', text: arc.premise, icon: 'mingcute:play-circle-line' },
    { label: 'Конфликт', text: arc.conflict, icon: 'mingcute:alert-diamond-line' },
    { label: 'Поворот', text: arc.turningPoint, icon: 'mingcute:refresh-2-line' },
    { label: 'Развязка', text: arc.resolution, icon: 'mingcute:trophy-line' },
  ].filter(s => s.text)
})

const arcTemplateLabels: Record<string, string> = {
  transformation: 'Трансформация',
  discovery: 'Открытие',
  challenge: 'Вызов',
  comparison: 'Сравнение',
  day_in_life: 'День из жизни',
  social_proof: 'Соцдоказательство',
  curiosity: 'Любопытство',
  custom: 'Свободная',
}

const pacingLabels: Record<string, string> = {
  slow: 'Медленный',
  moderate: 'Умеренный',
  fast: 'Быстрый',
}

interface AppliedRef {
  favoritePromptId: number
  aspects: string[]
}

function appliedReferencesTooltip(refs: AppliedRef[] | null | undefined): string {
  if (!refs || refs.length === 0) return ''
  return refs
    .map(r => `Промт #${r.favoritePromptId}: ${r.aspects.join(', ')}`)
    .join(' | ')
}
</script>

<template>
  <div class="space-y-2">
    <!-- Story Arc -->
    <div v-if="storyPlan?.storyArc" class="collapse collapse-arrow bg-base-200">
      <input type="checkbox" checked="checked">
      <div class="collapse-title font-semibold text-sm flex items-center gap-2">
        <Icon name="mingcute:route-line" class="text-primary text-lg" />
        Сюжетная дуга
        <span
          v-if="storyPlan.storyArc.template"
          class="badge badge-sm badge-outline badge-primary"
        >
          {{ arcTemplateLabels[storyPlan.storyArc.template] || storyPlan.storyArc.template }}
        </span>
      </div>
      <div class="collapse-content space-y-3">
        <!-- Arc Steps as vertical steps -->
        <ul v-if="arcSteps.length" class="steps steps-vertical w-full">
          <li
            v-for="(step, idx) in arcSteps"
            :key="idx"
            class="step step-primary"
          >
            <div class="text-left">
              <div class="font-medium text-xs text-base-content/60 flex items-center gap-1">
                <Icon :name="step.icon" class="text-sm" />
                {{ step.label }}
              </div>
              <p class="text-sm text-base-content/80">{{ step.text }}</p>
            </div>
          </li>
        </ul>

        <!-- Emotional journey -->
        <div v-if="storyPlan.storyArc.emotionalJourney?.length" class="flex flex-wrap items-center gap-1 pt-1">
          <span class="text-xs text-base-content/50 mr-1">Эмоции:</span>
          <template v-for="(emotion, idx) in storyPlan.storyArc.emotionalJourney" :key="idx">
            <span class="badge badge-sm badge-ghost">{{ emotion }}</span>
            <Icon
              v-if="idx < storyPlan.storyArc.emotionalJourney.length - 1"
              name="mingcute:arrow-right-line"
              class="text-xs text-base-content/30"
            />
          </template>
        </div>
      </div>
    </div>

    <!-- Protagonist -->
    <div v-if="storyPlan?.protagonist" class="collapse collapse-arrow bg-base-200">
      <input type="checkbox">
      <div class="collapse-title font-semibold text-sm flex items-center gap-2">
        <Icon name="mingcute:user-star-line" class="text-secondary text-lg" />
        Протагонист
        <span
          v-if="storyPlan.protagonist.type"
          :class="['badge badge-sm', protagonistTypeColors[storyPlan.protagonist.type] || 'badge-neutral']"
        >
          {{ protagonistTypeLabels[storyPlan.protagonist.type] || storyPlan.protagonist.type }}
        </span>
      </div>
      <div class="collapse-content space-y-2">
        <p v-if="storyPlan.protagonist.description" class="text-sm text-base-content/80">
          {{ storyPlan.protagonist.description }}
        </p>

        <!-- State transition -->
        <div
          v-if="storyPlan.protagonist.initialState || storyPlan.protagonist.finalState"
          class="flex items-center gap-2 text-sm"
        >
          <span v-if="storyPlan.protagonist.initialState" class="badge badge-soft badge-warning badge-sm">
            {{ storyPlan.protagonist.initialState }}
          </span>
          <Icon
            v-if="storyPlan.protagonist.initialState && storyPlan.protagonist.finalState"
            name="mingcute:arrow-right-line"
            class="text-base-content/40"
          />
          <span v-if="storyPlan.protagonist.finalState" class="badge badge-soft badge-success badge-sm">
            {{ storyPlan.protagonist.finalState }}
          </span>
        </div>

        <!-- Visual identifiers -->
        <div v-if="storyPlan.protagonist.visualIdentifiers?.length" class="flex flex-wrap gap-1 pt-1">
          <span class="text-xs text-base-content/50 mr-1">Маркеры:</span>
          <span
            v-for="(marker, idx) in storyPlan.protagonist.visualIdentifiers"
            :key="idx"
            class="badge badge-sm badge-outline"
          >
            {{ marker }}
          </span>
        </div>
      </div>
    </div>

    <!-- Scenes -->
    <div v-if="storyPlan?.scenes?.length" class="collapse collapse-arrow bg-base-200">
      <input type="checkbox">
      <div class="collapse-title font-semibold text-sm flex items-center gap-2">
        <Icon name="mingcute:movie-line" class="text-accent text-lg" />
        Сцены
        <span class="badge badge-sm badge-ghost">{{ storyPlan.scenes.length }}</span>
      </div>
      <div class="collapse-content">
        <ul class="timeline timeline-vertical timeline-compact">
          <li v-for="(scene, idx) in storyPlan.scenes" :key="idx">
            <hr v-if="idx > 0" class="bg-primary" />
            <div class="timeline-middle">
              <span class="badge badge-sm badge-primary badge-outline font-mono">
                {{ scene.order ?? idx + 1 }}
              </span>
            </div>
            <div class="timeline-end mb-4 ml-2 space-y-1 w-full">
              <!-- Purpose + applied references badge -->
              <div class="flex items-start gap-2 flex-wrap">
                <p v-if="scene.purpose" class="text-sm font-medium text-base-content">
                  {{ scene.purpose }}
                </p>
                <span
                  v-if="scene.appliedReferences && scene.appliedReferences.length > 0"
                  class="badge badge-outline badge-xs gap-1 cursor-help shrink-0"
                  :title="appliedReferencesTooltip(scene.appliedReferences)"
                >
                  <Icon name="mingcute:bookmark-line" class="text-[9px]" />
                  Эталоны: {{ scene.appliedReferences.length }}
                </span>
              </div>

              <!-- Setting & Action -->
              <div class="text-xs text-base-content/70 space-y-0.5">
                <p v-if="scene.setting">
                  <span class="text-base-content/50">Место:</span> {{ scene.setting }}
                </p>
                <p v-if="scene.action">
                  <span class="text-base-content/50">Действие:</span> {{ scene.action }}
                </p>
              </div>

              <!-- Emotion + Duration -->
              <div class="flex flex-wrap items-center gap-1.5">
                <span v-if="scene.emotionalState" class="badge badge-xs badge-ghost">
                  {{ scene.emotionalState }}
                </span>
                <span v-if="scene.duration" class="badge badge-xs badge-outline">
                  {{ scene.duration }}
                </span>
              </div>

              <!-- Subtitle copy -->
              <p v-if="scene.subtitleCopy" class="text-xs text-base-content/60 italic">
                &laquo;{{ scene.subtitleCopy }}&raquo;
              </p>

              <!-- App integration beat -->
              <div
                v-if="scene.appIntegrationBeat"
                class="text-xs bg-primary/10 text-primary rounded px-2 py-1 flex items-center gap-1"
              >
                <Icon name="mingcute:cellphone-line" class="text-sm" />
                {{ scene.appIntegrationBeat }}
              </div>

              <!-- App screen reference (image-to-video Kling) -->
              <div
                v-if="scene.appScreenRef?.fileUrl"
                class="flex items-center gap-2 text-xs bg-info/10 text-info rounded px-2 py-1.5"
                title="Сцена использует скриншот приложения как опорное изображение для Kling image-to-video"
              >
                <img
                  :src="scene.appScreenRef.fileUrl"
                  :alt="scene.appScreenRef.intent"
                  class="w-10 h-10 rounded object-cover border border-info/30 shrink-0"
                />
                <div class="flex flex-col min-w-0">
                  <span class="font-medium">Скрин приложения → image-to-video</span>
                  <span class="text-[10px] opacity-70 truncate">{{ scene.appScreenRef.intent || 'show_interface' }}</span>
                </div>
              </div>
            </div>
            <hr v-if="idx < storyPlan.scenes.length - 1" class="bg-primary" />
          </li>
        </ul>
      </div>
    </div>

    <!-- Subtitle Style -->
    <div v-if="storyPlan?.subtitleStyle" class="collapse collapse-arrow bg-base-200">
      <input type="checkbox">
      <div class="collapse-title font-semibold text-sm flex items-center gap-2">
        <Icon name="mingcute:text-line" class="text-info text-lg" />
        Стиль субтитров
      </div>
      <div class="collapse-content space-y-2">
        <!-- Typography -->
        <div v-if="storyPlan.subtitleStyle.typography" class="text-xs text-base-content/70 space-y-0.5">
          <p v-if="storyPlan.subtitleStyle.typography.fontIntent">
            <span class="text-base-content/50">Шрифт:</span>
            {{ storyPlan.subtitleStyle.typography.fontIntent }}
          </p>
          <p v-if="storyPlan.subtitleStyle.typography.casing">
            <span class="text-base-content/50">Регистр:</span>
            {{ storyPlan.subtitleStyle.typography.casing }}
          </p>
        </div>

        <!-- Primary color swatch -->
        <div v-if="storyPlan.subtitleStyle.visual?.primaryColor" class="flex items-center gap-2">
          <span class="text-xs text-base-content/50">Цвет:</span>
          <div
            class="w-5 h-5 rounded-sm border border-base-300"
            :style="{ backgroundColor: storyPlan.subtitleStyle.visual.primaryColor }"
            :title="storyPlan.subtitleStyle.visual.primaryColor"
          />
          <span class="text-xs font-mono text-base-content/50">
            {{ storyPlan.subtitleStyle.visual.primaryColor }}
          </span>
        </div>

        <!-- Animation -->
        <div v-if="storyPlan.subtitleStyle.animation" class="flex flex-wrap items-center gap-1 text-xs">
          <span v-if="storyPlan.subtitleStyle.animation.entrance" class="badge badge-xs badge-outline badge-info">
            in: {{ storyPlan.subtitleStyle.animation.entrance }}
          </span>
          <span v-if="storyPlan.subtitleStyle.animation.exit" class="badge badge-xs badge-outline badge-info">
            out: {{ storyPlan.subtitleStyle.animation.exit }}
          </span>
          <span v-if="storyPlan.subtitleStyle.animation.emphasis" class="badge badge-xs badge-outline badge-accent">
            {{ storyPlan.subtitleStyle.animation.emphasis }}
          </span>
        </div>
      </div>
    </div>

    <!-- Voiceover Plan -->
    <div v-if="storyPlan?.voiceoverPlan?.enabled" class="collapse collapse-arrow bg-base-200">
      <input type="checkbox">
      <div class="collapse-title font-semibold text-sm flex items-center gap-2">
        <Icon name="mingcute:voice-line" class="text-warning text-lg" />
        Озвучка
      </div>
      <div class="collapse-content space-y-2">
        <div class="text-xs text-base-content/70 space-y-0.5">
          <p v-if="storyPlan.voiceoverPlan.narratorPersona">
            <span class="text-base-content/50">Рассказчик:</span>
            {{ storyPlan.voiceoverPlan.narratorPersona }}
          </p>
          <p v-if="storyPlan.voiceoverPlan.pacing">
            <span class="text-base-content/50">Темп:</span>
            {{ pacingLabels[storyPlan.voiceoverPlan.pacing] || storyPlan.voiceoverPlan.pacing }}
          </p>
        </div>

        <!-- Lines -->
        <div v-if="storyPlan.voiceoverPlan.lines?.length" class="space-y-1.5 pt-1">
          <div
            v-for="line in storyPlan.voiceoverPlan.lines"
            :key="line.sceneOrder"
            class="flex gap-2 text-xs"
          >
            <span class="badge badge-xs badge-outline font-mono shrink-0">
              {{ line.sceneOrder }}
            </span>
            <span class="text-base-content/80">{{ line.text }}</span>
            <span v-if="line.emotion" class="badge badge-xs badge-ghost shrink-0 ml-auto">
              {{ line.emotion }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Negative Constraints -->
    <div v-if="storyPlan?.negativeConstraints?.length" class="collapse collapse-arrow bg-base-200">
      <input type="checkbox">
      <div class="collapse-title font-semibold text-sm flex items-center gap-2">
        <Icon name="mingcute:close-circle-line" class="text-error text-lg" />
        Ограничения
        <span class="badge badge-sm badge-ghost">{{ storyPlan.negativeConstraints.length }}</span>
      </div>
      <div class="collapse-content">
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="(constraint, idx) in storyPlan.negativeConstraints"
            :key="idx"
            class="badge badge-sm badge-soft badge-error"
          >
            {{ constraint }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
