/**
 * Contract-тесты /api/files/[...path] и /api/videos/[id]/playback-url.
 * Фокус — security gates (auth, prefix guard, path traversal) — поведение
 * самих driver'ов проверено в tests/unit/storage/driver.spec.ts.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest"
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { createTestUser, authHeaders } from "../helpers/auth"
import { nuxtTestEnv } from "../helpers/nuxt-env"

await setup({ dev: true, server: true, browser: false, env: nuxtTestEnv })

describe("GET /api/files/[...path]", () => {
  it("требует авторизацию", async () => {
    await expect(
      $fetch("/api/files/zavodcamp%2Fvideos%2F999%2Ffinal.mp4"),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it("отдаёт 404 для несуществующего ключа", async () => {
    const user = await createTestUser({ canAdmin: true })
    await expect(
      $fetch("/api/files/zavodcamp%2Fvideos%2F999999%2Fnope.mp4", {
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("блокирует path traversal в storage key", async () => {
    const user = await createTestUser({ canAdmin: true })
    await expect(
      $fetch("/api/files/zavodcamp%2F..%2Fetc%2Fpasswd", {
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("блокирует path traversal в legacy пути", async () => {
    const user = await createTestUser({ canAdmin: true })
    await expect(
      $fetch("/api/files/..%2F..%2Fetc%2Fpasswd", {
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  // URL hotfix: толерантность к двойному префиксу и URL-encoded слешам.
  // UI после миграции на GCS местами строит url как `/api/files/${fileUrl}`
  // где fileUrl уже содержит `/api/files/...` — endpoint должен срезать
  // лишний префикс, иначе 404 для всех ассетов новых видео.
  it("толерантен к двойному префиксу /api/files/", async () => {
    const user = await createTestUser({ canAdmin: true })
    // Двойной префикс на несуществующий ключ — после нормализации
    // должен попасть в storage-ветку и вернуть 404 (не 400 как раньше).
    await expect(
      $fetch("/api/files//api/files/zavodcamp%2Fvideos%2F999999%2Fnope.png", {
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("декодирует URL-encoded слеши (%2F)", async () => {
    const user = await createTestUser({ canAdmin: true })
    // %2F вместо / — после первого decode попадает в storage-ветку.
    await expect(
      $fetch("/api/files/zavodcamp%2Fvideos%2F999999%2Fscenes%2F0.png", {
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("декодирует двойное URL-encoding (%252F → %2F → /)", async () => {
    const user = await createTestUser({ canAdmin: true })
    // %252F → после первого decode даёт %2F → после второго / .
    await expect(
      $fetch("/api/files/zavodcamp%252Fvideos%252F999999%252F0.png", {
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("GET /api/videos/[id]/playback-url", () => {
  it("требует авторизацию", async () => {
    await expect($fetch("/api/videos/1/playback-url")).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it("404 для несуществующего видео", async () => {
    const user = await createTestUser({ canAdmin: true })
    await expect(
      $fetch("/api/videos/9999999/playback-url", {
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("400 при невалидном id", async () => {
    const user = await createTestUser({ canAdmin: true })
    await expect(
      $fetch("/api/videos/abc/playback-url", {
        headers: authHeaders(user.id),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})
