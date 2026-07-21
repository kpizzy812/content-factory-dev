/**
 * Smoke-тест Track F: video-uniqifier.
 * Не требует БД — тестирует только ffmpeg pipeline + hash/duration.
 *
 * Запуск:
 *   bun run scripts/test-uniqifier.ts
 *
 * Ожидаемый STDOUT:
 *   [test-uniqifier] preparing fixture...
 *   [test-uniqifier] fixture: <abs-path>
 *   [test-uniqifier] running tiktok variant (v1)...
 *   [test-uniqifier] tiktok hash=<sha-16> dur=<x>s size=<y>KB
 *   [test-uniqifier] hash differs from source: PASS
 *   [test-uniqifier] running youtube variant (v1)...
 *   [test-uniqifier] youtube hash=<sha-16> dur=<x>s size=<y>KB
 *   [test-uniqifier] tiktok != youtube hash: PASS
 *   [test-uniqifier] duration within ±5%: PASS
 *   [test-uniqifier] re-running tiktok with same seed (cached check)...
 *   [test-uniqifier] same paramsHash, same fileHash: PASS
 *   [test-uniqifier] ALL TESTS PASS
 */

import { mkdir, rm, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  generateUniqifyParams,
  hashParams,
  PLATFORM_PRESETS,
} from "../server/utils/video-uniqifier/params"
import {
  uniqifyVideo,
  computeFileHash,
  ffprobeDuration,
  runFfmpeg,
} from "../server/utils/video-uniqifier/ffmpeg"

const TEST_DIR = join(process.cwd(), "storage", "uploads", "_test_uniqifier")

async function ensureFixture(): Promise<string> {
  await mkdir(TEST_DIR, { recursive: true })
  const fixture = join(TEST_DIR, "source.mp4")
  if (!existsSync(fixture)) {
    console.log("[test-uniqifier] preparing fixture...")
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc=size=1080x1920:duration=4:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
      "-c:a", "aac", "-b:a", "128k",
      "-shortest",
      fixture,
    ])
  }
  console.log("[test-uniqifier] fixture:", fixture)
  return fixture
}

async function runVariant(source: string, platform: "tiktok" | "youtube", suffix: string) {
  const params = generateUniqifyParams(`test:${platform}:${suffix}`)
  const paramsHash = hashParams(params)
  const out = join(TEST_DIR, `${platform}_${paramsHash}.mp4`)
  console.log(`[test-uniqifier] running ${platform} variant (${suffix})...`)
  await uniqifyVideo({
    inputPath: source,
    outputPath: out,
    params,
    preset: PLATFORM_PRESETS[platform],
  })
  const [hash, dur, st] = await Promise.all([
    computeFileHash(out),
    ffprobeDuration(out),
    stat(out),
  ])
  console.log(`[test-uniqifier] ${platform} hash=${hash.slice(0, 16)} dur=${dur.toFixed(2)}s size=${(Number(st.size)/1024).toFixed(0)}KB`)
  return { params, paramsHash, hash, dur, size: Number(st.size), out }
}

async function main() {
  const fixture = await ensureFixture()
  const sourceHash = await computeFileHash(fixture)
  const sourceDur = await ffprobeDuration(fixture)

  const tt = await runVariant(fixture, "tiktok", "v1")
  if (tt.hash === sourceHash) throw new Error("FAIL: tiktok hash equals source")
  console.log("[test-uniqifier] hash differs from source: PASS")

  const yt = await runVariant(fixture, "youtube", "v1")
  if (yt.hash === tt.hash) throw new Error("FAIL: tiktok hash equals youtube hash")
  console.log("[test-uniqifier] tiktok != youtube hash: PASS")

  const tolerance = 0.05
  if (Math.abs(tt.dur - sourceDur) / sourceDur > tolerance) {
    throw new Error(`FAIL: tiktok duration drift > 5% (src=${sourceDur}, var=${tt.dur})`)
  }
  console.log("[test-uniqifier] duration within ±5%: PASS")

  console.log("[test-uniqifier] re-running tiktok with same seed (cached check)...")
  const tt2 = await runVariant(fixture, "tiktok", "v1")
  if (tt2.paramsHash !== tt.paramsHash) throw new Error("FAIL: paramsHash not deterministic")
  if (tt2.hash !== tt.hash) throw new Error("FAIL: re-run produced different fileHash (non-deterministic ffmpeg)")
  console.log("[test-uniqifier] same paramsHash, same fileHash: PASS")

  console.log("[test-uniqifier] ALL TESTS PASS")

  await rm(TEST_DIR, { recursive: true, force: true })
  console.log(`[test-uniqifier] cleanup: ${TEST_DIR} removed`)
}

main().catch((e) => {
  console.error("[test-uniqifier] FAIL:", e)
  process.exit(1)
})
