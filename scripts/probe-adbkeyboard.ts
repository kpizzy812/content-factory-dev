/**
 * Probe КАНАЛА M2Hxh: launch YT → You → View channel → Shorts → список видео.
 * Цель: (1) какой аккаунт реально залогинен (channel name на вкладке You),
 * (2) сколько копий видео 11 «When Spotify Fails You» уже в канале,
 * (3) видны ли они (по содержимому). powerOff обязателен (устройство = деньги).
 * Запуск: PROBE_IMAGE_ID=M2Hxh npx tsx scripts/probe-adbkeyboard.ts
 */
import "dotenv/config"
import { DuoplusClient } from "../server/utils/posting-provider/duoplus-client"
import { parseUiNodes, type UiNode } from "../server/automation/automation-engine/adb-shell"

const IMAGE_ID = process.env.PROBE_IMAGE_ID || "M2Hxh"
const PKG_YT = "com.google.android.youtube"

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }
async function cmd(c: DuoplusClient, x: string): Promise<string> {
  try { return await c.command(IMAGE_ID, x) } catch (e) { return `ERR:${(e as Error).message.slice(0, 70)}` }
}
async function dump(c: DuoplusClient, label: string): Promise<UiNode[]> {
  await cmd(c, `uiautomator dump /sdcard/d.xml >/dev/null 2>&1`)
  let n: UiNode[] = []
  try { n = parseUiNodes(await cmd(c, `cat /sdcard/d.xml`)) } catch { /* */ }
  console.log(`\n=== ${label}: ${n.length} узлов ===`)
  for (const x of n) { const d = x.contentDesc, t = x.text; if ((d && d.length > 1) || (t && t.length > 1)) console.log(`  d="${d.slice(0, 80)}" t="${t.slice(0, 40)}" [${x.center.x},${x.center.y}]`) }
  return n
}
function find(n: UiNode[], ...ndl: string[]): UiNode | null {
  for (const q of ndl) { const f = n.find((x) => `${x.contentDesc} ${x.text}`.toLowerCase().includes(q.toLowerCase())); if (f) return f }
  return null
}
async function tap(c: DuoplusClient, n: UiNode | null, label: string, wait = 3500): Promise<boolean> {
  if (!n) { console.log(`>>> ${label}: НЕ найдено`); return false }
  console.log(`>>> tap ${label} [${n.center.x},${n.center.y}]`)
  await cmd(c, `input tap ${n.center.x} ${n.center.y}`); await sleep(wait); return true
}

async function main(): Promise<void> {
  const c = new DuoplusClient({ baseUrl: "https://openapi.duoplus.net" })
  const dev = (await c.listCloudPhones()).find((d) => d.id === IMAGE_ID)
  console.log(`${IMAGE_ID}: status=${dev?.status}`)
  if (!dev) return
  if (dev.status !== 1) {
    await c.powerOn([IMAGE_ID]); let on = false
    for (let i = 0; i < 30; i++) { await sleep(10_000); const d = (await c.listCloudPhones()).find((x) => x.id === IMAGE_ID); console.log(`poll ${i + 1}:${d?.status}`); if (d?.status === 1) { on = true; break } }
    if (!on) { await c.powerOff([IMAGE_ID]).catch(() => {}); return }
  }
  try {
    await cmd(c, `settings put global window_animation_scale 0; settings put global transition_animation_scale 0; settings put global animator_duration_scale 0`)
    await cmd(c, `monkey -p ${PKG_YT} -c android.intent.category.LAUNCHER 1`); await sleep(7000)
    let n = await dump(c, "home")
    // 1. вкладка You (нижний нав-бар).
    const you = n.find((x) => /^you$/i.test(x.text.trim()) && x.center.y > 1800) ?? find(n, "you", "вы ")
    if (await tap(c, you, "You")) n = await dump(c, "You — имя канала вверху")
    // 2. имя канала — крупный текст в верхней части (y<700), не «Switch account»/«Subscribe».
    const nameNode = n.find((x) => x.center.y < 720 && x.text.trim().length > 2 && !/subscrib|switch|view|tap|your channel/i.test(x.text))
    console.log(`\n>>> ИМЯ КАНАЛА (аккаунт на M2Hxh): "${nameNode?.text ?? "?"}"  @desc="${nameNode?.contentDesc ?? ""}"`)
    // 3. View channel → страница канала.
    const viewCh = find(n, "view channel", "your channel", "ваш канал", "перейти на канал")
    if (await tap(c, viewCh, "View channel")) n = await dump(c, "страница канала — вкладки")
    // 4. вкладка Shorts.
    const shorts = n.find((x) => /^shorts$/i.test(x.text.trim())) ?? find(n, "shorts")
    if (await tap(c, shorts, "Shorts tab")) n = await dump(c, "Shorts — список видео")
    // 5. перечислить видео канала (ищем копии «When Spotify»/«song» + просмотры/visibility).
    console.log("\n>>> ВИДЕО В КАНАЛЕ (Shorts):")
    let spotify = 0
    for (const x of n) {
      const d = x.contentDesc
      if (!d || d.length < 4) continue
      if (/spotify|song|трек|девушк|view|просмотр|short|private|unlisted|public|ago|назад/i.test(d)) {
        console.log(`   "${d.slice(0, 100)}"`)
        if (/spotify|made my own/i.test(d)) spotify += 1
      }
    }
    console.log(`\n>>> КОПИЙ «When Spotify» в канале: ${spotify}`)
  } finally {
    console.log("\n=== powerOff ==="); await c.powerOff([IMAGE_ID]).catch(() => {}); console.log("powerOff")
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERR:", e?.message ?? e); process.exit(1) })
