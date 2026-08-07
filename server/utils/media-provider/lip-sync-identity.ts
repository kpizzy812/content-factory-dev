/**
 * Идентичность lip-sync задачи: что считать «той же самой» попыткой, а что —
 * общей сущностью, на которую выделен бюджет повторов.
 *
 * Ключ идемпотентности обязан включать отпечатки исходников: без них после
 * переозвучки сцены мы переиспользовали бы чужой готовый результат.
 *
 * Областей подсчёта бюджета две, и обе нужны.
 *
 * 1. УЗКАЯ (`attemptScope`) — ролик + сцена + модель + отпечатки видео и аудио,
 *    то есть ровно тот же набор, что и в ключе. Именно она отвечает за смысл
 *    потолка «не зацикливаться на негодном исходнике»: пять неудач на ОДНИХ И
 *    ТЕХ ЖЕ байтах — и хватит. Держать бюджет без отпечатков нельзя: типовое
 *    «no face detected» на сгенерированном клипе без лица лечится
 *    перегенерацией клипа, после которой исходник ДРУГОЙ, а бюджет по сцене
 *    оставался сожжённым — сцена запиралась навсегда.
 *
 * 2. ШИРОКАЯ (`attemptCeilingScope`) — ролик + сцена + модель, без отпечатков.
 *    Без неё узкая область не связывала бы ничего: на перезапуске шага TTS
 *    синтезируется заново, байты mp3 другие, sha другой, ключ и область другие,
 *    и двадцать перезапусков = двадцать оплаченных prediction'ов. Широкая
 *    область — строгий префикс узкой, по ней считается общий потолок.
 */

export interface LipSyncIdentity {
  /**
   * Узкая область бюджета: конкретный набор исходников. Совпадает с базовым
   * ключом цепочки попыток — ретраи живут под ним через `#retry-N`.
   */
  attemptScope: string
  /** Широкая область: ролик + сцена + модель. Строгий префикс attemptScope. */
  attemptCeilingScope: string
  /** Полный ключ идемпотентности — с отпечатками исходников. */
  idempotencyKey: string
}

export interface LipSyncIdentityInput {
  videoId: number
  sceneOrder: number
  modelId: string
  sourceFingerprint: string
  audioFingerprint: string
}

export function buildLipSyncIdentity(input: LipSyncIdentityInput): LipSyncIdentity {
  // Пустой отпечаток склеил бы разные исходники в один ключ — и мы отдали бы
  // чужой готовый ролик вместо новой генерации.
  if (!input.sourceFingerprint.trim() || !input.audioFingerprint.trim()) {
    throw new Error("Отпечатки исходников lip-sync не могут быть пустыми")
  }
  if (!input.modelId.trim()) {
    throw new Error("Идентификатор модели lip-sync не может быть пустым")
  }

  const attemptCeilingScope = [
    "lip-sync",
    "v1",
    "video",
    input.videoId,
    "scene",
    input.sceneOrder,
    "model",
    input.modelId,
  ].join(":")

  // Раскладка ключа не менялась: узкая область — это и есть прежний ключ
  // целиком. Поэтому уже созданные записи MediaPrediction остаются «своими»,
  // идемпотентность повтора с теми же исходниками сохраняется, а миграция
  // данных не нужна.
  const idempotencyKey = [
    attemptCeilingScope,
    "source",
    input.sourceFingerprint,
    "audio",
    input.audioFingerprint,
  ].join(":")

  return { attemptScope: idempotencyKey, attemptCeilingScope, idempotencyKey }
}
