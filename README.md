# Video-to-Doc MVP

Video-to-Doc turns captions or user-captured tab audio from public YouTube and Bilibili videos into timestamped transcripts and editable Markdown/DOCX documents.

## Scope

The first version supports public YouTube and Bilibili video pages opened by the user. It reads public captions in the browser when available. If captions are unavailable, the Chrome extension can capture the current tab's audio with explicit user consent. The backend never downloads videos and never receives browser cookies.

The MVP limits one task to 60 minutes and each user to 300 minutes per calendar month. Audio chunks are temporary and are eligible for cleanup after 24 hours; transcripts and documents remain until the user deletes the task.

## Repository layout

```text
apps/api        NestJS API, Prisma persistence and upload/job endpoints
apps/extension  Chrome Manifest V3 extension
apps/web        React workbench
apps/worker     BullMQ worker, FFmpeg normalization and AI providers
packages/core   Transcript normalization, quotas and Markdown rendering
packages/contracts Shared Zod API and domain contracts
```

## Requirements

- Node.js 22+
- pnpm 11+
- Docker (for PostgreSQL, Redis and S3-compatible storage)
- An OpenAI API key for transcription/document generation jobs

FFmpeg is included in the worker Docker image. It is not required on the Mac host.

## Local setup

```bash
cd /Users/dabing/Downloads/video-to-doc
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm --filter @video-to-doc/api prisma:generate
pnpm --filter @video-to-doc/api prisma:migrate --name init
pnpm dev
```

Set `OPENAI_API_KEY` in `.env` before processing audio or generating documents. The OpenAI model names are configurable with `OPENAI_TRANSCRIPTION_MODEL` and `OPENAI_DOCUMENT_MODEL`; they are not compiled into the extension.

For local object storage, start the `minio` and `minio-init` services after the image is available in your Docker registry, then set the S3 variables from `.env.example`. The API and worker use presigned S3-compatible URLs, so production storage can be selected without changing application code.

## Development commands

```bash
pnpm test       # all package tests
pnpm typecheck  # all TypeScript projects
pnpm build      # API, worker, web and extension bundles
pnpm dev        # Turbo development processes
```

The API health endpoint is `GET http://localhost:3000/health`.

## Chrome extension

1. Run `pnpm --filter @video-to-doc/extension build`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select `apps/extension/dist`.
4. Open a public YouTube or Bilibili video, open the extension side panel, and sign in with an invited email.

The extension uses `chrome.identity.launchWebAuthFlow` for PKCE login, `chrome.tabCapture` plus an offscreen document for explicit tab-audio capture, and 15-second WebM/Opus chunks for resumable uploads.

## Authentication and invites

The MVP uses invite-only email magic links. In development, if SMTP is not configured, the API logs a development verification URL. Invites are maintained through a script/API-level database insert for now; an admin UI is intentionally out of scope.

## Important constraints

- No server-side video download, DRM bypass, private/paid content, live streams or other browsers.
- AI keys stay on the server; the extension and web app only receive short-lived access tokens.
- Caption and document jobs are idempotent by task/document keys. Ownership checks are applied to every task, transcript and document query.
- The current Docker Compose file provisions local Postgres, Redis and an S3-compatible MinIO service. It does not bind the application to a cloud vendor.

## GitHub

This repository starts on the local `main` branch with no GitHub remote. Add an `origin` remote only after creating the GitHub repository.
