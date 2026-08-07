/**
 * Правила policy-чека для тем о здоровье и питании (docs/PROJECT_CONTEXT.md, п.10).
 *
 * ПОЧЕМУ это отдельный модуль с чистыми функциями: до него единственным барьером
 * против медицинских обещаний была ПРОСЬБА в промпте генератора. Просьба к модели
 * — это не контроль: она не проверяется, не логируется и молча перестаёт работать
 * при смене промпта или модели. Регуляторный риск (обещание лечения, гарантия
 * результата) должен ловиться детерминированной постпроверкой готового текста,
 * которую видно в вердикте и можно прогнать тестом без сети.
 *
 * Все шаблоны написаны под НОРМАЛИЗОВАННЫЙ текст (`normalizePolicyText`):
 * нижний регистр, ё→е, пунктуация схлопнута в одиночные пробелы. Поэтому внутри
 * шаблонов не используются `\w` и `\b` — в JS они ASCII-only и на кириллице
 * молча не срабатывают.
 */

export type PolicySeverity = 'blocking' | 'warning'

/** Откуда взят текст, в котором найдено нарушение. */
export type PolicyTextSource = 'script' | 'hook' | 'cta' | 'subtitles' | 'llm_judge'

export interface PolicyTextPart {
  source: PolicyTextSource
  text: string
}

export interface PolicyFinding {
  ruleId: string
  severity: PolicySeverity
  source: PolicyTextSource
  message: string
  /** Фрагмент нормализованного текста вокруг совпадения — чтобы оператор видел, за что блок. */
  excerpt: string
}

export interface PolicyRule {
  id: string
  severity: PolicySeverity
  message: string
  patterns: RegExp[]
}

/** Любое слово нормализованного текста: кириллица, латиница, цифры, знак процента. */
const WORD = '[а-яa-z0-9%]+'

/** До `maxWords` произвольных слов между значимыми токенами шаблона. */
function gap(maxWords: number): string {
  return `(?:${WORD} ){0,${maxWords}}`
}

function rule(id: string, severity: PolicySeverity, message: string, sources: string[]): PolicyRule {
  return { id, severity, message, patterns: sources.map(src => new RegExp(src, 'u')) }
}

/**
 * Нормализация текста перед сопоставлением.
 * Схлопывание пунктуации важно: «гарантируем — результат!» и «гарантируем результат»
 * должны ловиться одним шаблоном.
 */
