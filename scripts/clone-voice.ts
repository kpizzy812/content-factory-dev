/**
 * Клонирование голоса ведущей через `minimax/voice-cloning`.
 *
 *   bun run scripts/clone-voice.ts <аудио> [--yes] [--model=speech-02-turbo]
 *                                  [--noise-reduction] [--normalize]
 *
 * Разовая административная операция, а не шаг конвейера: голос клонируется один
 * раз на ведущую, дальше полученный `voice_id` живёт в `Video.voiceoverVoiceId`
 * и уходит в обычную спеку `replicate:minimax-speech-02-turbo` без единой правки
 * кода — она и так прокидывает произвольный `voice_id` в payload.
 *
 * **Стоит $3 за успешный прогон** (тариф со страницы модели, `generic_output_count`).
 * Поэтому без `--yes` скрипт только показывает, что собирается сделать.
 *
 * Требования модели к файлу (из снятой схемы): MP3, M4A или WAV, от 10 секунд
 * до 5 минут, меньше 20 МБ.
 */
import { readFile, stat } from "node:fs/promises"
import { basename } from "node:path"
import Replicate from "replicate"

const MODEL = "minimax/voice-cloning"
const PRICE_USD = 3
const MIN_SEC = 10
const MAX_SEC = 5 * 60
const MAX_BYTES = 20 * 1024 * 1024
const ALLOWED_EXT = [".mp3", ".m4a", ".wav"]

const args = process.argv.slice(2)
const audioPath = args.find(arg => !arg.startsWith("--"))
if (!audioPath) {
  console.error("Usage: bun run scripts/clone-voice.ts <audio> [--yes] [--model=speech-02-turbo] [--noise-reduction] [--normalize]")
  process.exit(1)
}

const token = process.env.REPLICATE_API_TOKEN?.trim()
if (!token) {
  console.error("REPLICATE_API_TOKEN не задан — клонировать нечем")
  process.exit(1)
}

const targetModel = args.find(a => a.startsWith("--model="))?.split("=")[1] ?? "speech-02-turbo"
const confirmed = args.includes("--yes")

// Проверки ДО оплаты: модель отвергнет файл не того формата или длины уже
// после того, как задача создана, и это будут потраченные деньги.
const ext = audioPath.slice(audioPath.lastIndexOf(".")).toLowerCase()
if (!ALLOWED_EXT.includes(ext)) {
  console.error(`Формат ${ext} модель не принимает. Допустимые: ${ALLOWED_EXT.join(", ")}`)
  process.exit(1)
}
const info = await stat(audioPath)
if (info.size > MAX_BYTES) {
  console.error(`Файл ${(info.size / 1048576).toFixed(1)} МБ, предел модели 20 МБ`)
  process.exit(1)
}

const duration = await new Promise<number>((resolve, reject) => {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", audioPath], { stdout: "pipe" })
  new Response(proc.stdout).text().then(t => resolve(Number.parseFloat(t.trim()))).catch(reject)
})
if (!Number.isFinite(duration) || duration < MIN_SEC || duration > MAX_SEC) {
  console.error(`Длительность ${duration}s вне диапазона модели ${MIN_SEC}-${MAX_SEC}s`)
  process.exit(1)
}

console.log(`файл:        ${audioPath}`)
console.log(`длительность:${duration.toFixed(1)}s, ${(info.size / 1048576).toFixed(2)} МБ`)
console.log(`модель:      ${MODEL} → обучает голос для ${targetModel}`)
console.log(`цена:        $${PRICE_USD} за успешный прогон`)

if (!confirmed) {
  console.log("\nПрогон не запущен. Добавь --yes, чтобы потратить $3.")
  process.exit(0)
}

const replicate = new Replicate({ auth: token })

/**
 * Готовый публичный URL вместо заливки в Replicate.
 *
 * Files API отдаёт ссылку вида `/v1/files/{id}` — БЕЗ расширения, а MiniMax
 * определяет формат именно по нему и отвечает «invalid file ext for voice
 * clone». Проверено: заливка проходит, задача падает. Поэтому для этой модели
 * нужен адрес, оканчивающийся на .mp3/.m4a/.wav.
 */
const directUrl = args.find(a => a.startsWith("--url="))?.slice("--url=".length)

let file: { id: string, urls: { get: string } } | null = null
let voiceUrl: string
if (directUrl) {
  voiceUrl = directUrl
  console.log(`\nисточник: ${directUrl}`)
}
else {
  console.log("\nзаливаю файл…")
  const contents = await readFile(audioPath)
  file = await replicate.files.create(
    new File([new Uint8Array(contents)], basename(audioPath), {
      type: ext === ".wav" ? "audio/wav" : "audio/mpeg",
    }),
  ) as unknown as { id: string, urls: { get: string } }
  voiceUrl = file.urls.get
  console.log(`залит: ${file.id}`)
}

console.log("обучаю голос (несколько минут)…")
const output = await replicate.run(MODEL as `${string}/${string}`, {
  input: {
    voice_file: voiceUrl,
    model: targetModel,
    ...(args.includes("--noise-reduction") ? { need_noise_reduction: true } : {}),
    ...(args.includes("--normalize") ? { need_volume_normalization: true } : {}),
  },
}) as unknown as { voice_id?: string, preview?: string, model?: string }

console.log("\n─── готово ───")
console.log(`voice_id: ${output?.voice_id ?? "(нет в ответе)"}`)
console.log(`preview:  ${output?.preview ?? "(нет)"}`)
console.log(`модель:   ${output?.model ?? "(нет)"}`)
console.log("\nПоложить в Video.voiceoverVoiceId при генерации ролика.")

if (file) {
  await replicate.files.delete(file.id).catch(() => {
    console.warn("исходник на Replicate удалить не удалось — удали вручную")
  })
}
