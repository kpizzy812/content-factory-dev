-- Perceptual hash и происхождение клипа при автонарезке длинной записи.
-- Все поля nullable: клипы, загруженные вручную до этой миграции, остаются валидными.
ALTER TABLE "PresenterSourceClip" ADD COLUMN "perceptualHash" TEXT;
ALTER TABLE "PresenterSourceClip" ADD COLUMN "sourceRecording" TEXT;
ALTER TABLE "PresenterSourceClip" ADD COLUMN "sourceStartSec" DOUBLE PRECISION;

CREATE INDEX "PresenterSourceClip_characterId_perceptualHash_idx"
  ON "PresenterSourceClip"("characterId", "perceptualHash");
