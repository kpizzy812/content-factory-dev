# Autonomous ContentFactory Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** РџРµСЂРµРЅРµСЃС‚Рё production foundation, content strategy, QA Рё РІРµСЂС‚РёРєР°Р»СЊРЅС‹Р№ preset РёР· РёСЃС‚РѕСЂРёС‡РµСЃРєРѕРіРѕ VideoCamp РІ СѓРЅРёРІРµСЂСЃР°Р»СЊРЅС‹Р№ ContentFactory Р±РµР· РєР»РёРµРЅС‚СЃРєРёС… Р·Р°РІРёСЃРёРјРѕСЃС‚РµР№ Рё Р·Р°РїСЂРµС‰РµРЅРЅРѕРіРѕ posting-РєРѕРЅС‚СѓСЂР°.

**Architecture:** РСЃС‚РѕСЂРёС‡РµСЃРєРёРµ РєРѕРјРјРёС‚С‹ `7951550`, `a5ab8cb`, `66878c8` РёСЃРїРѕР»СЊР·СѓСЋС‚СЃСЏ С‚РѕР»СЊРєРѕ РєР°Рє СЂРµС„РµСЂРµРЅСЃ. РќРѕРІРѕРµ СЏРґСЂРѕ С…СЂР°РЅРёС‚ presenter clips, funnels, hypotheses, QA Рё batches РІ СѓРЅРёРІРµСЂСЃР°Р»СЊРЅС‹С… РјРѕРґРµР»СЏС…; РІРЅРµС€РЅРёРµ РІРѕСЂРѕРЅРєРё РїРѕРґРєР»СЋС‡Р°СЋС‚СЃСЏ С‡РµСЂРµР· adapter/config РїРѕР»СЏ, media РёРґРµС‚ С‡РµСЂРµР· СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёР№ Replicate layer, API Р¶РёРІРµС‚ РїРѕРґ `/api/factory/*`.

**Tech Stack:** Nuxt 4, Bun, Vitest, PostgreSQL, Prisma 7, Replicate, FFmpeg/Remotion pipeline.

## Global Constraints

- Replicate РѕСЃС‚Р°РµС‚СЃСЏ РѕСЃРЅРѕРІРЅС‹Рј media provider; fal.ai С‚РѕР»СЊРєРѕ СЏРІРЅС‹Р№ fallback.
- РќРµ РґРѕР±Р°РІР»СЏС‚СЊ Reforma, ChatPlace, DuoPlus, ADB Рё private API РІ РґРѕРјРµРЅРЅС‹Рµ РјРѕРґРµР»Рё РёР»Рё РЅРѕРІС‹Р№ orchestration path.
- РџСѓР±Р»РёРєР°С†РёСЏ С‚РѕР»СЊРєРѕ С‡РµСЂРµР· РѕР±С‰РёР№ РѕС„РёС†РёР°Р»СЊРЅС‹Р№ SocialPublisher port; legacy PostingJob РЅРµ СЂР°СЃС€РёСЂСЏС‚СЊ.
- Р’СЃРµ РјРёРіСЂР°С†РёРё additive; `prisma db push` Р·Р°РїСЂРµС‰РµРЅ.
- Tracking token СЃРѕС…СЂР°РЅСЏРµС‚СЃСЏ РѕС‚ hypothesis РґРѕ attribution event.

---

### Task 1: Pure factory domain and TDD contracts

**Files:**
- Create: `tests/unit/content-factory-attribution.spec.ts`
- Create: `tests/unit/content-factory-batch.spec.ts`
- Create: `tests/unit/content-strategy-agent.spec.ts`
- Create: `tests/unit/content-quality-gate.spec.ts`
- Create: `server/utils/content-factory-attribution.ts`
- Create: `server/utils/content-factory-batch.ts`
- Create: `server/utils/agents/content-strategy-agent.ts`
- Create: `server/utils/content-quality-gate.ts`
- Modify: `vitest.pure.config.ts`

**Interfaces:**
- Produces: `buildConversionTrackingUrl`, `createAttributionIdempotencyKey`, `planFactoryAssignments`, `inspectFactoryPipeline`, `validateContentStrategyResult`, `evaluateFactoryQuality`.

- [x] Add adapted universal tests and include them in DB-free Vitest config.
- [x] Run tests and confirm missing-module failures.
- [x] Port the four pure modules, replacing client-specific names with adapter-neutral contracts.
- [x] Run DB-free tests and confirm green.

