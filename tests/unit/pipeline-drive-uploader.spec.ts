/**
 * Unit-тесты executor'а google_drive_uploader.
 *
 * Стратегия:
 *  - Реальная test-БД (Pipeline → WorkflowRun → Video).
 *  - vi.mock на google-drive/credential + google-drive/client — чтобы не
 *    обменивать настоящий JWT на токен и не делать реальных HTTP-вызовов.
 *  - Реальные fs.read для абсолютных путей tmp-файлов.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prisma } from '../../server/utils/prisma'
import { CancellationError } from '../../server/utils/pipeline-cancel-registry'

// ── Module mocks ────────────────────────────────────────────────────────────
// vi.mock hoisted, поэтому fn-моки создаём через vi.hoisted чтобы они были
// доступны factory-функциям моков.

const FAKE_CLIENT_EMAIL = 'uploader-tests@my-project.iam.gserviceaccount.com'

const { exchangeMock, multipartMock, decryptMock } = vi.hoisted(() => ({
  exchangeMock: vi.fn(),
  multipartMock: vi.fn(),
  decryptMock: vi.fn(),
}))

vi.mock('../../server/utils/google-drive/credential', () => ({
  decryptDriveServiceAccount: decryptMock,
}))

vi.mock('../../server/utils/google-drive/client', async () => {
  const actual = await vi.importActual<typeof import('../../server/utils/google-drive/client')>(
    '../../server/utils/google-drive/client',
  )
  return {
    ...actual,
    exchangeServiceAccountForToken: exchangeMock,
    multipartUploadRequest: multipartMock,
  }
})

import { executeGoogleDriveUploaderNode } from '../../server/utils/pipeline-drive-uploader'

// ── Fixtures ────────────────────────────────────────────────────────────────

let tmpStorageRoot: string
let storageBase: string

async function createPipelineRun(): Promise<{ runId: number; userId: number }> {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const user = await prisma.zavodUser.create({
    data: {
      externalId: seed,
      email: `uploader-${seed}@test`,
      rolePreset: 'admin',
      canRead: true,
      canWrite: true,
      canCreate: true,
      canDelete: true,
      canApprove: true,
      canRunAgent: true,
      canApplyChanges: true,
      canAdmin: true,
      moduleAccess: ['trendwatcher', 'pipeline'],
      isActive: true,
    },
  })
  const pipeline = await prisma.pipeline.create({
    data: { userId: user.id, name: `up-${seed}` },
  })
  const run = await prisma.workflowRun.create({
    data: { pipelineId: pipeline.id, status: 'running' },
  })
  return { runId: run.id, userId: user.id }
}

async function createCredentialFor(userId: number): Promise<number> {
  const cred = await prisma.pipelineCredential.create({
    data: {
      userId,
      name: `drive-cred-${Math.random()}`,
      type: 'oauth2',
      encryptedData: 'fake-encrypted',
      metadata: { kind: 'google_drive_service_account' },
    },
  })
  return cred.id
}

async function createVideo(opts: {
  filePath?: string | null
  title?: string | null
  driveFileId?: string | null
}): Promise<number> {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const app = await prisma.app.create({
    data: { name: `app-${seed}`, keywords: [], forbiddenClaims: [] },
  })
  const trend = await prisma.trend.create({
    data: {
      appId: app.id,
      platform: 'tiktok',
      sourceUrl: `https://t.test/${seed}`,
      title: `trend-${seed}`,
      viewCount: 1,
      hashtags: [],
    },
  })
  const scenario = await prisma.scenario.create({
    data: { trendId: trend.id, appId: app.id, status: 'generated' },
  })
  if (opts.title) {
    const variant = await prisma.scenarioVariant.create({
      data: {
        scenarioId: scenario.id,
        variantIndex: 0,
        status: 'accepted',
        title: opts.title,
        hook: 'h',
        body: 'b',
        cta: 'c',
        fullScript: 'f',
        visualStyleText: 'v',
      },
    })
    await prisma.scenario.update({
      where: { id: scenario.id },
      data: { selectedVariantId: variant.id },
    })
  }
  const video = await prisma.video.create({
    data: {
      scenarioId: scenario.id,
      applicationId: app.id,
      status: 'completed',
      filePath: opts.filePath ?? null,
      driveFileId: opts.driveFileId ?? null,
    },
  })
  return video.id
}

// ── Setup tmp storage so STORAGE_BASE points at our tmp ────────────────────

beforeEach(() => {
  exchangeMock.mockReset()
  exchangeMock.mockResolvedValue({ accessToken: 'test-token', expiresAt: Date.now() + 3600_000 })
  multipartMock.mockReset()
  decryptMock.mockReset()
  decryptMock.mockImplementation(async (credentialId: number) => ({
    credentialId,
    serviceAccount: {
      type: 'service_account',
      project_id: 'p',
      private_key_id: 'k',
      private_key: 'secret',
      client_email: FAKE_CLIENT_EMAIL,
      client_id: '1',
    },
  }))

  // Создаём tmp-директорию для очистки. Сами файлы кладём в реальный
  // process.cwd()/storage/uploads/uploader-tests/, потому что STORAGE_BASE
  // в executor'е захардкожен относительно process.cwd().
  tmpStorageRoot = mkdtempSync(join(tmpdir(), 'zc-uploader-'))
  storageBase = join(tmpStorageRoot, 'storage', 'uploads')
})

afterEach(() => {
  if (tmpStorageRoot) {
    rmSync(tmpStorageRoot, { recursive: true, force: true })
  }
  // Чистим тестовые файлы из реального storage/uploads
  const realTestDir = join(process.cwd(), 'storage', 'uploads', 'uploader-tests')
  rmSync(realTestDir, { recursive: true, force: true })
})

function makeRealStorageFile(relName: string, contents = 'fake-mp4-bytes'): string {
  const realBase = join(process.cwd(), 'storage', 'uploads')
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const fullPath = join(realBase, relName)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, contents)
  return fullPath
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('pipeline-drive-uploader: happy path', () => {
  it('заливает 2 видео и проставляет driveFileId/driveCredentialId в БД', async () => {
    const { runId, userId } = await createPipelineRun()
    const credentialId = await createCredentialFor(userId)
    const seed = Math.floor(Math.random() * 1_000_000_000)
    const f1 = `uploader-tests/v1-${seed}.mp4`
    const f2 = `uploader-tests/v2-${seed}.mp4`
    makeRealStorageFile(f1)
    makeRealStorageFile(f2)
    const v1 = await createVideo({ filePath: f1, title: 'Cat video' })
    const v2 = await createVideo({ filePath: f2, title: 'Dog video' })

    multipartMock
      .mockResolvedValueOnce({ id: 'gd-1' })
      .mockResolvedValueOnce({ id: 'gd-2' })

    const out = await executeGoogleDriveUploaderNode(
      { credentialId, folderId: 'folder1234567890' },
      { _runId: runId, videos: [{ id: v1 }, { id: v2 }] },
    )

    expect(out.uploadedCount).toBe(2)
    expect(out.skippedCount).toBe(0)
    expect(out.failedCount).toBe(0)
    expect(out.driveFileIds).toEqual(['gd-1', 'gd-2'])

    const stored1 = await prisma.video.findUniqueOrThrow({ where: { id: v1 } })
    const stored2 = await prisma.video.findUniqueOrThrow({ where: { id: v2 } })
    expect(stored1.driveFileId).toBe('gd-1')
    expect(stored1.driveCredentialId).toBe(credentialId)
    expect(stored2.driveFileId).toBe('gd-2')
  })
})

describe('pipeline-drive-uploader: skipIfAlreadyUploaded', () => {
  it('пропускает видео с уже заполненным driveFileId и не вызывает upload', async () => {
    const { runId, userId } = await createPipelineRun()
    const credentialId = await createCredentialFor(userId)
    const seed = Math.floor(Math.random() * 1_000_000_000)
    const f1 = `uploader-tests/skip-${seed}.mp4`
    makeRealStorageFile(f1)
    const v1 = await createVideo({ filePath: f1, driveFileId: 'already-uploaded-id' })

    const out = await executeGoogleDriveUploaderNode(
      { credentialId, folderId: 'folder1234567890', skipIfAlreadyUploaded: true },
      { _runId: runId, videos: [{ id: v1 }] },
    )

    expect(out.skippedCount).toBe(1)
    expect(out.uploadedCount).toBe(0)
    expect(out.driveFileIds).toEqual(['already-uploaded-id'])
    expect(multipartMock).not.toHaveBeenCalled()
  })
})

describe('pipeline-drive-uploader: 403 от Drive', () => {
  it('failure содержит client_email и слово Editor', async () => {
    const { runId, userId } = await createPipelineRun()
    const credentialId = await createCredentialFor(userId)
    const seed = Math.floor(Math.random() * 1_000_000_000)
    const f1 = `uploader-tests/forbidden-${seed}.mp4`
    makeRealStorageFile(f1)
    const v1 = await createVideo({ filePath: f1 })

    const err = Object.assign(new Error('forbidden'), { statusCode: 403 })
    multipartMock.mockRejectedValueOnce(err)

    const out = await executeGoogleDriveUploaderNode(
      { credentialId, folderId: 'folder1234567890' },
      { _runId: runId, videos: [{ id: v1 }] },
    )

    expect(out.failedCount).toBe(1)
    expect(out.uploadedCount).toBe(0)
    const failure = (out.failures as Array<{ videoId: number; reason: string }>)[0]
    expect(failure.videoId).toBe(v1)
    expect(failure.reason).toContain(FAKE_CLIENT_EMAIL)
    expect(failure.reason).toContain('Editor')
  })
})

describe('pipeline-drive-uploader: видео без filePath', () => {
  it('fail-soft, остальные обрабатываются', async () => {
    const { runId, userId } = await createPipelineRun()
    const credentialId = await createCredentialFor(userId)
    const seed = Math.floor(Math.random() * 1_000_000_000)
    const okFile = `uploader-tests/ok-${seed}.mp4`
    makeRealStorageFile(okFile)
    const noPath = await createVideo({ filePath: null })
    const ok = await createVideo({ filePath: okFile })

    multipartMock.mockResolvedValueOnce({ id: 'gd-ok' })

    const out = await executeGoogleDriveUploaderNode(
      { credentialId, folderId: 'folder1234567890' },
      { _runId: runId, videos: [{ id: noPath }, { id: ok }] },
    )

    expect(out.uploadedCount).toBe(1)
    expect(out.failedCount).toBe(1)
    const failures = out.failures as Array<{ videoId: number; reason: string }>
    expect(failures[0].videoId).toBe(noPath)
    expect(failures[0].reason).toContain('filePath')
  })
})

describe('pipeline-drive-uploader: empty input', () => {
  it('возвращает _noData без вызова upload', async () => {
    const { runId, userId } = await createPipelineRun()
    const credentialId = await createCredentialFor(userId)

    const out = await executeGoogleDriveUploaderNode(
      { credentialId, folderId: 'folder1234567890' },
      { _runId: runId, videos: [] },
    )

    expect(out._noData).toBe(true)
    expect(out._domainStatus).toBe('no_data')
    expect(out.uploadedCount).toBe(0)
    expect(multipartMock).not.toHaveBeenCalled()
    expect(exchangeMock).not.toHaveBeenCalled()
  })
})

describe('pipeline-drive-uploader: path traversal', () => {
  it('fail-soft с reason "Недопустимый путь файла"', async () => {
    const { runId, userId } = await createPipelineRun()
    const credentialId = await createCredentialFor(userId)
    const v1 = await createVideo({ filePath: '../../etc/passwd' })

    const out = await executeGoogleDriveUploaderNode(
      { credentialId, folderId: 'folder1234567890' },
      { _runId: runId, videos: [{ id: v1 }] },
    )

    expect(out.failedCount).toBe(1)
    expect(out.uploadedCount).toBe(0)
    const failure = (out.failures as Array<{ videoId: number; reason: string }>)[0]
    expect(failure.reason).toBe('Недопустимый путь файла')
    expect(multipartMock).not.toHaveBeenCalled()
  })
})

describe('pipeline-drive-uploader: aborted signal', () => {
  it('throwIfAborted прерывает цикл до обработки следующего видео', async () => {
    const { runId, userId } = await createPipelineRun()
    const credentialId = await createCredentialFor(userId)
    const seed = Math.floor(Math.random() * 1_000_000_000)
    const f1 = `uploader-tests/abort-1-${seed}.mp4`
    const f2 = `uploader-tests/abort-2-${seed}.mp4`
    makeRealStorageFile(f1)
    makeRealStorageFile(f2)
    const v1 = await createVideo({ filePath: f1 })
    const v2 = await createVideo({ filePath: f2 })

    const controller = new AbortController()
    multipartMock.mockImplementationOnce(async () => {
      controller.abort()
      return { id: 'gd-1' }
    })

    await expect(
      executeGoogleDriveUploaderNode(
        { credentialId, folderId: 'folder1234567890' },
        { _runId: runId, videos: [{ id: v1 }, { id: v2 }] },
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(CancellationError)

    expect(multipartMock).toHaveBeenCalledTimes(1)
  })
})
