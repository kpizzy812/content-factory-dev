/**
 * Регрессия на публикацию в TikTok.
 *
 * Дефекты, которые здесь закрыты:
 *  - ролик уходил в inbox-черновик (`/inbox/video/init/`) и в ленте не появлялся;
 *  - файл любого размера слался одним PUT с `chunk_size = video_size`;
 *  - `privacy_level` был жёстко прошит как PUBLIC_TO_EVERYONE без сверки с creator_info;
 *  - `publish_id` выдавался за id поста и подставлялся в публичный URL;
 *  - ретрай начинал публикацию заново вместо продолжения по publish_id;
 *  - `publish_id` сохранялся сразу после init, и обрыв заливки делал публикацию
 *    невосстановимой: ретрай пропускал загрузку чанков целиком;
 *  - без явного выбора оператора бралcя allowed[0] = SELF_ONLY, и ролик, видимый
 *    только автору, считался успешно опубликованным.
 *
 * Всё проверяется на фейковом fetchImpl — то есть вместе с настоящим слоем
 * HTTP-клиента (пути, заголовки, тела запросов), но без сети.
 *
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest"

import { createTikTokAdapter } from "~~/server/utils/social/tiktok"
import {
  TIKTOK_MAX_CHUNK_BYTES,
  TIKTOK_MAX_CHUNK_COUNT,
  planTikTokChunks,
} from "~~/server/utils/social/tiktok-api"
import type {
  DecryptedAccount,
  UploadParams,
  UploadProgress,
} from "~~/server/utils/social/types"

const MB = 1024 * 1024

interface RecordedCall {
  url: string
  path: string
  method: string
  headers: Record<string, string>
  json: Record<string, any> | null
  bytes: number[] | null
}

interface FakeStatus {
  status: string
  failReason?: string
  postIds?: string[]
}

interface FakeServerOptions {
  privacyLevelOptions?: string[]
  username?: string
  commentDisabled?: boolean
  duetDisabled?: boolean
  stitchDisabled?: boolean
  publishId?: string
  uploadUrl?: string
  statuses?: FakeStatus[]
  videos?: Array<Record<string, unknown>>
}

function headerRecord(init?: RequestInit): Record<string, string> {
  const raw = init?.headers
  if (!raw) return {}
  if (raw instanceof Headers) return Object.fromEntries(raw.entries())
  if (Array.isArray(raw)) return Object.fromEntries(raw)
  return { ...(raw as Record<string, string>) }
}

/**
 * Фейковый TikTok: отвечает по путям Content Posting API и записывает всё,
 * что в него постучалось. Ничего не знает про адаптер — именно поэтому по
 * записям видно, тот ли сценарий публикации выбран.
 */
