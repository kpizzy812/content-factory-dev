/**
 * Регрессия на порчу метрик TikTok чужими числами.
 *
 * Дефект: в сборе метрик стоял фолбэк `videos.find(...) ?? videos[0]`. Штатный
 * путь к беде — в platformPostId лежит publish_id (публичный id поста не
 * разрезолвился за отведённые опросы статуса): Display API по такому id ничего
 * не находит, отдаёт что-то своё, а в PostMetrics этой загрузки уезжали
 * счётчики ЧУЖОГО ролика — молча, без единой ошибки в сборщике.
 *
 * Заодно закрыты соседние «мягкие» фолбэки разбора ответа Display API:
 *  - запись без id превращалась в видео с пустым id;
 *  - отсутствующий счётчик превращался в 0, неотличимый от честного нуля.
 *
 * Всё на фейковом fetchImpl: без сети, без БД, вместе с настоящим HTTP-слоем.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest"

import { createTikTokAdapter } from "~~/server/utils/social/tiktok"
import { createTikTokApiClient } from "~~/server/utils/social/tiktok-api"
import type { DecryptedAccount } from "~~/server/utils/social/types"

function account(): DecryptedAccount {
  return {
    id: 1,
    platform: "tiktok",
    displayName: "TikTok Test",
    platformUserId: "u-1",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: new Date(Date.now() + 3_600_000),
  }
}

/** Отвечает только на /v2/video/query/ — больше адаптеру для метрик и не нужно. */
function fakeVideoQuery(videos: Array<Record<string, unknown>>) {
  const calls: string[] = []
  const fetchImpl = async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = String(input)
    calls.push(url)
    return new Response(JSON.stringify({ data: { videos }, error: { code: "ok" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch }
}

function buildAdapter(videos: Array<Record<string, unknown>>) {
  const server = fakeVideoQuery(videos)
  const adapter = createTikTokAdapter({
    fetchImpl: server.fetchImpl,
    getAccessToken: async () => "token",
  })
  return { adapter, server }
}

const FULL_COUNTS = {
  view_count: 999_000,
  like_count: 111,
  comment_count: 22,
  share_count: 3,
}

describe("TikTok: метрики только по точному id поста", () => {
  it("не подставляет счётчики чужого ролика, когда запрошенного id в ответе нет", async () => {
    // Ровно тот случай: сохранён publish_id, а Display API вернул посторонний ролик.
    const { adapter } = buildAdapter([{ id: "7309999", ...FULL_COUNTS }])

    await expect(adapter.getPostMetrics(account(), "v_pub_file~publish-1")).rejects.toThrow(
      /не найдено в Display API/,
    )
  })

  it("объясняет причину (publish_id вместо id поста) и что делать", async () => {
    const { adapter } = buildAdapter([{ id: "7309999", ...FULL_COUNTS }])

    const error = await adapter
      .getPostMetrics(account(), "v_pub_file~publish-1")
      .then(() => null, (reason: unknown) => reason as Error)

    expect(error).toBeInstanceOf(Error)
    const message = error!.message
    // Причина, по которой в platformPostId оказался не тот id.
    expect(message).toContain("publish_id")
    // Что именно пришло вместо запрошенного — иначе разбирать нечего.
    expect(message).toContain("7309999")
    // Подсказка по второй частой причине и действие оператора.
    expect(message).toContain("video.list")
    expect(message).toContain("OAuth")
  })

  it("выбирает из ответа именно запрошенный ролик, а не первый", async () => {
    const { adapter } = buildAdapter([
      { id: "7309999", view_count: 999_000, like_count: 1, comment_count: 1, share_count: 1 },
      { id: "7301111", view_count: 12_000, like_count: 340, comment_count: 12, share_count: 7 },
    ])

    const metrics = await adapter.getPostMetrics(account(), "7301111")

    expect(metrics).toMatchObject({ views: 12_000, likes: 340, comments: 12, shares: 7 })
  })
})

describe("TikTok: разбор ответа Display API", () => {
  it("падает на отсутствующем счётчике вместо тихого нуля", async () => {
    const server = fakeVideoQuery([
      { id: "7301111", like_count: 340, comment_count: 12, share_count: 7 },
    ])
    const client = createTikTokApiClient({
      accessToken: "token",
      fetchImpl: server.fetchImpl,
    })

    await expect(client.queryVideos(["7301111"])).rejects.toThrow(
      /не вернул view_count для видео 7301111/,
    )
  })

  it("падает на записи без id: привязать счётчики не к чему", async () => {
    const server = fakeVideoQuery([{ ...FULL_COUNTS }])
    const client = createTikTokApiClient({
      accessToken: "token",
      fetchImpl: server.fetchImpl,
    })

    await expect(client.queryVideos(["7301111"])).rejects.toThrow(/без id/)
  })
})
