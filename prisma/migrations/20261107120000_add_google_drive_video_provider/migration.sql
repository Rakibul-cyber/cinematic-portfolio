-- Google Drive as an external video provider (replaces the never-applied
-- Mux upload migration 20261106120000_add_uploaded_video, which was removed).
-- Additive only: one enum value; no table, column, or row changes.
-- PostgreSQL 12+ allows ADD VALUE inside a transaction; the value is not used
-- in this migration.

-- AlterEnum
ALTER TYPE "VideoProvider" ADD VALUE 'GOOGLE_DRIVE';
