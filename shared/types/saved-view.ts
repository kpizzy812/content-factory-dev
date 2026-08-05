/** Класс представления. Системные заводятся кодом и в БД не хранятся. */
export type SavedViewScope = 'system' | 'shared' | 'personal'

export interface SavedViewDto {
  id: number | string
  section: string
  name: string
  scope: SavedViewScope
  query: Record<string, unknown>
  columns: string[] | null
  ownerId: number | null
  ownerName: string | null
  updatedAt: string | null
}

export interface SavedViewInput {
  section: string
  name: string
  scope: Exclude<SavedViewScope, 'system'>
  query: Record<string, unknown>
  columns?: string[] | null
}

export const SAVED_VIEW_NAME_MAX = 60
export const SAVED_VIEW_MAX_PER_USER = 40
