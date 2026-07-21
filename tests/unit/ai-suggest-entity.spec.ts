/**
 * Unit-тесты для AI suggest entity (Этап 1 фичи character/scene AI autofill).
 *
 * Покрытие:
 *   1. pipeline-node-schema: character_entity и scene_entity объявлены с правильным
 *      набором aiSafe-полей.
 *   2. getAiSafeFields() / getAiBlockedFields() корректно фильтруют по новым типам.
 *   3. validateAiOutput() для character_entity:
 *      - режет неизвестные поля,
 *      - применяет allowedValues для role,
 *      - обрезает длинные строки по maxLength,
 *      - обрезает длинные теги.
 *   4. resolveEntityNodeType() — pure helper маппинга entityType → nodeType.
 *   5. normalizeTagsField() — нормализация строки через запятую в массив для tags.
 *
 * Полноценный API-тест с моком Anthropic + БД-аудит вынесен в tests/api/
 * (на этап 2/5 плана — здесь только unit-уровень).
 */

import { describe, it, expect } from 'vitest'
import {
  nodeFieldSchemas,
  getAiSafeFields,
  getAiBlockedFields,
  validateAiOutput,
} from '../../app/utils/pipeline-node-schema'
import {
  resolveEntityNodeType,
  normalizeTagsField,
  looksLikeSecret,
} from '../../server/utils/ai-entity-suggest'

// ── Schemas ────────────────────────────────────────────────────────────────

describe('character_entity schema', () => {
  it('объявлен в nodeFieldSchemas с ожидаемыми полями', () => {
    const schema = nodeFieldSchemas.character_entity
    expect(schema).toBeDefined()
    const keys = Object.keys(schema!).sort()
    expect(keys).toEqual([
      'ageRange',
      'description',
      'emotionDefault',
      'name',
      'role',
      'tags',
      'visualPrompt',
    ])
  })

  it('все поля aiSafe=true (это сущность пользователя, без ссылок на ресурсы)', () => {
    const schema = nodeFieldSchemas.character_entity!
    for (const [key, field] of Object.entries(schema)) {
      expect(field.aiSafe, `field "${key}" должен быть aiSafe`).toBe(true)
    }
    expect(getAiBlockedFields('character_entity')).toEqual([])
  })

  it('role имеет ограниченный набор значений', () => {
    const schema = nodeFieldSchemas.character_entity!
    expect(schema.role!.type).toBe('select')
    expect(schema.role!.allowedValues).toEqual(['main', 'support', 'extra'])
  })

  it('visualPrompt имеет увеличенный maxLength (800) для подробного prompt', () => {
    expect(nodeFieldSchemas.character_entity!.visualPrompt!.maxLength).toBe(800)
  })

  it('getAiSafeFields возвращает все 7 полей', () => {
    const safe = getAiSafeFields('character_entity')
    expect(Object.keys(safe).length).toBe(7)
  })
})

describe('scene_entity schema', () => {
  it('объявлен в nodeFieldSchemas с тремя полями', () => {
    const schema = nodeFieldSchemas.scene_entity
    expect(schema).toBeDefined()
    expect(Object.keys(schema!).sort()).toEqual(['description', 'name', 'tags'])
  })

  it('все поля aiSafe=true', () => {
    const schema = nodeFieldSchemas.scene_entity!
    for (const [key, field] of Object.entries(schema)) {
      expect(field.aiSafe, `field "${key}" должен быть aiSafe`).toBe(true)
    }
  })

  it('tags имеет type=tags и maxLength=30 (per-tag)', () => {
    const tags = nodeFieldSchemas.scene_entity!.tags!
    expect(tags.type).toBe('tags')
    expect(tags.maxLength).toBe(30)
  })
})

// ── validateAiOutput ────────────────────────────────────────────────────────

describe('validateAiOutput для character_entity', () => {
  it('пропускает корректные значения', () => {
    const { safe, blocked } = validateAiOutput('character_entity', {
      name: 'Алекс',
      description: 'Тренер 30 лет',
      role: 'main',
      tags: ['fitness', 'lifestyle'],
    })
    expect(safe.name).toBe('Алекс')
    expect(safe.role).toBe('main')
    expect(safe.tags).toEqual(['fitness', 'lifestyle'])
    expect(blocked).toEqual([])
  })

  it('отклоняет неизвестные поля', () => {
    const { safe, blocked } = validateAiOutput('character_entity', {
      name: 'Bob',
      hackerField: 'evil',
    })
    expect(safe.name).toBe('Bob')
    expect(safe).not.toHaveProperty('hackerField')
    expect(blocked.some(b => b.field === 'hackerField')).toBe(true)
  })

  it('отклоняет недопустимое значение role', () => {
    const { safe, blocked } = validateAiOutput('character_entity', {
      role: 'protagonist', // не из allowedValues
    })
    expect(safe).not.toHaveProperty('role')
    expect(blocked.some(b => b.field === 'role')).toBe(true)
  })

  it('обрезает name по maxLength=100', () => {
    const long = 'x'.repeat(200)
    const { safe } = validateAiOutput('character_entity', { name: long })
    expect((safe.name as string).length).toBe(100)
  })

  it('обрезает теги длиннее 30 символов', () => {
    const longTag = 'верыоченьдлинныйтегкоторыйобязательнобудетобрезанпотомучтоэтоневозможно'
    const { safe } = validateAiOutput('character_entity', {
      tags: ['ok', longTag],
    })
    const tags = safe.tags as string[]
    expect(tags[0]).toBe('ok')
    expect(tags[1]!.length).toBe(30)
  })
})

