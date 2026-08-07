/**
 * LLM-судья policy-чека: второй контур поверх детерминированных правил.
 *
 * ПОЧЕМУ он нужен вдобавок к regexp-правилам: списки шаблонов ловят известные
 * формулировки, но обещание вылечить можно написать и без слова «вылечить»
 * («через неделю про таблетки забудете»). Судья закрывает перефраз. И наоборот —
 * ПОЧЕМУ он не заменяет правила: модель нестабильна, а регуляторный барьер обязан
 * работать даже когда судья выключен или упал.
 *
 * Ключевое поведение: НЕУДАЧА СУДЬИ НЕ ЕСТЬ «ВСЁ ХОРОШО». Ошибка вызова отдаётся
 * наружу отдельным статусом, и quality gate превращает её в блокирующий чек, а не
 * молча пропускает. Отключённый судья даёт warning, а не зелёный свет.
 *
 * Вызов идёт через общий адаптер `callAnthropicAgent`, поэтому при
 * ANTHROPIC_MOCK_MODE=true ответ берётся из фикстуры и сетевого запроса нет.
 * Импорт адаптера намеренно динамический: модуль правил должен грузиться в
 * DB-free тестах, не втягивая транспортные зависимости.
 */

import type { PolicySeverity, PolicyTextPart } from './policy-rules'
import { normalizePolicyText } from './policy-rules'

export interface PolicyJudgeViolation {
  severity: PolicySeverity
  /** Цитата из текста, к которой относится претензия. */
  quote: string
  reason: string
}

export interface PolicyJudgeVerdict {
  verdict: 'pass' | 'warning' | 'block'
  violations: PolicyJudgeViolation[]
  summary: string
}

export type PolicyJudgeOutcome =
  | { status: 'ok'; verdict: PolicyJudgeVerdict }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string }

export interface PolicyJudgeInput {
  parts: PolicyTextPart[]
  appName?: string | null
  forbiddenClaims?: readonly string[] | null
  riskyClaims?: readonly string[] | null
  /** false — судья отключён конфигом узла. */
  enabled?: boolean
}

/** Подпись адаптера вызова модели — вынесена ради подмены в тестах. */
export type PolicyJudgeCaller = (options: {
  systemPrompt: string
  userPrompt: string
  maxTokens: number
  agentName: string
  validate: (data: unknown) => PolicyJudgeVerdict
}) => Promise<PolicyJudgeVerdict>

export const POLICY_JUDGE_AGENT = 'content-policy-judge'

/**
 * Имя агента для mock-режима. Позволяет тесту прогнать блокирующую ветку через
 * фикстуру, не подменяя файлы (по образцу CRITIC_MOCK_VARIANT).
 */
export function getPolicyJudgeAgentName(): string {
  const variant = (process.env.POLICY_JUDGE_MOCK_VARIANT || '').trim().toLowerCase()
  if (variant === 'block') return `${POLICY_JUDGE_AGENT}-block`
  return POLICY_JUDGE_AGENT
}

/** Разбор ответа модели. Чистая функция: невалидный ответ — исключение, а не «pass». */
export function parsePolicyJudgeVerdict(data: unknown): PolicyJudgeVerdict {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('policy judge: ответ не является объектом')
  }
  const raw = data as Record<string, unknown>
  const verdict = String(raw.verdict ?? '').trim().toLowerCase()
  if (verdict !== 'pass' && verdict !== 'warning' && verdict !== 'block') {
    throw new Error(`policy judge: неизвестный verdict «${String(raw.verdict)}»`)
  }
  const rawViolations = Array.isArray(raw.violations) ? raw.violations : []
  const violations: PolicyJudgeViolation[] = rawViolations.map((item) => {
    const entry = (item ?? {}) as Record<string, unknown>
    const severity = String(entry.severity ?? '').trim().toLowerCase() === 'warning' ? 'warning' : 'blocking'
    return {
      severity: severity as PolicySeverity,
      quote: String(entry.quote ?? '').trim(),
      reason: String(entry.reason ?? '').trim() || 'без пояснения',
    }
  })
  // Вердикт block без единого нарушения — противоречивый ответ; не даём ему
  // раствориться в пустом списке, иначе чек покажет блок без причины.
  if (verdict === 'block' && violations.length === 0) {
    violations.push({ severity: 'blocking', quote: '', reason: 'модель вернула block без перечня нарушений' })
  }
  return {
    verdict,
    violations,
    summary: String(raw.summary ?? '').trim(),
  }
}

