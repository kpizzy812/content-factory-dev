import type { EntityStatus } from '~~/shared/utils/entity-status'
import type { SceneStatus } from '~~/shared/types/scene'

/**
 * Приведение статусов сцены к общему словарю системы.
 *
 * Подпись остаётся доменной (`SCENE_STATUS_LABELS`): «Готова» — это сцена,
 * которую можно отправлять в генерацию, а не «В очереди» — очереди у сцен нет.
 * Из словаря берётся только тон, как у `ProxyHealthBadge`.
 */
export const SCENE_STATUS_TO_ENTITY: Record<SceneStatus, EntityStatus> = {
  draft: 'draft',
  ready: 'queued',
  generating: 'running',
  done: 'done',
}

export function sceneStatus(raw: string | null | undefined): EntityStatus {
  return SCENE_STATUS_TO_ENTITY[(raw ?? '') as SceneStatus] ?? 'draft'
}
