/**
 * Сопоставление текста сценария с распознанными словами.
 *
 * Показываем мы текст сценария («MRR»), а время знаем только про распознанные
 * слова («эм эр эр»). Поэтому задача не «исправить транскрипцию моделью», как
 * делают снаружи, а связать два ряда слов: эталонный текст у нас уже есть
 * (spec §4.2).
 *
 * Ядро — выравнивание двух последовательностей по indel-расстоянию (замена
 * запрещена: слово либо то же самое, либо пропуск с одной из сторон). Замена
 * дала бы «сопоставленные» пары непохожих слов и вместе с ними уверенные, но
 * выдуманные тайминги.
 *
 * Многосложные токены (аббревиатуры, числа) точным сравнением не ловятся
 * никогда: `MRR` не равно ни `эм`, ни `эр`. Их разбирает ОТДЕЛЬНЫЙ пост-проход
 * по словам, оставшимся ничьими между сопоставленными соседями. Делать это
 * внутри сопоставления нельзя — интервал такого слова перехлестнулся бы с
 * соседним.
 */

import type { Transcript, TranscriptWord } from "./types"

export interface AlignScene {
  order: number
  text: string
}

export interface AlignedWord {
  /** Слово ИЗ СЦЕНАРИЯ — именно оно попадёт в субтитр. */
  text: string
  startSec: number
  endSec: number
  /** Нашлось ли ему распознанное слово. false — время интерполировано. */
  matched: boolean
}

export interface AlignedScene {
  order: number
  startSec: number
  endSec: number
  words: AlignedWord[]
}

export interface AlignmentResult {
  scenes: AlignedScene[]
  /** Доля слов сценария, которым нашлось распознанное слово. */
  matchedRatio: number
  /** Сошлось меньше половины — границы ненадёжны, вызывающий обязан сказать вслух. */
  degraded: boolean
}

const DEGRADED_THRESHOLD = 0.5

interface ScriptToken {
  sceneOrder: number
  raw: string
  normalized: string
  /** Сколько распознанных слов токен может занять: у многосложных больше одного. */
  span: number
}

/** Приведение к сравнимому виду: регистр, ё/е, окружающая пунктуация. */
export function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/^[.,;:!?…«»"'`()\[\]{}]+|[.,;:!?…«»"'`()\[\]{}]+$/g, "")
    .trim()
}

/** Латинская аббревиатура из заглавных: «MRR» звучит тремя словами. */
function abbreviationSpan(raw: string): number {
  const bare = raw.replace(/[^A-Za-z]/g, "")
  const isAbbreviation = bare.length >= 2 && bare.length <= 5
    && bare === bare.toUpperCase()
    && raw === raw.toUpperCase()
  return isAbbreviation ? bare.length : 0
}

/**
 * Число произносится словами, и сколько их будет — неизвестно: «1000» это одна
 * «тысяча», а «1250» — четыре слова. Берём верхнюю оценку по числу разрядов;
 * пост-проход возьмёт столько ничейных слов, сколько реально есть.
 */
function numberSpan(raw: string): number {
  const digits = raw.replace(/[^0-9]/g, "")
  if (digits.length === 0) return 0
  return Math.min(4, Math.max(1, Math.ceil(digits.length / 2) + 1))
}

function tokenizeScene(scene: AlignScene): ScriptToken[] {
  return scene.text
    .split(/\s+/)
    .map(word => word.trim())
    .filter(Boolean)
    .map((raw) => {
      const normalized = normalizeToken(raw)
      const span = Math.max(1, abbreviationSpan(raw), numberSpan(raw))
      return { sceneOrder: scene.order, raw, normalized, span }
    })
    .filter(token => token.normalized.length > 0)
}

type Op = "match" | "script_only" | "transcript_only"

interface PathEntry { op: Op, scriptIndex: number, heardIndex: number }

function alignSequences(script: ScriptToken[], heard: TranscriptWord[]): PathEntry[] {
  const n = script.length
  const m = heard.length
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))

  for (let i = 0; i <= n; i += 1) cost[i]![0] = i
  for (let j = 0; j <= m; j += 1) cost[0]![j] = j

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const same = script[i - 1]!.normalized === normalizeToken(heard[j - 1]!.text)
      cost[i]![j] = Math.min(
        same ? cost[i - 1]![j - 1]! : Number.POSITIVE_INFINITY,
        cost[i - 1]![j]! + 1,
        cost[i]![j - 1]! + 1,
      )
    }
  }

  const path: PathEntry[] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const same = i > 0 && j > 0 && script[i - 1]!.normalized === normalizeToken(heard[j - 1]!.text)
    if (same && cost[i]![j] === cost[i - 1]![j - 1]) {
      path.push({ op: "match", scriptIndex: i - 1, heardIndex: j - 1 })
      i -= 1
      j -= 1
      continue
    }
    if (i > 0 && cost[i]![j] === cost[i - 1]![j]! + 1) {
      path.push({ op: "script_only", scriptIndex: i - 1, heardIndex: j })
      i -= 1
      continue
    }
    path.push({ op: "transcript_only", scriptIndex: i, heardIndex: j - 1 })
    j -= 1
  }

  return path.reverse()
}