function createFakeTikTok(options: FakeServerOptions = {}) {
  const calls: RecordedCall[] = []
  const statuses = [...(options.statuses ?? [{ status: "PUBLISH_COMPLETE", postIds: ["7301111"] }])]
  const uploadUrl = options.uploadUrl ?? "https://upload.tiktokapis.com/upload/?upload_id=42"
  const publishId = options.publishId ?? "v_pub_file~publish-1"

  const creatorInfo = {
    creator_username: options.username ?? "creator",
    creator_nickname: "Creator",
    privacy_level_options: options.privacyLevelOptions ?? ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
    max_video_post_duration_sec: 600,
    comment_disabled: options.commentDisabled ?? false,
    duet_disabled: options.duetDisabled ?? false,
    stitch_disabled: options.stitchDisabled ?? false,
  }

  const fetchImpl = async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input)
    const path = new URL(url).pathname
    const method = init?.method ?? "GET"
    const body = init?.body
    const call: RecordedCall = {
      url,
      path,
      method,
      headers: headerRecord(init),
      json: typeof body === "string" ? JSON.parse(body) : null,
      bytes: body instanceof Uint8Array ? Array.from(body) : null,
    }
    calls.push(call)

    if (method === "PUT") {
      const isLast = call.headers["Content-Range"]?.split("/")[0]?.split("-")[1]
      const total = call.headers["Content-Range"]?.split("/")[1]
      const finished = isLast !== undefined && total !== undefined && Number(isLast) + 1 === Number(total)
      return new Response(null, { status: finished ? 201 : 206 })
    }

    const json = (payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })

    if (path.endsWith("/creator_info/query/")) {
      return json({ data: creatorInfo, error: { code: "ok" } })
    }
    if (path.endsWith("/publish/video/init/")) {
      return json({ data: { publish_id: publishId, upload_url: uploadUrl }, error: { code: "ok" } })
    }
    if (path.endsWith("/publish/status/fetch/")) {
      const next = statuses.length > 1 ? statuses.shift()! : statuses[0]!
      return json({
        data: {
          status: next.status,
          fail_reason: next.failReason,
          publicaly_available_post_id: next.postIds,
        },
        error: { code: "ok" },
      })
    }
    if (path.endsWith("/video/query/")) {
      return json({ data: { videos: options.videos ?? [] }, error: { code: "ok" } })
    }

    return json({ error: { code: "unknown_endpoint", message: `нет обработчика для ${path}` } })
  }

  return { calls, fetchImpl, publishId, uploadUrl }
}

function account(): DecryptedAccount {
  return {
    id: 11,
    platform: "tiktok",
    displayName: "Reforma TT",
    platformUserId: "tt-user",
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: new Date(Date.now() + 86_400_000),
  }
}

function uploadParams(overrides: Partial<UploadParams> = {}): UploadParams {
  return {
    filePath: "/tmp/video.mp4",
    title: "Заголовок",
    description: "Описание",
    hashtags: ["reforma", "#ремонт"],
    isShort: true,
    ...overrides,
  }
}

/** Собирает адаптер поверх фейкового TikTok: диск и таймеры тоже подменены. */
function buildAdapter(
  server: ReturnType<typeof createFakeTikTok>,
  videoSize: number,
  extra: { fileSize?: ReturnType<typeof vi.fn>; readChunk?: ReturnType<typeof vi.fn> } = {},
) {
  const fileSize = extra.fileSize ?? vi.fn(async () => videoSize)
  // Байт-маркер вместо реального куска файла: важно не содержимое, а то,
  // что каждый запланированный чанк прочитан и отправлен ровно один раз.
  const readChunk = extra.readChunk ?? vi.fn(async (_path: string, chunk: { index: number }) =>
    Uint8Array.of(chunk.index))
  const adapter = createTikTokAdapter({
    fetchImpl: server.fetchImpl as unknown as typeof fetch,
    getAccessToken: async () => "token",
    fileSize: fileSize as unknown as (filePath: string) => Promise<number>,
    readChunk: readChunk as unknown as never,
    sleep: async () => {},
    pollIntervalMs: 1,
  })
  return { adapter, fileSize, readChunk }
}

