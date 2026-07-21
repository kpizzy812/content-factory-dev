/**
 * Seed дефолтных глобальных WarmupKeywordPool.
 *
 * Запуск: bun run scripts/seed-warmup-keywords.ts (или bun run seed:warmup)
 *
 * Идемпотентен: проверяет наличие pool по уникальному name (не Prisma-уник, а findFirst).
 * Все pools — global (appId=null) и language=ru/en/null.
 */

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../app/generated/prisma/client"

const pool = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter: pool })

interface PoolSeed {
  name: string
  language: string | null
  category: string
  keywords: string[]
  hashtags?: string[]
}

const POOLS: PoolSeed[] = [
  {
    name: "general_en",
    language: "en",
    category: "general",
    keywords: [
      "fyp", "foryou", "viral", "trending", "explore", "tiktok", "reels",
      "shorts", "discover", "popular", "funny", "amazing", "wow", "cool",
      "best", "new", "today", "lifestyle", "daily", "routine", "vibes",
      "moment", "weekend", "morning", "evening", "summer", "winter",
      "spring", "autumn", "happy", "love", "friends", "family", "good",
      "creative", "art", "music", "dance", "comedy", "challenge", "tutorial",
      "tips", "review", "story", "vlog", "behindthescenes", "diy", "craft",
      "food", "travel",
    ],
    hashtags: ["#fyp", "#foryou", "#viral", "#trending", "#reels", "#shorts"],
  },
  {
    name: "general_ru",
    language: "ru",
    category: "general",
    keywords: [
      "рек", "врек", "втоп", "тренды", "новое", "популярное", "топ", "вирус",
      "смешно", "круто", "класс", "огонь", "лучшее", "красиво", "интересно",
      "жизнь", "будни", "выходные", "утро", "вечер", "лето", "зима", "весна",
      "осень", "счастье", "любовь", "друзья", "семья", "хорошо", "творчество",
      "искусство", "музыка", "танцы", "юмор", "челлендж", "лайфхак", "совет",
      "обзор", "история", "влог", "закулисье", "своимируками", "кулинария",
      "путешествие", "мода", "стиль", "красота", "уют", "дом", "отдых",
      "развлечение",
    ],
    hashtags: ["#рек", "#втоп", "#тренды", "#популярное"],
  },
  {
    name: "tech_en",
    language: "en",
    category: "tech",
    keywords: [
      "tech", "techtok", "coding", "programming", "developer", "software",
      "ai", "artificialintelligence", "machinelearning", "startup", "saas",
      "productivity", "app", "appdev", "ios", "android", "webdev", "frontend",
      "backend", "javascript", "python", "rust", "golang", "devops", "cloud",
      "aws", "azure", "googlecloud", "cybersecurity", "automation",
    ],
  },
  {
    name: "lifestyle_en",
    language: "en",
    category: "lifestyle",
    keywords: [
      "lifestyle", "wellness", "selfcare", "mindfulness", "meditation",
      "yoga", "morningroutine", "eveningroutine", "skincare", "beauty",
      "fashion", "ootd", "outfit", "style", "minimalism", "homedecor",
      "interior", "cozy", "aesthetic", "vibes", "moodboard", "journaling",
      "productivitytips", "selfimprovement", "mentalhealth",
    ],
  },
  {
    name: "fitness_en",
    language: "en",
    category: "fitness",
    keywords: [
      "fitness", "workout", "gym", "gymtok", "homeworkout", "training",
      "strength", "cardio", "yoga", "pilates", "hiit", "crossfit", "running",
      "cycling", "swimming", "nutrition", "diet", "mealprep", "protein",
      "weightloss", "musclebuilding", "transformation", "fitnessmotivation",
      "bodyweight", "calisthenics",
    ],
  },
  {
    name: "education_en",
    language: "en",
    category: "education",
    keywords: [
      "education", "learn", "learning", "study", "studytok", "studygram",
      "students", "school", "university", "college", "exams", "homework",
      "knowledge", "facts", "didyouknow", "history", "science", "math",
      "physics", "chemistry", "biology", "literature", "philosophy",
      "psychology", "languages", "english", "spanish", "french",
      "tutorial", "howto",
    ],
  },
  {
    name: "music_en",
    language: "en",
    category: "music",
    keywords: [
      "music", "musictok", "song", "songs", "newmusic", "indie", "pop",
      "rock", "hiphop", "rap", "edm", "electronic", "house", "techno",
      "lofi", "chill", "rnb", "jazz", "classical", "guitar", "piano",
      "vocals", "singer", "songwriter", "producer", "beatmaker",
      "remix", "cover", "playlist", "spotify",
    ],
  },
]

async function upsertPool(seed: PoolSeed): Promise<"created" | "skipped"> {
  const existing = await prisma.warmupKeywordPool.findFirst({
    where: { name: seed.name, appId: null },
    select: { id: true },
  })
  if (existing) {
    return "skipped"
  }
  await prisma.warmupKeywordPool.create({
    data: {
      name: seed.name,
      appId: null,
      language: seed.language,
      category: seed.category,
      keywords: seed.keywords,
      hashtags: seed.hashtags ?? [],
      isActive: true,
    },
  })
  return "created"
}

async function main() {
  console.log("=== Seeding WarmupKeywordPool ===")
  let created = 0
  let skipped = 0
  for (const pool of POOLS) {
    const result = await upsertPool(pool)
    console.log(`  ${result.toUpperCase()}: ${pool.name} (${pool.keywords.length} keywords)`)
    if (result === "created") created++
    else skipped++
  }
  console.log(`\nTotal: ${created} created, ${skipped} skipped (already exist).`)
  console.log("Seed complete.")
}

main()
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (e) => {
    console.error("Seed failed:", e)
    await prisma.$disconnect()
    process.exit(1)
  })
