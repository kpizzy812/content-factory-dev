/**
 * Сборка policy-чека: тексты → находки → чеки quality gate.
 *
 * Всё здесь — чистые функции. Единственный «грязный» шаг (вызов LLM-судьи) живёт
 * в policy-judge.ts и приезжает сюда готовым результатом, поэтому вердикт можно
 * проверить тестом без сети и без БД.
 */

import type { QualityCheck } from './severity'
import { makeQualityCheck } from './severity'
import type { PolicyFinding, PolicyTextPart } from './policy-rules'
import {
  findClaimListViolations,
  findMissingMedicalDisclaimer,
  findPolicyRuleViolations,
  normalizePolicyText,
} from './policy-rules'
import type { PolicyJudgeOutcome } from './policy-judge'

export interface PolicyTextSourceInput {
  fullScript?: unknown
  hook?: unknown
  cta?: unknown
  /** StoryPlan варианта: финальные субтитры лежат в scenes[].subtitleCopy. */
  storyPlan?: unknown
  /** Явный список строк субтитров, если он уже собран вызывающей стороной. */
  subtitles?: unknown
}

/**
 * Извлекает финальные субтитры из storyPlan.
 * ПОЧЕМУ именно оттуда: рендер (video-pipeline-steps) берёт субтитры из
 * `scenes[].subtitleCopy`, и туда же пишет ручная правка через
 * POST /api/videos/[id]/edit-subtitles. Значит это и есть текст, который увидит
 * зритель — проверять надо его, а не исходный сценарий.
 */
export function extractSubtitleTexts(storyPlan: unknown): string[] {
  if (!storyPlan || typeof storyPlan !== 'object' || Array.isArray(storyPlan)) return []
  const scenes = (storyPlan as { scenes?: unknown }).scenes
  if (!Array.isArray(scenes)) return []
  return scenes
    .map((scene) => {
      if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return ''
      return String((scene as { subtitleCopy?: unknown }).subtitleCopy ?? '').trim()
    })
    .filter(text => text.length > 0)
}

/** Собирает куски текста, подлежащие policy-проверке. */
export function collectPolicyTexts(input: PolicyTextSourceInput): PolicyTextPart[] {
  const parts: PolicyTextPart[] = []
  const push = (source: PolicyTextPart['source'], value: unknown) => {
    const text = String(value ?? '').trim()
    if (text) parts.push({ source, text })
  }
  push('script', input.fullScript)
  push('hook', input.hook)
  push('cta', input.cta)
  const subtitles = Array.isArray(input.subtitles)
    ? input.subtitles.map(item => String(item ?? '').trim()).filter(Boolean)
    : extractSubtitleTexts(input.storyPlan)
  if (subtitles.length > 0) parts.push({ source: 'subtitles', text: subtitles.join(' ') })
  return parts
}

export interface ContentPolicyInput {
  parts: PolicyTextPart[]
  forbiddenClaims?: readonly string[] | null
  riskyClaims?: readonly string[] | null
  judge?: PolicyJudgeOutcome | null
}

export interface ContentPolicyEvaluation {
  /** Находки детерминированных правил и списков приложения. */
  ruleFindings: PolicyFinding[]
  /** Находки LLM-судьи, приведённые к общему формату. */
  judgeFindings: PolicyFinding[]
  findings: PolicyFinding[]
  judge: PolicyJudgeOutcome | null
  /** Был ли вообще текст для проверки. Пустой текст ≠ чистый текст. */
  hasText: boolean
}

/** Приводит нарушения судьи к общему типу находки. */
export function judgeFindingsOf(judge: PolicyJudgeOutcome | null | undefined): PolicyFinding[] {
  if (!judge || judge.status !== 'ok') return []
  return judge.verdict.violations.map(violation => ({
    ruleId: 'llm_policy_judge',
    severity: violation.severity,
    source: 'llm_judge' as const,
    message: violation.reason,
    excerpt: violation.quote,
  }))
}

