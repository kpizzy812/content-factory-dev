/**
 * Pipeline node: character.
 *
 * Source-нода (без upstream input по контракту). Резолвит Character из библиотеки app'a
 * по config'у и выпускает его на output для downstream нод (scenario, video, scene_composer).
 *
 * Config:
 *   - appId: number — обязательно
 *   - characterId: string — если задан, берём конкретного. Иначе — выбор по mode.
 *   - mode: 'fixed' | 'random' | 'first' — стратегия выбора если characterId нет
 *   - tag?: string — фильтр по тегу при mode=random/first
 *
 * Output:
 *   {
 *     character: { id, name, description, role, visualPrompt, tags, referenceImages },
 *     characterId: string,
 *     characterVisualPrompt: string,
 *     characterReferenceImageUrls: string[],
 *   }
 *
 * NO-DATA сценарии: персонажей нет в app пуле, characterId задан но архивирован/удалён.
 */

export async function executeCharacterNode(
  config: Record<string, unknown>,
  _input: Record<string, unknown>,
  _signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const appId = Number(config.appId)
  if (!appId || Number.isNaN(appId)) {
    return {
      character: null,
      _noData: true,
      _noDataReason: "appId не задан в конфиге ноды",
      _domainStatus: "no_data",
    }
  }

  const characterId = typeof config.characterId === "string" && config.characterId ? config.characterId : null
  const mode = (typeof config.mode === "string" ? config.mode : "fixed") as "fixed" | "random" | "first"
  const tag = typeof config.tag === "string" && config.tag ? config.tag : null

  // Прямая выборка по characterId
  if (characterId) {
    const c = await prisma.character.findUnique({
      where: { id: characterId },
      include: {
        referenceImages: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
      },
    })
    if (!c || c.archived) {
      return {
        character: null,
        _noData: true,
        _noDataReason: c
          ? `Персонаж ${characterId} в архиве`
          : `Персонаж ${characterId} не найден`,
        _domainStatus: "no_data",
      }
    }
    if (c.appId !== appId) {
      return {
        character: null,
        _noData: true,
        _noDataReason: `Персонаж ${characterId} принадлежит другому приложению (${c.appId})`,
        _domainStatus: "no_data",
      }
    }
    return buildOutput(c)
  }

  // Подборка из пула app'a
  const pool = await prisma.character.findMany({
    where: {
      appId,
      archived: false,
      ...(tag ? { tags: { has: tag } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: { referenceImages: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] } },
  })
  if (pool.length === 0) {
    return {
      character: null,
      _noData: true,
      _noDataReason: tag
        ? `В app=${appId} нет персонажей с тегом '${tag}'`
        : `В app=${appId} нет персонажей в библиотеке`,
      _domainStatus: "no_data",
    }
  }
  const picked = mode === "random" ? pool[Math.floor(Math.random() * pool.length)]! : pool[0]!
  return buildOutput(picked)
}

type CharacterWithRefs = Awaited<ReturnType<typeof prisma.character.findUnique>> & {
  referenceImages: Array<{
    id: string
    kind: string
    fileUrl: string
    storageKey: string | null
    width: number | null
    height: number | null
    aiVisualDescription?: string | null
    aiCaption?: string | null
    aiTags?: string[]
  }>
}

function buildOutput(c: CharacterWithRefs): Record<string, unknown> {
  const referenceImages = (c.referenceImages ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    fileUrl: r.fileUrl,
    storageKey: r.storageKey,
    width: r.width,
    height: r.height,
    aiVisualDescription: r.aiVisualDescription ?? null,
    aiCaption: r.aiCaption ?? null,
    aiTags: r.aiTags ?? [],
  }))
  // Если есть AI-описание у любого реф-фото — объединяем в финальный characterVisualPrompt
  // (это та строка которую downstream scenario/video может класть в финальный prompt).
  const aiDescriptions = referenceImages
    .map((r) => r.aiVisualDescription)
    .filter((s): s is string => Boolean(s && s.trim()))
  const finalVisualPrompt = aiDescriptions.length > 0
    ? `${c.visualPrompt ?? c.description ?? c.name}. ${aiDescriptions.join("; ")}`
    : (c.visualPrompt ?? c.description ?? c.name)
  const character = {
    id: c.id,
    appId: c.appId,
    name: c.name,
    description: c.description,
    role: c.role,
    visualPrompt: c.visualPrompt,
    tags: c.tags,
    emotionDefault: c.emotionDefault,
    ageRange: c.ageRange,
    referenceImages,
    aiVisualDescriptions: aiDescriptions,
  }
  return {
    character,
    characterId: c.id,
    characterVisualPrompt: finalVisualPrompt,
    characterReferenceImageUrls: referenceImages.map((r) => r.fileUrl),
    _domainStatus: "success",
  }
}
