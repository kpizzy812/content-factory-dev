/**
 * Standalone smoke-test для alert-dedup модуля.
 *
 * Симулирует 5 алёртов подряд для одной "прокси" и проверяет инварианты:
 * - shouldSendAlert возвращает true только на 1-м алёрте
 * - после quiet period shouldSendAlert снова true
 * - count корректно инкрементируется
 *
 * Запуск: bun run scripts/test-alert-dedup.ts
 */
import {
  shouldSendAlert,
  recordAlert,
  msUntilNextAlert,
  summarizeAlertHistory,
  type AlertHistory,
  type AlertReason,
} from "../server/utils/proxy/alert-dedup"

let passed = 0
let failed = 0

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

console.log("=== alert-dedup smoke test ===\n")

console.log("1) Пустая история — все категории разрешены")
{
  const history: AlertHistory | null = null
  const reasons: AlertReason[] = [
    "leak",
    "consecutive_failures_3",
    "auth_failed",
    "expired",
  ]
  for (const r of reasons) {
    assert(`shouldSendAlert(null, ${r}) = true`, shouldSendAlert(history, r))
  }
}

console.log("\n2) Первый алёрт leak записан → второй подавляется")
{
  let history: AlertHistory | null = null
  assert("shouldSendAlert(null, leak)", shouldSendAlert(history, "leak"))
  history = recordAlert(history, "leak")
  assert(
    "history.leak.count = 1 после первой записи",
    history.leak?.count === 1,
    `count=${history.leak?.count}`,
  )
  assert(
    "shouldSendAlert после recordAlert = false",
    !shouldSendAlert(history, "leak"),
  )
}

console.log("\n3) 5 подряд recordAlert — count = 5, всегда подавлен")
{
  let history: AlertHistory | null = null
  let allowedCount = 0
  for (let i = 0; i < 5; i += 1) {
    if (shouldSendAlert(history, "consecutive_failures_3")) {
      allowedCount += 1
      history = recordAlert(history, "consecutive_failures_3")
    }
  }
  assert(
    "из 5 попыток разрешена только 1 (первая)",
    allowedCount === 1,
    `allowedCount=${allowedCount}`,
  )
  assert(
    "history.consecutive_failures_3.count = 1",
    history?.consecutive_failures_3?.count === 1,
    `count=${history?.consecutive_failures_3?.count}`,
  )
}

console.log("\n4) Симуляция выхода из quiet period")
{
  const past = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
  const history: AlertHistory = {
    leak: { lastAt: past, count: 1 },
  }
  assert(
    "shouldSendAlert через 25 часов после quiet=24h",
    shouldSendAlert(history, "leak"),
  )

  const recent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const recentHistory: AlertHistory = {
    leak: { lastAt: recent, count: 1 },
  }
  assert(
    "shouldSendAlert через 2 часа после quiet=24h должен быть false",
    !shouldSendAlert(recentHistory, "leak"),
  )
}

console.log("\n5) Разные категории не блокируют друг друга")
{
  let history: AlertHistory | null = null
  history = recordAlert(history, "leak")
  assert(
    "leak записан → consecutive_failures_3 всё ещё разрешён",
    shouldSendAlert(history, "consecutive_failures_3"),
  )
  history = recordAlert(history, "consecutive_failures_3")
  assert(
    "оба записаны → leak подавлен",
    !shouldSendAlert(history, "leak"),
  )
  assert(
    "оба записаны → consecutive_failures_3 подавлен",
    !shouldSendAlert(history, "consecutive_failures_3"),
  )
}

console.log("\n6) msUntilNextAlert корректен")
{
  let history: AlertHistory | null = null
  assert(
    "msUntilNextAlert до первой записи = null",
    msUntilNextAlert(history, "leak") === null,
  )
  history = recordAlert(history, "leak")
  const remaining = msUntilNextAlert(history, "leak")
  assert(
    "msUntilNextAlert > 0 сразу после записи",
    remaining !== null && remaining > 0,
    `remaining=${remaining}`,
  )
  assert(
    "msUntilNextAlert <= 24h",
    remaining !== null && remaining <= 24 * 60 * 60 * 1000,
    `remaining=${remaining}`,
  )
}

console.log("\n7) summarizeAlertHistory")
{
  const history = recordAlert(
    recordAlert(null, "leak"),
    "auth_failed",
  )
  const summary = summarizeAlertHistory(history)
  assert("summary имеет 2 элемента", summary.length === 2)
  const byReason = Object.fromEntries(summary.map((s) => [s.reason, s]))
  assert("summary содержит leak", Boolean(byReason.leak))
  assert("summary содержит auth_failed", Boolean(byReason.auth_failed))
  assert(
    "summary не содержит expired (его не было)",
    !byReason.expired,
  )
}

console.log("\n8) Защита от мусора в БД")
{
  assert(
    "shouldSendAlert(undefined, leak) = true",
    shouldSendAlert(undefined, "leak"),
  )
  assert(
    "shouldSendAlert([], leak) = true (массив, не объект истории)",
    shouldSendAlert([], "leak"),
  )
  const corrupt: unknown = { leak: { lastAt: "not-a-date", count: 1 } }
  assert(
    "повреждённая дата → shouldSendAlert = true",
    shouldSendAlert(corrupt, "leak"),
  )
}

console.log(`\n=== Итог: ${passed} passed, ${failed} failed ===`)
process.exit(failed === 0 ? 0 : 1)
