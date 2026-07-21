/**
 * Pure-функция классификации возрастного бакета аккаунта по совокупности возраста
 * (createdAt) и числа публикаций (totalPostsPublished).
 *
 * Threshold'ы (закреплены архитектором):
 *   new:     ageDays < 7  ИЛИ  totalPostsPublished === 0
 *   warming: ageDays >= 7 && < 30  ИЛИ  totalPostsPublished < 10
 *   mature:  ageDays >= 30 && totalPostsPublished >= 10
 *
 * Реализация: сначала проверяем new (самый строгий), затем mature (только если оба
 * условия выполнены), иначе warming.
 */

import type { AccountAgeBucket } from "~~/shared/types/warmup"

export interface ClassifyAccountAgeInput {
  createdAt: Date
  totalPostsPublished: number
  /** Опционально: время «сейчас» для тестов. Default: new Date(). */
  now?: Date
}

export function classifyAccountAge(input: ClassifyAccountAgeInput): AccountAgeBucket {
  const now = input.now ?? new Date()
  const ageMs = now.getTime() - input.createdAt.getTime()
  const ageDays = Math.max(0, ageMs / (24 * 60 * 60 * 1000))

  if (ageDays < 7 || input.totalPostsPublished === 0) {
    return "new"
  }
  if (ageDays >= 30 && input.totalPostsPublished >= 10) {
    return "mature"
  }
  return "warming"
}
