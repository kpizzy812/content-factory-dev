/**
 * Детерминированный ремонт плана кадров.
 *
 * §5.3: нарушения сначала чинятся притяжкой границ к ближайшему межсловному
 * интервалу, и только если после ремонта план всё ещё невалиден — идёт повторный
 * запрос к модели с текстом ошибки. Порядок именно такой, потому что второй
 * запрос стоит денег и времени, а девять из десяти нарушений — это границы,
 * которые код умеет поправить сам.
 *
 * Функция чистая и не мутирует вход: план приходит из ответа модели, и портить
 * его значит потерять то, что уйдёт в диагностику при повторном запросе.
 *
 * Фикс-раунд 1 (ревью task-3-review.md, 3 Critical + 4 Important): общий с
 * `validate.ts` конец таймлайна и допуск округления; окно поиска щели; слияние
 * коротких кадров вместо мигания; код `invalid_bounds`; тишина по краям трека
 * тоже щель; честные `before`/`remaining`.
 *
 * Фикс-раунд 2 (ре-ревью task-3-rereview.md, 3 Critical + 4 Important):
 * слияние из раунда 1 лечило симптом, но само порождало нарушения:
 * - Critical Н-1: слияние могло растянуть presenter-кадр за потолок lip-sync
 *   ИЛИ съесть все presenter-кадры целиком (перекос доли перебивок к 100%).
 *   Оба нарушения ремонт не умеет чинить сам, то есть гарантировал платный
 *   повторный запрос — ровно то, ради чего §5.3 существует. Теперь слияние
 *   проверяется {@link canMergeSafely}: сначала пробуем слить со следующим,
 *   нельзя — с предыдущим, нельзя ни с кем — короткий кадр остаётся как есть.
 * - Critical Н-2: внутренняя граница клэмпилась СЫРОЙ `trackDurationSec`, а не
 *   `timelineEndSec` — на планах с кадром за концом трека `snapSecToFrame`
 *   уводил границу выше настоящего конца, давая вырожденный (нулевой или
 *   отрицательный) кадр в 100% таких случаев. Теперь клэмп — `timelineEndSec`.
 * - Critical Н-3: хвост был явно исключён из слияния (`!isLast`) — короткий
 *   финальный кадр проходил чистым. Теперь хвост участвует в слиянии наравне
 *   с остальными (сливается НАЗАД, в предыдущий — вперёд для него нет цели).
 * - Important Н-4: расстояние до щели мерялось до её СЕРЕДИНЫ, из-за чего
 *   широкие щели (в том числе только что добавленная краевая тишина)
 *   систематически отвергались окном поиска. Теперь — до ближайшей безопасной
 *   точки ВНУТРИ щели (`clamp` с запасом на слово и кадр).
 * - Important Н-5: константы слияния и окна поиска были фиксированы и могли
 *   конфликтовать с легальной настройкой `profile.shotChangeSec` (например,
 *   `shotChangeSec = 0.8` — легальный минимум по `profile.ts` — совпадал со
 *   старым порогом слияния и вырезал половину плана). Теперь обе величины —
 *   доля от `profile.shotChangeSec`.
 * - Important Н-6: слияние удаляло кадр вместе с `idea`/`sceneOrder`/
 *   `backgroundClipId` молча. Теперь `repairShotPlan` возвращает `changes` —
 *   список того, что реально сделано (слито, сброшено, деградировано).
 * - Minor Н-8..Н-11: докстринг `remaining` был неточным (см. поле ниже);
 *   `collectGaps` могла отдать щель ВНУТРИ слова при перекрывающихся словах,
 *   выбранная точка теперь перепроверяется; `WORD_EDGE_TOLERANCE_SEC` стал
 *   зависеть от fps вместе с допуском округления (перенесено в `validate.ts`);
 *   проверка ссылки на фон в `validate.ts` приведена к тому же стилю (`||`),
 *   что уже был здесь.
 *
 * Фикс-раунд 3 (ре-ревью task-3-rereview-2.md, 2 Critical + 6 Important):
 * защита ведущего и потолка из раунда 2 спасали одно и не смотрели на второе.
 * - Critical НН-1: окно поиска щели могло утащить внутреннюю границу почти
 *   на всю длину короткого кадра (окно считалось от `profile.shotChangeSec`,
 *   а не от длины самого кадра), presenter-сегмент схлопывался в вырожденный,
 *   и принудительное устранение вырожденного кадра обходило защиту R1,
 *   стирая единственного ведущего на ПОЛНОСТЬЮ здоровом входе. Теперь окно
 *   ограничено ещё и долей ЛОКАЛЬНОЙ длины кадра ({@link LOCAL_SPAN_WINDOW_RATIO}),
 *   а перед принудительным устранением единственный presenter сначала
 *   пытается быть спасён сдвигом границы за счёт соседа ({@link rescueOnlyPresenter}).
 * - Critical НН-2: те же правила R1/R2 могли оставить кадр в один-три кадра
 *   длиной (с оплаченным фоном) молча — `remaining` и `changes` пусты.
 *   Заведён абсолютный пол ({@link absoluteMinShotSec}), ниже которого кадр
 *   не может остаться в плане ни при каких мягких правилах (кроме спасения
 *   единственного presenter).
 * - Important Н-5 (доработано): `relieveOversizedPresenterEdge` заменена на
 *   {@link relieveOversizedPresenters} — работает для ЛЮБОГО presenter-сегмента,
 *   не только крайнего, и ищет ближайшую безопасную точку вместо немедленного
 *   отказа при попадании в слово (замер: раньше 3751 отказ на 1892 применения).
 * - Important Н-6 (доработано): допуск «рвёт ли слово» поднят до ПОЛНОГО
 *   кадра (`validate.ts`) — прежних `halfFrameSec + 3мс` было недостаточно,
 *   чтобы округление к кадру не могло само перекинуть уже проверенную
 *   безопасную точку обратно в слово.
 * - Important Н-7 (доработано): `changes` дополнен сдвигами границ
 *   `resolveBoundary`, разгрузкой `relieveOversizedPresenters` и записью о
 *   кадре, оставленном коротким без безопасного слияния — раньше все три
 *   вида правок были бесшумны. Плюс `finalShotOrder` — номер в ИТОГОВОМ
 *   плане, если кадр до него дожил.
 */

import { snapSecToFrame } from "../voiceover/segment-cut"
import { halfFrameSec, splitsWord, timelineEndSec, validateShotPlan, wordEdgeToleranceSec } from "./validate"
import type { PlannedShot, ShotPlan } from "./types"
import type { ResolvedEditProfile } from "./profile"
import type { ShotPlanContext, ShotPlanViolation } from "./validate"

/** Межсловные интервалы: пары (конец слова, начало следующего) плюс тишина по краям. */
interface WordGap {
  startSec: number
  endSec: number
}

/** Отрезок таймлайна на промежуточном шаге ремонта — до материализации в `PlannedShot`. */
interface Segment {
  startSec: number
  endSec: number
  /** Чьи метаданные (foreground/background/idea/...) сейчас несёт отрезок. */
  source: PlannedShot
}