describe("TikTok Direct Post", () => {
  it("идёт по маршруту creator_info → video/init → чанки → status/fetch, минуя inbox", async () => {
    const server = createFakeTikTok({
      statuses: [
        { status: "PROCESSING_UPLOAD" },
        { status: "PROCESSING_DOWNLOAD" },
        { status: "PUBLISH_COMPLETE", postIds: ["7301111"] },
      ],
    })
    const videoSize = 8 * MB
    const { adapter } = buildAdapter(server, videoSize)

    const result = await adapter.uploadVideo(account(), uploadParams())

    const paths = server.calls.map(call => `${call.method} ${call.path}`)
    expect(paths).toEqual([
      "POST /v2/post/publish/creator_info/query/",
      "POST /v2/post/publish/video/init/",
      "PUT /upload/",
      "POST /v2/post/publish/status/fetch/",
      "POST /v2/post/publish/status/fetch/",
      "POST /v2/post/publish/status/fetch/",
    ])
    // Ключевая суть дефекта: inbox кладёт черновик в приложение, в ленту он не идёт.
    expect(server.calls.some(call => call.path.includes("/inbox/"))).toBe(false)
    expect(result.platformPostId).toBe("7301111")
  })

  it("не выдаёт publish_id за id поста и не собирает из него URL", async () => {
    const server = createFakeTikTok({
      publishId: "v_pub_file~publish-777",
      username: "reforma",
      statuses: [{ status: "PUBLISH_COMPLETE", postIds: ["7399900011122233344"] }],
    })
    const { adapter } = buildAdapter(server, 6 * MB)
    const progress: UploadProgress[] = []

    const result = await adapter.uploadVideo(
      account(),
      uploadParams({ onProgress: async update => void progress.push(update) }),
    )

    expect(result.platformPostId).toBe("7399900011122233344")
    expect(result.platformPostUrl).toBe(
      "https://www.tiktok.com/@reforma/video/7399900011122233344",
    )
    expect(result.platformPostUrl).not.toContain("v_pub_file")
    expect(result.platformPostId).not.toBe(server.publishId)
    // publish_id всё-таки сохраняется — но как containerId для ретрая, не как id поста.
    expect(progress[0]).toEqual({ containerId: "v_pub_file~publish-777" })
    expect(progress.at(-1)).toEqual({
      postId: "7399900011122233344",
      postUrl: "https://www.tiktok.com/@reforma/video/7399900011122233344",
    })
  })

  it("отдаёт пустой URL, когда оператор сам выбрал непубличный уровень", async () => {
    const server = createFakeTikTok({
      publishId: "v_pub_file~self-1",
      statuses: [{ status: "PUBLISH_COMPLETE", postIds: [] }],
    })
    const { adapter } = buildAdapter(server, 6 * MB)

    const result = await adapter.uploadVideo(
      account(),
      uploadParams({ platformOptions: { tiktok: { privacyLevel: "SELF_ONLY" } } }),
    )

    expect(result.platformPostId).toBe("v_pub_file~self-1")
    // Битая ссылка хуже отсутствующей: раньше сюда подставлялся publish_id.
    expect(result.platformPostUrl).toBe("")
  })

  it("не считает публикацию успешной, если публичного id нет при уровне «всем»", async () => {
    const server = createFakeTikTok({
      publishId: "v_pub_file~ghost-1",
      statuses: [{ status: "PUBLISH_COMPLETE", postIds: [] }],
    })
    const { adapter } = buildAdapter(server, 6 * MB)

    // Раньше загрузка уходила в published с пустым URL: оператор получал алерт
    // «Видео загружено», а поста в ленте не было вовсе.
    await expect(adapter.uploadVideo(account(), uploadParams())).rejects.toThrow(
      /публичного id поста/,
    )
  })
})

