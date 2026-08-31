ALTER TABLE files
ADD COLUMN is_favorite boolean NOT NULL DEFAULT false;

ALTER TABLE files
ADD COLUMN trashed_at timestamptz;

CREATE INDEX files_owner_active_created_idx
ON files(owner_id, created_at DESC, id DESC)
WHERE status = 'READY' AND trashed_at IS NULL;

CREATE INDEX files_owner_favorite_created_idx
ON files(owner_id, created_at DESC, id DESC)
WHERE status = 'READY' AND trashed_at IS NULL AND is_favorite = true;

CREATE INDEX files_owner_trash_created_idx
ON files(owner_id, trashed_at DESC, id DESC)
WHERE status = 'READY' AND trashed_at IS NOT NULL;
