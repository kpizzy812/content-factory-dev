/**
 * Живой прогон youtube-poster.ts на РЕАЛЬНОМ устройстве DuoPlus (НЕ mock).
 * Закрывает ⚠️ «код-автоматизация на устройстве ещё не гонялась» — вызывает
 * именно код (pushVideoToDevice + postYouTubeShort), а не ручные команды.
 *
 * ВАЖНО (деньги): строгий powerOff в finally — устройство не остаётся включённым.
 *
 * Запуск: DUOPLUS_API_KEY=<key> npx tsx scripts/test-duoplus-youtube-live.ts [imageId]
 */
import { getDuoplusClient } from "../server/utils/posting-provider/duoplus-client"
import {
  pushVideoToDevice,
  removeDeviceVideo,
} from "../server/automation/automation-engine/media-push"
import { postYouTubeShort } from "../server/automation/automation-engine/posters/youtube-poster"

const imageId = process.argv[2] ?? "M2Hxh"
const VIDEO_URL =
  "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function powerOnAndWait(client: ReturnType<typeof getDuoplusClient>) {
  await client.powerOn([imageId])
  // 30×10с = 300с: configuring после частых циклов занимает ~180с+ (находка на живом устройстве).
  for (let i = 1; i <= 30; i++) {
    const dev = (await client.listCloudPhones()).find((d) => d.id === imageId)
    console.log(`[live] poll ${i}: status=${dev?.status ?? "?"}`)
    if (dev?.status === 1) return dev
    await sleep(10_000)
  }
  throw new Error("устройство не достигло status=ON за таймаут")
}

async function main() {
  const client = getDuoplusClient()
  let devicePath: string | null = null
  try {
    console.log(`[live] powerOn ${imageId}...`)
    await powerOnAndWait(client)
    console.log("[live] устройство ON. Заливаю видео КОДОМ (pushVideoToDevice)...")
    devicePath = await pushVideoToDevice(imageId, VIDEO_URL, "codetest.mp4")
    console.log(`[live] видео залито: ${devicePath}. Запускаю postYouTubeShort()...`)
    const result = await postYouTubeShort({
      imageId,
      deviceVideoPath: devicePath,
      caption: "DuoPlus CODE autopost test",
    })
    console.log("[live] === РЕЗУЛЬТАТ ПОСТЕРА ===")
    console.log(JSON.stringify(result, null, 2))
  } catch (err) {
    console.error("[live] ОШИБКА:", (err as Error)?.message ?? err)
  } finally {
    if (devicePath) await removeDeviceVideo(imageId, devicePath).catch(() => {})
    console.log(`[live] powerOff ${imageId} (СТРОГО — деньги за running)...`)
    await client
      .powerOff([imageId])
      .catch((e) => console.error("[live] powerOff fail:", (e as Error)?.message))
    console.log("[live] устройство выключено.")
  }
}

void main()
