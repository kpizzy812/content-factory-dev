/**
 * Unit-тесты ADB-shell хелперов (Этап 3, P2) против in-process mock-сервера DuoPlus.
 *
 * Покрывает: parseUiNodes (XML→узлы + bounds/center), findNodes/findNode (фильтры),
 * dumpUi (uiautomator dump + cat → дерево), launchApp (monkey подтверждение),
 * tapNode/tapXY/inputText/keyevent (команды не бросают), dumpUiWithRetry.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createDuoplusMockServer,
  type DuoplusMockHandle,
} from "../../server/__mocks__/duoplus-server"
import { resetDuoplusClient } from "../../server/utils/posting-provider/duoplus-client"
import {
  dumpUi,
  dumpUiWithRetry,
  findNode,
  findNodes,
  inputText,
  keyevent,
  launchApp,
  parseUiNodes,
  tapNode,
  tapXY,
  type UiNode,
} from "../../server/automation/automation-engine/adb-shell"

const API_KEY = "test-key-from-env"
const IMAGE_ID = "M2Hxh"

const SAMPLE_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.google.android.youtube" bounds="[0,0][1080,1920]">
    <node index="0" resource-id="com.google.android.youtube:id/fab_create" content-desc="Create" class="android.widget.ImageView" text="" clickable="true" bounds="[480,1760][600,1880]" />
    <node index="1" resource-id="com.google.android.youtube:id/title" content-desc="" class="android.widget.TextView" text="Home" clickable="false" bounds="[40,80][300,140]" />
    <node index="2" resource-id="" content-desc="" class="android.widget.Button" text="Upload a video" clickable="true" bounds="[100,500][980,600]" />
  </node>
</hierarchy>`

describe("parseUiNodes / findNodes (pure)", () => {
  it("парсит плоский список узлов с bounds и center", () => {
    const nodes = parseUiNodes(SAMPLE_XML)
    // 4 узла с валидным bounds: корневой FrameLayout + 3 листа.
    expect(nodes).toHaveLength(4)
    const create = nodes.find((n) => n.contentDesc === "Create")!
    expect(create.resourceId).toBe("com.google.android.youtube:id/fab_create")
    expect(create.clickable).toBe(true)
    expect(create.bounds).toEqual({ x1: 480, y1: 1760, x2: 600, y2: 1880 })
    // center = середина bounds
    expect(create.center).toEqual({ x: 540, y: 1820 })
  })

  it("пропускает узлы без валидного bounds", () => {
    const xml = `<hierarchy><node text="no-bounds" /><node text="ok" bounds="[0,0][10,10]" /></hierarchy>`
    const nodes = parseUiNodes(xml)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.text).toBe("ok")
  })

  it("findNodes фильтрует по resourceId / text / contentDesc / textContains (AND)", () => {
    const nodes = parseUiNodes(SAMPLE_XML)
    expect(findNodes(nodes, { contentDesc: "Create" })).toHaveLength(1)
    expect(findNodes(nodes, { text: "Home" })).toHaveLength(1)
    expect(
      findNodes(nodes, { resourceId: "com.google.android.youtube:id/title" }),
    ).toHaveLength(1)
    expect(findNodes(nodes, { textContains: "upload" })).toHaveLength(1)
    // комбинация, которая не сходится
    expect(findNodes(nodes, { text: "Home", contentDesc: "Create" })).toHaveLength(0)
  })

  it("findNode возвращает первый узел или null", () => {
    const nodes = parseUiNodes(SAMPLE_XML)
    const found: UiNode | null = findNode(nodes, { contentDesc: "Create" })
    expect(found).not.toBeNull()
    expect(findNode(nodes, { text: "does-not-exist" })).toBeNull()
  })
})

describe("ADB-shell хелперы (mock-сервер)", () => {
  let mock: DuoplusMockHandle

  beforeEach(async () => {
    mock = await createDuoplusMockServer({ powerOnTicks: 1 })
    // Хелперы используют синглтон getDuoplusClient(), который резолвит base/ключ
    // из env. Направляем синглтон на mock через mock-режим env + сброс синглтона.
    process.env.DUOPLUS_MOCK_MODE = "true"
    process.env.DUOPLUS_MOCK_URL = mock.baseUrl
    process.env.DUOPLUS_API_KEY = API_KEY
    resetDuoplusClient()
  })

  afterEach(async () => {
    resetDuoplusClient()
    delete process.env.DUOPLUS_MOCK_MODE
    delete process.env.DUOPLUS_MOCK_URL
    delete process.env.DUOPLUS_API_KEY
    await mock.close()
  })

  it("dumpUi: uiautomator dump + cat → дерево узлов с Create", async () => {
    const nodes = await dumpUi(IMAGE_ID)
    expect(nodes.length).toBeGreaterThan(0)
    expect(findNode(nodes, { contentDesc: "Create" })).not.toBeNull()
  })

  it("dumpUiWithRetry возвращает дерево с достаточным числом узлов", async () => {
    const nodes = await dumpUiWithRetry(IMAGE_ID, { retries: 3, minNodes: 1 })
    expect(nodes.length).toBeGreaterThanOrEqual(1)
  })

  it("launchApp: monkey подтверждает 'Events injected: 1'", async () => {
    await expect(launchApp(IMAGE_ID, "com.google.android.youtube")).resolves.toBeUndefined()
  })

  it("tapXY / tapNode / inputText / keyevent не бросают на happy-path", async () => {
    const nodes = await dumpUi(IMAGE_ID)
    const create = findNode(nodes, { contentDesc: "Create" })!
    await expect(tapNode(IMAGE_ID, create)).resolves.toBeUndefined()
    await expect(tapXY(IMAGE_ID, 100, 200)).resolves.toBeUndefined()
    await expect(inputText(IMAGE_ID, "hello world")).resolves.toBeUndefined()
    await expect(keyevent(IMAGE_ID, 66)).resolves.toBeUndefined()
  })

  it("inputText: ASCII идёт нативным `input text` (быстрый путь)", async () => {
    await expect(inputText(IMAGE_ID, "hello world")).resolves.toBeUndefined()
    // mock декодирует input text → запомненный caption (пробел через %s).
    expect(mock.devices.get(IMAGE_ID)!._ytCaption).toBe("hello world")
  })

  it("inputText: кириллица+эмодзи идут через ADBKeyboard (base64), без NPE", async () => {
    // Нативный `input text` тут падал бы NPE «length of null array» — не-ASCII.
    const text = "Как создать трек за 30 секунд 🎬"
    await expect(inputText(IMAGE_ID, text)).resolves.toBeUndefined()
    // Через ADB_INPUT_B64 текст дошёл в исходном Unicode-виде.
    expect(mock.devices.get(IMAGE_ID)!._ytCaption).toBe(text)
  })

  it("inputText: пустой/пробельный текст не шлёт команду (guard от NPE)", async () => {
    await expect(inputText(IMAGE_ID, "")).resolves.toBeUndefined()
    await expect(inputText(IMAGE_ID, "   ")).resolves.toBeUndefined()
  })
})