/**
 * Доля целевого шага монтажа, которую кадр обязан набрать, чтобы не считаться
 * миганием (Important Н-5 ре-ревью). Раньше был константой 0.8 с, СЛУЧАЙНО
 * совпадавшей с `MIN_VALID_SHOT_CHANGE_SEC` — нижней границей ЛЕГАЛЬНОЙ
 * настройки `profile.shotChangeSec` (`profile.ts`). При такой настройке пол
 * ремонта равнялся цели, и ремонт вырезал примерно половину плана. Доля 0.4
 * держит пол заметно ниже цели на всём легальном диапазоне: при минимуме
 * 0.8 с пол — 0.32 с, при дефолте 1.8 с — 0.72 с.
 */
const MIN_SHOT_RATIO = 0.4

/**
 * Доля целевого шага монтажа, задающая окно поиска безопасной точки реза
 * (Important Н-5 ре-ревью). Раньше окно было константой 1.0 с — шире целого
 * кадра при легальном минимальном шаге 0.8 с и 56% кадра при дефолтном 1.8 с
 * (замер ре-ревью: граница уехала ровно на всю ширину окна и утащила с собой
 * соседний кадр). Доля 0.3 заметно уже половины шага на всём диапазоне.
 *
 * Этого одного отношения оказалось недостаточно (Critical НН-1/НН-2 ре-ревью
 * раунда 3): окно считалось от `profile.shotChangeSec` — ЦЕЛЕВОГО шага
 * монтажа — и никак не было связано с ФАКТИЧЕСКОЙ длиной кадра, который оно
 * режет. На коротком кадре (например, presenter-реплика в 0.9 с при
 * `shotChangeSec` под 3 с) окно оказывалось шире самого кадра и утаскивало
 * границу почти на всю его длину — вплоть до `timelineEnd`, схлопывая кадр в
 * вырожденный и стирая единственного ведущего после принудительного слияния.
 * См. {@link LOCAL_SPAN_WINDOW_RATIO}.
 */
const SAFE_POINT_WINDOW_RATIO = 0.3

/**
 * Вторая, обязательная граница окна поиска (Critical НН-1/НН-2 ре-ревью
 * раунда 3): окно не может быть шире доли ФАКТИЧЕСКОЙ длины кадра, границу
 * которого сейчас двигаем — независимо от того, что разрешает
 * `profile.shotChangeSec`. Итоговое окно — минимум из доли шага профиля и
 * доли локальной длины кадра, поэтому короткий кадр защищён even когда
 * `shotChangeSec` в профиле большой. Половина — эвристика «граница может
 * забрать не больше половины кадра за один шаг», подобранная так, чтобы
 * устранять оба воспроизведённых сценария (seed=11555, seed=432 ре-ревью),
 * не проверялась перебором на оптимальность точного числа.
 */
const LOCAL_SPAN_WINDOW_RATIO = 0.5

/**
 * Абсолютный пол длины кадра, ниже которого кадр не может остаться в плане
 * ни при каких мягких правилах — даже ценой потолка lip-sync или защиты
 * presenter-идентичности (Critical НН-2 ре-ревью раунда 3): кадр короче
 * этого порога — не смена плана, а мигание, неотличимое от брака монтажа, и
 * при этом он всё равно получает оплаченный фон. 3 кадра — не эстетика: это
 * общепринятый нижний порог читаемой смены плана (100-125 мс при 24-30 fps),
 * заметно короче любого разумного `MIN_SHOT_RATIO`-порога. Единственное
 * исключение — риск потерять ЕДИНСТВЕННОГО presenter-кадра: тогда вместо
 * устранения применяется {@link rescueOnlyPresenter}.
 */
const ABSOLUTE_MIN_FRAMES = 3

/** Экспортируется, чтобы тесты считали ожидаемый порог от того же профиля, а не дублировали формулу магическим числом. */
export function minShotSec(profile: ResolvedEditProfile): number {
  return profile.shotChangeSec * MIN_SHOT_RATIO
}

/** Экспортируется по той же причине, что {@link minShotSec}. */
export function safePointWindowSec(profile: ResolvedEditProfile): number {
  return profile.shotChangeSec * SAFE_POINT_WINDOW_RATIO
}

/**
 * Экспортируется по той же причине, что {@link minShotSec}.
 *
 * Негодный fps (НН-19 ре-ревью раунда 4): `ABSOLUTE_MIN_FRAMES / Math.max(fps, 1)`
 * при `fps <= 0` давал ПОЛ В 3 СЕКУНДЫ — единственное место в модуле без
 * защиты от негодного fps (`halfFrameSec` в `validate.ts` падает на
 * `DEFAULT_EPSILON_SEC`, `snapSecToFrame`/`floorToFrame` возвращают вход как
 * есть) — и трёхсекундный пол схлопывал совершенно нормальный план (замер:
 * 5 кадров по 2 с при `fps = 0` → 2 кадра на выходе). Теперь при негодном fps
 * пол — 0: устранение ниже абсолютного пола просто не срабатывает, что
 * безопаснее, чем расширить его до случайного числа секунд. `ShotPlanContext.fps`
 * сегодня никем не заполняется (Task 5), поэтому дефект пока не наблюдаем в
 * проде — это мина, обезвреженная на будущее.
 */
export function absoluteMinShotSec(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? ABSOLUTE_MIN_FRAMES / fps : 0
}

function collectGaps(context: ShotPlanContext, timelineEnd: number): WordGap[] {
  const words = context.alignedScenes
    .flatMap(scene => scene.words)
    .slice()
    .sort((a, b) => a.startSec - b.startSec)

  if (words.length === 0) return []

  const gaps: WordGap[] = []

  // Тишина до первого слова и после последнего — тоже щель (Important 4
  // ревью): это самые естественные точки реза, а прежняя реализация видела
  // только пары СОСЕДНИХ слов и на разреженном материале теряла две самые
  // широкие щели трека.
  if (words[0]!.startSec > 0) gaps.push({ startSec: 0, endSec: words[0]!.startSec })

  for (let index = 0; index + 1 < words.length; index += 1) {
    const end = words[index]!.endSec
    const next = words[index + 1]!.startSec
    if (next > end) gaps.push({ startSec: end, endSec: next })
  }

  const lastWordEnd = words[words.length - 1]!.endSec
  if (lastWordEnd < timelineEnd) gaps.push({ startSec: lastWordEnd, endSec: timelineEnd })

  return gaps
}

