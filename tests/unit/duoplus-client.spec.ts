/**
 * Unit-тесты DuoPlus REST-клиента (Этап 3, P1) против in-process mock-сервера.
 *
 * Покрывает: list / powerOn / command happy-path, sshExecError → DuoplusCommandError,
 * device_offline → fail[], retry на 5xx, ключ только из env (через явный override),
 * powerOn-эмуляция перехода статуса 2→10→1 с появлением adb-адреса.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createServer, type Server } from "node:http"
import {
  createDuoplusMockServer,
  DUOPLUS_STATUS,
  type DuoplusMockHandle,
} from "../../server/__mocks__/duoplus-server"
import {
  DuoplusApiError,
  DuoplusClient,
  DuoplusCommandError,
} from "../../server/utils/posting-provider/duoplus-client"
import { DUOPLUS_DEVICE_STATUS } from "../../server/utils/posting-provider/duoplus-types"

const API_KEY = "test-key-from-env"

describe("DuoplusClient (mock)", () => {
  let mock: DuoplusMockHandle
  let client: DuoplusClient

  beforeEach(async () => {
    mock = await createDuoplusMockServer({ powerOnTicks: 1 })
    client = new DuoplusClient({ baseUrl: mock.baseUrl, apiKey: API_KEY })
  })

  afterEach(async () => {
    await mock.close()
  })

  it("listCloudPhones возвращает устройства из mock-аккаунта", async () => {
    const devices = await client.listCloudPhones()
    expect(devices).toHaveLength(2)
    expect(devices.map((d) => d.id)).toContain("M2Hxh")
    const first = devices.find((d) => d.id === "M2Hxh")!
    expect(first.os).toBe("Android 15")
    expect(first.status).toBe(DUOPLUS_DEVICE_STATUS.OFF)
    // У выключенного устройства adb пуст.
    expect(first.adb).toBe("")
  })

  it("powerOn: success[] содержит id, статус переходит 2→10→1 с появлением adb", async () => {
    const result = await client.powerOn(["M2Hxh"])
    expect(result.success).toContain("M2Hxh")
    expect(result.fail).toHaveLength(0)

    // Сразу после powerOn — статус POWERING_ON (10), adb ещё пуст.
    let list = await client.listCloudPhones()
    let dev = list.find((d) => d.id === "M2Hxh")!
    // powerOnTicks=1 → первый list декрементит тик, второй переводит в ON.
    expect([DUOPLUS_STATUS.POWERING_ON, DUOPLUS_STATUS.ON]).toContain(dev.status)

    // Поллим до ON.
    for (let i = 0; i < 5 && dev.status !== DUOPLUS_DEVICE_STATUS.ON; i += 1) {
      list = await client.listCloudPhones()
      dev = list.find((d) => d.id === "M2Hxh")!
    }
    expect(dev.status).toBe(DUOPLUS_DEVICE_STATUS.ON)
    // После ON — adb-адрес заполнен.
    expect(dev.adb).toMatch(/^\d+\.\d+\.\d+\.\d+:\d+$/)
  })

  it("powerOff возвращает устройство в OFF и очищает adb", async () => {
    await client.powerOn(["M2Hxh"])
    // прогнать до ON
    for (let i = 0; i < 5; i += 1) await client.listCloudPhones()
    const off = await client.powerOff(["M2Hxh"])
    expect(off.success).toContain("M2Hxh")
    const dev = (await client.listCloudPhones()).find((d) => d.id === "M2Hxh")!
    expect(dev.status).toBe(DUOPLUS_DEVICE_STATUS.OFF)
    expect(dev.adb).toBe("")
  })

  it("command happy-path: echo возвращает stdout", async () => {
    const out = await client.command("M2Hxh", "echo ok")
    expect(out).toBe("ok")
  })

  it("command: monkey-запуск содержит 'Events injected: 1'", async () => {
    const out = await client.command(
      "M2Hxh",
      "monkey -p com.google.android.youtube -c android.intent.category.LAUNCHER 1",
    )
    expect(out).toContain("Events injected: 1")
  })

  it("command: uiautomator dump → cat отдаёт валидный UI-XML", async () => {
    const out = await client.command("M2Hxh", "cat /sdcard/window_dump.xml")
    expect(out).toContain("<hierarchy")
    expect(out).toContain("content-desc=\"Create\"")
  })

  it("sshExecError: data.success:false → DuoplusCommandError (HTTP всё равно 200)", async () => {
    const errMock = await createDuoplusMockServer({ defaultScenario: "sshExecError" })
    const errClient = new DuoplusClient({ baseUrl: errMock.baseUrl, apiKey: API_KEY })
    await expect(errClient.command("M2Hxh", "sleep 6")).rejects.toBeInstanceOf(DuoplusCommandError)
    try {
      await errClient.command("M2Hxh", "sleep 6")
    } catch (e) {
      expect((e as DuoplusCommandError).message).toMatch(/sshExecError/)
    }
    await errMock.close()
  })

  it("device_offline: powerOn кладёт id в fail[]", async () => {
    const offMock = await createDuoplusMockServer({ defaultScenario: "device_offline" })
    const offClient = new DuoplusClient({ baseUrl: offMock.baseUrl, apiKey: API_KEY })
    const result = await offClient.powerOn(["M2Hxh"])
    expect(result.fail).toContain("M2Hxh")
    expect(result.success).toHaveLength(0)
    await offMock.close()
  })

  it("initProxy happy-path возвращает success:true", async () => {
    const res = await client.initProxy("M2Hxh", { proxyId: "p1" })
    expect(res.success).toBe(true)
  })
})

describe("DuoplusClient: env-ключ и retry", () => {
  it("без DUOPLUS_API_KEY клиент бросает DuoplusApiError (ключ обязателен из env)", async () => {
    const mock = await createDuoplusMockServer()
    // Явно пустой ключ имитирует отсутствие env.
    const client = new DuoplusClient({ baseUrl: mock.baseUrl, apiKey: "" })
    await expect(client.listCloudPhones()).rejects.toBeInstanceOf(DuoplusApiError)
    await mock.close()
  })

  it("retry на 5xx: после 2 сбоев успех на 3-й попытке", async () => {
    let calls = 0
    const flaky: Server = createServer((req, res) => {
      calls += 1
      if (calls <= 2) {
        res.statusCode = 503
        res.end(JSON.stringify({ code: 503, data: null, message: "unavailable" }))
        return
      }
      res.statusCode = 200
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({
        code: 200,
        data: { list: [], page: 1, pagesize: 20, total: 0, total_page: 1 },
        message: "Success",
      }))
    })
    const port = await new Promise<number>((resolve) => {
      flaky.listen(0, () => {
        const addr = flaky.address()
        resolve(typeof addr === "object" && addr ? addr.port : 0)
      })
    })
    const client = new DuoplusClient({ baseUrl: `http://localhost:${port}`, apiKey: API_KEY })
    const devices = await client.listCloudPhones()
    expect(devices).toEqual([])
    expect(calls).toBe(3)
    await new Promise<void>((resolve) => flaky.close(() => resolve()))
  })
})
