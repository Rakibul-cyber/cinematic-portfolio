-- Projects no longer need a category (MH-13). Additive and data-preserving:
-- existing rows keep their categoryId, the foreign key (ON DELETE RESTRICT)
-- and the categoryId index are unchanged, and no category row is touched.
-- AlterTable
ALTER TABLE "project" ALTER COLUMN "categoryId" DROP NOT NULL;