### Task 2: Presenter library, durable factory schema, and APIs

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260723100000_add_presenter_factory_foundation/migration.sql`
- Create: `prisma/migrations/20260723110000_add_content_strategy_and_qa/migration.sql`
- Create: `server/utils/avatar-source-selector.ts`
- Create: `server/utils/content-factory-status.ts`
- Create: `server/utils/factory-publication.ts`
- Create: `server/api/characters/[id]/source-clips/index.get.ts`
- Create: `server/api/characters/[id]/source-clips/index.post.ts`
- Create: `server/api/characters/[id]/source-clips/[clipId].delete.ts`
- Create: `server/api/factory/funnels/**`
- Create: `server/api/factory/lead-magnets/**`
- Create: `server/api/factory/attribution/**`
- Create: `server/api/factory/batches/**`

**Interfaces:**
- Consumes: pure contracts from Task 1.
- Produces: additive Prisma models `AvatarSourceClip`, `LeadMagnet`, `ContentFunnel`, `ContentHypothesis`, `FactoryPublication`, `FactoryQualityReview`, `AttributionEvent`; REST endpoints under `/api/factory/*`.

- [x] Merge schema fields with existing `MediaPrediction` relations.
- [x] Replace `reforma*` and `chatplaceConfig` with `conversionAdapter`, `conversionUrl`, `conversionTrackingParam`, `automationAdapter`, `automationConfig`, `deliveryAdapter`, `deliveryConfig`.
- [x] Rename historical `/api/zavod/batches` endpoints to `/api/factory/batches`.
- [x] Generate Prisma client and validate migrations against an isolated test database.

### Task 3: Pipeline strategy, QA, and Replicate presenter selection

**Files:**
- Create: `server/utils/pipeline-content-strategy.ts`
- Modify: `server/utils/pipeline-engine.ts`
- Modify: `server/utils/pipeline-executors.ts`
- Modify: `server/utils/pipeline-graph.ts`
- Modify: `server/utils/pipeline-validator.ts`
- Modify: `server/utils/lip-sync-runner.ts`
- Modify: `server/utils/pipeline-character-node.ts`
- Modify: `shared/utils/pipeline-node-registry.ts`
- Modify: `shared/types/character.ts`
- Modify: `shared/types/workflow.ts`

**Interfaces:**
- Consumes: durable factory models and existing Replicate `runLipSync` flow.
- Produces: `content_strategy` and `quality_gate` node executors plus presenter source selection without a fal.ai default.

- [x] Add strategy and QA executors from the reference implementation.
- [x] Route selected presenter clips into the existing Replicate lip-sync abstraction.
- [x] Preserve cancellation, idempotency, and tracking context in pipeline runs.
- [x] Run focused orchestration tests.

### Task 4: Autonomous 70-90 second vertical preset

**Files:**
- Create: `tests/unit/content-factory-preset.spec.ts`
- Create: `tests/unit/scenario-marketing-validator-language.spec.ts`
- Create: `tests/unit/scene-budget.spec.ts`
- Modify: `shared/utils/pipeline-presets.ts`
- Modify: `shared/utils/scene-budget.ts`
- Modify: `server/utils/agents/scenario-marketing-validator.ts`
- Modify: `server/utils/agents/scenario-pipeline.ts`
- Modify: `server/utils/agents/scene-planner-agent.ts`
- Modify: `shared/types/scenario.ts`

**Interfaces:**
- Produces: preset `content-factory-vertical` with strategy, presenter, scenario, script QA, video, final QA, caption and official upload nodes.

- [x] Add tests using a generic Russian-language brand, not a client name.
- [x] Confirm tests fail before preset and longform budget changes.
- [x] Port the nine-scene longform behavior and preset.
- [x] Run focused tests and graph validation.

### Task 5: Product integration and verification

**Files:**
- Modify only existing pipeline config components required to configure the two new node types.
- Modify `app/utils/pipeline-node-meta.ts`, `app/components/pipeline/PipelineSidebar.vue`, `app/components/pipeline/PipelineCanvas.vue`, `app/components/pipeline/PipelineImportModal.vue` so the new node types exist for the editor, not only for the engine.
- Create `app/components/character/CharacterPresenterSourceClips.vue` and mount it from `app/pages/characters/[id].vue`, otherwise the ported source-clip API has no entry point.
- Modify `shared/types/character.ts` with the `PresenterSourceClip` contract used by that component.
- Do not add `app/pages/factory/index.vue` until the mandatory `$design-feature` flow produces `implementation-spec.md`.

- [x] Generate Prisma client.
- [x] Register both new node types in editor metadata, palette, canvas and import validation; `PipelineImportModal` now derives known types from `shared/utils/pipeline-node-registry` instead of a local copy.
- [x] Add the presenter source-clip UI and its shared type.
- [x] Run all DB-free tests (`vitest.pure.config.ts`, 26 files / 100 tests green).
- [x] Apply migrations against an isolated PostgreSQL 16 instance on port 5436 and run `prisma validate`.
- [x] Run the production build (`nuxt build`) and confirm the client and Nitro bundles compile.
- [x] Inspect diff for client names and prohibited posting paths.

**Verification gap:** `bun` is not installed on the current workstation, and `tests/global-setup.ts` shells out to `bunx prisma migrate deploy`. The DB-backed `tests/unit`, `tests/integration` and `tests/api` suites therefore were not executed here and must be run in the Docker image or on a machine with Bun before this is treated as fully verified.
