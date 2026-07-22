# Replicate Media Provider And Lip-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Replicate the durable primary media provider and route the existing per-scene lip-sync pipeline through `kwaivgi/kling-lip-sync`, while retaining fal.ai only as an explicitly configured fallback.

**Architecture:** Add a provider-neutral media boundary above the existing fal.ai code. Replicate jobs are created asynchronously, persisted before waiting, finalized by a verified idempotent webhook, recovered by polling when a webhook is missed, and copied immediately into ContentFactory storage because provider output URLs expire. The current video pipeline waits on the durable job service for now; later orchestration can detach that wait without changing provider code.

**Tech Stack:** Nuxt 4/Nitro, TypeScript, Bun, Vitest, Prisma/PostgreSQL, official `replicate` JavaScript client, existing storage drivers and video pipeline.

## Global Constraints

- Replicate is the default and required media provider. fal.ai runs only when `MEDIA_PROVIDER_FALLBACK=fal` is explicitly configured.
- Use official APIs only. Never automate provider web interfaces.
- Never store API tokens, signing secrets, or unredacted authorization headers in Prisma snapshots or logs.
- Every paid request has a stable idempotency key and a durable database row before the caller starts polling.
- Webhooks may be duplicated and delivered out of order. Terminal states never regress.
- Copy successful outputs to ContentFactory storage immediately; Replicate API prediction data and output files are temporary.
- Do not use synchronous Replicate prediction mode for production work.
- All production behavior is test-first: write one failing test, observe the expected failure, implement the smallest change, then re-run.
- Use Bun commands only. Use Prisma migrations, never `prisma db push`.

---

## Task 1: Install And Configure The Official Replicate Client

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `.env.example`
- Create: `tests/unit/replicate/config.spec.ts`
- Create: `server/utils/replicate/config.ts`

- [x] Write a failing test asserting that `readReplicateConfig()` rejects a missing token outside mock mode, applies `kwaivgi/kling-lip-sync` as the default model, and never returns an empty webhook base URL when webhooks are enabled.
- [x] Run `bun test tests/unit/replicate/config.spec.ts` and confirm failure is caused by the missing module.
- [x] Run `bun add replicate` so `package.json` and `bun.lock` use the official client.
- [x] Add these documented variables to `.env.example`: `REPLICATE_API_TOKEN`, `REPLICATE_WEBHOOK_SIGNING_SECRET`, `REPLICATE_WEBHOOK_BASE_URL`, `REPLICATE_DEFAULT_LIPSYNC_MODEL`, `REPLICATE_MOCK_MODE`, `REPLICATE_RECOVERY_ENABLED`, and `MEDIA_PROVIDER_FALLBACK`.
- [x] Keep Replicate secrets out of `nuxt.config.ts` and read them only through the validated server-side `process.env` boundary, matching the existing no-secrets-in-bundle convention.
- [x] Implement `readReplicateConfig(env = process.env)` as a pure validator used by server code and tests.
- [x] Re-run the focused test and confirm it passes.

## Task 2: Define The Provider-Neutral Contract And Model Registry

**Files:**

- Create: `tests/unit/media-provider/registry.spec.ts`
- Create: `server/utils/media-provider/types.ts`
- Create: `server/utils/media-provider/registry.ts`

- [x] Write failing tests for a `lip_sync` registry entry that resolves Replicate by default, maps `videoUrl` to `video_url`, maps `audioUrl` to `audio_file`, reports `$0.014` per output second, and rejects unsupported models/capabilities.
- [x] Run `bun test tests/unit/media-provider/registry.spec.ts` and confirm the module-not-found failure.
- [x] Define `MediaCapability`, `MediaProviderName`, normalized input/output types, normalized prediction states, `MediaModelSpec`, and `MediaProvider` interfaces.
- [x] Register `kwaivgi/kling-lip-sync` as the default `lip_sync` model with its current input restrictions documented in code: 2-10 second `.mp4`/`.mov` input, supported video dimensions, supported audio formats, and provider data-processing note.
- [x] Add pure mapping and price-estimation functions; do not call Replicate from the registry.
- [x] Re-run the registry test and confirm it passes.

