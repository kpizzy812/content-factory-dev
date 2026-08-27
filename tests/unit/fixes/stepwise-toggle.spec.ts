/**
 * Пошаговый режим: чем его включают на КОНКРЕТНОМ ролике и что значит «отклонить».
 *
 * Task 6 сделал ожидание вне прогона, но включить режим на ролике было нечем:
 * `Video.stepwiseApproval` читался прогоном и писался только профилем приложения
 * либо прямой правкой БД. Здесь живёт чистая часть недостающей ручки — разбор
 * трёх состояний поля и вычисление того, что оператор увидит в интерфейсе.
 *
 * ТРИ СОСТОЯНИЯ, А НЕ ДВА. Поле сделано nullable намеренно (`resolveStepwiseEnabled`
 * и его докстринг): «оператор выключил на ролике» и «оператор ничего не выбирал»
 * обязаны различаться, иначе выключить режим, включённый профилем, нечем. Значит
 * и ручка обязана уметь передать `null` ОТЛИЧИМО от «поле не прислали»: в JSON
 * `null` — законное значение, а не отсутствие, и склеивать их через `?? null`
 * значило бы молча сбрасывать переопределение на каждом кривом запросе.
 *
 * Почему разбор вынесен из ручки сюда: это единственное место, где решается
 * судьба трёх состояний, и проверять его через поднятый Nuxt (`tests/api/**`)
 * ради `typeof body.stepwiseApproval` — несоразмерно. Ручка остаётся тонкой:
 * разбор здесь, запись в БД в `setVideoStepwiseApproval`.
 */
import { describe, expect, it } from "vitest"

import {
  AWAITING_OPERATOR_STATUS,
  describeStepwiseState,
  parseStepwiseOverride,
  resolveStepwiseEnabled,
} from "../../../server/utils/video-pipeline-stepwise"
import {
  CANCELABLE_VIDEO_STATUSES,
  RESUMABLE_VIDEO_STATUSES,
} from "../../../server/utils/video-pipeline-run-policy"

describe("разбор переопределения пошагового режима на ролике", () => {
  it("принимает все три состояния", () => {
    expect(parseStepwiseOverride({ stepwiseApproval: true })).toEqual({ ok: true, value: true })
    expect(parseStepwiseOverride({ stepwiseApproval: false })).toEqual({ ok: true, value: false })
    // null — это «наследовать профиль», а не «не прислали».
    expect(parseStepwiseOverride({ stepwiseApproval: null })).toEqual({ ok: true, value: null })
  })

  it("отличает пропущенное поле от явного null", () => {
    // Пустое тело — не «сбрось переопределение», а забытое поле. Молча трактовать
    // его как null значило бы стирать выбор оператора на каждом кривом запросе.
    const missing = parseStepwiseOverride({})
    expect(missing.ok).toBe(false)
    expect(missing.ok === false && missing.message).toMatch(/stepwiseApproval/)

    // Тела нет вовсе (readBody вернул null) — тот же случай.
    expect(parseStepwiseOverride(null).ok).toBe(false)
    expect(parseStepwiseOverride(undefined).ok).toBe(false)
    // undefined в самом поле — тоже «не прислали».
    expect(parseStepwiseOverride({ stepwiseApproval: undefined }).ok).toBe(false)
  })

  it("не принимает значения, похожие на булево", () => {
    // Строки и числа из формы приводить самим нельзя: "false" истинно в JS, и
    // оператор, выключивший режим, получил бы включённый.
    for (const raw of ["true", "false", 1, 0, "", "null", {}, []]) {
      const parsed = parseStepwiseOverride({ stepwiseApproval: raw })
      expect(parsed.ok, `значение ${JSON.stringify(raw)} должно быть отвергнуто`).toBe(false)
    }
  })
})

describe("что показать оператору про пошаговый режим ролика", () => {
  it("переопределение ролика сильнее профиля и так и подписано", () => {
    expect(describeStepwiseState({ videoOverride: true, profileStepwise: false })).toEqual({
      enabled: true,
      source: "video",
    })
    expect(describeStepwiseState({ videoOverride: false, profileStepwise: true })).toEqual({
      enabled: false,
      source: "video",
    })
  })

  it("без переопределения решает профиль", () => {
    expect(describeStepwiseState({ videoOverride: null, profileStepwise: true })).toEqual({
      enabled: true,
      source: "profile",
    })
    expect(describeStepwiseState({ videoOverride: null, profileStepwise: false })).toEqual({
      enabled: false,
      source: "profile",
    })
  })

  it("нет ни того, ни другого — режим выключен по умолчанию", () => {
    // Источник «default», а не «profile»: профиля нет вовсе, и подпись
    // «так решил монтажный профиль» была бы враньём в интерфейсе.
    expect(describeStepwiseState({ videoOverride: null, profileStepwise: null })).toEqual({
      enabled: false,
      source: "default",
    })
    expect(describeStepwiseState({ videoOverride: null, profileStepwise: undefined })).toEqual({
      enabled: false,
      source: "default",
    })
  })

  it("у ролика в ожидании есть выход через обычную отмену", () => {
    /**
     * Ролик в `awaiting_operator` — единственный статус, из которого нет НИ
     * автоматического, ни временнóго выхода: автопродолжения нет намеренно
     * (§9), watchdog его не трогает намеренно (он вне RESUMABLE_VIDEO_STATUSES).
     * Значит выход обязан быть ручным, и запретить отмену такому ролику —
     * значит запереть его навсегда.
     */
    expect(CANCELABLE_VIDEO_STATUSES).toContain(AWAITING_OPERATOR_STATUS)

    // И при этом он по-прежнему НЕ подхватывается watchdog'ом: отменяемость и
    // возобновляемость — разные списки, и путать их нельзя.
    expect(RESUMABLE_VIDEO_STATUSES).not.toContain(AWAITING_OPERATOR_STATUS)

    // Терминальные статусы отменять нечего — отменять можно только живое.
    for (const terminal of ["completed", "failed", "canceled"]) {
      expect(CANCELABLE_VIDEO_STATUSES).not.toContain(terminal)
    }
  })

  it("совпадает с тем, что решает сам прогон", () => {
    // describeStepwiseState — витрина для интерфейса, а не второе правило:
    // разойдись они, UI показывал бы одно, а прогон делал другое.
    const cases = [true, false, null].flatMap(videoOverride =>
      [true, false, null, undefined].map(profileStepwise => ({ videoOverride, profileStepwise })),
    )
    for (const input of cases) {
      expect(describeStepwiseState(input).enabled, JSON.stringify(input)).toBe(resolveStepwiseEnabled(input))
    }
  })
})
