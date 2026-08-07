/**
 * Регрессия на P0-6 и P1-12: policy-чек как реальный барьер и уровни серьёзности.
 *
 * Дефект 1 (P0-6). Требование docs/PROJECT_CONTEXT.md п.10 — QA обязан выявлять
 * категоричные медицинские обещания и запрещать формулировки о гарантированном
 * лечении или результате. Единственным «барьером» была просьба в промпте
 * генератора: quality gate текст сценария и финальные субтитры не смотрел вообще,
 * и ролик с «избавит от диабета» проходил гейт со вердиктом pass.
 *
 * Дефект 2 (P1-12). У чеков не было уровня: пятый аргумент add() существовал, но
 * никто не выставлял его в false. Косметическое замечание (короткий хук) валило
 * партию так же, как опасное утверждение, а отсутствующая или выключенная оценка
 * критика не отличалась от «всё хорошо».
 *
 * DB-free: чистые функции + LLM-судья с подменённым адаптером вызова. Сетевого
 * запроса нет ни в одном сценарии — отдельный тест это проверяет эмпирически.
 *
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { evaluateFactoryQuality } from '~~/server/utils/content-quality-gate'
import { aggregateQualityVerdict, makeQualityCheck } from '~~/server/utils/quality/severity'
import {
  findMissingMedicalDisclaimer,
  findPolicyRuleViolations,
  normalizePolicyText,
} from '~~/server/utils/quality/policy-rules'
import {
  buildPolicyChecks,
  collectPolicyTexts,
  evaluateContentPolicy,
} from '~~/server/utils/quality/policy-check'
import {
  parsePolicyJudgeVerdict,
  runPolicyJudge,
  type PolicyJudgeOutcome,
} from '~~/server/utils/quality/policy-judge'

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index}`).join(' ')
}

/** Судья отработал и претензий не имеет — «чистый» фон для остальных проверок. */
const JUDGE_OK: PolicyJudgeOutcome = {
  status: 'ok',
  verdict: { verdict: 'pass', violations: [], summary: 'нарушений нет' },
}

const BASE = {
  stage: 'script' as const,
  hypothesis: { id: 'h1', keyword: 'PLAN', cta: 'Отправь PLAN' },
  funnel: { id: 'f1', status: 'active', keyword: 'PLAN' },
  leadMagnet: { id: 'l1', status: 'approved' },
  scenario: { id: 1 },
  variant: {
    id: 2,
    hook: 'Ваши короткие видео теряют заявки раньше, чем зритель дойдёт до призыва',
    cta: 'Отправь PLAN в комментарии',
    fullScript: words(180),
    storyPlan: { scenes: [] },
    qualityScore: 82,
  },
  app: { name: 'Reforma', forbiddenClaims: [], riskyClaims: [] },
  policyJudge: JUDGE_OK,
}

function checkOf(result: { checks: Array<{ key: string }> }, key: string) {
  return result.checks.find(check => check.key === key)
}

