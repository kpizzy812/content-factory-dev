-- Additive state required to resume official external publishing safely.
ALTER TABLE "Upload"
  ADD COLUMN "platformContainerId" TEXT,
  ADD COLUMN "platformOptions" JSONB;