## Task 3: Persist Paid Predictions And Enforce Idempotency

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260722090000_add_media_predictions/migration.sql`
- Create: `tests/unit/replicate/prediction-state.spec.ts`
- Create: `server/utils/replicate/prediction-state.ts`
- Create: `server/utils/replicate/prediction-repository.ts`

- [x] Write failing pure state-machine tests proving that `starting -> processing -> succeeded` is valid, duplicate `succeeded` is a no-op, `succeeded -> processing` is rejected, and canceled/failed jobs are terminal.
- [x] Run `bun test tests/unit/replicate/prediction-state.spec.ts` and confirm the missing implementation failure.
- [x] Add `MediaPrediction` with: internal id, optional `videoId`, optional `videoAssetId`, provider, capability, model, unique idempotency key, unique nullable external prediction id, status, sanitized input/output snapshots, provider output URL, persisted storage metadata, error, metrics, submitted/completed/terminal/webhook timestamps, and created/updated timestamps.
- [x] Add indexes for `(status, updatedAt)`, `videoId`, and provider/external id. Add cascading relations where a prediction belongs to a video or asset.
- [x] Create migration SQL matching the schema and run `bunx prisma generate`.
- [x] Implement pure transition rules, terminal guards, sanitization, create-or-read-by-idempotency-key, attach-external-id, and atomic terminal update helpers.
- [x] Re-run focused state tests and confirm they pass.

## Task 4: Implement Replicate Submission, Polling And Mock Mode

**Files:**

- Create: `tests/unit/replicate/client.spec.ts`
- Create: `tests/unit/replicate/mock.spec.ts`
- Create: `server/utils/replicate/client.ts`
- Create: `server/utils/replicate/mock.ts`
- Create: `server/utils/replicate/errors.ts`

- [ ] Write failing tests against an injected official-client-shaped adapter proving create/get/cancel normalization, `webhook_events_filter: ["completed"]`, stable webhook URL construction, retry classification, and token redaction.
- [ ] Write a failing deterministic mock test that returns a stable external id for the same idempotency key and can move from `processing` to `succeeded` without network access.
- [ ] Run both focused tests and confirm expected failures.
- [ ] Wrap the official `replicate` client behind an injected adapter so tests do not call the network.
- [ ] Implement async `predictions.create`, `predictions.get`, and `predictions.cancel` normalization. The wrapper must not use `wait`, sync mode, or browser automation.
- [ ] Implement deterministic mock behavior enabled only by `REPLICATE_MOCK_MODE=true`.
- [ ] Re-run focused tests and confirm they pass.

## Task 5: Verify And Apply Idempotent Replicate Webhooks

**Files:**

- Create: `tests/unit/replicate/webhook.spec.ts`
- Create: `server/utils/replicate/webhook.ts`
- Create: `server/api/webhooks/replicate.post.ts`

- [ ] Write failing tests proving invalid signatures return an authentication error, valid payloads are normalized, duplicate terminal events are no-ops, and late processing events cannot overwrite success.
- [ ] Run `bun test tests/unit/replicate/webhook.spec.ts` and confirm expected failure.
- [ ] Build a Fetch `Request` from Nitro's untouched raw body, URL, method, and headers; validate it with the official client's `validateWebhook` before parsing JSON.
- [ ] Return a fast 2xx response after an idempotent database update. Do not download output media in the request handler.
- [ ] Store only sanitized provider payload fields and timestamps.
- [ ] Re-run focused webhook tests and confirm they pass.

## Task 6: Finalize Outputs And Recover Missed Webhooks

**Files:**

- Create: `tests/unit/replicate/prediction-service.spec.ts`
- Create: `server/utils/replicate/prediction-service.ts`
- Create: `server/plugins/replicate-recovery.ts`
- Modify: `server/utils/storage/keys.ts`

- [ ] Write failing tests proving one idempotency key creates one paid job, polling resumes an existing job, successful output is downloaded and persisted exactly once, expired/missing output fails clearly, and a missed webhook is recovered by `predictions.get`.
- [ ] Run `bun test tests/unit/replicate/prediction-service.spec.ts` and confirm expected failure.
- [ ] Implement `submitOrResumePrediction()` and `waitForPrediction()` using injected repository, provider, downloader, and persister dependencies.
- [ ] Add a `StorageKeys.mediaPredictionOutput(predictionId, extension)` key builder.
- [ ] Persist output immediately on success and record storage metadata before exposing completion to callers.
- [ ] Add a scheduler gated by both `SCHEDULERS_ENABLED` and `REPLICATE_RECOVERY_ENABLED`; it polls stale non-terminal jobs in bounded batches and never starts in unit tests.
- [ ] Re-run focused tests and confirm they pass.

## Task 7: Route Existing Scene Lip-Sync Through Replicate

**Files:**

- Create: `tests/unit/lip-sync-provider.spec.ts`
- Create: `server/utils/media-provider/lip-sync.ts`
- Modify: `server/utils/lip-sync-runner.ts`
- Modify: `server/utils/video-models.ts`
- Modify: `server/utils/balance/cost-ledger.ts`

- [ ] Write a failing test showing that the default lip-sync request uses Replicate's `kwaivgi/kling-lip-sync`, maps the video and TTS audio correctly, uses a deterministic key containing video/scene/source/audio identity, returns the persisted local clip path, and estimates cost at `$0.014` per output second.
- [ ] Write a second failing test proving fal.ai is never called unless `MEDIA_PROVIDER_FALLBACK=fal` is explicitly set and Replicate fails with a retry-exhausted provider error.
- [ ] Run `bun test tests/unit/lip-sync-provider.spec.ts` and confirm expected failures.
- [ ] Implement provider-neutral `runLipSync()` with Replicate as primary and opt-in fal fallback.
- [ ] Replace direct `falUploadFile`/`falSubmit`/`falPollUntilDone` calls in `lip-sync-runner.ts` with `runLipSync()` while preserving current step idempotency, per-scene fallback to the original clip, asset replacement, and cleanup behavior.
- [ ] Change default model metadata and cost-ledger service naming from fal-only to the actual provider used.
- [ ] Re-run focused tests and confirm they pass.

## Task 8: Integration Verification And Documentation

**Files:**

- Modify: `README.md`
- Modify: `docs/PROJECT_CONTEXT.md`
- Create: `docs/operations/replicate.md`
- Create: `tests/integration/replicate-lipsync-flow.spec.ts`

- [ ] Add an integration test using mock mode that creates a prediction, applies a duplicate webhook, persists one output, and resumes without a second paid submission.
- [ ] Run `bun test tests/integration/replicate-lipsync-flow.spec.ts` and confirm the intended initial failure, then add only the wiring needed for it to pass.
- [ ] Document setup, exact webhook URL, signature-secret acquisition, model/privacy constraints, mock mode, recovery behavior, fallback policy, and a canary procedure using one 2-10 second source clip before batch runs.
- [ ] Run `bunx prisma validate`.
- [ ] Run all new tests with `bun test tests/unit/replicate tests/unit/media-provider tests/unit/lip-sync-provider.spec.ts tests/integration/replicate-lipsync-flow.spec.ts`.
- [ ] Run the full unit suite with `bun run test:unit`.
- [ ] Run `bun run build`.
- [ ] Inspect `git diff --check`, `git status --short`, and the migration diff. Do not claim completion unless all required commands exit successfully.
