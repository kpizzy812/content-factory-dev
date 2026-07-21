import "dotenv/config"
import { DuoplusClient } from "../server/utils/posting-provider/duoplus-client"
;(async () => {
  const c = new DuoplusClient({ baseUrl: "https://openapi.duoplus.net" })
  const list = await c.listCloudPhones()
  const watch = list.filter((d) => ["M2Hxh", "4kwGy"].includes(d.id)).map((d) => ({ id: d.id, status: d.status }))
  console.log("ДО:", JSON.stringify(watch))
  const toOff = list.filter((d) => ["M2Hxh", "4kwGy"].includes(d.id) && [1, 10, 11].includes(d.status)).map((d) => d.id)
  if (toOff.length) {
    await c.powerOff(toOff)
    console.log("powerOff отправлен:", toOff.join(","))
  } else console.log("нечего выключать (оба уже off)")
  await new Promise((r) => setTimeout(r, 8000))
  const after = (await c.listCloudPhones()).filter((d) => ["M2Hxh", "4kwGy"].includes(d.id)).map((d) => ({ id: d.id, status: d.status }))
  console.log("ПОСЛЕ:", JSON.stringify(after))
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ERR:", e?.message ?? e)
    process.exit(1)
  })