/**
 * Точка ВНУТРИ щели, ближайшая к желаемой границе, с запасом `margin` от
 * обоих краёв щели: край щели совпадает с концом/началом слова, и точка без
 * запаса сдвинула бы кадр вплотную к слову — притяжка к кадру (округление до
 * `snapSecToFrame`) могла бы тогда снова завести её внутрь слова. Если щель
 * уже удвоенного запаса — целимся в её середину, деваться некуда.
 *
 * Minor НН-13 ре-ревью раунда 2 (буква рулинга B3-10): рулинг предписывал
 * мерить расстояние по ближней безопасной точке, но РЕЗАТЬ по-прежнему в
 * середину щели. Здесь резать тоже по ближней точке — отступление, которое
 * ре-ревью проверило отдельным экспериментом (та же реплика, но рез в
 * середину) на 20 000 сценариях: дрейф идемпотентности не меняется (7 из
 * 20 000 в обоих вариантах), `word_split` в `remaining` даже НИЖЕ у текущей
 * реализации (7 311 против 7 545) — отступление признано безвредным, реализация
 * не хуже буквы рулинга. Не меняю намеренно: буква рулинга работает хуже
 * измеренного факта.
 */
function nearestPointInGap(gap: WordGap, desiredSec: number, margin: number): number {
  const lo = gap.startSec + margin
  const hi = gap.endSec - margin
  if (lo > hi) return (gap.startSec + gap.endSec) / 2
  return Math.min(Math.max(desiredSec, lo), hi)
}

/**
 * Безопасная точка реза рядом с желаемой границей.
 *
 * Если желаемая граница УЖЕ не рвёт слово — она остаётся на месте (только
 * притягивается к кадру): переписывать исправную границу незачем (Important 1
 * ревью). НО округление к кадру само способно столкнуть безопасную точку
 * обратно внутрь слова, если запас был меньше половины кадра (найдено
 * тестом-свойством при увеличении числа сценариев с 80 до 300: `desiredSec`
 * лежал в 3.7 мс от границы допуска, что меньше половины кадра на 25 fps
 * (20 мс), и `snapSecToFrame` перекинул точку на другую сторону) — поэтому
 * притянутая к кадру точка ПЕРЕПРОВЕРЯЕТСЯ, и если снятие всё же порвало
 * слово, граница обрабатывается наравне со случаем «рвёт с самого начала».
 * Тогда ищем ближайшую щель В ПРЕДЕЛАХ `windowSec`, но расстояние меряем до
 * БЛИЖАЙШЕЙ БЕЗОПАСНОЙ ТОЧКИ ВНУТРИ щели ({@link nearestPointInGap}), а не до
 * её середины (Important Н-4 ре-ревью): середина широкой щели может быть
 * дальше окна, хотя её ближний край — рядом, и именно так систематически
 * отвергались самые удобные щели, включая только что добавленную краевую
 * тишину. Выбранная точка тоже перепроверяется на то, что сама не рвёт слово
 * (Minor Н-9 ре-ревью: при перекрывающихся словах щель между несмежными
 * парами может лежать ВНУТРИ третьего слова). Если ничего не подошло —
 * граница остаётся на желаемой точке, притянутой к кадру, всё ещё рвёт слово,
 * и об этом честно узнает `remaining` (а с ре-ревью раунда 4 — и `changes`,
 * см. вызывающий код в `repairShotPlan`).
 *
 * Important НН-6 ре-ревью раундов 2-4: фолбэк на провал перепроверки после
 * `snapSecToFrame` раньше был ЧИСТО ДИАГНОСТИЧЕСКИМ — он обнаруживал, что
 * снятая точка порвала слово, шёл искать щель, и при провале поиска ВСЁ
 * РАВНО возвращал ту же самую (пересчитанную заново) небезопасную снятую
 * точку, то есть перепроверка ни на что не влияла. Раунд 3 пытался закрыть
 * это расширением допуска (`wordEdgeToleranceSec`), но ре-ревью раунда 4
 * показало, что это ухудшает метрику (щель нужной ширины реже находится) и
 * не трогает сам фолбэк. Правка здесь — не новый механизм поиска, а честное
 * использование уже установленного факта: если ИСХОДНАЯ (до снятия к кадру)
 * желаемая точка сама по себе безопасна — это единственный случай, когда
 * `snapSecToFrame` вообще мог всё сломать, — и щели рядом не нашлось,
 * возвращается ИСХОДНАЯ точка, а не повторное снятие, гарантированно
 * воспроизводящее ту же небезопасную точку, которую перепроверка только что
 * забраковала.
 */
function resolveBoundary(
  words: readonly { startSec: number, endSec: number }[],
  gaps: readonly WordGap[],
  desiredSec: number,
  fps: number,
  windowSec: number,
  timelineEnd: number,
): number {
  const desiredIsSafe = !splitsWord(words, desiredSec, fps)
  if (desiredIsSafe) {
    const snapped = snapSecToFrame(desiredSec, fps)
    if (!splitsWord(words, snapped, fps)) return snapped
  }

  // Тот же допуск, что и решение «рвёт ли слово» (Minor НН-10 ре-ревью
  // раунда 3) — раньше здесь был отдельный, случайно совпадающий по значению
  // `halfFrameSec(fps) * 2`, никак не связанный с `wordEdgeToleranceSec`.
  const margin = wordEdgeToleranceSec(fps)

  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const gap of gaps) {
    const point = nearestPointInGap(gap, desiredSec, margin)
    if (splitsWord(words, point, fps)) continue
    const distance = Math.abs(point - desiredSec)
    if (distance <= windowSec && distance < bestDistance) {
      bestDistance = distance
      best = point
    }
  }
  // Math.min с timelineEnd — защита по построению: щель приходит из
  // collectGaps и не должна вылезать за конец таймлайна, но граница обязана
  // держать инвариант «не позже конца трека» без исключений (Critical 2/Н-2).
  if (best !== null) return snapSecToFrame(Math.min(best, timelineEnd), fps)

  // НН-6 ре-ревью раунда 4: щели не нашлось. Если исходная (до снятия)
  // точка была безопасна — снятие сюда и завело, откатываем именно снятие,
  // а не желаемую точку целиком.
  if (desiredIsSafe) return Math.min(desiredSec, timelineEnd)

  // Исходная точка сама по себе рвёт слово, и щели рядом нет — деваться
  // некуда: возвращаем снятую желаемую точку как есть, честно небезопасную.
  // Вызывающий код обязан залогировать это отдельно (не как «сдвинута к
  // щели», а как «безопасной точки не нашлось») — нормальный, а не скрытый
  // исход.
  return snapSecToFrame(Math.min(desiredSec, timelineEnd), fps)
}

