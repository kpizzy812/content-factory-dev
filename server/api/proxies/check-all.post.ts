/**
 * POST /api/proxies/check-all
 * Массовая параллельная проверка прокси с лимитом concurrency=5.
 *
 * Возвращает агрегированный результат — UI рендерит toast с total/successful/failed.
 * Каждая проверка runProxyHealthCheck сохраняет ProxyHealthCheck row и обновляет
 * Proxy.status / lastCheckedAt / consecutiveFailures.
 */
const CONCURRENCY_LIMIT = 5

interface CheckAllResult {
  id: string
  label: string
  ok: boolean
  errorCategory: string | null
  errorMessage: string | null
}

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  const proxies = await prisma.proxy.findMany({
    where: { status: { not: "expired" } },
    select: { id: true, label: true },
    orderBy: { createdAt: "asc" },
  })

  if (proxies.length === 0) {
    return { data: { total: 0, successful: 0, failed: 0, results: [] } }
  }

  const results: CheckAllResult[] = []

  for (let i = 0; i < proxies.length; i += CONCURRENCY_LIMIT) {
    const chunk = proxies.slice(i, i + CONCURRENCY_LIMIT)
    const chunkResults = await Promise.allSettled(
      chunk.map(async (p) => {
        const r = await runProxyHealthCheck(p.id, "manual")
        return {
          id: p.id,
          label: p.label,
          ok: r.httpProbeOk && !r.isLeaking,
          errorCategory: r.errorCategory ?? null,
          errorMessage: r.errorMessage ?? null,
        } satisfies CheckAllResult
      }),
    )
    for (let idx = 0; idx < chunkResults.length; idx += 1) {
      const r = chunkResults[idx]
      const source = chunk[idx]
      if (r.status === "fulfilled") {
        results.push(r.value)
      } else {
        const message =
          r.reason instanceof Error
            ? r.reason.message
            : String(r.reason ?? "unknown error")
        results.push({
          id: source.id,
          label: source.label,
          ok: false,
          errorCategory: "unknown",
          errorMessage: message.slice(0, 200),
        })
      }
    }
  }

  const successful = results.filter((r) => r.ok).length
  const failed = results.length - successful

  return {
    data: {
      total: proxies.length,
      successful,
      failed,
      results,
    },
  }
})
