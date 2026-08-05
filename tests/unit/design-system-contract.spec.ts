import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Инварианты дизайн-системы.
 *
 * Впереди перенос ~44 страниц. Если инвариант поедет сейчас, он размножится
 * по всему приложению и чинить придётся в сорока местах. Эти проверки дешёвые
 * и ловят ровно те ошибки, которые легко сделать по невнимательности.
 */
const root = process.cwd()
const file = (path: string) => readFileSync(resolve(root, path), "utf8")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(resolve(root, dir))) {
    const rel = join(dir, entry)
    if (statSync(resolve(root, rel)).isDirectory()) walk(rel, out)
    else out.push(rel.replace(/\\/g, "/"))
  }
  return out
}

const vueFiles = walk("app").filter(f => f.endsWith(".vue"))

describe("DaisyUI удалён", () => {
  it("нет плагина и тем в главной таблице стилей", () => {
    const css = file("app/assets/css/main.css")
    expect(css).not.toContain("daisyui")
    expect(css).not.toContain("@source inline")
  })

  it("нет в зависимостях", () => {
    const pkg = file("package.json")
    expect(pkg).not.toContain("daisyui")
  })
})

describe("токены", () => {
  const css = file("app/assets/css/main.css")

  it("определены в обеих темах", () => {
    expect(css).toContain("[data-theme=light]")
    for (const token of ["--color-surface", "--color-panel", "--color-card", "--color-border", "--color-accent"]) {
      // По одному объявлению на тёмную и светлую тему.
      const hits = css.split(`${token}:`).length - 1
      expect(hits, token).toBeGreaterThanOrEqual(2)
    }
  })

  it("статусные тона идут тройками текст/фон/граница", () => {
    for (const tone of ["neutral", "info", "success", "warning", "danger"]) {
      expect(css, tone).toContain(`--color-${tone}:`)
      expect(css, tone).toContain(`--color-${tone}-bg:`)
      expect(css, tone).toContain(`--color-${tone}-border:`)
    }
  })

  it("короткие алиасы ссылаются на исходные токены, а не дублируют значения", () => {
    // Дубль значения означал бы, что при смене темы алиас останется прежним:
    // переопределяется только исходный токен.
    for (const [alias, source] of [
      ["--color-fg", "--color-text"],
      ["--color-muted", "--color-text-muted"],
      ["--color-subtle", "--color-text-subtle"],
      ["--color-inverse", "--color-text-inverse"],
    ]) {
      const declaration = new RegExp(`${alias}:\\s*([^;]+);`).exec(css)
      expect(declaration, `нет объявления ${alias}`).not.toBeNull()
      expect(declaration![1]!.trim(), alias).toBe(`var(${source})`)
    }
  })

  it("плотности строк заданы явно", () => {
    expect(css).toContain("--row-h-text: 36px")
    expect(css).toContain("--row-h-media: 44px")
  })
})

describe("примитивы", () => {
  const uiFiles = vueFiles.filter(f => f.startsWith("app/components/ui/"))

  it("библиотека на месте", () => {
    expect(uiFiles.length).toBeGreaterThanOrEqual(30)
  })

  it("не знают про домен — иначе это уже не примитивы", () => {
    const domainWords = ["Тренд", "Сценари", "Конвейер", "trendwatcher", "pipeline"]
    for (const f of uiFiles) {
      const src = file(f)
      for (const word of domainWords) {
        expect(src.includes(word), `${f} упоминает ${word}`).toBe(false)
      }
    }
  })

  it("не тянут цвета мимо токенов", () => {
    // Единственное исключение — фирменные цвета площадок в бейдже платформы.
    for (const f of uiFiles.filter(f => !f.endsWith("UiPlatformBadge.vue"))) {
      const src = file(f)
      expect(src.match(/#[0-9a-fA-F]{6}\b/), `${f} содержит хардкодный цвет`).toBeNull()
    }
  })
})

describe("навигация", () => {
  it("структура задана в одном месте", () => {
    const nav = file("app/composables/useAppNavigation.ts")
    expect(nav).toContain("canAccessModule")
    expect(nav).toContain("canAdmin")

    // Оболочка и палитра только читают composable и не заводят свой список.
    for (const consumer of [
      "app/components/app/AppSidebar.vue",
      "app/components/app/AppTopbar.vue",
      "app/components/app/AppCommandPalette.vue",
    ]) {
      expect(file(consumer), consumer).toContain("useAppNavigation")
    }
  })

  it("не ссылается на несуществующие маршруты", () => {
    const nav = file("app/composables/useAppNavigation.ts")
    const routes = [...nav.matchAll(/to:\s*'([^']+)'/g)].map(m => m[1]!)
    expect(routes.length).toBeGreaterThan(10)

    const pages = walk("app/pages")
      .filter(f => f.endsWith(".vue"))
      .map(f => f.replace(/^app\/pages/, "").replace(/\/index\.vue$/, "").replace(/\.vue$/, ""))
      .map(p => (p === "" ? "/" : p))

    for (const route of routes) {
      const exists = pages.some(p => p === route || p.startsWith(`${route}/`))
      expect(exists, `нет страницы под ${route}`).toBe(true)
    }
  })
})

describe("временные витрины", () => {
  it("живут только в dev и удаляются перед мержем", () => {
    const mw = file("app/middleware/auth.global.ts")
    expect(mw).toContain("import.meta.dev")
    expect(mw).toContain('startsWith("/_")')

    for (const page of ["app/pages/_ui.vue", "app/pages/_shell.vue"]) {
      expect(file(page), page).toContain("этапе 7")
    }
  })
})
