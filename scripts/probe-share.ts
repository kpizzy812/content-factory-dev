/**
 * Probe SHARE-flow YouTube: You → channel → Shorts → тап видео #19 (love song) →
 * More actions/Share → dump (ищем youtube.com/shorts/<id>) + попытка clipboard.
 * Цель: где читается URL поста после публикации. НЕ трогает постер. powerOff обязателен.
 * Запуск: PROBE_IMAGE_ID=4kwGy npx tsx scripts/probe-share.ts
 */
import "dotenv/config"
import { DuoplusClient } from "../server/utils/posting-provider/duoplus-client"
import { parseUiNodes, type UiNode } from "../server/automation/automation-engine/adb-shell"

const IMAGE_ID = process.env.PROBE_IMAGE_ID || "4kwGy"
const PKG_YT = "com.google.android.youtube"
const NEEDLE = (process.env.PROBE_VIDEO_NEEDLE || "love song").toLowerCase()

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }
async function cmd(c: DuoplusClient, x: string): Promise<string> {
  try { return await c.command(IMAGE_ID, x) } catch (e) { return `ERR:${(e as Error).message.slice(0, 70)}` }
}
async function dump(c: DuoplusClient, label: string): Promise<UiNode[]> {
  await cmd(c, `uiautomator dump /sdcard/d.xml >/dev/null 2>&1`)
  let n: UiNode[] = []
  try { n = parseUiNodes(await cmd(c, `cat /sdcard/d.xml`)) } catch { /* */ }
  console.log(`\n=== ${label}: ${n.length} ===`)
  for (const x of n) { const d = x.contentDesc, t = x.text; if ((d && d.length > 1) || (t && t.length > 1)) console.log(`  d="${d.slice(0, 70)}" t="${t.slice(0, 40)}" [${x.center.x},${x.center.y}]`) }
  return n
}
function find(n: UiNode[], ...ndl: string[]): UiNode | null {
  for (const q of ndl) { const f = n.find((x) => `${x.contentDesc} ${x.text}`.toLowerCase().includes(q.toLowerCase())); if (f) return f }
  return null
}
async function tap(c: DuoplusClient, n: UiNode | null, label: string, wait = 3000): Promise<boolean> {
  if (!n) { console.log(`>>> ${label}: НЕ найдено`); return false }
  console.log(`>>> tap ${label} [${n.center.x},${n.center.y}]`)
  await cmd(c, `input tap ${n.center.x} ${n.center.y}`); await sleep(wait); return true
}
function scanUrl(n: UiNode[]): string | null {
  for (const x of n) {
    const blob = `${x.contentDesc} ${x.text}`
    const m = blob.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/shorts\/[\w-]+|youtu\.be\/[\w-]+)/)
    if (m) return m[0]
  }
  return null
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
    const you = n.find((x) => /^you$/i.test(x.text.trim()) && x.center.y > 1800) ?? find(n, "you")
    if (await tap(c, you, "You")) n = await dump(c, "You")
    if (await tap(c, find(n, "view channel", "your channel"), "View channel")) n = await dump(c, "channel")
    const shorts = n.find((x) => /^shorts$/i.test(x.text.trim())) ?? find(n, "shorts")
    if (await tap(c, shorts, "Shorts tab")) n = await dump(c, "Shorts list")
    // НЕ тапаем видео (промахивается на Create-навбар «Short»). Тапаем «More actions»
    // ИМЕННО у нашего видео — ближайшую по координате к подписи NEEDLE → меню видео.
    const vidNode = n.find((x) => x.contentDesc.toLowerCase().includes(NEEDLE))
    let moreBtn: UiNode | null = null
    if (vidNode) {
      const mores = n.filter((x) => /more actions/i.test(x.contentDesc))
      const dist = (x: UiNode): number => Math.abs(x.center.y - vidNode.center.y) + Math.abs(x.center.x - vidNode.center.x)
      moreBtn = mores.sort((a, b) => dist(a) - dist(b))[0] ?? null
      console.log(`видео "${NEEDLE}" @[${vidNode.center.x},${vidNode.center.y}], ближайший More actions @[${moreBtn?.center.x},${moreBtn?.center.y}]`)
    }
    if (!(await tap(c, moreBtn, `More actions у видео "${NEEDLE}"`, 2500))) { console.log("More actions у видео не найден — стоп"); return }
    n = await dump(c, "меню видео (ищем Share / Copy link / URL)")
    let url = scanUrl(n)
    if (url) { console.log(`\n!!! URL прямо в меню: ${url}`); return }
    // Ищем Share напрямую, иначе More actions → Share.
    let share = find(n, "share")
    if (!share) {
      const more = find(n, "more actions", "more options", "more")
      if (await tap(c, more, "More actions (2)")) { n = await dump(c, "More-menu"); share = find(n, "share") }
    }
    if (await tap(c, share, "Share", 2500)) {
      n = await dump(c, "Share-sheet (ищем URL / Copy link)")
      url = scanUrl(n)
      if (url) { console.log(`\n!!! URL в Share-sheet: ${url}`); return }
      // Пробуем Copy link → читаем буфер обмена (Android 13+: cmd clipboard).
      const copy = find(n, "copy link", "copy")
      if (await tap(c, copy, "Copy link", 1500)) {
        const clip = await cmd(c, `cmd clipboard get-primary 2>/dev/null || service call clipboard 1`)
        console.log(`\n>>> clipboard: ${clip.slice(0, 200)}`)
        const m = clip.match(/https?:\/\/[\w./-]+/)
        console.log(m ? `!!! URL из буфера: ${m[0]}` : "URL в буфере не распознан — см. выше")
      }
    }
  } finally {
    console.log("\n=== powerOff ==="); await c.powerOff([IMAGE_ID]).catch(() => {}); console.log("powerOff")
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERR:", e?.message ?? e); process.exit(1) })
