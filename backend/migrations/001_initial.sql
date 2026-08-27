CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE file_visibility AS ENUM ('PRIVATE', 'PUBLIC');
CREATE TYPE file_status AS ENUM ('UPLOADING', 'READY', 'REJECTED');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(254) NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalized CHECK (email = lower(email))
);

CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  csrf_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name varchar(255) NOT NULL,
  storage_key text NOT NULL UNIQUE,
  mime_type varchar(127) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  status file_status NOT NULL DEFAULT 'UPLOADING',
  visibility file_visibility NOT NULL DEFAULT 'PRIVATE',
  share_token char(43) UNIQUE,
  multipart_upload_id text,
  rejection_reason varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_file_has_share_token CHECK (
    (visibility = 'PRIVATE') OR (visibility = 'PUBLIC' AND share_token IS NOT NULL)
  ),
  CONSTRAINT ready_file_has_no_upload_id CHECK (
    (status = 'UPLOADING') OR multipart_upload_id IS NULL
  )
);

CREATE INDEX files_owner_created_idx ON files(owner_id, created_at DESC, id DESC);
CREATE INDEX files_public_share_idx ON files(share_token) WHERE visibility = 'PUBLIC' AND status = 'READY';

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER files_set_updated_at
BEFORE UPDATE ON files
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
