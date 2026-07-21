/**
 * Временный скрипт для visual audit Google Drive страницы.
 * Удаляется после аудита.
 */
import { chromium, type BrowserContext } from 'playwright'
import path from 'node:path'

const BASE_URL = 'http://localhost:3000'
const TEST_AUTH_TOKEN = 'e2e-visual-token-2026'
const SCREENSHOT_DIR = path.resolve('tests/visual/screenshots/2026-05-06-google-drive')

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 800 },
  { name: '375', width: 375, height: 812 },
]

// Авторизуемся через node fetch, получаем cookie header
async function getSessionCookie(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/_test/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-auth-token': TEST_AUTH_TOKEN,
    },
    body: JSON.stringify({ email: 'visual-audit@test.local', rolePreset: 'admin', canAdmin: true }),
  })
  const setCookieHeader = res.headers.get('set-cookie')
  if (!setCookieHeader) throw new Error('No set-cookie header from login')
  // Вернём только первую часть до первой ';'
  return setCookieHeader.split(';')[0] ?? ''
}

async function makeContext(browser: Awaited<ReturnType<typeof chromium.launch>>, width: number, height: number, cookie: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width, height },
  })
  // Устанавливаем cookie напрямую в контекст
  const [name, ...rest] = cookie.split('=')
  if (name && rest.length > 0) {
    await ctx.addCookies([{
      name: name.trim(),
      value: rest.join('=').trim(),
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
    }])
  }
  return ctx
}

async function main() {
  console.log('Получаем session cookie...')
  const cookie = await getSessionCookie()
  console.log(`Cookie: ${cookie.slice(0, 40)}...`)

  const browser = await chromium.launch({ headless: true })

  // --- Сценарии A и C (empty state — нет credentials у тестового юзера изначально) ---
  for (const vp of VIEWPORTS) {
    const ctx = await makeContext(browser, vp.width, vp.height, cookie)
    const page = await ctx.newPage()

    // A: Empty state
    await page.goto(`${BASE_URL}/google-drive`, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${SCREENSHOT_DIR}/A-empty-${vp.name}.png`, fullPage: true })
    console.log(`[OK] A-empty-${vp.name}.png`)

    // C: Setup modal открыт
    const connectBtn = page.getByRole('button', { name: /Подключить Drive/i })
    const connectBtnVisible = await connectBtn.isVisible().catch(() => false)
    if (connectBtnVisible) {
      await connectBtn.click()
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${SCREENSHOT_DIR}/C-modal-${vp.name}.png` })
      console.log(`[OK] C-modal-${vp.name}.png`)
      const cancelBtn = page.getByRole('button', { name: /Отмена/i })
      if (await cancelBtn.isVisible().catch(() => false)) await cancelBtn.click()
      await page.waitForTimeout(300)
    } else {
      // Если уже есть credentials - кнопки «Подключить» нет на empty state
      // Ищем в DriveCredentialsSection кнопку «Добавить»
      const addBtn = page.getByRole('button', { name: /Добавить/i })
      if (await addBtn.isVisible().catch(() => false)) {
        await addBtn.click()
        await page.waitForTimeout(600)
        await page.screenshot({ path: `${SCREENSHOT_DIR}/C-modal-${vp.name}.png` })
        console.log(`[OK] C-modal-${vp.name}.png (via Add)`)
        const cancelBtn = page.getByRole('button', { name: /Отмена/i })
        if (await cancelBtn.isVisible().catch(() => false)) await cancelBtn.click()
      } else {
        console.log(`[SKIP] C-modal-${vp.name}.png — кнопка подключения не найдена`)
      }
    }

    await page.close()
    await ctx.close()
  }

  // Создаём Drive credential через API
  console.log('\nСоздаём Drive credential через API...')
  const mockSA = JSON.stringify({
    type: 'service_account',
    project_id: 'visual-audit-project',
    private_key_id: 'key-id-001',
    private_key: '-----BEGIN RSA PRIVATE KEY-----\nMockPrivateKeyForVisualAudit\n-----END RSA PRIVATE KEY-----\n',
    client_email: 'visual-audit@visual-audit-project.iam.gserviceaccount.com',
    client_id: '123456789',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'http://localhost:18889/token',
  })

  // Парсим cookie для header
  const cookieHeader = cookie

  const createRes = await fetch(`${BASE_URL}/api/pipelines/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      name: 'Visual Audit Drive',
      description: 'Тестовый credential для visual audit',
      type: 'custom',
      secretData: { json: mockSA },
      metadata: {
        kind: 'google_drive_service_account',
        clientEmail: 'visual-audit@visual-audit-project.iam.gserviceaccount.com',
        projectId: 'visual-audit-project',
      },
    }),
  })
  const createData = await createRes.json() as Record<string, unknown>
  console.log('Credential result:', JSON.stringify(createData).slice(0, 200))

  // --- Сценарии B и D ---
  for (const vp of VIEWPORTS) {
    const ctx = await makeContext(browser, vp.width, vp.height, cookie)
    const page = await ctx.newPage()

    await page.goto(`${BASE_URL}/google-drive`, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(3000)

    // Проверяем видимость DriveCredentialsSection
    const hasCredSection = await page.locator('.tabs').isVisible().catch(() => false)
    console.log(`  Tabs visible: ${hasCredSection}`)

    // D: Вкладка Обзор папок (tab по умолчанию — первая)
    const foldersTab = page.getByRole('tab', { name: /Обзор папок/i })
    const foldersTabVisible = await foldersTab.isVisible().catch(() => false)
    if (foldersTabVisible) {
      await foldersTab.click()
      await page.waitForTimeout(1500)
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/D-folders-${vp.name}.png`, fullPage: true })
    console.log(`[OK] D-folders-${vp.name}.png`)

    // B: Вкладка Файлы
    const filesTab = page.getByRole('tab', { name: /Файлы/i })
    const filesTabVisible = await filesTab.isVisible().catch(() => false)
    if (filesTabVisible) {
      await filesTab.click()
      await page.waitForTimeout(1000)
      await page.screenshot({ path: `${SCREENSHOT_DIR}/B-files-${vp.name}.png`, fullPage: true })
      console.log(`[OK] B-files-${vp.name}.png`)
    } else {
      console.log(`[SKIP] B-files-${vp.name}.png — таб Файлы не найден`)
      // Скриншот текущего состояния для диагностики
      await page.screenshot({ path: `${SCREENSHOT_DIR}/B-files-${vp.name}.png`, fullPage: true })
      console.log(`  Fallback screenshot saved for B-files-${vp.name}.png`)
    }

    await page.close()
    await ctx.close()
  }

  await browser.close()
  console.log('\nAll screenshots done.')
}

main().catch(err => {
  console.error('Screenshot script failed:', err)
  process.exit(1)
})
