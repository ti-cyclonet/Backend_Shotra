-- AlterTable
ALTER TABLE "proposals" ADD COLUMN     "imageIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