export function evaluateContentPolicy(input: ContentPolicyInput): ContentPolicyEvaluation {
  const parts = input.parts.filter(part => normalizePolicyText(part.text).length > 0)
  const ruleFindings = [
    ...findPolicyRuleViolations(parts),
    ...findClaimListViolations(parts, input.forbiddenClaims, 'blocking', 'app_forbidden_claim'),
    ...findClaimListViolations(parts, input.riskyClaims, 'warning', 'app_risky_claim'),
    ...findMissingMedicalDisclaimer(parts),
  ]
  const judgeFindings = judgeFindingsOf(input.judge)
  return {
    ruleFindings,
    judgeFindings,
    findings: [...ruleFindings, ...judgeFindings],
    judge: input.judge ?? null,
    hasText: parts.length > 0,
  }
}

function describe(findings: PolicyFinding[], limit = 3): string {
  return findings
    .slice(0, limit)
    .map(finding => `[${finding.source}] ${finding.message}${finding.excerpt ? ` — «${finding.excerpt}»` : ''}`)
    .join('; ')
}

/**
 * Превращает результат policy-анализа в чеки quality gate.
 *
 * Три чека вместо одного, потому что у них разная природа:
 *   policy_forbidden_claims — блокирующий, регуляторный;
 *   policy_risky_claims     — предупреждение, повод для правки;
 *   policy_judge            — состояние второго контура. Отдельным чеком именно
 *                             затем, чтобы «судья не отработал» было видно как
 *                             отдельная строка, а не растворилось в тишине.
 */
export function buildPolicyChecks(evaluation: ContentPolicyEvaluation): QualityCheck[] {
  const checks: QualityCheck[] = []
  const blocking = evaluation.ruleFindings.filter(finding => finding.severity === 'blocking')
  const warnings = evaluation.ruleFindings.filter(finding => finding.severity === 'warning')

  checks.push(makeQualityCheck(
    'policy_forbidden_claims',
    evaluation.hasText && blocking.length === 0,
    evaluation.hasText
      ? (blocking.length === 0
          ? 'No forbidden medical or guaranteed-result claims found'
          : `Forbidden claims found: ${describe(blocking)}`)
      : 'No script or subtitle text to run the policy check on',
    { severity: 'blocking', value: blocking.length },
  ))

  checks.push(makeQualityCheck(
    'policy_risky_claims',
    warnings.length === 0,
    warnings.length === 0
      ? 'No risky wording found'
      : `Risky wording found: ${describe(warnings)}`,
    { severity: 'warning', value: warnings.length },
  ))

  const judge = evaluation.judge
  if (!judge || judge.status === 'skipped') {
    // Не запускали — значит не проверяли. Жёлтый флаг, но не «pass».
    const reason = judge?.status === 'skipped' ? judge.reason : 'судья не запускался'
    checks.push(makeQualityCheck(
      'policy_judge',
      false,
      `LLM policy judge did not verify the text: ${reason}`,
      { severity: 'warning', value: 'skipped' },
    ))
  }
  else if (judge.status === 'failed') {
    // Упавший судья — это НЕ зелёный свет: непроверенный регуляторный риск
    // опаснее косметического замечания, поэтому уровень блокирующий.
    checks.push(makeQualityCheck(
      'policy_judge',
      false,
      `LLM policy judge failed, content policy is unverified: ${judge.error}`,
      { severity: 'blocking', value: 'failed' },
    ))
  }
  else {
    const judgeBlocking = evaluation.judgeFindings.filter(finding => finding.severity === 'blocking')
    const judgeWarnings = evaluation.judgeFindings.filter(finding => finding.severity === 'warning')
    const blocked = judge.verdict.verdict === 'block' || judgeBlocking.length > 0
    if (blocked) {
      checks.push(makeQualityCheck(
        'policy_judge',
        false,
        `LLM policy judge blocked the text: ${describe(judgeBlocking) || judge.verdict.summary}`,
        { severity: 'blocking', value: judge.verdict.verdict },
      ))
    }
    else if (judge.verdict.verdict === 'warning' || judgeWarnings.length > 0) {
      checks.push(makeQualityCheck(
        'policy_judge',
        false,
        `LLM policy judge flagged wording: ${describe(judgeWarnings) || judge.verdict.summary}`,
        { severity: 'warning', value: judge.verdict.verdict },
      ))
    }
    else {
      checks.push(makeQualityCheck(
        'policy_judge',
        true,
        'LLM policy judge found no policy violations',
        { severity: 'blocking', value: judge.verdict.verdict },
      ))
    }
  }

  return checks
}
