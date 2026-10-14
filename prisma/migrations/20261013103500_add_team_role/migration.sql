-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN "role" "TeamRole" NOT NULL DEFAULT 'MEMBER';
