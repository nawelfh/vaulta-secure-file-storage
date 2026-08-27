# Vaulta — Secure File Storage

Vaulta is a full-stack secure file storage service built entirely with JavaScript, React, Node.js/Express, PostgreSQL, and S3-compatible object storage.

Authenticated users can upload files up to 250 MB, manage them from a personal dashboard, keep them private, create revocable public sharing links, download them, and delete them safely.

The implementation prioritizes authorization and file safety. The object-storage bucket remains private, internal storage keys are never exposed as application identifiers, and large file bytes are uploaded directly from the browser to object storage instead of passing through the Express server.

## Core capabilities

- Account registration with email and password
- Repeated-password confirmation on the registration page
- Argon2id password hashing
- Opaque, revocable sessions stored in `HttpOnly` cookies
- Session-bound CSRF protection for authenticated mutations
- Strict owner authorization for private files
- Direct multipart uploads with progress reporting and cancellation
- Three concurrent upload parts for improved performance
- Upload support up to 250 MB, covering the required 100 MB minimum
- Validation of filename, extension, declared MIME type, size, and file signature
- Private files by default
- Unguessable, revocable 256-bit public share tokens
- Dedicated public sharing page for recipients
- Five-minute presigned download URLs from a private bucket
- Confirmation popup before deleting a file
- Only validated `READY` files displayed in the dashboard
- Cursor pagination, structured API errors, request IDs, and rate limiting
- Responsive interface with a sticky footer on large screens
- Custom Vaulta favicon
- SQL migrations, automated tests, linting, production build, and CI

The repeated-password field is validated only in the browser. It is never sent to the backend because the API only needs the final password.

## Architecture

```mermaid
flowchart LR
    B[React browser] -->|Session and CSRF| A[Express API]
    A -->|Users, sessions, metadata| P[(PostgreSQL)]
    A -->|Short-lived signed commands| S[(Private S3 bucket)]
    B -->|Multipart file bytes| S
```

The upload lifecycle is:

```text
UPLOADING → READY
UPLOADING → REJECTED
```

Only `READY` files can appear in the dashboard, be downloaded, or be made public. If the uploaded content does not match its declared type, the file becomes `REJECTED`, its stored object is deleted, and it is excluded from all user file lists.

Before setting a file to `READY`, the API verifies the actual object size and reads a small content prefix to validate its signature.

## Project structure

```text
backend/
  migrations/          PostgreSQL schema and migrations
  src/
    config/            Validated environment configuration
    db/                Database pool, migrations, and repositories
    middleware/        Authentication, CSRF, and error handling
    routes/            REST endpoints and request validation
    services/          Authentication and file lifecycle rules
    storage/           S3-compatible storage adapter
  test/                Backend tests

frontend/
  public/              Static assets and favicon
  src/
    api/               API client and multipart uploader
    components/        Dashboard and reusable interface components
    context/           Authentication state
    pages/             Login, registration, dashboard, and sharing pages

docs/
  openapi.yaml         REST API contract
  SECURITY.md          Threat model and production hardening
  DECISIONS.md         Architecture and engineering decisions
```

## Requirements

- Node.js 22.12 or newer
- npm
- Docker
- Docker Compose

## Environment configuration

Create the local environment file from the provided template:

```bash
cp .env.example .env
```

The application reads `.env`. The `.env.example` file is only a safe configuration template that can be committed to GitHub.

Never commit `.env`, because it may contain database and object-storage credentials.

## Local installation

From the project root, install the dependencies:

```bash
npm install
```

Start PostgreSQL and MinIO:

```bash
docker compose up -d
```

Verify the containers:

```bash
docker compose ps -a
```

The expected state is:

- PostgreSQL is running and healthy.
- MinIO is running.
- `create-bucket` exits with code `0` after creating the private bucket.

Apply the PostgreSQL migrations:

```bash
npm run db:migrate
```

Start the backend and frontend development servers:

```bash
npm run dev
```

