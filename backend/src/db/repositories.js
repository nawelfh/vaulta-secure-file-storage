function mapUser(row) {
  return row && {
    id: row.id,
    name: row.name ?? null,
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
    isFavorite: row.is_favorite ?? false,
    trashedAt: row.trashed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createRepositories(pool) {
  return {
    users: {
      async create({ name, email, passwordHash }) {
        const result = await pool.query(
          `INSERT INTO users(name, email, password_hash)
           VALUES ($1, $2, $3)
           RETURNING *`,
          [name, email, passwordHash],
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
                  u.id, u.name, u.email, u.created_at
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
          `SELECT COUNT(*) FILTER (WHERE trashed_at IS NULL) AS total_files,
                  COUNT(*) FILTER (WHERE trashed_at IS NULL AND visibility = 'PUBLIC') AS public_files,
                  COUNT(*) FILTER (WHERE trashed_at IS NULL AND visibility = 'PRIVATE') AS private_files,
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
              AND status = 'READY'
              AND trashed_at IS NULL`,
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
                  AND trashed_at IS NULL
             )`
          : '';

        if (cursor) parameters.push(cursor);

        const result = await pool.query(
          `SELECT *
             FROM files
            WHERE owner_id = $1
              AND status = 'READY'
              AND trashed_at IS NULL
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

      async listOwnedPage({
        ownerId,
        page,
        limit,
        search,
        sort,
        visibility,
        view = 'active',
      }) {
        const sortClauses = {
          newest: 'created_at DESC, id DESC',
          oldest: 'created_at ASC, id ASC',
          'name-asc': 'lower(original_name) ASC, original_name ASC, id ASC',
          'name-desc': 'lower(original_name) DESC, original_name DESC, id DESC',
          'size-asc': 'size_bytes ASC, id ASC',
          'size-desc': 'size_bytes DESC, id DESC',
          'deleted-newest': 'trashed_at DESC, id DESC',
          'deleted-oldest': 'trashed_at ASC, id ASC',
        };
        const orderBy = sortClauses[sort];
        if (!orderBy) throw new TypeError('Unsupported file sort option.');

        const viewPredicates = {
          active: ['trashed_at IS NULL'],
          recent: ['trashed_at IS NULL'],
          favorites: ['trashed_at IS NULL', 'is_favorite = true'],
          trash: ['trashed_at IS NOT NULL'],
        };
        const selectedView = viewPredicates[view];
        if (!selectedView) throw new TypeError('Unsupported file view.');

        const parameters = [ownerId];
        const predicates = ["owner_id = $1", "status = 'READY'", ...selectedView];
        if (search) {
          const escaped = search.replace(/[\\%_]/g, '\\$&');
          parameters.push(`%${escaped}%`);
          predicates.push(`original_name ILIKE $${parameters.length} ESCAPE '\\'`);
        }
        if (visibility) {
          parameters.push(visibility);
          predicates.push(`visibility = $${parameters.length}`);
        }
        const where = predicates.join('\n              AND ');
        const countResult = await pool.query(
          `SELECT COUNT(*) AS total
             FROM files
            WHERE ${where}`,
          parameters,
        );
        const total = Number(countResult.rows[0].total);
        const totalPages = Math.ceil(total / limit);
        const resolvedPage = Math.min(page, Math.max(totalPages, 1));
        const dataParameters = [...parameters, limit, (resolvedPage - 1) * limit];
        const limitParameter = dataParameters.length - 1;
        const offsetParameter = dataParameters.length;
        const result = await pool.query(
          `SELECT *
             FROM files
            WHERE ${where}
            ORDER BY ${orderBy}
            LIMIT $${limitParameter}
           OFFSET $${offsetParameter}`,
          dataParameters,
        );

        return {
          files: result.rows.map(mapFile),
          pagination: {
            page: resolvedPage,
            limit,
            total,
            totalPages,
            hasPrevious: resolvedPage > 1,
            hasNext: resolvedPage < totalPages,
          },
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
              AND trashed_at IS NULL
            RETURNING *`,
          [id, ownerId, visibility, shareToken],
        );

        return mapFile(result.rows[0]);
      },

      async updateFavorite({ id, ownerId, favorite }) {
        const result = await pool.query(
          `UPDATE files
              SET is_favorite = $3
            WHERE id = $1
              AND owner_id = $2
              AND status = 'READY'
              AND trashed_at IS NULL
            RETURNING *`,
          [id, ownerId, favorite],
        );
        return mapFile(result.rows[0]);
      },

      async moveToTrash({ id, ownerId }) {
        const result = await pool.query(
          `UPDATE files
              SET trashed_at = now()
            WHERE id = $1
              AND owner_id = $2
              AND status = 'READY'
              AND trashed_at IS NULL
            RETURNING *`,
          [id, ownerId],
        );
        return mapFile(result.rows[0]);
      },

      async restoreFromTrash({ id, ownerId }) {
        const result = await pool.query(
          `UPDATE files
              SET trashed_at = NULL
            WHERE id = $1
              AND owner_id = $2
              AND status = 'READY'
              AND trashed_at IS NOT NULL
            RETURNING *`,
          [id, ownerId],
        );
        return mapFile(result.rows[0]);
      },

      async deleteTrashed(id, ownerId) {
        const result = await pool.query(
          `DELETE FROM files
            WHERE id = $1
              AND owner_id = $2
              AND status = 'READY'
              AND trashed_at IS NOT NULL
            RETURNING *`,
          [id, ownerId],
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
