-- CreateEnum
CREATE TYPE "SupplierCountry" AS ENUM ('CHINA', 'RUSSIA');

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN "country" "SupplierCountry" NOT NULL DEFAULT 'CHINA';
