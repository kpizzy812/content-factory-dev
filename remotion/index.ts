/**
 * Точка входа слоя инфографики. Её ищет `server/utils/remotion/render.ts`;
 * отсутствие файла означает «слой не собран», и ролик выходит без графики.
 */

import { registerRoot } from 'remotion'

import { RemotionRoot } from './Root'

registerRoot(RemotionRoot)
