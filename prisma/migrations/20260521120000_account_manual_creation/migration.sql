-- Manual account creation (no OAuth): сделать accessToken nullable + добавить platformHandle.
-- ADD-only миграция. accessToken: NOT NULL → NULL — безопасный drop constraint, существующие
-- значения не страдают. platformHandle — новое опциональное поле для Apify scraping и login.

ALTER TABLE "SocialAccount"
  ALTER COLUMN "accessToken" DROP NOT NULL,
  ADD COLUMN "platformHandle" TEXT;
