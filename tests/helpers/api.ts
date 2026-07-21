/**
 * Тонкая обёртка над $fetch (@nuxt/test-utils) для интеграционных тестов API.
 *
 * Использование:
 *   const user = await createTestUser()
 *   const res = await apiGet("/api/admin/accounts-health", { headers: authHeaders(user.id) })
 *
 * В Nuxt-окружении @nuxt/test-utils экспонирует глобальный $fetch,
 * который ходит во встроенный Nitro-сервер (без реального HTTP).
 */
import { $fetch } from "@nuxt/test-utils/e2e"

type FetchInit = Parameters<typeof $fetch>[1]

export async function apiGet<T = unknown>(
  path: string,
  init?: Omit<FetchInit, "method">,
): Promise<T> {
  return $fetch(path, { ...(init ?? {}), method: "GET" }) as Promise<T>
}

export async function apiPost<T = unknown>(
  path: string,
  body: unknown,
  init?: Omit<FetchInit, "method" | "body">,
): Promise<T> {
  return $fetch(path, { ...(init ?? {}), method: "POST", body }) as Promise<T>
}

export async function apiPut<T = unknown>(
  path: string,
  body: unknown,
  init?: Omit<FetchInit, "method" | "body">,
): Promise<T> {
  return $fetch(path, { ...(init ?? {}), method: "PUT", body }) as Promise<T>
}

export async function apiDelete<T = unknown>(
  path: string,
  init?: Omit<FetchInit, "method">,
): Promise<T> {
  return $fetch(path, { ...(init ?? {}), method: "DELETE" }) as Promise<T>
}
