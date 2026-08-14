/**
 * Слой анимационной инфографики поверх готового ролика.
 *
 * Ролик приходит уже собранным: клипы склеены, звук сведён, субтитры вшиты.
 * Задача этого слоя — только плашки с цифрами, и он обязан не мешать тому, что
 * уже в кадре. Отсюда правила: плашка держится в верхней трети (низ занят
 * субтитрами), появляется и уходит анимацией, а не морганием, и живёт ровно
 * столько, сколько отвела ей раскладка (`server/utils/remotion/overlay-plan.ts`).
 */

import React from 'react'
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'

export interface OverlayItem {
  kind: 'stat'
  sceneOrder: number
  startSec: number
  durationSec: number
  text: string
}

/**
 * Пересечение с Record<string, unknown> — требование типов `Composition`:
 * Remotion передаёт пропсы как произвольный объект и без него не принимает
 * компонент с конкретной сигнатурой.
 */
export type OverlaysProps = {
  /** Имя файла ролика внутри publicDir, который передаёт бандлер. */
  videoFileName: string
  overlays: OverlayItem[]
  /** Длительность ролика: по ней считается число кадров композиции. */
  durationSec?: number
} & Record<string, unknown>

/** Крупная часть — число, остальное подписью: цифру видно за долю секунды. */
function splitStat(text: string): { value: string, caption: string } {
  const match = text.match(/(\d+[.,]?\d*\s*(?:%|₽|\$)?)/)
  if (!match) return { value: text, caption: '' }
  const value = match[1]!.trim()
  const caption = text.replace(match[1]!, '').replace(/\s+/g, ' ').trim()
  return { value, caption }
}

const StatCard: React.FC<{ item: OverlayItem }> = ({ item }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const { value, caption } = splitStat(item.text)

  // Пружина на появление: резкий скачок читается как ошибка рендера, а не как
  // акцент. Числа подобраны так, чтобы плашка «садилась» примерно за треть секунды.
  const enter = spring({ frame, fps, config: { damping: 14, mass: 0.6 } })
  const durationFrames = Math.max(1, Math.round(item.durationSec * fps))
  const exit = interpolate(
    frame,
    [durationFrames - Math.round(fps * 0.4), durationFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  const opacity = Math.min(enter, exit)

  return (
    <AbsoluteFill
      style={{
        // Верхняя треть: низ кадра занят субтитрами, и плашка туда лезть не должна.
        justifyContent: 'flex-start',
        alignItems: 'center',
        paddingTop: '14%',
        opacity,
        transform: `translateY(${interpolate(enter, [0, 1], [-40, 0])}px)`,
      }}
    >
      <div
        style={{
          background: 'rgba(12, 12, 14, 0.82)',
          borderRadius: 28,
          padding: '28px 44px',
          maxWidth: '78%',
          textAlign: 'center',
          border: '2px solid rgba(255, 255, 255, 0.14)',
        }}
      >
        <div
          style={{
            fontFamily: 'Inter, Arial, sans-serif',
            fontWeight: 800,
            fontSize: 96,
            lineHeight: 1,
            color: '#FFFFFF',
            letterSpacing: '-0.02em',
          }}
        >
          {value}
        </div>
        {caption
          ? (
              <div
                style={{
                  marginTop: 12,
                  fontFamily: 'Inter, Arial, sans-serif',
                  fontWeight: 600,
                  fontSize: 34,
                  lineHeight: 1.2,
                  color: 'rgba(255, 255, 255, 0.86)',
                }}
              >
                {caption}
              </div>
            )
          : null}
      </div>
    </AbsoluteFill>
  )
}

export const Overlays: React.FC<OverlaysProps> = ({ videoFileName, overlays }) => {
  const { fps } = useVideoConfig()

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/*
        OffthreadVideo, а не Video: он декодирует кадры вне браузера и не
        рассинхронизируется на длинных роликах — ровно наш случай, 70-90 секунд.
      */}
      <OffthreadVideo src={staticFile(videoFileName)} />
      {overlays.map((item, index) => (
        <Sequence
          key={`${item.sceneOrder}-${index}`}
          from={Math.round(item.startSec * fps)}
          durationInFrames={Math.max(1, Math.round(item.durationSec * fps))}
        >
          <StatCard item={item} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