describe('policy-чек как блокирующая проверка', () => {
  it('блокирует обещание вылечить болезнь в тексте сценария', () => {
    const result = evaluateFactoryQuality({
      ...BASE,
      variant: {
        ...BASE.variant,
        fullScript: `${words(170)} Эта привычка избавит вас от диабета за месяц.`,
      },
    })

    expect(result.verdict).toBe('fail')
    const check = checkOf(result, 'policy_forbidden_claims')
    expect(check?.passed).toBe(false)
    expect(check?.severity).toBe('blocking')
    expect(result.issues.some(issue => issue.startsWith('policy_forbidden_claims:'))).toBe(true)
  })

  it('блокирует гарантию результата в финальных субтитрах, а не только в сценарии', () => {
    const result = evaluateFactoryQuality({
      ...BASE,
      variant: {
        ...BASE.variant,
        storyPlan: {
          scenes: [
            { order: 1, subtitleCopy: 'Первый шаг простой' },
            { order: 2, subtitleCopy: 'Мы гарантируем результат уже через неделю' },
          ],
        },
      },
    })

    expect(result.verdict).toBe('fail')
    expect(checkOf(result, 'policy_forbidden_claims')?.passed).toBe(false)
  })

  it('блокирует запрещённое утверждение из App.forbiddenClaims', () => {
    const result = evaluateFactoryQuality({
      ...BASE,
      app: { name: 'Reforma', forbiddenClaims: ['заменяет консультацию диетолога'], riskyClaims: [] },
      variant: {
        ...BASE.variant,
        fullScript: `${words(170)} Приложение заменяет консультацию диетолога полностью.`,
      },
    })

    expect(result.verdict).toBe('fail')
    expect(checkOf(result, 'policy_forbidden_claims')?.message).toContain('заменяет консультацию диетолога')
  })

  it('блокирует медицинскую тему без оговорки о противопоказаниях', () => {
    const findings = findMissingMedicalDisclaimer([
      { source: 'script', text: 'При гипертонии добавьте этот продукт в рацион.' },
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('blocking')

    const withDisclaimer = findMissingMedicalDisclaimer([
      { source: 'script', text: 'При гипертонии добавьте продукт в рацион. Есть противопоказания, проконсультируйтесь с врачом.' },
    ])
    expect(withDisclaimer).toHaveLength(0)
  })

  it('рискованная формулировка даёт warning и не валит партию', () => {
    const result = evaluateFactoryQuality({
      ...BASE,
      app: { name: 'Reforma', forbiddenClaims: [], riskyClaims: [] },
      variant: {
        ...BASE.variant,
        fullScript: `${words(170)} Этот приём разгоняет метаболизм.`,
      },
    })

    expect(result.verdict).toBe('warning')
    expect(checkOf(result, 'policy_risky_claims')?.severity).toBe('warning')
    expect(checkOf(result, 'policy_forbidden_claims')?.passed).toBe(true)
  })

  it('чистый текст проходит policy-чек', () => {
    const result = evaluateFactoryQuality(BASE)
    expect(result.verdict).toBe('pass')
    expect(checkOf(result, 'policy_forbidden_claims')?.passed).toBe(true)
    expect(checkOf(result, 'policy_judge')?.passed).toBe(true)
  })

  it('пустой текст не считается чистым', () => {
    const evaluation = evaluateContentPolicy({ parts: [], judge: JUDGE_OK })
    const checks = buildPolicyChecks(evaluation)
    expect(checks.find(check => check.key === 'policy_forbidden_claims')?.passed).toBe(false)
  })

  it('нормализация схлопывает пунктуацию и ё, шаблон срабатывает на кириллице', () => {
    expect(normalizePolicyText('Гарантируем — РЕЗУЛЬТАТ!')).toBe('гарантируем результат')
    const findings = findPolicyRuleViolations([
      { source: 'script', text: 'Гарантируем — РЕЗУЛЬТАТ!' },
    ])
    expect(findings.map(finding => finding.ruleId)).toContain('guaranteed_result')
  })
})

describe('severity у проверок quality gate', () => {
  it('косметическое замечание даёт warning, а не fail', () => {
    const result = evaluateFactoryQuality({
      ...BASE,
      variant: { ...BASE.variant, hook: 'Смотри' },
    })

    expect(checkOf(result, 'hook')?.passed).toBe(false)
    expect(checkOf(result, 'hook')?.severity).toBe('warning')
    expect(result.verdict).toBe('warning')
  })

  it('опасное утверждение всё равно валит партию, даже если косметика в порядке', () => {
    const result = evaluateFactoryQuality({
      ...BASE,
      variant: { ...BASE.variant, fullScript: `${words(170)} Этот курс вылечит бессонницу.` },
    })
    expect(result.verdict).toBe('fail')
  })

  it('пустой список чеков не считается успехом', () => {
    expect(aggregateQualityVerdict([]).verdict).toBe('fail')
  })

  it('поле blocking синхронизировано с severity', () => {
    expect(makeQualityCheck('k', true, 'm', { severity: 'warning' }).blocking).toBe(false)
    expect(makeQualityCheck('k', true, 'm').blocking).toBe(true)
  })
})

describe('упавший или выключенный критик не даёт зелёный свет', () => {
  it('отсутствие оценки критика блокирует', () => {
    const result = evaluateFactoryQuality({
      ...BASE,
      variant: { ...BASE.variant, qualityScore: undefined },
    })

    expect(result.verdict).toBe('fail')
    const check = checkOf(result, 'critic_available')
    expect(check?.passed).toBe(false)
    expect(check?.severity).toBe('blocking')
  })

  it('выключенный критик даёт warning, а не pass', () => {
    const result = evaluateFactoryQuality({ ...BASE, criticEnabled: false })

    expect(result.verdict).toBe('warning')
    const check = checkOf(result, 'critic_score')
    expect(check?.passed).toBe(false)
    expect(check?.severity).toBe('warning')
    expect(checkOf(result, 'critic_available')).toBeUndefined()
  })
})

describe('LLM-судья policy-чека', () => {
  it('упавший судья блокирует, а не пропускает', () => {
    const result = evaluateFactoryQuality({
      ...BASE,
      policyJudge: { status: 'failed', error: 'AI-сервис не ответил' },
    })

    expect(result.verdict).toBe('fail')
    const check = checkOf(result, 'policy_judge')
    expect(check?.passed).toBe(false)
    expect(check?.severity).toBe('blocking')
    expect(check?.message).toContain('AI-сервис не ответил')
  })

  it('невыполненный судья даёт warning, а не тишину', () => {
    const result = evaluateFactoryQuality({
      ...BASE,
      policyJudge: { status: 'skipped', reason: 'отключён в конфигурации узла' },
    })

    expect(result.verdict).toBe('warning')
    expect(checkOf(result, 'policy_judge')?.severity).toBe('warning')
  })

  it('отсутствие результата судьи вообще тоже не проходит молча', () => {
    const result = evaluateFactoryQuality({ ...BASE, policyJudge: null })
    expect(result.verdict).toBe('warning')
    expect(checkOf(result, 'policy_judge')?.passed).toBe(false)
  })

  it('вердикт block от судьи блокирует, даже когда шаблоны молчат', () => {
    const result = evaluateFactoryQuality({
      ...BASE,
      policyJudge: {
        status: 'ok',
        verdict: {
          verdict: 'block',
          violations: [{ severity: 'blocking', quote: 'про таблетки можно забыть', reason: 'обещание отмены препаратов' }],
          summary: 'обещание отмены лекарств',
        },
      },
    })

    expect(result.verdict).toBe('fail')
    expect(checkOf(result, 'policy_judge')?.message).toContain('обещание отмены препаратов')
  })

  it('невалидный ответ модели не превращается в pass', () => {
    expect(() => parsePolicyJudgeVerdict({ verdict: 'ok' })).toThrow()
    expect(() => parsePolicyJudgeVerdict('pass')).toThrow()
    // block без перечня нарушений получает синтетическую причину, а не пустоту
    expect(parsePolicyJudgeVerdict({ verdict: 'block' }).violations).toHaveLength(1)
  })

  it('ошибка адаптера возвращается статусом failed, а не исключением', async () => {
    const outcome = await runPolicyJudge(
      { parts: [{ source: 'script', text: 'любой текст' }] },
      async () => { throw new Error('502 от AI-сервиса') },
    )
    expect(outcome).toEqual({ status: 'failed', error: '502 от AI-сервиса' })
  })

  it('отключённый судья не вызывает адаптер', async () => {
    const caller = vi.fn()
    const outcome = await runPolicyJudge(
      { parts: [{ source: 'script', text: 'любой текст' }], enabled: false },
      caller,
    )
    expect(caller).not.toHaveBeenCalled()
    expect(outcome.status).toBe('skipped')
  })
})

describe('mock-режим судьи не ходит в сеть', () => {
  const originalMock = process.env.ANTHROPIC_MOCK_MODE
  const originalVariant = process.env.POLICY_JUDGE_MOCK_VARIANT
  const originalFetch = (globalThis as Record<string, unknown>).$fetch

  afterEach(() => {
    if (originalMock === undefined) delete process.env.ANTHROPIC_MOCK_MODE
    else process.env.ANTHROPIC_MOCK_MODE = originalMock
    if (originalVariant === undefined) delete process.env.POLICY_JUDGE_MOCK_VARIANT
    else process.env.POLICY_JUDGE_MOCK_VARIANT = originalVariant
    if (originalFetch === undefined) delete (globalThis as Record<string, unknown>).$fetch
    else (globalThis as Record<string, unknown>).$fetch = originalFetch
  })

  it('отдаёт фикстуру и не делает сетевого вызова', async () => {
    process.env.ANTHROPIC_MOCK_MODE = 'true'
    delete process.env.POLICY_JUDGE_MOCK_VARIANT
    // Любая попытка реального вызова взорвётся: $fetch — единственный сетевой путь адаптера.
    const fetchSpy = vi.fn(() => { throw new Error('network call in mock mode') })
    ;(globalThis as Record<string, unknown>).$fetch = fetchSpy

    const outcome = await runPolicyJudge({
      parts: collectPolicyTexts({ fullScript: 'Обычный текст сценария про завтрак.' }),
      appName: 'Reforma',
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(outcome.status).toBe('ok')
    expect(outcome.status === 'ok' && outcome.verdict.verdict).toBe('pass')
  })

  it('через POLICY_JUDGE_MOCK_VARIANT=block отдаёт блокирующую фикстуру', async () => {
    process.env.ANTHROPIC_MOCK_MODE = 'true'
    process.env.POLICY_JUDGE_MOCK_VARIANT = 'block'
    const fetchSpy = vi.fn(() => { throw new Error('network call in mock mode') })
    ;(globalThis as Record<string, unknown>).$fetch = fetchSpy

    const outcome = await runPolicyJudge({
      parts: [{ source: 'script', text: 'Через неделю про таблетки можно забыть.' }],
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(outcome.status === 'ok' && outcome.verdict.verdict).toBe('block')
  })
})
