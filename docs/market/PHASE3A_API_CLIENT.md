# Phase 3-A — KONEPS API client foundation

## Result

The backend-side TypeScript foundation is implemented under `collector/koneps/`. It is not imported by `src/`, not bundled by Vite, not exposed as a Tauri command, and not connected to the Collector UI. No live API call, database, raw persistence, checkpoint or scheduler was added.

## Structure

- `client.ts`: injected `fetch` transport, timeout, bounded retry, exact response bytes/text, envelope validation and redacted call metadata.
- `config.ts`: backend-only `process.env.KONEPS_SERVICE_KEY` configuration.
- `endpoints.ts`: three approved service base endpoints and one representative bid-notice operation descriptor.
- `types.ts`: request, envelope, response, metadata and error-category types.
- `envelope.ts`: depth-limited common-envelope discovery without hardcoding `response.body.items.item`.
- `redaction.ts`: case-insensitive `ServiceKey` query redaction and direct-secret removal.
- `errors.ts`: secret-safe categorized error.
- `fixtures/` and `client.test.ts`: offline fixture/mock verification.

## Configuration and secret policy

Set `KONEPS_SERVICE_KEY` only in the backend/collector process environment. `.env` and `.env.*` are ignored; `.env.example` contains empty values only. `VITE_KONEPS_SERVICE_KEY` is forbidden because Vite variables can enter the frontend bundle.

`KONEPS_SERVICE_KEY_MODE` supports:

- `preserve` (default): retain an already percent-encoded key, preventing `%2F` becoming `%252F`;
- `encode`: apply `encodeURIComponent` once to a decoded key.

Keys containing query separators, fragments or whitespace are rejected. The correct live mode remains a Phase 3-B verification item.

## Endpoints

- `BidPublicInfoService`: `https://apis.data.go.kr/1230000/ad/BidPublicInfoService`
- `ScsbidInfoService`: `https://apis.data.go.kr/1230000/as/ScsbidInfoService`
- `CntrctInfoService`: `https://apis.data.go.kr/1230000/ao/CntrctInfoService`

Only `getBidPblancListInfoThngPPSSrch` has a representative typed operation descriptor. Other operations were intentionally not registered.

## HTTP and response behavior

Node 24 built-in `fetch` is used; no Axios/Got/request dependency was added. A transport can be injected for tests. The response exposes HTTP status, headers, exact `Uint8Array`, decoded body text, parsed JSON, common envelope, received time, duration and call metadata. It does not persist or log the body.

Timeout is 20 seconds by default, deliberately well above the official document's 500 ms average. A single user-initiated request may retry at most twice (three attempts total) with exponential backoff and up to 25% jitter.

Retryable: transient network/timeout, HTTP 429, HTTP 5xx. Not retryable: configuration/validation, ordinary HTTP 4xx, API result-code error, invalid JSON, envelope mismatch.

Error categories: `configuration`, `network`, `timeout`, `http`, `api`, `parse`, `structure`. Errors contain redacted metadata and do not include response bodies, request URLs with keys, or transport exception strings.

## Call metadata and counters

Metadata: service, operation, redacted URL, page/row settings, HTTP status, result code/message, start/finish/duration, attempt and retry counts. Client counters expose requests and retries only; there is no quota manager and no hardcoded daily limit.

## Test coverage

Offline tests cover:

1. normal response with items and paging;
2. empty result with `totalCount=0` and uncertain items nesting;
3. HTTP 200 + API error result code;
4. HTTP 500 error without body leakage;
5. malformed JSON;
6. common-envelope mismatch;
7. abort timeout;
8. HTTP 500 then success retry;
9. encoded-key preservation/no `%252F` double encoding plus metadata redaction;
10. case-insensitive URL and direct-secret redaction;
11. network exception secret non-leakage;
12. missing backend environment configuration.

All fixtures use obvious fake values. No live API was called.

## Phase 3-B verification

Use one narrow bid-notice query to verify service-key mode, actual JSON nesting, empty items representation, page sizes, date-boundary semantics, error envelope and response encoding. Save only redacted fixtures. Do not add DB persistence or broad collection until those results update the baseline documents.
