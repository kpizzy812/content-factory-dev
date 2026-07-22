-- Atomic lease for copying temporary provider outputs to durable storage.
ALTER TABLE "MediaPrediction"
ADD COLUMN "persistenceStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "persistenceStartedAt" TIMESTAMP(3),
ADD COLUMN "persistenceAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "persistenceError" TEXT;
