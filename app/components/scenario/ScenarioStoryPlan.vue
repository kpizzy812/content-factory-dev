<script setup lang="ts">
const props = defineProps<{
  storyPlan: any
}>()

const PROTAGONIST_LABELS: Record<string, string> = {
  person: 'Персона',
  object: 'Объект',
  abstract: 'Абстракция',
}

const ARC_TEMPLATE_LABELS: Record<string, string> = {
  transformation: 'Трансформация',
  discovery: 'Открытие',
  challenge: 'Вызов',
  comparison: 'Сравнение',
  day_in_life: 'День из жизни',
  social_proof: 'Соцдоказательство',
  curiosity: 'Любопытство',
  custom: 'Свободная',
}

const PACING_LABELS: Record<string, string> = {
  slow: 'Медленный',
  moderate: 'Умеренный',
  fast: 'Быстрый',
}

/** Нейтральная пометка-чип: у этих значений нет статуса, только подпись. */
const CHIP = 'rounded-sm border border-divider px-1.5 py-0.5 text-micro text-muted'

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

interface AppliedRef {
  favoritePromptId: number
  aspects: string[]
}

function appliedReferencesTooltip(refs: AppliedRef[] | null | undefined): string {
  if (!refs?.length) return ''
  return refs.map(r => `Промт #${r.favoritePromptId}: ${r.aspects.join(', ')}`).join(' · ')
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Сюжетная дуга -->
    <UiDisclosure
      v-if="storyPlan?.storyArc"
      title="Сюжетная дуга"
      icon="mingcute:route-line"
      icon-tone="text-accent"
      default-open
    >
      <template #header-extra>
        <span v-if="storyPlan.storyArc.template" :class="CHIP">
          {{ ARC_TEMPLATE_LABELS[storyPlan.storyArc.template] ?? storyPlan.storyArc.template }}
        </span>
      </template>

      <ol v-if="arcSteps.length" class="flex flex-col">
        <li
          v-for="(step, idx) in arcSteps"
          :key="idx"
          class="flex gap-2.5 border-b border-divider py-1.5 last:border-b-0"
        >
          <span
            class="tnum mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-accent-border bg-accent-bg font-mono text-micro text-accent"
          >
            {{ idx + 1 }}
          </span>
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 text-micro text-subtle">
              <Icon :name="step.icon" />
              {{ step.label }}
            </div>
            <p class="text-sm">{{ step.text }}</p>
          </div>
        </li>
      </ol>

      <div v-if="storyPlan.storyArc.emotionalJourney?.length" class="mt-2 flex flex-wrap items-center gap-1">
        <span class="mr-1 text-micro text-subtle">Эмоции</span>
        <template v-for="(emotion, idx) in storyPlan.storyArc.emotionalJourney" :key="idx">
          <span :class="CHIP">{{ emotion }}</span>
          <Icon
            v-if="idx < storyPlan.storyArc.emotionalJourney.length - 1"
            name="mingcute:right-line"
            class="text-subtle"
          />
        </template>
      </div>
    </UiDisclosure>

    <!-- Протагонист -->
    <UiDisclosure
      v-if="storyPlan?.protagonist"
      title="Протагонист"
      icon="mingcute:user-star-line"
      icon-tone="text-accent"
    >
      <template #header-extra>
        <span v-if="storyPlan.protagonist.type" :class="CHIP">
          {{ PROTAGONIST_LABELS[storyPlan.protagonist.type] ?? storyPlan.protagonist.type }}
        </span>
      </template>

      <p v-if="storyPlan.protagonist.description" class="text-sm">
        {{ storyPlan.protagonist.description }}
      </p>

      <div
        v-if="storyPlan.protagonist.initialState || storyPlan.protagonist.finalState"
        class="mt-2 flex flex-wrap items-center gap-1.5"
      >
        <span
          v-if="storyPlan.protagonist.initialState"
          class="rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-micro text-warning"
        >
          {{ storyPlan.protagonist.initialState }}
        </span>
        <Icon
          v-if="storyPlan.protagonist.initialState && storyPlan.protagonist.finalState"
          name="mingcute:right-line"
          class="text-subtle"
        />
        <span
          v-if="storyPlan.protagonist.finalState"
          class="rounded-sm border border-success-border bg-success-bg px-1.5 py-0.5 text-micro text-success"
        >
          {{ storyPlan.protagonist.finalState }}
        </span>
      </div>

      <div v-if="storyPlan.protagonist.visualIdentifiers?.length" class="mt-2 flex flex-wrap items-center gap-1">
        <span class="mr-1 text-micro text-subtle">Маркеры</span>
        <span v-for="(marker, idx) in storyPlan.protagonist.visualIdentifiers" :key="idx" :class="CHIP">
          {{ marker }}
        </span>
      </div>
    </UiDisclosure>

    <!-- Сцены -->
    <UiDisclosure
      v-if="storyPlan?.scenes?.length"
      title="Сцены"
      icon="mingcute:movie-line"
      icon-tone="text-accent"
      :count="storyPlan.scenes.length"
    >
      <ol class="flex flex-col">
        <li
          v-for="(scene, idx) in storyPlan.scenes"
          :key="idx"
          class="flex gap-2.5 border-b border-divider py-2 last:border-b-0"
        >
          <span
            class="tnum mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-micro text-muted"
          >
            {{ scene.order ?? idx + 1 }}
          </span>

          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <div class="flex flex-wrap items-start gap-2">
              <p v-if="scene.purpose" class="text-sm font-medium">{{ scene.purpose }}</p>
              <span
                v-if="scene.appliedReferences?.length"
                class="shrink-0 cursor-help rounded-sm border border-divider px-1.5 py-0.5 text-micro text-muted"
                :title="appliedReferencesTooltip(scene.appliedReferences)"
              >
                <Icon name="mingcute:bookmark-line" />
                эталонов {{ scene.appliedReferences.length }}
              </span>
            </div>

            <UiKeyValue
              :items="[
                { label: 'Место', value: scene.setting, mono: false },
                { label: 'Действие', value: scene.action, mono: false },
              ].filter(i => i.value)"
              label-width="72px"
            />

            <div v-if="scene.emotionalState || scene.duration" class="flex flex-wrap items-center gap-1">
              <span v-if="scene.emotionalState" :class="CHIP">{{ scene.emotionalState }}</span>
              <span v-if="scene.duration" :class="CHIP">{{ scene.duration }}</span>
            </div>

            <p v-if="scene.subtitleCopy" class="text-sm text-muted italic">«{{ scene.subtitleCopy }}»</p>

            <div
              v-if="scene.appIntegrationBeat"
              class="flex items-center gap-1.5 rounded-sm border border-accent-border bg-accent-bg px-2 py-1 text-micro text-accent"
            >
              <Icon name="mingcute:cellphone-line" />
              {{ scene.appIntegrationBeat }}
            </div>

            <div
              v-if="scene.appScreenRef?.fileUrl"
              class="flex items-center gap-2 rounded-sm border border-info-border bg-info-bg px-2 py-1.5 text-info"
              title="Скриншот приложения идёт опорным кадром в image-to-video"
            >
              <img
                :src="scene.appScreenRef.fileUrl"
                :alt="scene.appScreenRef.intent"
                class="size-10 shrink-0 rounded-sm border border-info-border object-cover"
              >
              <div class="flex min-w-0 flex-col">
                <span class="text-micro font-medium">Скрин приложения → image-to-video</span>
                <span class="truncate font-mono text-[10px] opacity-70">
                  {{ scene.appScreenRef.intent || 'show_interface' }}
                </span>
              </div>
            </div>
          </div>
        </li>
      </ol>
    </UiDisclosure>

    <!-- Стиль субтитров -->
    <UiDisclosure
      v-if="storyPlan?.subtitleStyle"
      title="Стиль субтитров"
      icon="mingcute:text-line"
      icon-tone="text-info"
    >
      <UiKeyValue
        :items="[
          { label: 'Шрифт', value: storyPlan.subtitleStyle.typography?.fontIntent, mono: false },
          { label: 'Регистр', value: storyPlan.subtitleStyle.typography?.casing, mono: false },
        ].filter(i => i.value)"
      />

      <div v-if="storyPlan.subtitleStyle.visual?.primaryColor" class="mt-2 flex items-center gap-2">
        <span class="text-micro text-subtle">Цвет</span>
        <span
          class="size-5 rounded-sm border border-border"
          :style="{ backgroundColor: storyPlan.subtitleStyle.visual.primaryColor }"
          :title="storyPlan.subtitleStyle.visual.primaryColor"
        />
        <span class="font-mono text-micro text-muted">{{ storyPlan.subtitleStyle.visual.primaryColor }}</span>
      </div>

      <div v-if="storyPlan.subtitleStyle.animation" class="mt-2 flex flex-wrap items-center gap-1">
        <span v-if="storyPlan.subtitleStyle.animation.entrance" :class="CHIP">
          вход: {{ storyPlan.subtitleStyle.animation.entrance }}
        </span>
        <span v-if="storyPlan.subtitleStyle.animation.exit" :class="CHIP">
          выход: {{ storyPlan.subtitleStyle.animation.exit }}
        </span>
        <span v-if="storyPlan.subtitleStyle.animation.emphasis" :class="CHIP">
          акцент: {{ storyPlan.subtitleStyle.animation.emphasis }}
        </span>
      </div>
    </UiDisclosure>

    <!-- Озвучка -->
    <UiDisclosure
      v-if="storyPlan?.voiceoverPlan?.enabled"
      title="Озвучка"
      icon="mingcute:voice-line"
      icon-tone="text-warning"
    >
      <UiKeyValue
        :items="[
          { label: 'Рассказчик', value: storyPlan.voiceoverPlan.narratorPersona, mono: false },
          {
            label: 'Темп',
            value: storyPlan.voiceoverPlan.pacing
              ? (PACING_LABELS[storyPlan.voiceoverPlan.pacing] ?? storyPlan.voiceoverPlan.pacing)
              : null,
            mono: false,
          },
        ].filter(i => i.value)"
      />

      <div v-if="storyPlan.voiceoverPlan.lines?.length" class="mt-2 flex flex-col">
        <div
          v-for="line in storyPlan.voiceoverPlan.lines"
          :key="line.sceneOrder"
          class="flex items-start gap-2 border-b border-divider py-1.5 text-sm last:border-b-0"
        >
          <span class="tnum shrink-0 font-mono text-micro text-subtle">{{ line.sceneOrder }}</span>
          <span class="min-w-0 flex-1">{{ line.text }}</span>
          <span v-if="line.emotion" :class="[CHIP, 'shrink-0']">{{ line.emotion }}</span>
        </div>
      </div>
    </UiDisclosure>

    <!-- Ограничения -->
    <UiDisclosure
      v-if="storyPlan?.negativeConstraints?.length"
      title="Ограничения"
      icon="mingcute:close-circle-line"
      icon-tone="text-danger"
      :count="storyPlan.negativeConstraints.length"
    >
      <div class="flex flex-wrap gap-1">
        <span
          v-for="(constraint, idx) in storyPlan.negativeConstraints"
          :key="idx"
          class="rounded-sm border border-danger-border bg-danger-bg px-1.5 py-0.5 text-micro text-danger"
        >
          {{ constraint }}
        </span>
      </div>
    </UiDisclosure>
  </div>
</template>
