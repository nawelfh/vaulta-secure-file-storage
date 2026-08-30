# Security model

## Assets and trust boundaries

The application protects account credentials, session secrets, private file bytes, object-store identifiers, and sharing state. The browser, Express API, PostgreSQL, and S3-compatible service are distinct trust boundaries. Object storage is private; every object operation is mediated by a narrowly scoped, expiring signature created by the API.

## Implemented controls

### Authentication

- Passwords are hashed with Argon2id (`m=19456 KiB`, `t=2`, `p=1`).
- Login errors do not reveal whether the email exists. A dummy Argon2 verification reduces timing differences for unknown emails.
- Session and CSRF tokens contain 256 bits of randomness. Only SHA-256 hashes are stored in PostgreSQL.
- The session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Sessions expire and can be revoked at logout.
- Authentication endpoints and the API as a whole are rate limited.

### Authorization and CSRF

- Repository reads and mutations take both `file_id` and `owner_id`; non-owners receive the same 404 as unknown files.
- Public access uses a separate 256-bit token and only selects `PUBLIC + READY` records.
- State-changing authenticated routes require a CSRF header equal to a readable cookie and bound by hash to the server-side session.
- Changing a file back to private removes its share token. A previously issued S3 URL can remain usable for at most its five-minute TTL.

### Upload handling

- Allowed types are PDF, PNG, JPEG, GIF, WebP, MP4, WebM, QuickTime MOV, plain text, and ZIP.
- File name, extension, declared MIME, integer size, and configured maximum are checked by the API.
- Completion reads at most the first 4096 object bytes. GIF requires `GIF87a` or `GIF89a`; WebP requires both `RIFF` and `WEBP` markers at their defined offsets; WebM requires a bounded EBML header containing the exact `webm` DocType.
- MP4 and MOV require a structurally valid top-level ISO-BMFF `ftyp` box within that prefix. MP4 requires at least one of these major or compatible brands: `isom`, `iso2`–`iso9`, `mp41`, `mp42`, `mp71`, `avc1`, `M4V `, `M4VH`, `M4VP`, `F4V `, `MSNV`, `dash`, `cmfc`, or `cmfs`. MOV requires the QuickTime `qt  ` brand. Malformed, oversized-prefix, truncated, unbranded, or MIME/extension-mismatched media is rejected.
- Storage keys are generated and contain no user filename.
- The bucket is private and file bytes bypass Express via presigned multipart part requests.
- Part numbers must be unique and within the calculated range; completion requires one consecutive entry for every part.
- Before a record becomes `READY`, the API verifies actual object length and magic bytes. A mismatch is deleted and marked `REJECTED`.
- Original filenames are used only in a sanitized `Content-Disposition` value on download.

### API and operations

- JSON bodies are limited to 64 KiB and validated with strict Zod schemas.
- Helmet security headers, an exact frontend CORS origin, generic 500 responses, request IDs, structured logging, health endpoints, and graceful shutdown are configured.
- SQL values are parameterized. Schema checks protect public/share-token and ready/upload-ID invariants.
- CI uses read-only repository permissions and runs migrations, lint, tests, and the frontend build.

## Production hardening still required

These are explicit extensions rather than hidden claims:

1. Put new objects in a quarantine prefix and scan with antivirus or content-disarm/reconstruction before promotion. Magic bytes are useful validation, not malware detection.
2. Enforce user quotas, per-user concurrent-upload limits, and stale-upload cleanup. Configure an S3 lifecycle rule to abort incomplete multipart uploads.
3. Replace the in-process rate-limit store with Redis when running more than one API instance.
4. Add verified email, password reset, suspicious-login monitoring, session management, and breach-password screening.
5. Use workload identity/IAM roles, KMS-managed encryption, secret rotation, audit retention, backups, and tested restore procedures.
6. Serve only over TLS, configure a strict frontend CSP at the static host, and set HSTS after confirming the entire domain is HTTPS-only.
7. Run end-to-end tests against real PostgreSQL and a non-production S3 bucket in a protected CI environment.

## Reporting a vulnerability

Do not open a public issue containing sensitive details. Send a minimal reproduction privately to the repository owner, including affected endpoint, impact, and suggested remediation. Never include real access keys, session cookies, or private-file links.