Open the application at [http://localhost:5173](http://localhost:5173).

Local services:

| Service | Address |
| --- | --- |
| React application | `http://localhost:5173` |
| Express API | `http://localhost:4000` |
| MinIO API | `http://localhost:9000` |
| MinIO console | `http://localhost:9001` |

The credentials provided in `.env.example` are intended only for local development. Never reuse them in production.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the Express API and React development server |
| `npm run db:migrate` | Apply pending SQL migrations transactionally |
| `npm run lint` | Run ESLint for the backend and frontend |
| `npm test` | Run backend and frontend automated tests |
| `npm run build` | Create the production frontend bundle |
| `npm start` | Start the Express API |

## API overview

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Public | Create an account and session |
| `POST` | `/api/auth/login` | Public | Authenticate and create a session |
| `GET` | `/api/auth/me` | Authenticated | Restore the current user |
| `POST` | `/api/auth/logout` | Authenticated + CSRF | Revoke the current session |
| `GET` | `/api/files` | Owner | List the owner's validated files |
| `POST` | `/api/files/uploads` | Owner + CSRF | Initialize a multipart upload |
| `POST` | `/api/files/:id/parts` | Owner + CSRF | Sign selected upload parts |
| `POST` | `/api/files/:id/complete` | Owner + CSRF | Verify and complete an upload |
| `PATCH` | `/api/files/:id` | Owner + CSRF | Change public/private visibility |
| `GET` | `/api/files/:id/download` | Owner | Obtain a short-lived download URL |
| `DELETE` | `/api/files/:id` | Owner + CSRF | Abort an upload or delete a file |
| `GET` | `/api/public/:shareToken` | Public | Redirect to a short-lived download URL |

All API errors use the following structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "requestId": "request-identifier"
  }
}
```

See [`docs/openapi.yaml`](docs/openapi.yaml) for the complete request and response schemas.

## Security design

### Authentication

- Passwords are hashed with Argon2id.
- Authentication uses random server-side sessions.
- The browser stores only an opaque session identifier in an `HttpOnly` cookie.
- Session cookies use `SameSite` protection.
- Authentication endpoints are rate limited.

### Authorization

Every private file query is scoped by both the file identifier and authenticated owner identifier. A user cannot read, modify, publish, download, or delete another user's file.

### CSRF protection

Authenticated state-changing requests require a session-bound CSRF token. Login CSRF is also mitigated by validating the request origin.

### File validation

The application validates:

- allowed file extensions;
- declared MIME types;
- maximum size;
- actual object size after upload;
- content signatures using magic bytes.

A filename or browser-provided MIME type alone is never considered sufficient proof of the real file type.

### Public sharing

The storage bucket is never public. Public access uses an unguessable application share token. The token can be revoked by switching the file back to private.

After authorization, the backend creates a presigned object-storage download URL that expires after five minutes. This prevents the application from exposing permanent storage URLs or private object keys.

## Interface behavior

- The registration form requires the password to be entered twice.
- Account creation is blocked when both passwords differ.
- Deleting a file opens an accessible confirmation dialog.
- Cancelling the dialog leaves the file unchanged.
- The dashboard shows only successfully validated files.
- The footer remains at the bottom on large screens, including pages with little content.
- The browser tab uses the custom Vaulta favicon.

These interface-only behaviors do not change the REST API contract.

## AWS S3 deployment notes

Keep S3 Block Public Access enabled. Grant the backend role only the required actions on the application's storage prefix: multipart creation, part signing, completion, abort, `HeadObject`, ranged `GetObject`, and deletion.

Configure bucket CORS so the frontend origin can upload with `PUT` and read the `ETag` response header:

```json
[
  {
    "AllowedOrigins": ["https://files.example.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

For production, also use:

- TLS for every connection;
- IAM roles instead of long-lived access keys;
- bucket-default encryption;
- a lifecycle rule that removes incomplete multipart uploads;
- a production database with encrypted backups;
- centralized rate limiting if the API runs on multiple instances.

Set `S3_ENDPOINT` only when using a compatible local provider such as MinIO. Set `S3_SSE=AES256` when server-side encryption is not already enforced by the bucket.

## Engineering scope

The project is intentionally compact enough for a take-home assignment while implementing the core requirements to a production-minded standard.

Potential production extensions include:

- antivirus or Content Disarm and Reconstruction processing;
- password reset;
- storage quotas;
- object versioning;
- account deletion;
- distributed rate-limit storage;
- background cleanup jobs;
- audit-log export.

These extensions are documented as future improvements and are not presented as already implemented.

## References

- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [Amazon S3 multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)
- [Amazon S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [Microsoft REST API design best practices](https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design)

## License

This project was created as a technical assignment and is provided for evaluation purposes.