export function normalizePolicyText(raw: unknown): string {
  return String(raw ?? '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .trim()
    .replace(/ {2,}/gu, ' ')
}

/**
 * Встроенные правила. Блокирующие — ровно четыре класса из п.10 ТЗ:
 * гарантия результата, обещание лечения, обход врача, самодиагностика.
 * Остальное — предупреждения: это поводы для правки, но не регуляторный стоп.
 */
export const BUILT_IN_POLICY_RULES: PolicyRule[] = [
  rule('guaranteed_result', 'blocking', 'Обещание гарантированного результата', [
    `гарантиру[а-я]* ${gap(3)}(?:результат|похуден|снижен|эффект|избавлен|выздоровлен)[а-я]*`,
    `(?:результат|эффект|похуден|снижен)[а-я]* гарантирован[а-я]*`,
    `100 ?% ${gap(1)}(?:результат|гарант|эффектив)[а-я]*`,
    `обязательно ${gap(1)}(?:похуде|сброс|выздорове|поможе|получит|срабатыва)[а-я]*`,
    `(?:всем|каждому) без исключени[а-я]* ${gap(1)}(?:помога|подойд|работа)[а-я]*`,
  ]),
  rule('cure_promise', 'blocking', 'Обещание лечения или избавления от болезни', [
    '(?:вылеч|излеч|исцел)[а-я]*',
    `избав[а-я]* ${gap(2)}от ${gap(1)}(?:болезн|диабет|гипертон|псориаз|астм|аллерг|депресс|гастрит|ожирени|бессонниц)[а-я]*`,
    `(?:лечит|лечен|терапи)[а-я]* ${gap(1)}(?:диабет|гипертон|ожирени|щитовид|бесплоди|депресси|мигрен)[а-я]*`,
    `навсегда ${gap(2)}(?:забуд|избав)[а-я]* ${gap(2)}(?:болезн|диабет|давлен|таблетк)[а-я]*`,
  ]),
  rule('medical_supervision_bypass', 'blocking', 'Призыв заменить или отменить назначения врача', [
    `(?:замен[а-я]*|вместо) ${gap(2)}(?:лекарств|таблет|препарат|инсулин|врача|терапи)[а-я]*`,
    `(?:отмен[а-я]*|броса[а-я]*|бросай[а-я]*|прекрат[а-я]*|перестань[а-я]*) ${gap(2)}(?:таблет|лекарств|препарат|инсулин)[а-я]*`,
    'без (?:консультации |консультаци[а-я]* )?врача',
    'врач[а-я]* (?:вам |тебе )?(?:больше )?не нужен',
  ]),
  rule('self_diagnosis', 'blocking', 'Постановка диагноза без врача', [
    `(?:поставим|поставит|поставь|определим|определит|узнаешь|узнайте) ${gap(2)}диагноз[а-я]*`,
    'диагностиру[а-я]*',
  ]),
  rule('fast_result', 'warning', 'Обещание быстрого результата без оговорок', [
    'минус ?[0-9]+ ?(?:кг|килограмм)[а-я]*',
    `(?:быстро|мгновенно|моментально) ${gap(1)}(?:похуде|сброс|уйдут)[а-я]*`,
    `за [0-9]+ (?:дня|дней|день|недели|неделю) ${gap(1)}(?:похуде|минус|сброс)[а-я]*`,
    'похуде[а-я]* без (?:диет|усили|спорт|ограничен|трениров)[а-я]*',
  ]),
  rule('unverifiable_biology', 'warning', 'Непроверяемое утверждение о детоксе и метаболизме', [
    `(?:вывед|выводит|выведут|очища|очист)[а-я]* ${gap(2)}(?:токсин|шлак)[а-я]*`,
    '(?:^| )шлак[а-я]*',
    `(?:разгон|ускор)[а-я]* ${gap(2)}метаболизм[а-я]*`,
  ]),
  rule('unsourced_science', 'warning', 'Ссылка на исследования или абсолютное утверждение без источника', [
    'доказано (?:учены|наукой|исследовани)[а-я]*',
    '(?:ученые|исследовани[а-я]*) доказал[а-я]*',
    'единственн[а-я]* (?:способ|метод|средство)',
  ]),
]

/**
 * Медицинские темы, при упоминании которых текст обязан содержать оговорку.
 * Требование п.10: «медицинские противопоказания без оговорок» — блокирующий вердикт.
 */
export const MEDICAL_CONTEXT_TERMS = [
  'диабет', 'гипертони', 'давлени', 'щитовид', 'беременн', 'кормящ', 'гастрит',
  'холестерин', 'инсулин', 'гормональн', 'аллерги', 'астм', 'онколог', 'анеми',
  'антидепрессант', 'остеопороз', 'противопоказан', 'побочн',
]

/** Формулировки, которые считаются достаточной оговоркой. */
export const MEDICAL_DISCLAIMER_MARKERS = [
  'проконсультируйтесь с врачом',
  'проконсультируйся с врачом',
  'посоветуйтесь с врачом',
  'посоветуйся с врачом',
  'обратитесь к врачу',
  'обратитесь к специалисту',
  'консультация врача обязательна',
  'есть противопоказания',
  'имеются противопоказания',
  'не является медицинской рекомендацией',
  'не заменяет консультацию',
  'не заменяет рекомендации врача',
]

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30)
  const end = Math.min(text.length, index + length + 30)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

