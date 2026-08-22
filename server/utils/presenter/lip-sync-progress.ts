/**
 * Прогресс шага lip-sync: пофайловые записи по сценам и их слияние между попытками.
 *
 * Зачем отдельный модуль: механизм «resume без повторной оплаты» держится ровно на
 * этих записях, а раньше они уезжали в outputSnapshot одним куском в самом конце
 * шага. Обрыв в середине (упавшая заливка, перезапуск воркера) оставлял снапшот
 * пустым, и следующий прогон заново платил за TTS и Replicate по уже готовым сценам.
 * Теперь runner персистит прогресс после каждой доехавшей сцены, а слияние со
 * старыми записями живёт здесь — чистой функцией, чтобы её можно было проверить
 * DB-free тестом.
 */

// Импорт ТИПА, а не значения — стирается компилятором. Нужен только для поля
// LipSyncSceneRecord.outputPath ниже (Task 6, ре-ревью 1, Important 2): без
// него бренд LipSyncedClipPath терялся сразу за пределами lip-sync-runner.ts,
// и потребителю (Task 8) пришлось бы восстанавливать его слепым `as`, ровно
// той операцией, от которой бренд должен защищать.
import type { LipSyncedClipPath } from "../video-tools/pip-compose"

/**
 * Почему сцену с репликой синхронизировать НЕ удалось.
 *
 * Раньше такие сцены просто не попадали в снапшот, и «покрыты все сцены» не
 * выполнялось никогда: шаг переставал кэшироваться навсегда и каждый повторный
 * прогон заново гонял TTS и probe по остальным сценам. Запись-отказ отличает
 * «сцену ещё не обрабатывали» от «сцену обработать нельзя».
 */
export type LipSyncSkipReason =
  /** Исходного клипа нет ни в clipPaths, ни в снапшоте, ни в БД. */
  | "no_clip"
  /** Индекс клипа сцены за границей списка путей (рассинхрон снапшотов шагов). */
  | "clip_index_out_of_range"
  /**
   * Файла исходника нет на диске: измерять нечего, и это свойство материала.
   * Появится файл — сменится отпечаток (sourceSignature), и отказ снимется сам.
   */
  | "source_missing"
  /**
   * Файл на месте, но замер длительности не удался (ffprobe недоступен, spawn
   * EAGAIN/EMFILE под нагрузкой, файл занят антивирусом, битые метаданные).
   * Это состояние СРЕДЫ, а не материала — см. DETERMINISTIC_SKIP_REASONS.
   */
  | "source_unmeasurable"
  /** Реальная длительность источника вне диапазона lip-sync модели. */
  | "duration_out_of_range"
  /** Синтез реплики упал у провайдера. */
  | "tts_failed"
  /**
   * Маршрут «монтаж от звука»: в выравнивании нет границ этой сцены в общем
   * треке — вырезать нечего. Свойство данных, а не среды: пока выравнивание то
   * же, ответ будет тот же, а появится сцена — сменится ключ (в него входит
   * отпечаток куска), и отказ перестанет её закрывать.
   */
  | "track_segment_missing"
  /** Границы сцены в треке есть, но интервал нулевой: вырезать нечего. */
  | "track_segment_empty"
  /**
   * Не удалось вырезать кусок общего трека под сцену (маршрут «монтаж от звука»).
   * Причина среды — упавший ffmpeg, занятый файл: сцена обязана получить вторую
   * попытку, а не остаться без lip-sync навсегда.
   */
  | "track_segment_failed"
  /** Сам вызов lip-sync упал у провайдера. */
  | "lip_sync_failed"