describe("TikTok: загрузка файла чанками", () => {
  it("маленький файл уходит одним чанком с Content-Range на весь файл", async () => {
    const server = createFakeTikTok()
    const videoSize = 8 * MB
    const { adapter, readChunk } = buildAdapter(server, videoSize)

    await adapter.uploadVideo(account(), uploadParams())

    const init = server.calls.find(call => call.path.endsWith("/video/init/"))!
    expect(init.json?.source_info).toEqual({
      source: "FILE_UPLOAD",
      video_size: videoSize,
      chunk_size: videoSize,
      total_chunk_count: 1,
    })

    const puts = server.calls.filter(call => call.method === "PUT")
    expect(puts).toHaveLength(1)
    expect(puts[0]!.headers["Content-Range"]).toBe(`bytes 0-${videoSize - 1}/${videoSize}`)
    expect(puts[0]!.headers["Content-Length"]).toBe(String(videoSize))
    expect(readChunk).toHaveBeenCalledTimes(1)
  })

  it("большой файл режется на чанки, а Content-Range идёт без дыр до последнего байта", async () => {
    const server = createFakeTikTok()
    const videoSize = 100 * MB
    const { adapter, readChunk } = buildAdapter(server, videoSize)

    await adapter.uploadVideo(account(), uploadParams())

    const init = server.calls.find(call => call.path.endsWith("/video/init/"))!
    // Правило платформы: total_chunk_count = floor(video_size / chunk_size),
    // поэтому последний чанк забирает остаток, а не идёт отдельной частью.
    expect(init.json?.source_info).toEqual({
      source: "FILE_UPLOAD",
      video_size: videoSize,
      chunk_size: 32 * MB,
      total_chunk_count: 3,
    })

    const puts = server.calls.filter(call => call.method === "PUT")
    expect(puts).toHaveLength(3)
    expect(puts.map(call => call.headers["Content-Range"])).toEqual([
      `bytes 0-${32 * MB - 1}/${videoSize}`,
      `bytes ${32 * MB}-${64 * MB - 1}/${videoSize}`,
      `bytes ${64 * MB}-${videoSize - 1}/${videoSize}`,
    ])
    expect(puts.map(call => Number(call.headers["Content-Length"]))).toEqual([
      32 * MB,
      32 * MB,
      36 * MB,
    ])
    // Каждый прочитанный кусок ушёл ровно один раз и в своём порядке.
    expect(puts.map(call => call.bytes)).toEqual([[0], [1], [2]])
    expect(readChunk).toHaveBeenCalledTimes(3)
    expect(readChunk.mock.calls.map(([, chunk]: any[]) => [chunk.start, chunk.end])).toEqual([
      [0, 32 * MB - 1],
      [32 * MB, 64 * MB - 1],
      [64 * MB, videoSize - 1],
    ])
  })
})

describe("planTikTokChunks", () => {
  /** Общие инварианты плана: покрытие файла целиком и соблюдение лимитов TikTok. */
  function expectValidPlan(videoSize: number) {
    const plan = planTikTokChunks(videoSize)
    expect(plan.videoSize).toBe(videoSize)
    expect(plan.chunks).toHaveLength(plan.totalChunkCount)
    expect(plan.totalChunkCount).toBeLessThanOrEqual(TIKTOK_MAX_CHUNK_COUNT)
    expect(plan.chunkSize).toBeLessThanOrEqual(TIKTOK_MAX_CHUNK_BYTES)
    expect(plan.chunks[0]!.start).toBe(0)
    expect(plan.chunks.at(-1)!.end).toBe(videoSize - 1)
    let expectedStart = 0
    for (const chunk of plan.chunks) {
      expect(chunk.start).toBe(expectedStart)
      expect(chunk.size).toBe(chunk.end - chunk.start + 1)
      expect(chunk.size).toBeLessThanOrEqual(TIKTOK_MAX_CHUNK_BYTES)
      expectedStart = chunk.end + 1
    }
    expect(expectedStart).toBe(videoSize)
    return plan
  }

  it("оставляет одним куском всё, что влезает в максимальный чанк", () => {
    expect(expectValidPlan(1).totalChunkCount).toBe(1)
    expect(expectValidPlan(5 * MB).totalChunkCount).toBe(1)
    expect(expectValidPlan(TIKTOK_MAX_CHUNK_BYTES).totalChunkCount).toBe(1)
  })

  it("режет всё, что больше максимального чанка", () => {
    expect(expectValidPlan(TIKTOK_MAX_CHUNK_BYTES + 1).totalChunkCount).toBe(2)
    expect(expectValidPlan(200 * MB).totalChunkCount).toBe(6)
  })

  it("держит инварианты вплоть до предельного размера файла у TikTok (4 ГБ)", () => {
    const plan = expectValidPlan(4 * 1024 * MB)
    expect(plan.chunkSize).toBe(32 * MB)
    expect(plan.totalChunkCount).toBe(128)
  })

  it("не выходит за 1000 частей на файле у самой границы укрупнения чанка", () => {
    const plan = expectValidPlan(31 * 1024 * MB)
    expect(plan.totalChunkCount).toBe(992)
  })

  /**
   * Известный дефект ветки «файл-гигант», не закрытый этим исправлением.
   *
   * Выше 32 ГБ chunk_size считается как ceil(size / 1000), и последний чанк,
   * добирающий остаток, вырастает примерно вдвое — до 65…82 МБ при потолке
   * платформы 64 МБ (а на 64 ГБ ещё и частей выходит 1024 при лимите 1000).
   * Через официальный Direct Post такой файл не пройдёт в принципе: TikTok
   * ограничивает загрузку 4 ГБ, поэтому ветка недостижима. Тест помечен
   * `fails` намеренно: он покраснеет ровно тогда, когда дефект починят, —
   * это сигнал снять пометку, а не прятать проблему.
   */
  it.fails("НЕ соблюдает лимит 64 МБ на чанк для файлов больше 32 ГБ", () => {
    expectValidPlan(40 * 1024 * MB)
  })

  it("не строит план по нулевому или отрицательному размеру", () => {
    expect(() => planTikTokChunks(0)).toThrow(/некорректный размер/)
    expect(() => planTikTokChunks(-1)).toThrow(/некорректный размер/)
    expect(() => planTikTokChunks(Number.NaN)).toThrow(/некорректный размер/)
  })
})

