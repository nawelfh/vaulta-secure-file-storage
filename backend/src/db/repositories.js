function mapUser(row) {
  return row && {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

function mapFile(row) {
  return row && {
    id: row.id,
    ownerId: row.owner_id,
    originalName: row.original_name,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    status: row.status,
    visibility: row.visibility,
    shareToken: row.share_token,
    multipartUploadId: row.multipart_upload_id,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createRepositories(pool) {
  return {
    users: {
      async create({ email, passwordHash }) {
        const result = await pool.query(
          `INSERT INTO users(email, password_hash)
           VALUES ($1, $2)
           RETURNING *`,
          [email, passwordHash],
        );

        return mapUser(result.rows[0]);
      },

      async findByEmail(email) {
        const result = await pool.query(
          'SELECT * FROM users WHERE email = $1',
          [email],
        );

        return mapUser(result.rows[0]);
      },
    },

    sessions: {
      async create({ userId, tokenHash, csrfHash, expiresAt }) {
        await pool.query(
          `INSERT INTO sessions(user_id, token_hash, csrf_hash, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [userId, tokenHash, csrfHash, expiresAt],
        );
      },

      async findValid(tokenHash) {
        const result = await pool.query(
          `SELECT s.id AS session_id, s.csrf_hash, s.expires_at,
                  u.id, u.email, u.created_at
             FROM sessions s
             JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = $1 AND s.expires_at > now()`,
          [tokenHash],
        );

        if (!result.rows[0]) return null;

        const row = result.rows[0];

        return {
          sessionId: row.session_id,
          csrfHash: row.csrf_hash,
          expiresAt: row.expires_at,
          user: mapUser(row),
        };
      },

      async deleteByTokenHash(tokenHash) {
        await pool.query(
          'DELETE FROM sessions WHERE token_hash = $1',
          [tokenHash],
        );
      },

      async deleteExpired() {
        await pool.query(
          'DELETE FROM sessions WHERE expires_at <= now()',
        );
      },
    },

    files: {
      async getReadyStorageStats(ownerId) {
        const result = await pool.query(
          `SELECT COUNT(*) AS total_files,
                  COUNT(*) FILTER (WHERE visibility = 'PUBLIC') AS public_files,
                  COUNT(*) FILTER (WHERE visibility = 'PRIVATE') AS private_files,
                  COALESCE(SUM(size_bytes), 0) AS used_bytes
             FROM files
            WHERE owner_id = $1
              AND status = 'READY'`,
          [ownerId],
        );
        const row = result.rows[0];
        return {
          totalFiles: row.total_files,
          publicFiles: row.public_files,
          privateFiles: row.private_files,
          usedBytes: row.used_bytes,
        };
      },

      async createUpload(file) {
        const result = await pool.query(
          `INSERT INTO files(
             id, owner_id, original_name, storage_key, mime_type,
             size_bytes, multipart_upload_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            file.id,
            file.ownerId,
            file.originalName,
            file.storageKey,
            file.mimeType,
            file.sizeBytes,
            file.multipartUploadId,
          ],
        );

        return mapFile(result.rows[0]);
      },

      async findOwned(id, ownerId) {
        const result = await pool.query(
          'SELECT * FROM files WHERE id = $1 AND owner_id = $2',
          [id, ownerId],
        );

        return mapFile(result.rows[0]);
      },

      async findPublic(shareToken) {
        const result = await pool.query(
          `SELECT * FROM files
            WHERE share_token = $1
              AND visibility = 'PUBLIC'
              AND status = 'READY'`,
          [shareToken],
        );

        return mapFile(result.rows[0]);
      },

      async listOwned({ ownerId, cursor, limit }) {
        const parameters = [ownerId, limit + 1];

        const cursorClause = cursor
          ? `AND (created_at, id) < (
               SELECT created_at, id
                 FROM files
                WHERE id = $3
                  AND owner_id = $1
                  AND status = 'READY'
             )`
          : '';

        if (cursor) parameters.push(cursor);

        const result = await pool.query(
          `SELECT *
             FROM files
            WHERE owner_id = $1
              AND status = 'READY'
              ${cursorClause}
            ORDER BY created_at DESC, id DESC
            LIMIT $2`,
          parameters,
        );

        const hasMore = result.rows.length > limit;
        const rows = hasMore
          ? result.rows.slice(0, limit)
          : result.rows;

        return {
          items: rows.map(mapFile),
          nextCursor: hasMore ? rows.at(-1).id : null,
        };
      },

      async markReady({ id, ownerId }) {
        const result = await pool.query(
          `UPDATE files
              SET status = 'READY',
                  multipart_upload_id = NULL,
                  rejection_reason = NULL
            WHERE id = $1
              AND owner_id = $2
              AND status = 'UPLOADING'
            RETURNING *`,
          [id, ownerId],
        );

        return mapFile(result.rows[0]);
      },

      async markRejected({ id, ownerId, reason }) {
        const result = await pool.query(
          `UPDATE files
              SET status = 'REJECTED',
                  multipart_upload_id = NULL,
                  rejection_reason = $3
            WHERE id = $1
              AND owner_id = $2
            RETURNING *`,
          [id, ownerId, reason],
        );

        return mapFile(result.rows[0]);
      },

      async updateVisibility({
        id,
        ownerId,
        visibility,
        shareToken,
      }) {
        const result = await pool.query(
          `UPDATE files
              SET visibility = $3,
                  share_token = $4
            WHERE id = $1
              AND owner_id = $2
              AND status = 'READY'
            RETURNING *`,
          [id, ownerId, visibility, shareToken],
        );

        return mapFile(result.rows[0]);
      },

      async deleteOwned(id, ownerId) {
        const result = await pool.query(
          `DELETE FROM files
            WHERE id = $1
              AND owner_id = $2
            RETURNING *`,
          [id, ownerId],
        );

        return mapFile(result.rows[0]);
      },
    },
  };
}