const SYSTEM_PROMPT = `Ты — Content Policy Judge для короткого видео о здоровье и питании.
Твоя задача — найти в тексте регуляторно опасные утверждения. Это финальный барьер перед публикацией.

БЛОКИРУЮЩИЕ нарушения (severity="blocking"):
1. Гарантия результата: «гарантируем», «100% результат», «обязательно похудеете», «сработает у всех».
2. Обещание лечения: «вылечит», «избавит от болезни», «уберёт диабет», «навсегда забудете про давление».
3. Подмена врача: замена или отмена лекарств, «врач не нужен», «без консультации врача».
4. Медицинские противопоказания без оговорки: упомянуты болезнь, беременность, препараты — и нет оговорки о консультации врача и противопоказаниях.
5. Постановка диагноза аудитории.

ПРЕДУПРЕЖДЕНИЯ (severity="warning"):
- обещание быстрого результата без оговорок, «минус N кг за неделю»;
- непроверяемая биология: шлаки, токсины, «разгоняет метаболизм»;
- ссылка на исследования без источника, абсолютные утверждения.

Перефраз считается нарушением: важен смысл, а не конкретные слова.
Если нарушений нет — verdict="pass". Если только предупреждения — verdict="warning". Хотя бы одно блокирующее — verdict="block".

Ответь СТРОГО одним JSON-объектом без пояснений вокруг:
{
  "verdict": "pass" | "warning" | "block",
  "violations": [ { "severity": "blocking" | "warning", "quote": "цитата из текста", "reason": "почему это нарушение" } ],
  "summary": "одно предложение с итогом"
}`

/** Сборка пользовательского промпта. Чистая функция — проверяется тестом. */
export function buildPolicyJudgePrompt(input: PolicyJudgeInput): string {
  const lines: string[] = []
  if (input.appName) lines.push(`ПРОДУКТ: ${input.appName}`)
  const forbidden = (input.forbiddenClaims ?? []).filter(Boolean)
  const risky = (input.riskyClaims ?? []).filter(Boolean)
  if (forbidden.length > 0) lines.push(`ЗАПРЕЩЁННЫЕ утверждения продукта: ${forbidden.join('; ')}`)
  if (risky.length > 0) lines.push(`РИСКОВАННЫЕ утверждения продукта: ${risky.join('; ')}`)
  lines.push('')
  lines.push('ТЕКСТ НА ПРОВЕРКУ:')
  for (const part of input.parts) {
    const text = String(part.text ?? '').trim()
    if (!text) continue
    lines.push(`--- ${part.source} ---`)
    lines.push(text)
  }
  return lines.join('\n')
}

async function defaultCaller(options: Parameters<PolicyJudgeCaller>[0]): Promise<PolicyJudgeVerdict> {
  const { callAnthropicAgent } = await import('../agents/call-anthropic')
  return callAnthropicAgent<PolicyJudgeVerdict>({
    systemPrompt: options.systemPrompt,
    userPrompt: options.userPrompt,
    maxTokens: options.maxTokens,
    agentName: options.agentName,
    validate: options.validate,
  })
}

/**
 * Прогон судьи. Никогда не бросает: результат вызова — это ДАННЫЕ для гейта,
 * а решение «блокировать или нет» принимает гейт. Исключение здесь означало бы
 * падение всего узла, и оператор не увидел бы остальные проверки.
 */
export async function runPolicyJudge(
  input: PolicyJudgeInput,
  caller: PolicyJudgeCaller = defaultCaller,
): Promise<PolicyJudgeOutcome> {
  if (input.enabled === false) {
    return { status: 'skipped', reason: 'LLM policy judge отключён в конфигурации узла' }
  }
  const hasText = input.parts.some(part => normalizePolicyText(part.text).length > 0)
  if (!hasText) {
    return { status: 'skipped', reason: 'нет текста сценария и субтитров для проверки' }
  }
  try {
    const verdict = await caller({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildPolicyJudgePrompt(input),
      maxTokens: 2048,
      agentName: getPolicyJudgeAgentName(),
      validate: parsePolicyJudgeVerdict,
    })
    return { status: 'ok', verdict }
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'failed', error: message }
  }
}
