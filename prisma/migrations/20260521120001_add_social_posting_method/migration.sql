-- Метод постинга для SocialAccount: api (OAuth, default) или browser_automation
-- (Indigo + CDP). Безопасный миграционный path - все existing accounts получают
-- 'api' через default, что сохраняет текущее поведение.

CREATE TYPE "public"."SocialPostingMethod" AS ENUM ('api', 'browser_automation');

ALTER TABLE "public"."SocialAccount"
ADD COLUMN "postingMethod" "public"."SocialPostingMethod" NOT NULL DEFAULT 'api';

CREATE INDEX "SocialAccount_postingMethod_idx" ON "public"."SocialAccount"("postingMethod");