/** Прогон встроенных шаблонов по каждому куску текста. */
export function findPolicyRuleViolations(
  parts: PolicyTextPart[],
  rules: PolicyRule[] = BUILT_IN_POLICY_RULES,
): PolicyFinding[] {
  const findings: PolicyFinding[] = []
  for (const part of parts) {
    const text = normalizePolicyText(part.text)
    if (!text) continue
    for (const item of rules) {
      for (const pattern of item.patterns) {
        const match = pattern.exec(text)
        if (!match) continue
        findings.push({
          ruleId: item.id,
          severity: item.severity,
          source: part.source,
          message: item.message,
          excerpt: excerptAround(text, match.index, match[0].length),
        })
        // Одного попадания на правило и кусок текста достаточно: вердикт от
        // количества совпадений не меняется, а список issues не должен пухнуть.
        break
      }
    }
  }
  return findings
}

const CLAIM_STOP_WORDS = new Set([
  'что', 'этот', 'эта', 'это', 'как', 'для', 'при', 'без', 'или', 'наш', 'наши',
  'the', 'and', 'for', 'with', 'that', 'this',
])

/** Значимые токены формулировки: от 4 символов, без служебных слов. */
export function significantClaimTokens(claim: string): string[] {
  return normalizePolicyText(claim)
    .split(' ')
    .filter(token => token.length >= 4 && !CLAIM_STOP_WORDS.has(token))
}

/**
 * Сопоставление со списком формулировок приложения (App.forbiddenClaims / riskyClaims).
 *
 * Две стратегии: прямое вхождение нормализованной фразы и, как запасной вариант,
 * присутствие ВСЕХ значимых токенов формулировки в тексте (минимум двух). Второе
 * ловит перестановку слов и вставки — при этом остаётся консервативным, потому
 * что требует все токены, а не долю.
 */
export function findClaimListViolations(
  parts: PolicyTextPart[],
  claims: readonly string[] | null | undefined,
  severity: PolicySeverity,
  ruleId: string,
): PolicyFinding[] {
  const list = (claims ?? []).map(claim => String(claim ?? '').trim()).filter(Boolean)
  if (list.length === 0) return []
  const findings: PolicyFinding[] = []
  for (const part of parts) {
    const text = normalizePolicyText(part.text)
    if (!text) continue
    const tokens = new Set(text.split(' '))
    for (const claim of list) {
      const normalizedClaim = normalizePolicyText(claim)
      if (!normalizedClaim) continue
      let matched = false
      let index = text.indexOf(normalizedClaim)
      if (index >= 0) matched = true
      if (!matched) {
        const claimTokens = significantClaimTokens(claim)
        if (claimTokens.length >= 2 && claimTokens.every(token => tokens.has(token))) {
          matched = true
          index = text.indexOf(claimTokens[0]!)
        }
      }
      if (!matched) continue
      findings.push({
        ruleId,
        severity,
        source: part.source,
        message: severity === 'blocking'
          ? `Запрещённое утверждение приложения: «${claim}»`
          : `Рискованное утверждение приложения: «${claim}»`,
        excerpt: excerptAround(text, Math.max(0, index), normalizedClaim.length),
      })
    }
  }
  return findings
}

/**
 * Медицинская тема без оговорки. Считаем по СКЛЕЕННОМУ тексту: дисклеймер обычно
 * стоит в конце сценария или в субтитрах, а упоминание болезни — в середине хука,
 * и покусочная проверка ложно срабатывала бы на каждом фрагменте.
 */
export function findMissingMedicalDisclaimer(parts: PolicyTextPart[]): PolicyFinding[] {
  const combined = normalizePolicyText(parts.map(part => part.text).join(' '))
  if (!combined) return []
  const term = MEDICAL_CONTEXT_TERMS.find(item => combined.includes(item))
  if (!term) return []
  if (MEDICAL_DISCLAIMER_MARKERS.some(marker => combined.includes(marker))) return []
  const index = combined.indexOf(term)
  return [{
    ruleId: 'medical_disclaimer_missing',
    severity: 'blocking',
    source: 'script',
    message: `Медицинская тема («${term}…») упомянута без оговорки о противопоказаниях и консультации врача`,
    excerpt: excerptAround(combined, index, term.length),
  }]
}
