/**
 * Perceptual hash кадра для контроля похожести исходников ведущего.
 *
 * dHash: сравниваем соседние пиксели по горизонтали в сетке 9x8 и получаем
 * 64 бита. Он не зависит от общей яркости и сжатия — именно то, что нужно,
 * чтобы поймать «тот же кадр, только чуть светлее».
 *
 * Функции чистые: серые пиксели готовит ffmpeg
 * (`-vf scale=9:8,format=gray -f rawvideo`), сюда приходит уже готовый буфер.
 */

export const DHASH_WIDTH = 9
export const DHASH_HEIGHT = 8

/** Кадры одной сцены различаются на единицы бит, разные сцены — на десятки. */
export const DEFAULT_SIMILARITY_THRESHOLD = 6

const EXPECTED_LENGTH = DHASH_WIDTH * DHASH_HEIGHT
const HEX_HASH = /^[0-9a-f]{16}$/

export function dHashFromGrayscale(pixels: Uint8Array | number[]): string {
  if (pixels.length !== EXPECTED_LENGTH) {
    throw new Error(`Ожидается кадр 9x8 в оттенках серого (${EXPECTED_LENGTH} байт), получено ${pixels.length}`)
  }

  let hash = 0n
  let bit = 0
  for (let y = 0; y < DHASH_HEIGHT; y += 1) {
    for (let x = 0; x < DHASH_WIDTH - 1; x += 1) {
      const left = pixels[y * DHASH_WIDTH + x]!
      const right = pixels[y * DHASH_WIDTH + x + 1]!
      if (left > right) hash |= 1n << BigInt(63 - bit)
      bit += 1
    }
  }

  return hash.toString(16).padStart(16, "0")
}

function parseHash(value: string, label: string): bigint {
  if (!HEX_HASH.test(value)) {
    throw new Error(`${label} должен быть 16 hex-символами, получено "${value}"`)
  }
  return BigInt(`0x${value}`)
}

export function hammingDistance(a: string, b: string): number {
  let diff = parseHash(a, "hash") ^ parseHash(b, "hash")
  let distance = 0
  while (diff) {
    diff &= diff - 1n
    distance += 1
  }
  return distance
}

export function areFramesSimilar(
  a: string,
  b: string,
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): boolean {
  return hammingDistance(a, b) <= threshold
}