/**
 * Может ли `eaten` быть слит в `survivor` БЕЗ нарушения, которое ремонт не
 * умеет чинить сам (Critical Н-1 ре-ревью). Два жёстких предела:
 * - потолок lip-sync модели, если слитый кадр остаётся presenter-кадром;
 * - presenter-кадр не может быть съеден НЕ-presenter соседом: это не смещение
 *   доли перебивок (она уже не блокирует §5.3 по рулингу заказчика), а полная
 *   потеря ведущего из ролика, если так съедены ВСЕ presenter-кадры подряд.
 *   Обратное (не-presenter съедается presenter-соседом) разрешено: ведущий
 *   поглощает перебивку, но сам не исчезает.
 *
 * Геометрическая сломанность `eaten` (нулевая/отрицательная длина) здесь
 * НЕ считается пропуском проверок. Доказуемо (не только по тесту): при
 * вырожденном `eaten` (`b <= a` для интервала `[a,b)`) слияние вперёд даёт
 * `survivor` бывший `[b,c]` → `[a,c]`, фактическая длина `c-a`, а эта функция
 * меряет `max(b,c)-min(a,b) = c-b >= c-a`; слияние назад — симметрично. Оценка
 * ВСЕГДА не меньше фактического результата, занизить её нельзя — значит если
 * `canMergeSafely` отказала, кадр-выживший УЖЕ был бы выше потолка ДО
 * слияния, и принудительный обход этой проверки в {@link mergeShortSegments}
 * не может создать `presenter_too_long`, которого не было бы и так.
 */
function canMergeSafely(eaten: Segment, survivor: Segment, lipSyncMaxDurationSec: number, eps: number): boolean {
  if (eaten.source.foreground === "presenter" && survivor.source.foreground !== "presenter") return false

  if (survivor.source.foreground === "presenter") {
    const mergedStart = Math.min(eaten.startSec, survivor.startSec)
    const mergedEnd = Math.max(eaten.endSec, survivor.endSec)
    if (mergedEnd - mergedStart > lipSyncMaxDurationSec + eps) return false
  }

  return true
}

export interface ShotPlanRepairAction {
  /**
   * Кадр(ы), которых касается правка, в ИСХОДНОЙ (ещё не перенумерованной)
   * нумерации — под этим номером кадр существовал в момент правки. Если
   * правка была слиянием и кадр не пережил его, годного "нового" номера для
   * него не существует в принципе — только у survivor-кадра есть шанс дожить
   * до финальной нумерации, см. {@link ShotPlanRepairAction.finalShotOrder}.
   */
  shotOrder: number | null
  /**
   * Номер этого же кадра в ИТОГОВОМ плане (`ShotPlanRepairResult.plan`),
   * если кадр дожил до конца ремонта; `null`, если кадр был поглощён
   * слиянием и в итоговом плане отдельно не существует (Minor НН-12 ре-ревью
   * раунда 3: раньше `shotOrder` был единственным номером, а после
   * перенумерации он не соответствовал НИЧЕМУ в возвращённом плане).
   * Проставляется один раз, в самом конце {@link repairShotPlan}.
   */
  finalShotOrder: number | null
  message: string
}

/** Слить `eaten` в `survivor` по направлению `forward`/`backward`, записав диагностику. */
function applyMerge(
  list: Segment[],
  index: number,
  direction: "forward" | "backward",
  actions: ShotPlanRepairAction[],
  reason: string,
): void {
  const seg = list[index]!
  const survivorIndex = direction === "forward" ? index + 1 : index - 1
  const survivor = list[survivorIndex]!
  actions.push({
    shotOrder: seg.source.order,
    finalShotOrder: null,
    message: `Кадр ${seg.source.order} (${(seg.endSec - seg.startSec).toFixed(2)}с) слит с ${direction === "forward" ? "следующим" : "предыдущим"} кадром ${survivor.source.order} — ${reason}`,
  })
  if (direction === "forward") {
    list[survivorIndex] = { ...survivor, startSec: seg.startSec }
  } else {
    list[survivorIndex] = { ...survivor, endSec: seg.endSec }
  }
  list.splice(index, 1)
}

function countPresenters(list: readonly Segment[]): number {
  let count = 0
  for (const seg of list) if (seg.source.foreground === "presenter") count += 1
  return count
}

/**
 * Спасает ЕДИНСТВЕННЫЙ оставшийся presenter-сегмент от принудительного
 * устранения (Critical НН-1 ре-ревью раунда 3): забирает у ОДНОГО доступного
 * соседа ровно столько секунд, чтобы `seg` набрал `floorSec`. Пробует вперёд
 * (сосед справа сжимается слева — его `startSec` едет вправо), при неудаче —
 * назад (сосед слева сжимается справа). Метаданные соседа (`idea`,
 * `backgroundClipId` и т.д.) не трогаются, теряется только экранное время.
 *
 * Честная граница гарантии (НН-20 ре-ревью раунда 4 — докстринг раньше
 * подразумевал больше, чем гарантирует код): единственный гард —
 * `boundary` строго между `seg.startSec`/`seg.endSec` соседа с запасом
 * `eps` (полкадра), поэтому сосед НЕ может уйти в ноль или отрицательную
 * длину — но это НЕ то же самое, что абсолютный пол в 3 кадра
 * ({@link absoluteMinShotSec}), который вводит этот же раунд: сосед может
 * остаться ровно в `eps` (1/(2·fps)) и на следующем проходе `mergeShortSegments`
 * сам оказаться ниже пола и быть съеден вынужденным слиянием (его
 * `idea`/`backgroundClipId` тогда исчезнут вместе с ним, честно попав в
 * `changes` тем слиянием). Замер ре-ревью раунда 4 на 20 000 сценариев:
 * спасение срабатывает 498 раз, из них 16 сопровождаются таким последующим
 * слиянием соседа — не дефект (вырожденных кадров на выходе по-прежнему
 * 0 из 20 005), но и не то, что подразумевала прежняя формулировка.
 *
 * Возвращает `false`, если соседу самому нечем поделиться (тогда
 * единственный оставшийся выход — зафиксировать потерю ведущего как меньшее
 * зло по сравнению с оставленной невалидной геометрией) — на прогоне в
 * 20 000 сценариев (не 60 000 — прежняя ссылка была неточной) такой случай
 * не воспроизведён ни разу.
 */
function rescueOnlyPresenter(list: Segment[], index: number, floorSec: number, eps: number): boolean {
  const seg = list[index]!
  const hasNext = index < list.length - 1
  const hasPrev = index > 0
  // Цель — не РОВНО floorSec, а floorSec + eps (нашлось перебором, seed=11555
  // на committed диапазоне): `seg.endSec - floorSec`, посчитанный в IEEE754,
  // не гарантированно даёт длину, которая при следующей проверке `< floorSec`
  // окажется ЛОЖНОЙ — при неудачном округлении разность двух чисел разного
  // порядка может откатиться на пару ULP НИЖЕ floorSec. Без запаса это
  // зацикливало ремонт: спасение считает `seg` спасённым, следующий проход
  // видит ту же самую (по факту не увеличившуюся) длину и спасает снова, до
  // бесконечности — план не менялся, `actions` рос неограниченно (OOM).
  // Запас `eps` (полкадра) на порядки больше любой ошибки округления и не
  // меняет исход по существу: кадр всё равно на волосок над абсолютным полом.
  const target = floorSec + eps

  if (hasNext) {
    const neighbor = list[index + 1]!
    const boundary = seg.startSec + target
    if (boundary < neighbor.endSec - eps) {
      list[index] = { ...seg, endSec: boundary }
      list[index + 1] = { ...neighbor, startSec: boundary }
      return true
    }
  }
  if (hasPrev) {
    const neighbor = list[index - 1]!
    const boundary = seg.endSec - target
    if (boundary > neighbor.startSec + eps) {
      list[index] = { ...seg, startSec: boundary }
      list[index - 1] = { ...neighbor, endSec: boundary }
      return true
    }
  }
  return false
}

