/**
 * Разбор одной публикации: откуда она взялась и чем кончилась.
 *
 * Цепочка происхождения собирается по классическому пути тренд → сценарий →
 * ролик → публикация; результат и касания — по фабричной публикации с
 * tracking token. Публикации без фабричной записи атрибуции не имеют, и
 * интерфейс говорит об этом прямо, а не показывает нули.
 *
 * Касания сшиваются по `messengerUserId`, поэтому это нижняя оценка: события
 * без опознанного человека в цепочку не попадают.
 */

import type { ChainStep, PublicationChainResult, TouchEvent } from '~~/shared/types/analytics-funnel'
import { formatMoney } from '~~/shared/utils/money'
import { prisma } from '../prisma'

const NBSP = ' '

const EVENT_LABELS: Record<string, string> = {
  automation_comment: 'Комментарий',
  automation_direct: 'Direct',
  messenger_opened: 'Переход в мессенджер',
  lead_magnet_delivered: 'Лид-магнит отдан',
  conversion_opened: 'Форма открыта',
  conversion_submitted: 'Заявка',
  sale_attributed: 'Продажа',
}

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
}

function groupNumber(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function payloadText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  for (const key of ['text', 'comment', 'message', 'note']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function toTouchEvent(event: {
  type: string
  source: string
  occurredAt: Date
  messengerUserId: string | null
  payload: unknown
}): TouchEvent {
  return {
    type: event.type,
    label: EVENT_LABELS[event.type] ?? event.type,
    occurredAt: event.occurredAt.toISOString(),
    source: event.source,
    messengerUserId: event.messengerUserId,
    payloadText: payloadText(event.payload),
  }
}

export async function computePublicationChain(uploadId: number): Promise<PublicationChainResult | null> {
  const upload = await prisma.upload.findUnique({
    where: { id: uploadId },
    select: {
      id: true,
      title: true,
      createdAt: true,
      socialAccount: { select: { id: true, displayName: true, platform: true } },
      video: {
        select: {
          id: true,
          duration: true,
          totalCostActual: true,
          variantId: true,
          scenario: {
            select: {
              id: true,
              trend: {
                select: { id: true, title: true, platform: true, viralityScore: true },
              },
            },
          },
        },
      },
      metrics: { orderBy: { collectedAt: 'desc' }, take: 1 },
    },
  })

  if (!upload) return null

  const variant = upload.video?.variantId
    ? await prisma.scenarioVariant.findUnique({
        where: { id: upload.video.variantId },
        select: { variantIndex: true, hook: true, title: true, qualityScore: true },
      })
    : null

  const publication = await prisma.factoryPublication.findUnique({
    where: { uploadId },
    select: {
      id: true,
      trackingToken: true,
      publishedAt: true,
      funnel: { select: { leadMagnet: { select: { title: true } } } },
    },
  })

  const events = publication
    ? await prisma.attributionEvent.findMany({
        where: { publicationId: publication.id },
        orderBy: { occurredAt: 'asc' },
        select: { type: true, source: true, occurredAt: true, messengerUserId: true, payload: true },
      })
    : []

  const leads = events.filter(event => event.type === 'conversion_submitted').length
  const sales = events.filter(event => event.type === 'sale_attributed').length

  const latest = upload.metrics[0] ?? null
  const clicks = events.filter(event => event.type === 'messenger_opened').length

  // --- Цепочка происхождения -------------------------------------------------
  const chain: ChainStep[] = []
  const trend = upload.video?.scenario?.trend
  if (trend) {
    const parts = [PLATFORM_LABELS[trend.platform] ?? trend.platform]
    if (trend.viralityScore != null) parts.push(`виральность ${trend.viralityScore.toFixed(1)}`)
    chain.push({
      kind: 'trend',
      label: 'Тренд',
      title: trend.title,
      meta: parts.join(' · '),
      href: `/trends/${trend.id}`,
    })
  }

  const scenarioId = upload.video?.scenario?.id
  if (scenarioId) {
    const variantLabel = variant ? ` · вариант ${String.fromCharCode(64 + Math.max(1, variant.variantIndex))}` : ''
    const metaParts: string[] = []
    if (variant?.hook) metaParts.push(`хук: ${variant.hook}`)
    if (variant?.qualityScore != null) metaParts.push(`критик ${variant.qualityScore.toFixed(1)}`)
    chain.push({
      kind: 'scenario',
      label: 'Сценарий',
      title: `scr_${scenarioId}${variantLabel}`,
      meta: metaParts.length ? metaParts.join(' · ') : null,
      href: `/scenarios/${scenarioId}`,
    })
  }

  if (upload.video) {
    const duration = upload.video.duration ? `${upload.video.duration} сек` : null
    const cost = formatMoney(upload.video.totalCostActual)
    chain.push({
      kind: 'video',
      label: 'Ролик',
      title: [`vid_${upload.video.id}`, duration].filter(Boolean).join(' · '),
      meta: cost,
      href: `/videos/${upload.video.id}`,
    })
  }

  const account = upload.socialAccount
  const publicationMeta = [
    latest ? `${groupNumber(latest.views)} просм.` : null,
    clicks > 0 ? `${groupNumber(clicks)} ${plural(clicks, 'переход', 'перехода', 'переходов')}` : null,
  ].filter(Boolean).join(' · ')
  chain.push({
    kind: 'publication',
    label: 'Публикация',
    title: account ? `${account.displayName} · ${PLATFORM_LABELS[account.platform] ?? account.platform}` : 'Публикация',
    meta: publicationMeta || null,
    href: `/uploads/${upload.id}`,
  })

  if (publication) {
    chain.push({
      kind: 'result',
      label: 'Результат',
      title: `${leads} ${plural(leads, 'заявка', 'заявки', 'заявок')} · ${sales} ${plural(sales, 'продажа', 'продажи', 'продаж')}`,
      meta: publication.funnel?.leadMagnet?.title ? `лид-магнит: ${publication.funnel.leadMagnet.title}` : null,
      href: null,
    })
  }

  // --- Цепочка касаний -------------------------------------------------------
  const conversion = [...events].reverse().find(event => event.type === 'conversion_submitted') ?? null
  let touchCount: number | null = null
  let firstTouch: TouchEvent | null = null
  let lastTouch: TouchEvent | null = null

  if (conversion) {
    lastTouch = toTouchEvent(conversion)
    if (conversion.messengerUserId) {
      const chainEvents = await prisma.attributionEvent.findMany({
        where: {
          messengerUserId: conversion.messengerUserId,
          occurredAt: { lte: conversion.occurredAt },
        },
        orderBy: { occurredAt: 'asc' },
        select: { type: true, source: true, occurredAt: true, messengerUserId: true, payload: true },
      })
      touchCount = chainEvents.length
      firstTouch = chainEvents[0] ? toTouchEvent(chainEvents[0]) : null
    } else {
      // Человек не опознан — сшивать не с чем, считаем только эту публикацию.
      touchCount = events.filter(event => event.occurredAt <= conversion.occurredAt).length
      firstTouch = events[0] ? toTouchEvent(events[0]) : null
    }
  }

  return {
    uploadId: upload.id,
    title: upload.title,
    trackingToken: publication?.trackingToken ?? null,
    publishedAt: (publication?.publishedAt ?? upload.createdAt).toISOString(),
    chain,
    touchCount,
    firstTouch,
    lastTouch,
    events: events.map(toTouchEvent),
    leads,
    sales,
    leadMagnetTitle: publication?.funnel?.leadMagnet?.title ?? null,
    hasPublication: publication !== null,
  }
}
