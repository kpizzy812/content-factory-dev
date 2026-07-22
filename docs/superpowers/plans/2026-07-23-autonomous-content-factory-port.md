# Autonomous ContentFactory Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести production foundation, content strategy, QA и вертикальный preset из исторического VideoCamp в универсальный ContentFactory без клиентских зависимостей и запрещенного posting-контура.

**Architecture:** Исторические коммиты `7951550`, `a5ab8cb`, `66878c8` используются только как референс. Новое ядро хранит presenter clips, funnels, hypotheses, QA и batches в универсальных моделях; внешние воронки подключаются через adapter/config поля, media идет через существующий Replicate layer, API живет под `/api/factory/*`.

**Tech Stack:** Nuxt 4, Bun, Vitest, PostgreSQL, Prisma 7, Replicate, FFmpeg/Remotion pipeline.

## Global Constraints

- Replicate остается основным media provider; fal.ai только явный fallback.
- Не добавлять Reforma, ChatPlace, DuoPlus, ADB и private API в доменные модели или новый orchestration path.
- Публикация только через общий официальный SocialPublisher port; legacy PostingJob не расширять.
- Все миграции additive; `prisma db push` запрещен.
- Tracking token сохраняется от hypothesis до attribution event.

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

- [ ] Add adapted universal tests and include them in DB-free Vitest config.
- [ ] Run tests and confirm missing-module failures.
- [ ] Port the four pure modules, replacing client-specific names with adapter-neutral contracts.
- [ ] Run DB-free tests and confirm green.

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

- [ ] Merge schema fields with existing `MediaPrediction` relations.
- [ ] Replace `reforma*` and `chatplaceConfig` with `conversionAdapter`, `conversionUrl`, `conversionTrackingParam`, `automationAdapter`, `automationConfig`, `deliveryAdapter`, `deliveryConfig`.
- [ ] Rename historical `/api/zavod/batches` endpoints to `/api/factory/batches`.
- [ ] Generate Prisma client and validate migrations against an isolated test database.

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

- [ ] Add strategy and QA executors from the reference implementation.
- [ ] Route selected presenter clips into the existing Replicate lip-sync abstraction.
- [ ] Preserve cancellation, idempotency, and tracking context in pipeline runs.
- [ ] Run focused orchestration tests.

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

- [ ] Add tests using a generic Russian-language brand, not a client name.
- [ ] Confirm tests fail before preset and longform budget changes.
- [ ] Port the nine-scene longform behavior and preset.
- [ ] Run focused tests and graph validation.

### Task 5: Product integration and verification

**Files:**
- Modify only existing pipeline config components required to configure the two new node types.
- Do not add `app/pages/factory/index.vue` until the mandatory `$design-feature` flow produces `implementation-spec.md`.

- [ ] Generate Prisma client.
- [ ] Run all DB-free tests.
- [ ] Run unit/API tests against isolated PostgreSQL.
- [ ] Run `bun run build` in Docker.
- [ ] Inspect diff for client names and prohibited posting paths.
