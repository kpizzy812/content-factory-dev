-- Adds 'archived' value to IndigoSyncStatus enum для soft-delete профилей.
-- Используется в DELETE /api/indigo/profiles/:id - вместо hard delete запись
-- помечается archived чтобы sync from remote не воскрешал её (через dup check
-- в sync.ts по name+platformType). List endpoint фильтрует archived.

ALTER TYPE "IndigoSyncStatus" ADD VALUE 'archived';
