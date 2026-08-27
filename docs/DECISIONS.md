# Engineering decisions

## 1. JavaScript throughout

Both React and Express use modern ECMAScript modules. This keeps the submission aligned with the stated JavaScript experience while preserving separation through small modules, strict runtime validation, SQL constraints, and tests.

## 2. Direct PostgreSQL instead of an ORM

`node-postgres` makes authorization predicates, ordering, constraints, and parameterization visible during review. A small repository layer prevents SQL from leaking into routes. SQL migrations remain portable and auditable without generated code.

## 3. Opaque database sessions instead of browser JWT storage

Opaque sessions are immediately revocable and avoid placing bearer credentials in `localStorage`. Only a hash is stored, so a read-only database leak does not directly expose active cookie values. A session-bound CSRF token protects mutations.

## 4. Multipart browser-to-object-store uploads

Proxying a 250 MB body through Express increases memory/temporary-disk pressure and makes horizontal scaling harder. The API instead authorizes a fixed key and fixed part numbers for a short time. It remains responsible for ownership, lifecycle, metadata validation, and final verification.

## 5. Public token plus short-lived storage URL

Public state is an application decision, so the bucket remains private. A random application token can be revoked without changing bucket policy. Each use resolves to a five-minute download URL; storage keys and credentials stay outside the public route.

## 6. Verify before READY

Client-provided MIME and size are untrusted. Completion verifies stored length and a content signature while the record is still inaccessible. A failed object is removed and the reason is retained for diagnostics.

## 7. Explicit state over deletion-only failure handling

`UPLOADING`, `READY`, and `REJECTED` make incomplete and failed uploads distinguishable. Completion is retry-aware: if object assembly succeeded but the database response failed, the next request detects the object before attempting assembly again.
