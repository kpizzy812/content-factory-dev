-- Part D — Hybrid Browser Automation Posting
-- ADD-only миграция: добавляет поля login-check status и диагностики PostingJob.
-- Расширяет enum PostingErrorCategory новыми категориями для browser automation.

-- Login-check fields на SocialAccount
ALTER TABLE "SocialAccount" ADD COLUMN "loginCheckedAt" TIMESTAMP(3);
ALTER TABLE "SocialAccount" ADD COLUMN "loginCheckedStatus" BOOLEAN;
ALTER TABLE "SocialAccount" ADD COLUMN "loginCheckedUsername" TEXT;

-- Диагностика последней ошибки PostingJob (для browser automation)
ALTER TABLE "PostingJob" ADD COLUMN "lastErrorPhase" TEXT;
ALTER TABLE "PostingJob" ADD COLUMN "lastErrorScreenshotKey" TEXT;

-- Расширение enum PostingErrorCategory.
-- Postgres требует commit между ADD VALUE и использованием, поэтому отдельные statements.
ALTER TYPE "PostingErrorCategory" ADD VALUE IF NOT EXISTS 'login_required';
ALTER TYPE "PostingErrorCategory" ADD VALUE IF NOT EXISTS 'browser_connect_failed';
ALTER TYPE "PostingErrorCategory" ADD VALUE IF NOT EXISTS 'selector_not_found';
ALTER TYPE "PostingErrorCategory" ADD VALUE IF NOT EXISTS 'upload_failed';