/**
 * Слияние коротких и геометрически сломанных кадров.
 *
 * Порядок приоритетов на каждом кадре короче `threshold` (Critical Н-1/НН-1/
 * НН-2 ре-ревью раундов 2 и 3):
 *
 * 1. БЕЗОПАСНОЕ слияние — {@link canMergeSafely} — пробуем со следующим,
 *    нельзя — с предыдущим. Покрывает и просто короткие, и геометрически
 *    сломанные (`length <= 0`) кадры: оценка потолка в `canMergeSafely`
 *    доказуемо консервативна (см. её докстринг), поэтому безопасное слияние
 *    никогда не создаёт `presenter_too_long`, которого не было бы и так.
 * 2. Если оба безопасных направления отклонены, а кадр НИЖЕ АБСОЛЮТНОГО
 *    ПОЛА ({@link absoluteMinShotSec}) — оставить его как есть нельзя ни при
 *    каких мягких правилах (Critical НН-2 ре-ревью раунда 3: 1-кадровый
 *    presenter с оплаченным фоном и ПУСТЫМ `remaining` — это исходный
 *    Critical 1, вернувшийся другим путём). Если это ЕДИНСТВЕННЫЙ
 *    presenter-сегмент — сначала пробуем {@link rescueOnlyPresenter} (Critical
 *    НН-1: защита ведущего важнее мягких правил слияния, но не важнее
 *    геометрии), и только если спасти нечем — сливаем принудительно, куда
 *    можем (вперёд приоритетнее). Принудительное слияние ВЫРОЖДЕННОГО
 *    (`length <= 0`) кадра доказуемо не может создать `presenter_too_long`
 *    (см. докстринг `canMergeSafely`) — но доказательство держится ТОЛЬКО
 *    для этого случая; для кадра ниже пола, но положительной длины, оценка
 *    `canMergeSafely` точна, а не завышена, и принудительный обход МОЖЕТ
 *    создать `presenter_too_long`, которого не было бы иначе (ре-ревью
 *    раунда 3, исправлено НН-18 ре-ревью раунда 4 — этот же докстринг
 *    раньше безоговорочно утверждал обратное, противореча собственному телу
 *    функции). Такое нарушение уйдёт в `remaining` честно и по рулингу
 *    обязано быть — устранение ниже пола приоритетнее потолка lip-sync.
 *    Слияние МОЖЕТ также стереть presenter-идентичность — если сегмент не
 *    единственный presenter, эта потеря не затрагивает инвариант «ведущий
 *    не исчезает из ролика».
 * 3. Кадр короткий, но НЕ ниже абсолютного пола, и оба безопасных слияния
 *    отклонены — остаётся как есть. Хуже нормального кадра, но лучше
 *    неустранимого нарушения и платного повторного запроса (рулинг
 *    заказчика). Такие кадры собираются отдельным проходом ПОСЛЕ стабилизации
 *    списка (не в этом цикле — иначе перезапуск `while` после ДРУГОГО
 *    слияния логировал бы один и тот же кадр повторно) и попадают в
 *    `changes` с явной причиной (Important НН-2/НН-7 ре-ревью раунда 3:
 *    третье плечо рулинга «оставить короткий И СКАЗАТЬ» раньше не было
 *    реализовано вовсе).
 *
 * Фиксированная точка достигается за конечное число шагов: список строго
 * укорачивается на каждом успешном слиянии, а спасение не меняет его длину.
 */
function mergeShortSegments(
  initial: readonly Segment[],
  context: ShotPlanContext,
): { segments: Segment[], actions: ShotPlanRepairAction[] } {
  const list = initial.slice()
  const actions: ShotPlanRepairAction[] = []
  const eps = halfFrameSec(context.fps)
  const threshold = minShotSec(context.profile)
  const floor = absoluteMinShotSec(context.fps)

  let changed = true
  while (changed) {
    changed = false
    for (let index = 0; index < list.length; index += 1) {
      if (list.length === 1) break
      const seg = list[index]!
      const length = seg.endSec - seg.startSec
      // `length <= 0` — ВСЕГДА ниже любого пола, независимо от того, какое
      // число вернул `absoluteMinShotSec` (I6 финального ревью, найдено
      // расширенным перебором: 18 из 120 сценариев, ВСЕ с негодным fps).
      // При негодном fps (0, отрицательный, NaN) пол по НН-19 равен нулю, и
      // сравнение `length < floor` на вырожденном кадре давало `0 < 0` ===
      // false: кадр объявлялся «коротким, но выше пола», оба безопасных
      // слияния его отвергали, и он ОСТАВАЛСЯ в плане нулевой длины — то есть
      // `invalid_bounds` доживал до `remaining` вопреки §5.3, где у ремонта
      // нет права на компромисс по геометрии. Принудительное слияние
      // вырожденного кадра ниже уже описано как доказуемо безопасное (см.
      // докстринг этой функции и `canMergeSafely`) — оно просто было
      // недостижимо на этом входе. При годном fps пол положителен, и
      // `length <= 0` уже влечёт `length < floor`: поведение не меняется ни на
      // одном сценарии прежнего домена.
      const belowFloor = length <= 0 || length < floor
      if (!belowFloor && length >= threshold) continue

      const hasNext = index < list.length - 1
      const hasPrev = index > 0

      if (hasNext && canMergeSafely(seg, list[index + 1]!, context.lipSyncMaxDurationSec, eps)) {
        applyMerge(list, index, "forward", actions, "короче минимума монтажного шага")
        changed = true
        break
      }
      if (hasPrev && canMergeSafely(seg, list[index - 1]!, context.lipSyncMaxDurationSec, eps)) {
        applyMerge(list, index, "backward", actions, "короче минимума монтажного шага")
        changed = true
        break
      }
      if (!belowFloor) continue // короткий, но выше абсолютного пола — залогируем отдельным проходом ниже

      const isOnlyPresenter = seg.source.foreground === "presenter" && countPresenters(list) === 1
      if (isOnlyPresenter && rescueOnlyPresenter(list, index, floor, eps)) {
        actions.push({
          shotOrder: seg.source.order,
          finalShotOrder: null,
          message: `Кадр ${seg.source.order} расширен до ${floor.toFixed(2)}с за счёт соседнего кадра — единственный кадр с ведущим в плане, устранить нельзя`,
        })
        changed = true
        break
      }

      // Принудительное слияние ниже абсолютного пола игнорирует ОБА правила
      // (R1 — личность presenter — и R2 — потолок lip-sync): буквальное
      // чтение рулинга Critical НН-2 («R1/R2 уступают устранению ниже
      // пола») — сливаем вперёд, приоритетнее назад; `presenter_too_long`
      // (если возникнет) уйдёт в `remaining` честно, откуда его подхватит
      // `splitLongPresenterLine` (Task 4).
      //
      // Ре-ревью раунда 3 (НН-16): здесь стоял приоритет направления —
      // сначала пробовать то, что само по себе не нарушает потолок lip-sync
      // (`violatesCap`). Обоснование («seed=1257 и семь других») при
      // независимой проверке не подтвердилось: откат приоритета не менял
      // итоговый план НИ НА ОДНОМ из 20 000 сценариев перебора, а
      // единственный юнит-тест, который должен был его закреплять, проходил
      // и с отключённым механизмом — вакуумно (реальная причина: в его
      // фикстуре `timelineEnd` округляет конец трека 4.03→4.0, и слияние
      // вперёд само по себе укладывается ровно в потолок независимо от
      // приоритета). Мёртвый код с зелёным вакуумным тестом хуже отсутствия
      // кода — убран целиком, а не оставлен «на всякий случай».
      if (hasNext) {
        applyMerge(list, index, "forward", actions, "ниже абсолютного порога длины кадра, безопасного слияния и спасения нет")
        changed = true
        break
      }
      if (hasPrev) {
        applyMerge(list, index, "backward", actions, "ниже абсолютного порога длины кадра, безопасного слияния и спасения нет")
        changed = true
        break
      }
      // Единственный кадр в плане: сливать не с кем. Остаётся вырожденным —
      // это фиксирует invalid_bounds в remaining, что честно и ожидаемо для
      // плана без реального материала (например trackDurationSec <= 0).
    }
  }

  // Кадры короче мягкого порога, но не ниже абсолютного пола, для которых
  // оба безопасных слияния были отклонены, — залогировать здесь, а не в
  // цикле выше: цикл перезапускается после КАЖДОГО успешного слияния, и
  // повторное логирование одного и того же нетронутого кадра при каждом
  // перезапуске задвоило бы записи (Important НН-7 ре-ревью раунда 3).
  for (const seg of list) {
    const length = seg.endSec - seg.startSec
    if (length > 0 && length < threshold) {
      actions.push({
        shotOrder: seg.source.order,
        finalShotOrder: null,
        message: `Кадр ${seg.source.order} (${length.toFixed(2)}с) короче минимума монтажного шага, но безопасное слияние отклонено (потолок lip-sync или защита ведущего) — оставлен как есть`,
      })
    }
  }

  return { segments: list, actions }
}

