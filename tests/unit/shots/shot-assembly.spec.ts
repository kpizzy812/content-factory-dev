import { describe, expect, it } from "vitest"

import { buildClipLaneAudioFilter, planShotAssembly } from "~~/server/utils/render"

const SHOTS = [
  { order: 0, startSec: 0, endSec: 1.8, path: "/a/shot_0.mp4" },
  { order: 1, startSec: 1.8, endSec: 3.6, path: "/a/shot_1.mp4" },
]

describe("решения кадровой сборки", () => {
  it("кадровый таймлайн задан — подгон длин под трек НЕ исполняется", () => {
    const plan = planShotAssembly({ shotTimeline: { shots: SHOTS, trackDurationSec: 3.6 }, clipVolumeWithVoiceover: 0, clips: [] })
    // Кадры по построению покрывают трек ровно: подгонять нечего, а лишний
    // проход тронул бы уже точные границы.
    expect(plan.usesClipTrackAlignment).toBe(false)
  })

  it("склейка идёт по кадрам в порядке order, а не по клипам сцен", () => {
    const plan = planShotAssembly({
      shotTimeline: { shots: [SHOTS[1]!, SHOTS[0]!], trackDurationSec: 3.6 },
      clipVolumeWithVoiceover: 0, clips: ["/a/scene_0.mp4"],
    })
    expect(plan.concatPaths).toEqual(["/a/shot_0.mp4", "/a/shot_1.mp4"])
  })

  it("дорожки картинки идут В НОЛЬ — иначе двойная речь с эхом (§6.4)", () => {
    const plan = planShotAssembly({ shotTimeline: { shots: SHOTS, trackDurationSec: 3.6 }, clipVolumeWithVoiceover: 0, clips: [] })
    expect(plan.clipLaneVolume).toBe(0)
  })

  it("субтитры на кадровом маршруте берутся из трека, а не из позиций клипов", () => {
    const plan = planShotAssembly({ shotTimeline: { shots: SHOTS, trackDurationSec: 3.6 }, clipVolumeWithVoiceover: 0, clips: [] })
    expect(plan.subtitleSource).toBe("shots")
  })

  it("кадрового таймлайна нет — поведение старого маршрута побайтово прежнее", () => {
    const plan = planShotAssembly({ clips: ["/a/scene_0.mp4", "/a/scene_1.mp4"], clipVolumeWithVoiceover: 0.3 })
    expect(plan.concatPaths).toEqual(["/a/scene_0.mp4", "/a/scene_1.mp4"])
    expect(plan.clipLaneVolume).toBe(0.3)
    expect(plan.subtitleSource).not.toBe("shots")
  })

  it("пустой кадровый таймлайн не превращается в пустую склейку молча", () => {
    expect(() => planShotAssembly({ shotTimeline: { shots: [], trackDurationSec: 3.6 }, clipVolumeWithVoiceover: 0, clips: [] }))
      .toThrow()
  })

  // Сверх брифа (Step 5 prose): shotTimeline и clipTrackAlignment — две разные
  // шкалы времени в одной сборке. Заданы одновременно — это ошибка
  // вызывающего, а не молчаливый приоритет одного над другим.
  it("shotTimeline и clipTrackAlignment заданы одновременно — ошибка вызывающего, бросает явно", () => {
    expect(() => planShotAssembly({
      shotTimeline: { shots: SHOTS, trackDurationSec: 3.6 },
      clipTrackAlignment: { alignedScenes: [], positionByOrder: new Map(), trackDurationSec: 3.6 },
      clipVolumeWithVoiceover: 0,
      clips: [],
    })).toThrow()
  })

  it("субтитры вне кадрового маршрута классифицируются как clips/legacy по hasSceneSubtitles", () => {
    const withScenes = planShotAssembly({ clips: ["/a/scene_0.mp4"], clipVolumeWithVoiceover: 0.3, hasSceneSubtitles: true })
    const withoutScenes = planShotAssembly({ clips: ["/a/scene_0.mp4"], clipVolumeWithVoiceover: 0.3, hasSceneSubtitles: false })
    expect(withScenes.subtitleSource).toBe("clips")
    expect(withoutScenes.subtitleSource).toBe("legacy")
  })

  // Фикс-раунд 1, Critical 1 (ревью): деградировавший кадр выпадает из `shots`
  // ВМЕСТЕ со своим интервалом. `amix duration=first` в assembleVideo обрежет
  // микс по видео короче трека — несколько секунд речи пропадут молча, а
  // ролик получит статус «готов». planShotAssembly обязана бросить, а не
  // тихо собрать короткую склейку под трек, который её не признаёт.
  describe("покрытие таймлайна — деградировавший кадр не укорачивает ролик молча", () => {
    it("кадры покрывают трек НЕ до конца (собственная фикстура задачи: 4 кадра на 9с при треке 11с) — бросает", () => {
      const shots = [
        { order: 0, startSec: 0, endSec: 2, path: "/a/shot_0.mp4" },
        { order: 1, startSec: 2, endSec: 5, path: "/a/shot_1.mp4" },
        { order: 3, startSec: 5, endSec: 7, path: "/a/shot_3.mp4" },
        { order: 4, startSec: 7, endSec: 9, path: "/a/shot_4.mp4" },
      ]
      expect(() => planShotAssembly({ shotTimeline: { shots, trackDurationSec: 11 }, clipVolumeWithVoiceover: 0, clips: [] }))
        .toThrow()
    })

    it("разрыв в середине таймлайна (не только в конце) — тоже бросает", () => {
      const shots = [
        { order: 0, startSec: 0, endSec: 2, path: "/a/shot_0.mp4" },
        // order 1 деградировал и выпал целиком — дыра [2,4) внутри трека.
        { order: 2, startSec: 4, endSec: 7, path: "/a/shot_2.mp4" },
      ]
      expect(() => planShotAssembly({ shotTimeline: { shots, trackDurationSec: 7 }, clipVolumeWithVoiceover: 0, clips: [] }))
        .toThrow()
    })

    it("разрыв в НАЧАЛЕ таймлайна (первый кадр не с нуля) — тоже бросает", () => {
      const shots = [{ order: 0, startSec: 1, endSec: 3, path: "/a/shot_0.mp4" }]
      expect(() => planShotAssembly({ shotTimeline: { shots, trackDurationSec: 3 }, clipVolumeWithVoiceover: 0, clips: [] }))
        .toThrow()
    })

    it("кадры покрывают трек целиком и встык — не бросает", () => {
      const shots = [
        { order: 0, startSec: 0, endSec: 2, path: "/a/shot_0.mp4" },
        { order: 1, startSec: 2, endSec: 5, path: "/a/shot_1.mp4" },
      ]
      expect(() => planShotAssembly({ shotTimeline: { shots, trackDurationSec: 5 }, clipVolumeWithVoiceover: 0, clips: [] }))
        .not.toThrow()
    })
  })

  // Important 3 (ревью): «дорожки картинки идут в ноль» с исходным `clipVolumeWithVoiceover: 0`
  // не отличает передачу значения насквозь от хардкода нуля в кадровой ветке — 0 совпадает с 0.
  // Ненулевое значение доказывает, что planShotAssembly не подменяет громкость, а передаёт её как есть.
  it("громкость дорожки кадров проходит НАСКВОЗЬ, а не подменяется хардкодом нуля (§6.4)", () => {
    const plan = planShotAssembly({ shotTimeline: { shots: SHOTS, trackDurationSec: 3.6 }, clipVolumeWithVoiceover: 0.42, clips: [] })
    expect(plan.clipLaneVolume).toBe(0.42)
  })

  // Important 3 (ревью фикс-раунда 1): «дорожки кадров в ноль» держалось только на
  // значении `ShotAssemblyPlan.clipLaneVolume` — сам ffmpeg-граф не проверялся ни
  // одним тестом, и литерал `volume=1.000` вместо переданной громкости проходил
  // всю чистую сьюту (2819 тестов) и живой DB-прогон незамеченным. Здесь строка
  // графа проверяется ДОСЛОВНО — это выход, который реально уйдёт в ffmpeg.
  describe("строка ffmpeg-фильтра дорожки клипов/кадров в миксе (§6.4)", () => {
    it("голос есть, громкость кадров 0 (кадровый маршрут) — глушится в ноль в САМОЙ СТРОКЕ фильтра", () => {
      expect(buildClipLaneAudioFilter({ hasVoiceover: true, clipLaneVolume: 0 })).toBe("[0:a]volume=0.000[va]")
    })

    it("голос есть, ненулевая громкость (старый маршрут, 0.3) — проходит насквозь в строку графа", () => {
      expect(buildClipLaneAudioFilter({ hasVoiceover: true, clipLaneVolume: 0.3 })).toBe("[0:a]volume=0.300[va]")
    })

    it("голоса нет — дорожка клипов на полную (1.0) независимо от clipLaneVolume", () => {
      expect(buildClipLaneAudioFilter({ hasVoiceover: false, clipLaneVolume: 0 })).toBe("[0:a]volume=1.000[va]")
    })

    it("точечный ducking по voicedIntervals — enable=between(...), а не сплошной volume", () => {
      const filter = buildClipLaneAudioFilter({
        hasVoiceover: true, clipLaneVolume: 0, voiceoverIntervals: [{ startSec: 1, endSec: 3 }],
      })
      expect(filter).toBe("[0:a]volume=0.000:enable='between(t,1.00,3.00)'[va]")
    })
  })
})
