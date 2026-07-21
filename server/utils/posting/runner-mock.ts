/**
 * Mock runner для PostingJob (итерация Track D).
 *
 * Имитирует Indigo+Playwright runner:
 *  - случайная задержка 2..5s
 *  - 10% случайный сбой с code='ETIMEDOUT' (для проверки retry-логики)
 *  - на success возвращает фейковый platformPostId / platformPostUrl
 *
 * В итерации 4 будет заменён на реальный runner с Indigo browser session.
 */

import type { Platform, PostingJob } from "../../../app/generated/prisma/client"

export interface RunnerSuccess {
  platformPostId: string
  platformPostUrl: string
  apiMadeWarning: boolean
}

export interface RunnerError extends Error {
  code: string
}

function randomDelayMs(): number {
  return 2000 + Math.floor(Math.random() * 3000)
}

function randomPostId(): string {
  return Math.random().toString(36).slice(2, 12).toUpperCase()
}

function postUrl(platform: Platform, postId: string): string {
  switch (platform) {
    case "tiktok":
      return `https://tiktok.com/v/${postId}`
    case "instagram":
      return `https://instagram.com/p/${postId}`
    case "youtube":
      return `https://youtube.com/shorts/${postId}`
    default: {
      // exhaust-check: при добавлении новой Platform TS подсветит ошибку.
      const _exhaustive: never = platform
      void _exhaustive
      return `https://${String(platform)}/${postId}`
    }
  }
}

/**
 * Отправить job на исполнение в (mock) runner.
 *
 * @throws RunnerError с code='ETIMEDOUT' в 10% случаев (категоризируется как network_error → retry)
 */
export async function sendToRunner(job: Pick<PostingJob, "id" | "platform">): Promise<RunnerSuccess> {
  await new Promise((resolve) => setTimeout(resolve, randomDelayMs()))

  if (Math.random() < 0.1) {
    const err = new Error("Mock runner timeout") as RunnerError
    err.code = "ETIMEDOUT"
    throw err
  }

  const postId = `mock-post-${randomPostId()}`
  return {
    platformPostId: postId,
    platformPostUrl: postUrl(job.platform, postId),
    apiMadeWarning: false,
  }
}