/**
 * Ближайшая к `desiredSec` безопасная (не рвущая слово) точка внутри окна,
 * которая ДОПОЛНИТЕЛЬНО реально укладывает сегмент в потолок lip-sync —
 * то есть лежит НЕ дальше `desiredSec` в сторону, сокращающую сегмент
 * (`side==="end"`: не позже `desiredSec`; `side==="start"`: не раньше).
 *
 * Без этого фильтра {@link resolveBoundary} мог вернуть ближайшую по
 * абсолютному расстоянию точку, даже если она лежит ПОСЛЕ потолка (то есть
 * сокращает кадр, но потолок всё равно превышен) — притом что более
 * дальняя, но соблюдающая потолок точка была в том же окне. Найдено повторным
 * прогоном перебора на 20 000 сценариев (не входит в 5 именованных сидов
 * ре-ревью раунда 3): presenter-кадр без presenter-соседа, с доступным
 * НЕ-presenter соседом, всё равно получал `presenter_too_long`, потому что
 * ближайшее к желаемой точке безопасное место оказывалось чуть ДАЛЬШЕ потолка,
 * а место чуть БЛИЖЕ (и значит, соблюдающее потолок) отвергалось только из-за
 * того, что было немного дальше по абсолютному расстоянию. Возвращает `null`,
 * если ни одна точка в окне потолок не соблюдает — тогда вызывающий код
 * откатывается на обычный {@link resolveBoundary} (частичное облегчение лучше
 * никакого, как и раньше).
 */
function findCapRespectingPoint(
  words: readonly { startSec: number, endSec: number }[],
  gaps: readonly WordGap[],
  desiredSec: number,
  side: "end" | "start",
  fps: number,
  windowSec: number,
  timelineEnd: number,
  margin: number,
): number | null {
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const gap of gaps) {
    const point = nearestPointInGap(gap, desiredSec, margin)
    if (splitsWord(words, point, fps)) continue
    const respectsCap = side === "end" ? point <= desiredSec : point >= desiredSec
    if (!respectsCap) continue
    const distance = Math.abs(point - desiredSec)
    if (distance <= windowSec && distance < bestDistance) {
      bestDistance = distance
      best = point
    }
  }
  if (best === null) return null
  return snapSecToFrame(Math.min(best, timelineEnd), fps)
}

/**
 * Разгружает presenter-сегмент, выросший за потолок lip-sync, в сторону
 * НЕ-presenter соседа — с какой угодно стороны и в какой угодно позиции
 * плана, не только на краях (Important НН-5 ре-ревью раунда 3: раньше
 * механизм смотрел только на первый/последний сегмент и при первом же
 * попадании желаемой точки внутрь слова сразу сдавался, хотя щель могла
 * быть рядом — замер показал 3751 отказ на 1892 применения, и 61% всех
 * `presenter_too_long`, которые ремонт создаёт сам, чинятся именно этим
 * сдвигом, просто раньше он до них не добирался).
 *
 * Сначала ищет точку, которая потолок РЕАЛЬНО соблюдает ({@link
 * findCapRespectingPoint}); если такой нет в пределах `windowSec` —
 * переиспользует {@link resolveBoundary}, то же ядро поиска безопасной точки,
 * что и основные границы плана (частичное облегчение лучше никакого). Пробует
 * сначала сжать с конца (нужен НЕ-presenter сосед справа), затем с начала
 * (нужен НЕ-presenter сосед слева); если после первого сдвига кадр всё ещё
 * длиннее потолка — второй сдвиг попробует ужать его ещё. Если оба соседа
 * presenter — раздвинуть нечем: конфликт остаётся, честно попадая в
 * `remaining` (не арифметика границ, а `splitLongPresenterLine`, Task 4,
 * §5.3); то же самое, если даже с доступным НЕ-presenter соседом ни одна
 * безопасная точка в окне не лежит ближе потолка, чем расположение слов
 * позволяет физически — редкий, но геометрически честный остаток.
 */