describe("TikTok: privacy_level", () => {
  it("отказывается публиковать в уровень, который аккаунту не разрешён", async () => {
    const server = createFakeTikTok({ privacyLevelOptions: ["SELF_ONLY"] })
    const { adapter, fileSize } = buildAdapter(server, 6 * MB)

    await expect(
      adapter.uploadVideo(
        account(),
        uploadParams({ platformOptions: { tiktok: { privacyLevel: "PUBLIC_TO_EVERYONE" } } }),
      ),
    ).rejects.toThrow(/PUBLIC_TO_EVERYONE недоступен/)

    // Раньше PUBLIC_TO_EVERYONE был прошит в теле init и уходил всегда.
    expect(server.calls.some(call => call.path.endsWith("/video/init/"))).toBe(false)
    expect(fileSize).not.toHaveBeenCalled()
  })

  it("без явной настройки не публикует в непубличный уровень", async () => {
    const server = createFakeTikTok({ privacyLevelOptions: ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS"] })
    const { adapter } = buildAdapter(server, 6 * MB)

    // Раньше здесь молча брался allowed[0] = SELF_ONLY: ролик видел только автор,
    // а пайплайн считал его опубликованным и слал оператору «Видео загружено».
    await expect(adapter.uploadVideo(account(), uploadParams())).rejects.toThrow(/аудит/)
    expect(server.calls.some(call => call.path.endsWith("/video/init/"))).toBe(false)
  })

  it("публикует в непубличный уровень только по явному выбору оператора", async () => {
    const server = createFakeTikTok({
      privacyLevelOptions: ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS"],
      statuses: [{ status: "PUBLISH_COMPLETE", postIds: [] }],
    })
    const { adapter } = buildAdapter(server, 6 * MB)

    await adapter.uploadVideo(
      account(),
      uploadParams({ platformOptions: { tiktok: { privacyLevel: "MUTUAL_FOLLOW_FRIENDS" } } }),
    )

    const init = server.calls.find(call => call.path.endsWith("/video/init/"))!
    expect(init.json?.post_info.privacy_level).toBe("MUTUAL_FOLLOW_FRIENDS")
  })

  it("падает, если creator_info вообще не вернул уровней", async () => {
    const server = createFakeTikTok({ privacyLevelOptions: [] })
    const { adapter } = buildAdapter(server, 6 * MB)

    await expect(adapter.uploadVideo(account(), uploadParams())).rejects.toThrow(/video\.publish/)
  })

  it("уважает запреты аккаунта на комментарии, дуэты и стичи", async () => {
    const server = createFakeTikTok({ commentDisabled: true, duetDisabled: true })
    const { adapter } = buildAdapter(server, 6 * MB)

    await adapter.uploadVideo(
      account(),
      uploadParams({ platformOptions: { tiktok: { disableStitch: true } } }),
    )

    const init = server.calls.find(call => call.path.endsWith("/video/init/"))!
    expect(init.json?.post_info).toMatchObject({
      disable_comment: true,
      disable_duet: true,
      disable_stitch: true,
    })
  })
})

describe("TikTok: возобновление публикации", () => {
  it("сохраняет publish_id только после того, как все чанки доехали", async () => {
    const server = createFakeTikTok()
    const { adapter } = buildAdapter(server, 100 * MB)
    const putsBeforeSave: number[] = []

    await adapter.uploadVideo(
      account(),
      uploadParams({
        onProgress: async update => {
          if (!update.containerId) return
          putsBeforeSave.push(server.calls.filter(call => call.method === "PUT").length)
        },
      }),
    )

    // Раньше containerId писался сразу после init. Обрыв на втором чанке из трёх
    // делал загрузку невосстановимой: ретрай возобновлялся по publish_id, минуя
    // заливку, и публикация вечно висела в PROCESSING_UPLOAD.
    expect(putsBeforeSave).toEqual([3])
  })

  it("не сохраняет publish_id, если заливка оборвалась на середине", async () => {
    const server = createFakeTikTok()
    let puts = 0
    const flaky = async (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ): Promise<Response> => {
      if ((init?.method ?? "GET") === "PUT" && ++puts === 2) {
        throw new Error("соединение разорвано")
      }
      return server.fetchImpl(input, init)
    }
    const adapter = createTikTokAdapter({
      fetchImpl: flaky as unknown as typeof fetch,
      getAccessToken: async () => "token",
      fileSize: async () => 100 * MB,
      readChunk: async (_path, chunk) => Uint8Array.of(chunk.index),
      sleep: async () => {},
      pollIntervalMs: 1,
    })
    const progress: UploadProgress[] = []

    await expect(
      adapter.uploadVideo(
        account(),
        uploadParams({ onProgress: async update => void progress.push(update) }),
      ),
    ).rejects.toThrow(/чанк 2/)

    // Ничего не сохранено — значит ретрай начнёт публикацию заново, а не
    // застрянет на недозалитой.
    expect(progress).toEqual([])
  })

  it("возобновление, застрявшее на приёме файла, падает быстро и по делу", async () => {
    const server = createFakeTikTok({ statuses: [{ status: "PROCESSING_UPLOAD" }] })
    let clock = 0
    const adapter = createTikTokAdapter({
      fetchImpl: server.fetchImpl as unknown as typeof fetch,
      getAccessToken: async () => "token",
      fileSize: async () => 6 * MB,
      readChunk: async (_path, chunk) => Uint8Array.of(chunk.index),
      sleep: async ms => {
        clock += ms
      },
      now: () => clock,
      pollIntervalMs: 5,
      pollTimeoutMs: 600_000,
      resumeStuckTimeoutMs: 10,
    })

    // Строки в БД, оставшиеся от старого поведения, не должны молча съедать по
    // десять минут на каждый ретрай — оператору нужна причина и действие.
    await expect(
      adapter.uploadVideo(
        account(),
        uploadParams({ resume: { containerId: "v_pub_file~stuck" } }),
      ),
    ).rejects.toThrow(/platformContainerId/)
  })

  it("по сохранённому publish_id не читает файл и не создаёт вторую публикацию", async () => {
    const server = createFakeTikTok({
      statuses: [{ status: "PUBLISH_COMPLETE", postIds: ["7302222"] }],
    })
    const { adapter, fileSize, readChunk } = buildAdapter(server, 100 * MB)

    const result = await adapter.uploadVideo(
      account(),
      uploadParams({ resume: { containerId: "v_pub_file~resume-1" } }),
    )

    expect(server.calls.some(call => call.path.endsWith("/video/init/"))).toBe(false)
    expect(server.calls.some(call => call.method === "PUT")).toBe(false)
    expect(fileSize).not.toHaveBeenCalled()
    expect(readChunk).not.toHaveBeenCalled()

    const statusCall = server.calls.find(call => call.path.endsWith("/status/fetch/"))!
    expect(statusCall.json?.publish_id).toBe("v_pub_file~resume-1")
    expect(result.platformPostId).toBe("7302222")
  })

  it("по уже известному id поста не ходит в TikTok вообще", async () => {
    const server = createFakeTikTok()
    const { adapter } = buildAdapter(server, 6 * MB)

    const result = await adapter.uploadVideo(
      account(),
      uploadParams({
        resume: { postId: "7303333", postUrl: "https://www.tiktok.com/@reforma/video/7303333" },
      }),
    )

    expect(server.calls).toHaveLength(0)
    expect(result).toEqual({
      platformPostId: "7303333",
      platformPostUrl: "https://www.tiktok.com/@reforma/video/7303333",
    })
  })
})

describe("TikTok: исход публикации", () => {
  it("падает с причиной отказа платформы", async () => {
    const server = createFakeTikTok({
      statuses: [{ status: "FAILED", failReason: "spam_risk_too_many_posts" }],
    })
    const { adapter } = buildAdapter(server, 6 * MB)

    await expect(adapter.uploadVideo(account(), uploadParams())).rejects.toThrow(
      /spam_risk_too_many_posts/,
    )
  })

  it("не ждёт вечно: по таймауту поллинга публикация считается зависшей", async () => {
    const server = createFakeTikTok({ statuses: [{ status: "PROCESSING_UPLOAD" }] })
    let clock = 0
    const adapter = createTikTokAdapter({
      fetchImpl: server.fetchImpl as unknown as typeof fetch,
      getAccessToken: async () => "token",
      fileSize: async () => 6 * MB,
      readChunk: async (_path, chunk) => Uint8Array.of(chunk.index),
      sleep: async ms => {
        clock += ms
      },
      now: () => clock,
      pollIntervalMs: 5,
      pollTimeoutMs: 10,
    })

    await expect(adapter.uploadVideo(account(), uploadParams())).rejects.toThrow(
      /не завершил публикацию/,
    )
    // Поллинг должен был закончиться, а не крутиться бесконечно.
    expect(server.calls.filter(call => call.path.endsWith("/status/fetch/")).length)
      .toBeLessThanOrEqual(4)
  })
})

describe("TikTok: метрики поста", () => {
  it("запрашивает счётчики с обязательным fields и честно помечает недоступное", async () => {
    const server = createFakeTikTok({
      videos: [
        {
          id: "7301111",
          view_count: 12_000,
          like_count: 340,
          comment_count: 12,
          share_count: 7,
        },
      ],
    })
    const { adapter } = buildAdapter(server, 6 * MB)

    const metrics = await adapter.getPostMetrics(account(), "7301111")

    const query = server.calls.find(call => call.path.endsWith("/video/query/"))!
    expect(new URL(query.url).searchParams.get("fields")).toContain("view_count")
    expect(query.json?.filters).toEqual({ video_ids: ["7301111"] })
    expect(metrics).toMatchObject({
      views: 12_000,
      likes: 340,
      comments: 12,
      shares: 7,
      watchThrough: 0,
    })
    // Ноль без пометки сборщик принял бы за «никто не досмотрел».
    expect(metrics.unsupported).toContain("watchThrough")
  })

  it("падает, если запрошенного видео в ответе нет", async () => {
    const server = createFakeTikTok({ videos: [] })
    const { adapter } = buildAdapter(server, 6 * MB)

    await expect(adapter.getPostMetrics(account(), "7301111")).rejects.toThrow(/не найдено/)
  })
})
