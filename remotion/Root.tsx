/**
 * Композиции Remotion.
 *
 * Две штуки — вертикаль и горизонталь: формат ролика выбирает адаптер
 * (`server/utils/remotion/render.ts`) по `Video.format`. Длительность и размер
 * приходят из inputProps, потому что известны только в момент рендера.
 */

import React from 'react'
import { Composition } from 'remotion'

import { Overlays, type OverlaysProps } from './Overlays'

const FPS = 30
/** Запасная длительность, если рендер запущен без inputProps (превью в студии). */
const FALLBACK_DURATION_SEC = 80

const defaultProps: OverlaysProps = {
  videoFileName: 'preview.mp4',
  overlays: [],
}

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="VerticalOverlays"
        component={Overlays}
        durationInFrames={FALLBACK_DURATION_SEC * FPS}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={defaultProps}
        calculateMetadata={({ props }) => ({
          // Длительность равна ролику: лишние кадры дорисовали бы чёрный хвост,
          // а нехватка обрезала бы концовку с CTA.
          durationInFrames: Math.max(
            1,
            Math.round((props.durationSec ?? FALLBACK_DURATION_SEC) * FPS),
          ),
        })}
      />
      <Composition
        id="HorizontalOverlays"
        component={Overlays}
        durationInFrames={FALLBACK_DURATION_SEC * FPS}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={defaultProps}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(
            1,
            Math.round((props.durationSec ?? FALLBACK_DURATION_SEC) * FPS),
          ),
        })}
      />
    </>
  )
}
