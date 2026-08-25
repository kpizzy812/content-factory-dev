/**
 * Контрактный тест `/api/videos/estimate-cost` — маршрут audio-first (§7, §12
 * спеки 2026-08-16-audio-first-editing-design): «смета сходится с фактом».
 *
 * Эндпоинт считает ДО создания Video, поэтому у него нет `videoId` и он не
 * может звать `resolveVideoRoute` напрямую. Вместо этого он резолвит маршрут
 * ТЕМ ЖЕ признаком через `decideVideoRoute` (video-pipeline-run-policy.ts):
 * `EDIT_PIPELINE` из окружения + доступность модели транскрипции в реестре.
 * Третья ветка `decideVideoRoute` (уже синтезированный трек) для ролика,
 * которого ещё нет, структурно недостижима — это не подмена признака.
 *
 * Отдельный spec-файл нужен потому, что @nuxt/test-utils поднимает Nuxt
 * dev-сервер отдельным процессом: env для сервера задаётся ТОЛЬКО в setup(),
 * а process.env теста на уже запущенный сервер не влияет (см.
 * tests/api/scenario-critic-disabled.spec.ts).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { nuxtTestEnv } from "../helpers/nuxt-env"

await setup({
  dev: true,
  server: true,
  browser: false,
  env: {
    ...nuxtTestEnv,
    EDIT_PIPELINE: "on",
    // Модель уже подтверждена тарифом (правка model-specs.ts), но integrated
    // остаётся false по §4.1 — маршрут явно включается этой переменной.
    MEDIA_MODEL_TRANSCRIPTION: "replicate:whisper",
  },
})

describe("POST /api/videos/estimate-cost — EDIT_PIPELINE включён, модель транскрипции настроена", () => {
  it("смета включает transcription и edit_plan — маршрут резолвится тем же признаком, что и реальный пайплайн", async () => {
    const res = await $fetch<{
      breakdown: Array<{ stage: string, subtotal: number }>
      total: number
    }>("/api/videos/estimate-cost", {
      method: "POST",
      body: {
        sceneCount: 3,
        clipDuration: 5,
        generateAudio: true,
        enableMusic: true,
        voiceoverEnabled: false,
        quality: "1080p",
      },
    })

    const transcriptionItem = res.breakdown.find(item => item.stage === "transcription")
    const editPlanItem = res.breakdown.find(item => item.stage === "edit_plan")
    expect(transcriptionItem).toBeDefined()
    expect(editPlanItem).toBeDefined()
    expect(transcriptionItem!.subtotal).toBeGreaterThan(0)
    expect(editPlanItem!.subtotal).toBeGreaterThan(0)
  })

  it("явный body.audioFirst=false перекрывает вычисленный признак (клиентский оверрайд не затирается)", async () => {
    const res = await $fetch<{ breakdown: Array<{ stage: string }> }>(
      "/api/videos/estimate-cost",
      {
        method: "POST",
        body: {
          sceneCount: 3,
          clipDuration: 5,
          audioFirst: false,
        },
      },
    )

    expect(res.breakdown.some(item => item.stage === "transcription")).toBe(false)
    expect(res.breakdown.some(item => item.stage === "edit_plan")).toBe(false)
  })
})
