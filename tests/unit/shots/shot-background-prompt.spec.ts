import { describe, expect, it } from "vitest"

import {
  MIN_PROMPT_LENGTH,
  fallbackShotPrompt,
  mergeShotPrompts,
  type ShotPrompt,
  type ShotPromptRequest,
} from "~~/server/utils/agents/shot-background-prompt-agent"

const REQ: ShotPromptRequest[] = [
  { order: 0, idea: "график роста выручки", sceneText: "за квартал мы выросли втрое", durationSec: 1.8 },
  { order: 1, idea: null, sceneText: null, durationSec: 2.1 },
  { order: 2, idea: "офис на рассвете", sceneText: null, durationSec: 5.0 },
]

describe("фолбэк промпта кадра", () => {
  it("всегда длиннее порога валидатора — иначе validateScenePrompts бросит", () => {
    for (const r of REQ) {
      expect(fallbackShotPrompt(r, null).prompt.length).toBeGreaterThanOrEqual(MIN_PROMPT_LENGTH)
      expect(fallbackShotPrompt(r, "неоновый киберпанк").prompt.length).toBeGreaterThanOrEqual(MIN_PROMPT_LENGTH)
    }
  })

  it("purpose непустой — второе жёсткое требование валидатора", () => {
    for (const r of REQ) expect(fallbackShotPrompt(r, null).purpose.trim().length).toBeGreaterThan(0)
  })

  it("детерминирован: пересборка ролика даёт тот же промпт, значит тот же кэш картинки", () => {
    expect(fallbackShotPrompt(REQ[0]!, "стиль").prompt).toBe(fallbackShotPrompt(REQ[0]!, "стиль").prompt)
  })

  it("идея попадает в промпт, а стиль — дописывается", () => {
    const p = fallbackShotPrompt(REQ[0]!, "неоновый киберпанк").prompt
    expect(p).toContain("график роста выручки")
    expect(p).toContain("неоновый киберпанк")
  })

  it("пустая идея не даёт промпт из одних пробелов", () => {
    const p = fallbackShotPrompt({ order: 9, idea: "   ", sceneText: null, durationSec: 2 }, null)
    expect(p.prompt.trim().length).toBeGreaterThanOrEqual(MIN_PROMPT_LENGTH)
  })

  it("сохраняет order — по нему раннер склеивает ответ с сеткой", () => {
    expect(fallbackShotPrompt(REQ[2]!, null).order).toBe(2)
  })

  it("короткая идея сама по себе короче порога — переходит его только за счёт добавки", () => {
    // "график роста выручки" и "офис на рассвете" из REQ уже длиннее 50 символов
    // одним базовым предложением, поэтому не проверяют, что добавка вообще нужна.
    // Здесь идея нарочно короткая, чтобы без хвостовой добавки промпт не дотягивал до порога.
    const short: ShotPromptRequest = { order: 7, idea: "закат", sceneText: null, durationSec: 1 }
    const p = fallbackShotPrompt(short, null)
    expect(p.prompt.length).toBeGreaterThanOrEqual(MIN_PROMPT_LENGTH)
  })
})

describe("склейка ответа модели с сеткой кадров", () => {
  const answered: ShotPrompt[] = [
    { order: 2, prompt: "x".repeat(60), purpose: "перебивка" },
    { order: 0, prompt: "y".repeat(60), purpose: "иллюстрация тезиса" },
  ]

  it("склейка идёт ПО order, а не по позиции в ответе", () => {
    const { prompts } = mergeShotPrompts(REQ, answered, null)
    expect(prompts.map(p => p.order)).toEqual([0, 1, 2])
    expect(prompts.find(p => p.order === 0)!.prompt).toBe("y".repeat(60))
    expect(prompts.find(p => p.order === 2)!.prompt).toBe("x".repeat(60))
  })

  it("незаполненная ячейка добивается фолбэком и СЧИТАЕТСЯ", () => {
    const { prompts, filledByFallback } = mergeShotPrompts(REQ, answered, null)
    expect(filledByFallback).toBe(1)
    expect(prompts.find(p => p.order === 1)!.prompt).toBe(fallbackShotPrompt(REQ[1]!, null).prompt)
  })

  it("чужой order из ответа модели игнорируется, а не приписывается кадру", () => {
    const { prompts } = mergeShotPrompts(REQ, [{ order: 99, prompt: "z".repeat(60), purpose: "p" }], null)
    expect(prompts).toHaveLength(3)
    expect(prompts.every(p => !p.prompt.startsWith("z"))).toBe(true)
  })

  it("короткий промпт от модели отвергается фолбэком — валидатор такой бросит", () => {
    const { prompts, filledByFallback } = mergeShotPrompts(REQ, [{ order: 0, prompt: "коротко", purpose: "p" }], null)
    expect(filledByFallback).toBe(3)
    expect(prompts.find(p => p.order === 0)!.prompt.length).toBeGreaterThanOrEqual(MIN_PROMPT_LENGTH)
  })

  it("пустой purpose от модели отвергается тем же правилом", () => {
    const { filledByFallback } = mergeShotPrompts(REQ, [{ order: 0, prompt: "q".repeat(60), purpose: "  " }], null)
    expect(filledByFallback).toBe(3)
  })

  it("дубль order в ответе не удваивает кадр — берётся первый", () => {
    const dup = [{ order: 0, prompt: "a".repeat(60), purpose: "p" }, { order: 0, prompt: "b".repeat(60), purpose: "p" }]
    const { prompts } = mergeShotPrompts(REQ, dup, null)
    expect(prompts).toHaveLength(3)
    expect(prompts.find(p => p.order === 0)!.prompt).toBe("a".repeat(60))
  })
})