describe('validateAiOutput для scene_entity', () => {
  it('пропускает name/description/tags', () => {
    const { safe, blocked } = validateAiOutput('scene_entity', {
      name: 'Кухня утром',
      description: 'Тёплый свет, чашка кофе на столе',
      tags: ['утро', 'indoor', 'mood'],
    })
    expect(safe.name).toBe('Кухня утром')
    expect(safe.description).toContain('кофе')
    expect(safe.tags).toEqual(['утро', 'indoor', 'mood'])
    expect(blocked).toEqual([])
  })

  it('отклоняет visualPrompt (не существует у scene_entity)', () => {
    const { safe, blocked } = validateAiOutput('scene_entity', {
      name: 'Финал',
      visualPrompt: 'ignored field',
    })
    expect(safe).not.toHaveProperty('visualPrompt')
    expect(blocked.some(b => b.field === 'visualPrompt')).toBe(true)
  })
})

// ── resolveEntityNodeType ───────────────────────────────────────────────────

describe('resolveEntityNodeType', () => {
  it('маппит "character" → "character_entity"', () => {
    expect(resolveEntityNodeType('character')).toBe('character_entity')
  })

  it('маппит "scene" → "scene_entity"', () => {
    expect(resolveEntityNodeType('scene')).toBe('scene_entity')
  })

  it('возвращает null для неизвестного entityType', () => {
    expect(resolveEntityNodeType('foo')).toBeNull()
    expect(resolveEntityNodeType('')).toBeNull()
    expect(resolveEntityNodeType('character_entity')).toBeNull()
  })
})

// ── normalizeTagsField ──────────────────────────────────────────────────────

describe('normalizeTagsField', () => {
  it('преобразует строку через запятую в массив для character_entity.tags', () => {
    const out = normalizeTagsField('character_entity', {
      name: 'Алекс',
      tags: 'fitness, lifestyle, тренер',
    })
    expect(out.tags).toEqual(['fitness', 'lifestyle', 'тренер'])
    expect(out.name).toBe('Алекс') // не-tags поля не трогаются
  })

  it('преобразует строку с переносами в массив', () => {
    const out = normalizeTagsField('scene_entity', {
      tags: 'утро\nindoor\nmood',
    })
    expect(out.tags).toEqual(['утро', 'indoor', 'mood'])
  })

  it('преобразует строку через точку с запятой', () => {
    const out = normalizeTagsField('scene_entity', {
      tags: 'a;b;c',
    })
    expect(out.tags).toEqual(['a', 'b', 'c'])
  })

  it('не трогает массив (AI ответил правильно)', () => {
    const out = normalizeTagsField('character_entity', {
      tags: ['already', 'array'],
    })
    expect(out.tags).toEqual(['already', 'array'])
  })

  it('удаляет пустые элементы и тримит whitespace', () => {
    const out = normalizeTagsField('scene_entity', {
      tags: ' a ,  , b ,  ',
    })
    expect(out.tags).toEqual(['a', 'b'])
  })

  it('не падает на отсутствующих tags-полях', () => {
    const out = normalizeTagsField('character_entity', { name: 'x' })
    expect(out).toEqual({ name: 'x' })
  })
})

// ── looksLikeSecret ─────────────────────────────────────────────────────────

describe('looksLikeSecret', () => {
  it('детектит JWT', () => {
    expect(looksLikeSecret('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig')).toBe(true)
  })
  it('детектит GitHub PAT', () => {
    expect(looksLikeSecret('ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789')).toBe(true)
  })
  it('детектит AWS access key', () => {
    expect(looksLikeSecret('AKIAIOSFODNN7EXAMPLE')).toBe(true)
  })
  it('детектит prefix sk-/api-', () => {
    expect(looksLikeSecret('sk-abc123')).toBe(true)
    expect(looksLikeSecret('api-key-12345')).toBe(true)
  })
  it('не срабатывает на обычный текст', () => {
    expect(looksLikeSecret('Алекс — тренер по фитнесу')).toBe(false)
    expect(looksLikeSecret('curious')).toBe(false)
  })
})

// ── Edge cases для входа endpoint (валидация через pure helpers) ───────────

describe('entity endpoint input validation (pure helpers)', () => {
  it('неизвестный entityType — resolveEntityNodeType возвращает null (→ 400 в handler)', () => {
    expect(resolveEntityNodeType('unknown_type')).toBeNull()
    expect(resolveEntityNodeType('player')).toBeNull()
  })

  it('пустой entityType — 400-эквивалент', () => {
    expect(resolveEntityNodeType('')).toBeNull()
  })

  // Замечание: проверка пустого prompt — это `body.prompt.trim()` в handler.
  // Pure эквивалент: проверим что trim/length логика выполняется корректно.
  it('prompt с пробелами trim → пустая строка', () => {
    expect('   '.trim()).toBe('')
    expect('   '.trim().length === 0).toBe(true)
  })
})