function relieveOversizedPresenters(
  segments: Segment[],
  context: { lipSyncMaxDurationSec: number, fps: number },
  words: readonly { startSec: number, endSec: number }[],
  gaps: readonly WordGap[],
  windowSec: number,
  timelineEnd: number,
  eps: number,
  actions: ShotPlanRepairAction[],
): void {
  for (let index = 0; index < segments.length; index += 1) {
    const trySide = (side: "end" | "start"): boolean => {
      const seg = segments[index]!
      const length = seg.endSec - seg.startSec
      if (seg.source.foreground !== "presenter" || length <= context.lipSyncMaxDurationSec + eps) return false

      const neighborIndex = side === "end" ? index + 1 : index - 1
      if (neighborIndex < 0 || neighborIndex >= segments.length) return false
      const neighbor = segments[neighborIndex]!
      if (neighbor.source.foreground === "presenter") return false

      const desired = side === "end"
        ? seg.startSec + context.lipSyncMaxDurationSec
        : seg.endSec - context.lipSyncMaxDurationSec
      const margin = wordEdgeToleranceSec(context.fps)
      const capped = findCapRespectingPoint(words, gaps, desired, side, context.fps, windowSec, timelineEnd, margin)
      const boundary = capped ?? resolveBoundary(words, gaps, desired, context.fps, windowSec, timelineEnd)
      if (boundary <= seg.startSec + eps || boundary >= seg.endSec - eps) return false

      if (side === "end") {
        segments[index] = { ...seg, endSec: boundary }
        segments[neighborIndex] = { ...neighbor, startSec: boundary }
      } else {
        segments[index] = { ...seg, startSec: boundary }
        segments[neighborIndex] = { ...neighbor, endSec: boundary }
      }
      actions.push({
        shotOrder: seg.source.order,
        finalShotOrder: null,
        message: `Кадр ${seg.source.order}: ${side === "end" ? "конец" : "начало"} сдвинут(о) на ${boundary.toFixed(2)}с — presenter длиннее потолка lip-sync, избыток отдан кадру ${neighbor.source.order}`,
      })
      return true
    }

    // "end" первым: соответствует прежнему поведению для последнего кадра
    // плана (самый частый случай на практике — непокрытый хвост).
    if (trySide("end")) continue
    trySide("start")
  }
}

export interface ShotPlanRepairResult {
  plan: ShotPlan
  /** Нарушения ДО ремонта — что было не так и заставило чинить план. */
  before: ShotPlanViolation[]
  /**
   * Нарушения ИТОГОВОГО плана — включая те, что мог создать сам ремонт
   * (Minor Н-8 ре-ревью: прежняя формулировка «то, что починить не удалось»
   * исключала именно этот случай, а он и оказался реальным — Critical
   * Н-1/Н-2/Н-3). Считается заново, повторным прогоном валидации по факту
   * ремонта. Именно этот список решает, идти ли на повторный запрос к модели
   * (§5.3), а не `before`: `before` содержит и то, что ремонт заведомо не
   * трогает (presenter_too_long, broll_ratio), и молчит о правках, сделанных
   * не по нарушению.
   */
  remaining: ShotPlanViolation[]
  /**
   * Что ремонт реально сделал: какие кадры слиты (с чьими метаданными и
   * почему), какие ссылки на фон сброшены, какое генеративное видео
   * деградировано до картинки (Important Н-6 ре-ревью). Слияние выбрасывает
   * метаданные съеденного кадра — библиотечную перебивку, `idea`, привязку к
   * сцене — без этого списка такая потеря была бы полностью бесшумной,
   * вопреки требованию §10 называть всякую деградацию.
   */
  changes: ShotPlanRepairAction[]
}

