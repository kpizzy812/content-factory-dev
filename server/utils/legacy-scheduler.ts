import { readLegacyModules } from "~~/shared/utils/legacy-modules"

type Env = Record<string, string | undefined>

/** Зона важнее старого флага: выключенная зона не поднимает воркер никогда. */
function enabled(env: Env, zone: boolean, legacyFlag: string): boolean {
  if (!zone) return false
  return env[legacyFlag] !== "false"
}

export function isPostingWorkerEnabled(env: Env): boolean {
  return enabled(env, readLegacyModules(env).deviceAutomation, "POSTING_WORKER_ENABLED")
}

export function isProxyHealthCheckEnabled(env: Env): boolean {
  return enabled(env, readLegacyModules(env).proxyPool, "PROXY_HEALTH_CHECK_ENABLED")
}

export function isGoogleDriveSchedulerEnabled(env: Env): boolean {
  return enabled(env, readLegacyModules(env).googleDrive, "GOOGLE_DRIVE_SCHEDULER_ENABLED")
}