/**
 * Отказы, которые при ТОМ ЖЕ отпечатке исходника повторятся один в один.
 *
 * Только они закрывают сцену для ранней идемпотентности: их причина — свойство
 * самого материала (нет клипа, длительность вне диапазона модели), и повторный
 * прогон с тем же reuseKey ничего не изменит, а перегенерация клипа сменит
 * отпечаток и запись-отказ перестанет подходить сама собой.
 *
 * Отказы среды сюда НЕ входят намеренно: упавшая сеть, пятисотка у Replicate или
 * не запустившийся ffprobe — состояние минуты, а не материала. Считать их
 * «покрытием» значило бы навсегда заморозить сцену несинхронизированной, причём
 * молча: повторный прогон отдавал бы кэш вместо честной второй попытки.
 * Записываем их ради диагностики, но кэш они не открывают.
 *
 * Разбор по причинам — что материал, а что среда:
 *   no_clip                 материал: клипа сцены не существует ни в одном источнике.
 *                           Отпечатка у такой записи нет, и как только клип появится,
 *                           сцена попадёт в проверку отпечатков и переработается.
 *   clip_index_out_of_range материал: индекс сцены за границей нарезки. Пропадёт
 *                           вместе с рассинхроном снапшотов, а не сам по себе.
 *   source_missing          материал: файла на диске нет. Повторный прогон с тем же
 *                           отпечатком (sourceSignature=null) даст ровно тот же ответ,
 *                           а появление файла отпечаток сменит.
 *   duration_out_of_range   материал: измеренная длина вне диапазона модели.
 *   source_unmeasurable     СРЕДА: файл есть, а замер не состоялся. Ровно тот случай,
 *                           ради которого причина и отделена от source_missing —
 *                           один spawn EAGAIN или заблокированный антивирусом mp4
 *                           иначе навсегда лишал сцену lip-sync, причём молча.
 *   tts_failed              СРЕДА: провайдер синтеза.
 *   track_segment_missing   материал: выравнивание не знает границ этой сцены. Ключ
 *                           сцены на этом маршруте включает отпечаток куска, поэтому
 *                           появившееся выравнивание снимает отказ само.
 *   track_segment_empty     материал: интервал сцены в треке нулевой.
 *   track_segment_failed    СРЕДА: ffmpeg не вырезал кусок трека (файл занят, процесс
 *                           не запустился). Сам трек при этом на месте.
 *   lip_sync_failed         СРЕДА: провайдер lip-sync.
 */
const DETERMINISTIC_SKIP_REASONS: ReadonlySet<LipSyncSkipReason> = new Set<LipSyncSkipReason>([
  "no_clip",
  "clip_index_out_of_range",
  "source_missing",
  "duration_out_of_range",
  "track_segment_missing",
  "track_segment_empty",
])

/**
 * source_unmeasurable остаётся в словаре ради снапшотов, записанных до разделения
 * причины: такая запись читается и логируется, но кэш больше не открывает —
 * сцена получит честную повторную попытку.
 */
const KNOWN_SKIP_REASONS: ReadonlySet<string> = new Set<LipSyncSkipReason>([
  "no_clip",
  "clip_index_out_of_range",
  "source_missing",
  "source_unmeasurable",
  "duration_out_of_range",
  "tts_failed",
  "track_segment_missing",
  "track_segment_empty",
  "track_segment_failed",
  "lip_sync_failed",
])

/** Причина отказа из снапшота — только из известного словаря, иначе запись мусорная. */
export function isKnownSkipReason(value: unknown): value is LipSyncSkipReason {
  return typeof value === "string" && KNOWN_SKIP_REASONS.has(value)
}