export function repairShotPlan(context: ShotPlanContext): ShotPlanRepairResult {
  const before = validateShotPlan(context)
  const { fps, trackDurationSec } = context

  const original: PlannedShot[] = context.plan.shots
    .map(shot => ({ ...shot }))
    .sort((a, b) => a.startSec - b.startSec)

  if (original.length === 0) {
    const emptyPlan: ShotPlan = { shots: [] }
    return { plan: emptyPlan, before, remaining: validateShotPlan({ ...context, plan: emptyPlan }), changes: [] }
  }

  const timelineEnd = timelineEndSec(trackDurationSec, fps)
  const gaps = collectGaps(context, timelineEnd)
  const words = context.alignedScenes.flatMap(scene => scene.words)
  const profileWindowSec = safePointWindowSec(context.profile)
  const eps = halfFrameSec(fps)
  const changes: ShotPlanRepairAction[] = []

  // 1a. "Сырые" границы: конец последнего — конец таймлайна, остальные —
  //     безопасная точка рядом с желаемым концом исходного кадра. Клэмп
  //     желаемой точки — `timelineEnd`, а НЕ сырая `trackDurationSec`
  //     (Critical Н-2 ре-ревью): клэмп сырой длительностью пропускал точки
  //     ВЫШЕ фактического конца таймлайна дальше в `snapSecToFrame`, а то
  //     округление к ближайшему, а не к нижнему кадру — на планах с кадром
  //     за концом трека вырожденный (нулевой/отрицательный) кадр выходил в
  //     100% случаев. Нефинитную исходную границу (кадр от модели с
  //     NaN/`undefined`, Critical 3 ревью) заменяем на начало кадра, а если и
  //     оно нечисловое — на 0.
  //
  //     Окно поиска щели дополнительно ограничено долей ЛОКАЛЬНОЙ длины
  //     кадра (`localSpan`), а не только долей `profile.shotChangeSec`
  //     (Critical НН-1/НН-2 ре-ревью раунда 3): окно от целевого шага
  //     монтажа могло быть шире самого кадра, который оно режет, и утаскивало
  //     границу почти на всю его длину — вплоть до `timelineEnd`, схлопывая
  //     кадр в вырожденный (seed=11555, seed=432 ре-ревью).
  const boundaries: number[] = new Array(original.length + 1)
  boundaries[0] = 0
  boundaries[original.length] = timelineEnd
  for (let index = 1; index < original.length; index += 1) {
    const shot = original[index - 1]!
    const originalEnd = Number.isFinite(shot.endSec) ? shot.endSec : shot.startSec
    const safeOriginalEnd = Number.isFinite(originalEnd) ? originalEnd : 0
    const desiredEnd = Math.min(safeOriginalEnd, timelineEnd)
    const localSpan = Math.max(0, desiredEnd - boundaries[index - 1]!)
    const windowSec = Math.min(profileWindowSec, localSpan * LOCAL_SPAN_WINDOW_RATIO)
    const resolved = resolveBoundary(words, gaps, desiredEnd, fps, windowSec, timelineEnd)
    boundaries[index] = resolved

    // §10 требует называть всякую деградацию — сдвиг границы ради безопасности
    // слова является главной операцией §5.3, и раньше он не попадал в
    // `changes` вовсе (Important НН-7 ре-ревью раунда 3).
    const naive = snapSecToFrame(desiredEnd, fps)
    if (splitsWord(words, resolved, fps)) {
      // Important НН-6 ре-ревью раунда 4: `resolveBoundary` не нашла
      // безопасной точки — это нормальный исход (не всегда есть куда
      // сдвигать), но он обязан быть НАЗВАН, а не слит с обычным «сдвинута
      // к щели» сообщением ниже, которое подразумевает успех.
      changes.push({
        shotOrder: shot.order,
        finalShotOrder: null,
        message: `Кадр ${shot.order}: резать по слову нельзя, безопасной точки в пределах окна не нашлось — граница оставлена в ${resolved.toFixed(2)}с`,
      })
    } else if (Math.abs(resolved - naive) > eps) {
      changes.push({
        shotOrder: shot.order,
        finalShotOrder: null,
        message: `Кадр ${shot.order}: граница сдвинута с ${naive.toFixed(2)}с на ${resolved.toFixed(2)}с — резать по слову нельзя, взята ближайшая межсловная щель`,
      })
    }
  }

  const initialSegments: Segment[] = original.map((shot, index) => ({
    startSec: boundaries[index]!,
    endSec: boundaries[index + 1]!,
    source: shot,
  }))

  // 1a-bis. Первый и последний кадр по построению обязаны начинаться в 0 и
  //     заканчиваться в timelineEnd — иначе дыра по краям трека (Critical
  //     2/3). Побочный эффект: presenter-кадр модели с большой непокрытой
  //     дырой перед/после себя молча наследует её целиком и может выйти за
  //     потолок lip-sync ДО того, как до него дойдёт слияние коротких кадров
  //     (там он к этому моменту уже длинный, а не короткий) — разгружаем в
  //     сторону НЕ-presenter соседа, если он есть, и не только на краях
  //     (Important НН-5) — см. докстринг {@link relieveOversizedPresenters}.
  relieveOversizedPresenters(initialSegments, context, words, gaps, profileWindowSec, timelineEnd, eps, changes)

  // 1b. Слияние кадров короче минимума монтажного шага (Critical 1 ревью,
  //     переработано в Critical Н-1/НН-1/НН-2 ре-ревью раундов 2-3): хвост
  //     участвует наравне с остальными, слияние не создаёт presenter_too_long,
  //     не съедает ВСЕ presenter-кадры, а короче абсолютного пола кадр не
  //     остаётся в плане молча — см. докстринги {@link canMergeSafely} и
  //     {@link mergeShortSegments}.
  const { segments, actions } = mergeShortSegments(initialSegments, context)
  changes.push(...actions)

  // 1c. Слияние могло само подвинуть presenter-кадр на край (например,
  //     поглотив вырожденного НЕ-presenter соседа у самого края таймлайна) —
  //     разгрузку нужно попробовать ЕЩЁ РАЗ по итоговым краям, иначе повторный
  //     прогон ремонта над СВОИМ ЖЕ результатом находил бы разгрузку там, где
  //     первый проход её не видел (найдено тестом-свойством: нарушалась
  //     неподвижная точка).
  relieveOversizedPresenters(segments, context, words, gaps, profileWindowSec, timelineEnd, eps, changes)

  const materialized: PlannedShot[] = segments.map(seg => ({
    ...seg.source,
    startSec: seg.startSec,
    endSec: seg.endSec,
  }))

  // 2. Источники, которые нельзя оставить: несуществующий фон (библиотека БЕЗ
  //    известного клипа или app_screen без ссылки — Minor 5 ревью) и
  //    генеративное видео, которое либо короче минимума, либо запрещено
  //    флагом профиля (Minor 6 ревью; было — только длина). Порог короткого
  //    видео здесь тот же допуск округления, что в validate.ts (Minor 3
  //    ревью: раньше `repair` сравнивал без эпсилона вовсе).
  //
  //    Не чинятся здесь `presenter_too_long` (это дробление длинной реплики,
  //    отдельный детерминированный шаг `splitLongPresenterLine` из Task 4,
  //    §5.3 — раннер Task 5 вызывает его до этой функции) и `broll_ratio`
  //    (доля перебивок — вопрос СМЫСЛА подбора кадров, а не арифметики границ;
  //    Minor 9 ревью).
  for (const shot of materialized) {
    const missingLibraryRef = shot.background === "library"
      && (!shot.backgroundClipId || !context.knownBackgroundIds.has(shot.backgroundClipId))
    // Ре-ревью задачи, Critical 2: раньше проверялось только "поле не
    // пустое" — галлюцинированный id проходил репэйр невредимым и валил
    // `createMany` по FK ПОСЛЕ того, как вызов модели уже оплачен.
    // Симметрично `missingLibraryRef`.
    const missingAppScreenRef = shot.background === "app_screen"
      && (!shot.appReferenceId || !context.knownAppScreenIds.has(shot.appReferenceId))

    if (missingLibraryRef || missingAppScreenRef) {
      const previous = shot.background
      shot.background = shot.foreground === "presenter" ? "none" : "image"
      shot.backgroundClipId = null
      shot.appReferenceId = null
      changes.push({
        shotOrder: shot.order,
        finalShotOrder: null,
        message: `Кадр ${shot.order}: фон "${previous}" сброшен в "${shot.background}" — ссылка не существует`,
      })
    }
    if (shot.background === "video") {
      const tooShort = shot.endSec - shot.startSec < context.minGenerativeVideoSec - eps
      // Task 5, требование 8: парный к generative_video_too_long даунгрейд —
      // слияние коротких кадров (шаг 1b выше) может СОЗДАТЬ кадр длиннее
      // потолка одного клипа так же, как оно уже создаёт presenter_too_long
      // (relieveOversizedPresenters). Без этой ветки repair сообщил бы
      // невалидный remaining, хотя мог починить его сам.
      const tooLong = shot.endSec - shot.startSec > context.maxGenerativeVideoSec + eps
      const disabled = !context.profile.generativeVideoEnabled
      if (tooShort || tooLong || disabled) {
        shot.background = "image"
        changes.push({
          shotOrder: shot.order,
          finalShotOrder: null,
          message: `Кадр ${shot.order}: генеративное видео заменено картинкой (${
            tooShort ? "короче минимума длительности" : tooLong ? "длиннее одного клипа" : "флаг профиля выключен"
          })`,
        })
      }
    }
  }

  // 3. Нумерация подряд с нуля: order — ключ (videoId, order) в БД и позиция в
  //    склейке; дырки в нём означают потерянный кадр. `changes` собирался в
  //    ИСХОДНОЙ нумерации по ходу ремонта (кадр, съеденный слиянием, не имеет
  //    "нового" номера в принципе) — здесь достраивается `finalShotOrder` для
  //    записей, чей кадр дожил до итогового плана (Minor НН-12 ре-ревью
  //    раунда 3: раньше `shotOrder` не соответствовал НИЧЕМУ в возвращённом
  //    плане после перенумерации, и это документировалось, но не решалось).
  const finalOrderByOriginal = new Map<number, number>()
  materialized.forEach((shot, index) => finalOrderByOriginal.set(shot.order, index))
  materialized.forEach((shot, index) => { shot.order = index })
  for (const action of changes) {
    if (action.shotOrder !== null) action.finalShotOrder = finalOrderByOriginal.get(action.shotOrder) ?? null
  }

  const plan: ShotPlan = { shots: materialized }
  const remaining = validateShotPlan({ ...context, plan })
  return { plan, before, remaining, changes }
}
