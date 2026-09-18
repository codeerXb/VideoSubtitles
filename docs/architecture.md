# MVP architecture

```text
YouTube / Bilibili tab
        │
        ▼
Chrome MV3 side panel ── captions ───────────────┐
        │                                        │
        └─ tabCapture + offscreen + 15s chunks ──┤
                                                 ▼
                                         NestJS API
                                      ┌──────┼────────┐
                                      ▼      ▼        ▼
                                  Postgres  Redis    S3/MinIO
                                      │      │        │
                                      └──────┼────────┘
                                             ▼
                                      BullMQ Worker
                                  FFmpeg → transcription
                                             │
                                             ▼
                                      document generation
                                             │
                                             ▼
                                      React Web workbench
```

## Boundaries

- The extension owns platform-page inspection, caption fetching and explicit tab-audio capture. Cookies and provider API keys never leave the browser/server boundary they belong to.
- The API owns authentication, ownership checks, idempotency, quota accounting, presigned upload URLs and document revisions.
- The worker owns long-running work: audio concatenation, 16 kHz mono normalization, transcription, transcript cleanup and AI document generation.
- `packages/contracts` is the validation boundary shared by API, extension and worker. `packages/core` contains deterministic policy and rendering logic that can be tested without external services.

## Processing states

`CREATED → CAPTURING → UPLOADING → PROCESSING → READY` is the normal audio path. Caption tasks begin at `CREATED`, submit a transcript, and enter `PROCESSING`. Any recoverable provider, upload or worker error becomes `FAILED`; retry creates no duplicate usage ledger entry or document because task and document keys are unique. `CANCELED` is user initiated.

## Data retention

Audio objects are addressed as `captures/{userId}/{captureId}/{index}.webm` and are removed by the retention job after 24 hours. Transcript, document and revision rows remain until the owner deletes the capture task; relational cascades remove dependent rows and a cleanup job removes any remaining objects.

## Deployment seam

All external dependencies are configured through environment variables. Local development uses Docker Compose for PostgreSQL, Redis and MinIO; the API and worker can later be containerized without changing the application interfaces or selecting a cloud vendor in code.
