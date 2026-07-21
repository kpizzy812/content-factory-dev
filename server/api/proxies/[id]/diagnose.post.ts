/**
 * POST /api/proxies/:id/diagnose
 *
 * Глубокая диагностика прокси через 4 разных метода (curl baseline,
 * https.request + SocksProxyAgent, native fetch + agent, socks5h:// variant).
 * Возвращает большой JSON с auto-determined verdict — какой именно компонент
 * leak'ает и что чинить. Используется когда обычный health-check показывает
 * leak но непонятно где собака зарыта (NodeMaven side / наш код / Node bug).
 *
 * Permissions: те же что у /api/proxies/:id/check (canWrite + social-upload).
 */
import { diagnoseProxy } from "~~/server/utils/proxy/diagnostic"

export default defineEventHandler(async (event) => {
  await requireScopedAccess(event, {
    permissions: ["canWrite"],
    moduleSlug: "social-upload",
  })

  const id = getRouterParam(event, "id")
  if (!id || typeof id !== "string" || !id.trim()) {
    throw createError({
      statusCode: 400,
      message: "Неверный идентификатор прокси",
    })
  }

  const proxy = await prisma.proxy.findUnique({
    where: { id },
    select: {
      id: true,
      label: true,
      protocol: true,
      host: true,
      port: true,
      username: true,
      password: true,
    },
  })
  if (!proxy) {
    throw createError({ statusCode: 404, message: "Прокси не найден" })
  }

  const diagnostic = await diagnoseProxy({
    protocol: proxy.protocol,
    host: decryptSecret(proxy.host),
    port: proxy.port,
    username: proxy.username ? decryptSecret(proxy.username) : undefined,
    password: proxy.password ? decryptSecret(proxy.password) : undefined,
  })

  // Логируем только summary в server logs — без credentials, без full body.
  console.log(
    "[proxy-diagnostic]",
    JSON.stringify({
      proxyId: proxy.id,
      proxyLabel: proxy.label,
      protocol: proxy.protocol,
      verdict: diagnostic.verdict,
      containerIp_v4: diagnostic.containerIp.via_v4,
      curl_detectedIp: diagnostic.curlBaseline.detectedIp,
      curl_leak: diagnostic.curlBaseline.isLeakingViaCurl,
      rawNode_detectedIp: diagnostic.rawNodeRequest.detectedIp,
      rawNode_leak: diagnostic.rawNodeRequest.isLeaking,
      fetch_detectedIp: diagnostic.nativeFetch.detectedIp,
      fetch_leak: diagnostic.nativeFetch.isLeaking,
      socks5h_detectedIp: diagnostic.socks5hVariant.detectedIp,
      nodeVersion: diagnostic.nativeFetch.nodeVersion,
    }),
  )

  return { data: diagnostic }
})