/**
 * Многосложные токены забирают ничейные распознанные слова между соседями.
 * Возвращает, сколько токенов удалось закрыть, — это доля совпадений.
 */
function assignMultiWordTokens(
  tokens: readonly ScriptToken[],
  aligned: AlignedWord[],
  heard: readonly TranscriptWord[],
  heardOfScript: ReadonlyMap<number, number>,
  usedHeard: Set<number>,
): number {
  let assigned = 0

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    const word = aligned[index]!
    if (word.matched || token.span < 2) continue

    let lower = -1
    for (let back = index - 1; back >= 0; back -= 1) {
      const hit = heardOfScript.get(back)
      if (hit !== undefined) { lower = hit; break }
    }
    let upper = heard.length
    for (let forward = index + 1; forward < tokens.length; forward += 1) {
      const hit = heardOfScript.get(forward)
      if (hit !== undefined) { upper = hit; break }
    }

    const free: number[] = []
    for (let h = lower + 1; h < upper; h += 1) if (!usedHeard.has(h)) free.push(h)
    if (free.length === 0) continue

    const take = free.slice(0, token.span)
    word.startSec = heard[take[0]!]!.startSec
    word.endSec = heard[take[take.length - 1]!]!.endSec
    word.matched = true
    for (const h of take) usedHeard.add(h)
    assigned += 1
  }

  return assigned
}

/**
 * Слова без пары получают время в щели между сопоставленными соседями, и щель
 * делится между ними поровну: иначе вся группа загорится в караоке одновременно.
 */
function interpolate(words: AlignedWord[], fallbackStart: number, fallbackEnd: number): void {
  let index = 0
  while (index < words.length) {
    if (words[index]!.matched) { index += 1; continue }

    let runEnd = index
    while (runEnd < words.length && !words[runEnd]!.matched) runEnd += 1

    const prevEnd = index > 0 ? words[index - 1]!.endSec : fallbackStart
    const nextStart = runEnd < words.length ? words[runEnd]!.startSec : fallbackEnd
    const span = Math.max(0, nextStart - prevEnd)
    const step = span / (runEnd - index)

    for (let k = index; k < runEnd; k += 1) {
      words[k]!.startSec = prevEnd + step * (k - index)
      words[k]!.endSec = prevEnd + step * (k - index + 1)
    }

    index = runEnd
  }
}

export function alignScriptToTranscript(input: {
  scenes: AlignScene[]
  transcript: Transcript
}): AlignmentResult {
  const tokens = input.scenes.flatMap(tokenizeScene)
  const heard = input.transcript.words

  if (tokens.length === 0) {
    return { scenes: [], matchedRatio: 0, degraded: true }
  }

  const path = alignSequences(tokens, heard)
  const aligned: AlignedWord[] = tokens.map(token => ({
    text: token.raw,
    startSec: 0,
    endSec: 0,
    matched: false,
  }))

  const usedHeard = new Set<number>()
  const heardOfScript = new Map<number, number>()
  let matchedCount = 0

  for (const entry of path) {
    if (entry.op !== "match") continue
    const word = aligned[entry.scriptIndex]!
    const hit = heard[entry.heardIndex]!
    // Ровно одно распознанное слово: многосложные разбирает пост-проход ниже.
    word.startSec = hit.startSec
    word.endSec = hit.endSec
    word.matched = true
    usedHeard.add(entry.heardIndex)
    heardOfScript.set(entry.scriptIndex, entry.heardIndex)
    matchedCount += 1
  }

  matchedCount += assignMultiWordTokens(tokens, aligned, heard, heardOfScript, usedHeard)

  const timelineStart = heard[0]?.startSec ?? 0
  const timelineEnd = heard[heard.length - 1]?.endSec ?? 0

  // Границы соседних сцен, а не всего ролика: сцена, которую модель не узнала,
  // иначе растянулась бы от первого до последнего слова и накрыла соседей.
  const scenes: AlignedScene[] = []
  let cursor = 0
  let previousEnd = timelineStart

  for (let sceneIndex = 0; sceneIndex < input.scenes.length; sceneIndex += 1) {
    const scene = input.scenes[sceneIndex]!
    const count = tokens.filter(token => token.sceneOrder === scene.order).length
    if (count === 0) continue

    const words = aligned.slice(cursor, cursor + count)
    cursor += count

    let nextStart = timelineEnd
    for (let ahead = cursor; ahead < aligned.length; ahead += 1) {
      if (aligned[ahead]!.matched) { nextStart = aligned[ahead]!.startSec; break }
    }
    if (nextStart < previousEnd) nextStart = previousEnd

    interpolate(words, previousEnd, nextStart)
    const startSec = words[0]!.startSec
    const endSec = words[words.length - 1]!.endSec
    previousEnd = endSec

    scenes.push({ order: scene.order, startSec, endSec, words })
  }

  const matchedRatio = matchedCount / tokens.length
  return { scenes, matchedRatio, degraded: matchedRatio < DEGRADED_THRESHOLD }
}
