/**
 * Проба Fish Audio: клон голоса ведущей и синтез реплики.
 *
 *   FISH_API_KEY=... bun run scripts/fish-voice-probe.ts <аудио> "<текст>" [--model=s2.1-pro]
 *
 * Зачем отдельно от медиаконтура: сначала надо услышать, стоит ли Fish той
 * работы, которой стоит новый провайдер. Контур знает два способа исполнения,
 * и синхронный захардкожен на fal (`runSyncQueueTask` → `falRequest`), а Fish
 * отдаёт сырые байты вместо ссылки — это отдельная волна, а не вставка.
 *
 * Схема снята с `https://api.fish.audio/openapi.json`:
 *   POST /model   multipart, обязательные type, title, train_mode, voices
 *   POST /v1/tts  json, обязательный text; модель выбирается ЗАГОЛОВКОМ `model`
 *
 * Голос создаётся `private`. Значение по умолчанию у них `public` — то есть
 * голос реального человека попал бы в публичный каталог Fish Audio.
 */
import { readFile, writeFile } from "node:fs/promises"
import { basename } from "node:path"

const BASE = "https://api.fish.audio"

const args = process.argv.slice(2)
const audioPath = args[0]
const text = args[1]
if (!audioPath || !text) {
  console.error('Usage: FISH_API_KEY=... bun run scripts/fish-voice-probe.ts <audio> "<text>" [--model=s2.1-pro]')
  process.exit(1)
}

const key = process.env.FISH_API_KEY?.trim()
if (!key) {
  console.error("FISH_API_KEY не задан")
  process.exit(1)
}
const ttsModel = args.find(a => a.startsWith("--model="))?.split("=")[1] ?? "s2.1-pro"
const auth = { Authorization: `Bearer ${key}` }

console.log(`сэмпл: ${audioPath}`)
console.log(`текст: ${text.length} символов`)
console.log(`модель TTS: ${ttsModel}`)

// ─── клон ────────────────────────────────────────────────────────
const voice = await readFile(audioPath)
const form = new FormData()
form.append("type", "tts")
form.append("title", "Лиана (ContentFactory)")
form.append("train_mode", "fast")
// НЕ public: по умолчанию Fish кладёт модель в общий каталог.
form.append("visibility", "private")
form.append("voices", new Blob([new Uint8Array(voice)], { type: "audio/mpeg" }), basename(audioPath))

console.log("\nсоздаю голосовую модель…")
const modelResponse = await fetch(`${BASE}/model`, { method: "POST", headers: auth, body: form })
const modelBody = await modelResponse.text()
if (!modelResponse.ok) {
  console.error(`отказ ${modelResponse.status}: ${modelBody.slice(0, 400)}`)
  process.exit(1)
}
const model = JSON.parse(modelBody) as { _id?: string, id?: string, state?: string, visibility?: string }
const voiceId = model._id ?? model.id
console.log(`создана: ${voiceId} | состояние: ${model.state ?? "?"} | видимость: ${model.visibility ?? "?"}`)

// ─── синтез ──────────────────────────────────────────────────────
console.log("синтезирую реплику…")
const ttsResponse = await fetch(`${BASE}/v1/tts`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json", "model": ttsModel },
  body: JSON.stringify({ text, reference_id: voiceId, format: "mp3", mp3_bitrate: 128 }),
})
if (!ttsResponse.ok) {
  console.error(`отказ ${ttsResponse.status}: ${(await ttsResponse.text()).slice(0, 400)}`)
  console.error(`голосовая модель ${voiceId} осталась — удалить: DELETE /model/${voiceId}`)
  process.exit(1)
}

const out = `storage/raw/fish-${ttsModel}-test.mp3`
await writeFile(out, Buffer.from(await ttsResponse.arrayBuffer()))
console.log(`\n─── готово ───`)
console.log(`voice_id: ${voiceId}`)
console.log(`аудио:    ${out}`)