/** Результат по одной сцене — кладём в outputSnapshot ради переиспользования при рестарте. */
export interface LipSyncSceneRecord {
  /** order сцены из storyPlan (1-based) — только для логов и трассировки. */
  sceneOrder: number
  /** Индекс клипа этой сцены в clipPaths (он же order у VideoAsset(type=clip)). */
  sceneIndex: number
  /** Исходный (не синхронизированный) клип этой сцены. */
  sourcePath: string
  /**
   * Готовый lip-synced файл. null — запись-отказ (см. skipped).
   *
   * Типизирован брендом `LipSyncedClipPath` (Task 6, ре-ревью 1, Important 2),
   * а не сырой строкой: единственный писатель — `lip-sync-runner.ts`, и он
   * всегда кладёт сюда либо `markLipSynced(renderedPath)`, либо `null`. Так
   * потребитель шага 8 (сборка PiP), читая запись с непустым `outputPath`,
   * получает готовый `LipSyncedClipPath` напрямую — без слепого `as`, который
   * обнулил бы саму гарантию бренда на границе шага.
   */
  outputPath: LipSyncedClipPath | null
  /** Файл TTS реплики — переиспользуется, если текст не менялся. */
  audioPath: string | null
  /** Хэш spokenLine: сменился текст — старые аудио и видео негодны. */
  spokenLineHash: string | null
  /**
   * Ключ переиспользования (buildLipSyncReuseKey): текст + идентичность исходника +
   * персонаж и параметры синтеза. null — запись старого формата: её нельзя
   * переиспользовать, потому что неизвестно, из чего она собрана.
   *
   * У записи-отказа тот же смысл: причина отказа действительна ровно для этого
   * отпечатка исходника, и перегенерация клипа обязана дать сцене новый шанс.
   */
  reuseKey: string | null
  /** Реальная (измеренная) длительность источника, по ней же считалась стоимость. */
  durationSec: number
  /**
   * Причина, по которой сцена НЕ синхронизирована. Отсутствует/null у обычной
   * записи. Синхронизированной такая сцена не считается — только «обработанной».
   */
  skipped?: LipSyncSkipReason | null
}

/** Запись-отказ: файла нет, есть причина. */
export function isSkippedSceneRecord(record: LipSyncSceneRecord): boolean {
  return !!record.skipped
}

/**
 * Закрывает ли запись сцену для ранней идемпотентности.
 * Обычная запись — да; запись-отказ — только с детерминированной причиной.
 */
export function isSceneRecordCovering(record: LipSyncSceneRecord): boolean {
  if (!record.skipped) return true
  return DETERMINISTIC_SKIP_REASONS.has(record.skipped)
}

/** Достаёт пофайловые результаты прошлого прогона из outputSnapshot шага. */
export function readPreviousSceneRecords(snapshot: unknown): Map<number, LipSyncSceneRecord> {
  const map = new Map<number, LipSyncSceneRecord>()
  if (!snapshot || typeof snapshot !== "object") return map
  const scenes = (snapshot as { scenes?: unknown }).scenes
  if (!Array.isArray(scenes)) return map

  for (const raw of scenes) {
    if (!raw || typeof raw !== "object") continue
    const record = raw as Partial<LipSyncSceneRecord>
    if (typeof record.sceneIndex !== "number") continue
    // Снапшот из БД — это JSON: бренд физически не переживает сериализацию,
    // и здесь мы его восстанавливаем, доверяя тому, что записал единственный
    // писатель (lip-sync-runner.ts::markLipSynced). Это не «минтит» новый
    // LipSyncedClipPath из произвольной строки — это десериализация уже
    // однажды помеченного значения, ровно как previous.reuseKey/durationSec
    // ниже доверяют форме прошлой записи этого же раннера.
    const outputPath = typeof record.outputPath === "string"
      ? record.outputPath as LipSyncedClipPath
      : null
    const skipped = isKnownSkipReason(record.skipped) ? record.skipped : null
    // Годятся два вида записей: готовый файл либо явный отказ с известной причиной.
    // Всё остальное — мусор, из которого нельзя понять, обработана сцена или нет.
    if (!outputPath && !skipped) continue
    map.set(record.sceneIndex, {
      sceneOrder: typeof record.sceneOrder === "number" ? record.sceneOrder : record.sceneIndex + 1,
      sceneIndex: record.sceneIndex,
      sourcePath: typeof record.sourcePath === "string" ? record.sourcePath : "",
      outputPath,
      skipped,
      audioPath: typeof record.audioPath === "string" ? record.audioPath : null,
      spokenLineHash: typeof record.spokenLineHash === "string" ? record.spokenLineHash : null,
      // Обратная совместимость: снапшот прошлых версий поля не знает. null здесь —
      // не ошибка, а честное «переиспользовать нельзя, происхождение неизвестно».
      reuseKey: typeof record.reuseKey === "string" ? record.reuseKey : null,
      durationSec: typeof record.durationSec === "number" ? record.durationSec : 0,
    })
  }
  return map
}

