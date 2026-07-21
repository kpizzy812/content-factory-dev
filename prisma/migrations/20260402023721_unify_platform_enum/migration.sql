/*
  Warnings:

  - Changed the type of `platform` on the `SocialAccount` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "PipelineSchedule" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- AlterTable
ALTER TABLE "PipelineVersion" ADD COLUMN     "createdById" INTEGER;

-- AlterTable
ALTER TABLE "SocialAccount" DROP COLUMN "platform",
ADD COLUMN     "platform" "Platform" NOT NULL;

-- DropEnum
DROP TYPE "SocialPlatform";