/**
 * Склеивает записи прошлых попыток с записями текущей.
 *
 * Записи прошлого прогона обязаны пережить текущий: если этот заход дошёл только до
 * сцены 2, а в снапшоте лежали готовые сцены 3-4, запись «только своих» стёрла бы их
 * и следующий прогон оплатил бы сцены 3-4 заново. Свежая запись по тому же
 * sceneIndex всегда побеждает — она отражает актуальный текст реплики.
 */
export function mergeSceneRecords(
  previous: ReadonlyMap<number, LipSyncSceneRecord>,
  fresh: readonly LipSyncSceneRecord[],
): LipSyncSceneRecord[] {
  const merged = new Map(previous)
  for (const record of fresh) merged.set(record.sceneIndex, record)
  return [...merged.values()].sort((a, b) => a.sceneIndex - b.sceneIndex)
}

/**
 * Все ли целевые сцены уже обработаны (синхронизированы либо честно отклонены).
 *
 * Ранняя ветка идемпотентности имеет право вернуть кэш только когда закрыты ВСЕ
 * сцены с репликой. Иначе шаг со статусом completed, но с половиной сцен, навсегда
 * оставался бы недоделанным.
 *
 * «Закрыта» — это либо готовый файл, либо запись-отказ с детерминированной причиной
 * (см. isSceneRecordCovering). Без второго варианта сцена, которую синхронизировать
 * физически нельзя (нет клипа, длительность вне диапазона модели), навсегда лишала
 * шаг кэша: каждый прогон заново прогонял TTS и probe по остальным сценам.
 *
 * undefined в списке — сцена, которой не нашлось клипа в порядке нарезки. Записи в
 * снапшоте у неё быть не может (ключ записи — индекс клипа, а его нет), и хранить
 * такое состояние не нужно: оно пересчитывается из clipSceneOrders на каждом прогоне
 * и само исчезает, как только порядок нарезки становится известен.
 */
export function areAllScenesCovered(
  sceneIndexes: readonly (number | undefined)[],
  records: ReadonlyMap<number, LipSyncSceneRecord>,
): boolean {
  const mapped = sceneIndexes.filter((index): index is number => typeof index === "number")
  if (mapped.length === 0) return false
  return mapped.every(index => {
    const record = records.get(index)
    return !!record && isSceneRecordCovering(record)
  })
}

/**
 * Совпадают ли отпечатки всех целевых сцен с текущими условиями прогона.
 *
 * Наличия записи мало: completed-шаг отдаёт кэш целиком, и после смены персонажа,
 * голоса или перегенерации клипов этот кэш — ссылки на устаревшие файлы. Запись
 * старого формата (reuseKey=null) считается непригодной: шаг переработает сцену,
 * а не отдаст неизвестно из чего собранный результат.
 *
 * Записи-отказы проверяются здесь наравне с готовыми: их причина привязана к тому же
 * отпечатку исходника, поэтому перегенерация клипа (сменился размер/mtime) снимает
 * отказ автоматически. Отказы без исходника вообще (no_clip) в expectedKeyByIndex не
 * попадают — ключ для них не из чего построить.
 */
export function areAllScenesReusable(
  expectedKeyByIndex: ReadonlyMap<number, string>,
  records: ReadonlyMap<number, LipSyncSceneRecord>,
): boolean {
  if (expectedKeyByIndex.size === 0) return false
  for (const [sceneIndex, expectedKey] of expectedKeyByIndex) {
    const record = records.get(sceneIndex)
    if (!record?.reuseKey || record.reuseKey !== expectedKey) return false
  }
  return true
}
