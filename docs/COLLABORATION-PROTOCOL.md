# Collaboration relay protocol

This document specifies the WebSocket protocol implemented by
`@pdfrx/colab` and the reference relay in `examples/colab`. It also describes
the HTTP side channel used to transfer immutable source PDFs.

The TypeScript definitions in `packages/colab/src/wire.ts`,
`protocol.ts`, `annotation-protocol.ts`, and `form-protocol.ts` are the
executable source of truth. The reference relay is intentionally an in-memory
development implementation, not a production service.

## Transport and connection lifecycle

- WebSocket frames are UTF-8 JSON text. Binary frames have no defined meaning.
- Every message has a string `type`. Client messages also have a non-empty
  `sessionId`.
- A client must send `session.join` after the socket opens and before sending
  any other message. An admitted device supplies its `memberToken`. A new
  device supplies its actor and display name and waits for member approval.
- A successful join returns three snapshots, in this order:
  `session.snapshot`, `annotation.snapshot`, and `form.snapshot`.
- The browser client does not report a completed join or send queued operations
  until all three snapshots have arrived.
- Sending another `session.join` moves that socket to the named session.
- Closing the socket removes it from the session. The reference relay stores no
  participant presence.

There is currently no protocol-version field or subprotocol negotiation.
Clients and relays must therefore be deployed with compatible
`@pdfrx/colab` message definitions. An unrecognized or malformed client
message is rejected with `code: "invalid-message"`.

## Identity and coordinates

- `sessionId` identifies an application room. It is routing data, not proof of
  authorization.
- `actorId` is a stable participant identifier attached by the client. A
  production relay must validate or replace it; it is not authentication.
- `operationId` is a globally unique client-generated correlation ID.
- `documentId` identifies one immutable source PDF within a session.
- `placementId` identifies one slot in the virtual page arrangement. Duplicate
  appearances of the same source page have different placement IDs.
- `pageIndex` is zero-based within its source PDF.
- Annotation geometry is expressed in PDF page coordinates. Annotation
  operations address a stable `placementId`, never a mutable page number.
- Page rotations are restricted to `0`, `90`, `180`, or `270` degrees.

## Revision model

Pages, annotations, and forms have three independent, monotonically increasing
revision streams. Each starts at zero.

An authoritative operation request contains:

```ts
interface OperationRequest<T> {
  operationId: string;
  actorId: string;
  baseRevision: number;
  // `operation` for pages; `change` for annotations and forms
}
```

The relay accepts a request only when `baseRevision` exactly equals the current
revision of that stream. It applies the operation, increments that stream by
one, and broadcasts the committed operation to every joined client, including
the sender. A client applies a commit only when both its `baseRevision` and
assigned `revision` immediately follow the client's current snapshot.

The browser client maintains one in-flight request per stream. Operations in
different streams may proceed independently. It does not optimistically apply
an additional copy of a local operation; the local viewer mutation has already
happened, and the authoritative commit advances the shared snapshot.

## Client-to-relay messages

### Join

```json
{
  "type": "session.join",
  "sessionId": "review-123",
  "memberToken": "device-specific random token",
  "actorId": "user-42",
  "displayName": "Alice"
}
```

When `memberToken` is absent or invalid, a production relay creates a pending
request instead of returning snapshots:

```ts
// Relay -> applicant
{ type: 'session.join.pending'; sessionId: string; requestId: string }

// Relay -> every currently connected member
{ type: 'session.join.request'; sessionId: string; requestId: string;
  actorId: string; displayName: string }

// Any connected member -> relay
{ type: 'session.approve'; sessionId: string; requestId: string }
{ type: 'session.reject'; sessionId: string; requestId: string }

// Relay -> applicant
{ type: 'session.join.approved'; sessionId: string; requestId: string;
  memberToken: string }
{ type: 'session.join.rejected'; sessionId: string; requestId: string;
  retryAfterMs: number }

// Relay -> every connected member after either decision
{ type: 'session.join.resolved'; sessionId: string; requestId: string;
  decision: 'approved' | 'rejected' | 'cancelled' }

// Relay -> every connected member when presence changes
{ type: 'session.presence'; sessionId: string; connectedCount: number }
```

The applicant resends `session.join` with the issued token and then receives
the three snapshots. Tokens identify admitted devices, are not placed in the
shared URL, and are sent to source HTTP endpoints through
`X-Pdfrx-Member-Token`. Pending requests expire after ten minutes in the
relay. Approval, rejection, applicant disconnect, and expiry all broadcast a
resolution so every member removes the corresponding prompt.

After a rejection, the same `sessionId` / `actorId` pair cannot apply again
until `retryAfterMs` has elapsed. Consecutive rejections increase that delay
linearly: 5 seconds, 10 seconds, 15 seconds, and so on. The relay enforces
the cooldown; the client also displays the remaining time.

`session.presence` counts distinct connected `actorId` values, so multiple tabs
opened by the same participant do not inflate the participant count.

If the relay rejects an operation because its page, annotation, or form
revision is stale, the browser closes that socket and reconnects. Fresh
snapshots are then applied authoritatively: page placement is replaced,
annotations are restored in replace mode (including removal of unsent local
annotations), and form fields are reset to committed values or their original
document defaults. This prevents a transient failure from leaving a client in
a permanently divergent state.

### Page operation

```json
{
  "type": "page.operation",
  "sessionId": "review-123",
  "request": {
    "operationId": "550e8400-e29b-41d4-a716-446655440000",
    "actorId": "user-42",
    "baseRevision": 7,
    "operation": {
      "type": "page.rotate",
      "placementId": "page-slot-3",
      "rotation": 90
    }
  }
}
```

`operation` is one of:

```ts
type PagePlacementOperation =
  | { type: 'page.replace'; pages: readonly PagePlacement[] }
  | { type: 'page.insert'; page: PagePlacement; after: string | null }
  | { type: 'page.remove'; placementId: string }
  | { type: 'page.move'; placementId: string; after: string | null }
  | { type: 'page.rotate'; placementId: string; rotation: 0 | 90 | 180 | 270 };

interface PagePlacement {
  placementId: string;
  source: { documentId: string; pageIndex: number };
  rotation: 0 | 90 | 180 | 270;
}
```

For insertion and movement, `after: null` means the beginning of the
arrangement.

### Annotation operation

```json
{
  "type": "annotation.operation",
  "sessionId": "review-123",
  "request": {
    "operationId": "13fef33a-b3f2-4247-b9e7-4a4db05c26b7",
    "actorId": "user-42",
    "baseRevision": 12,
    "change": {
      "type": "update",
      "placementId": "page-slot-3",
      "id": "annotation-nm-id",
      "spec": {
        "subtype": "square",
        "rect": { "left": 72, "top": 180, "right": 240, "bottom": 120 }
      }
    }
  }
}
```

`change` is an `add`, `update`, or `remove`. `add` and `update` carry the full
serializable `PdfAnnotationSpec`; `remove` contains only `placementId` and
annotation `id`. Updates replace the materialized record with the supplied
specification.

### Annotation preview

```json
{
  "type": "annotation.preview",
  "sessionId": "review-123",
  "preview": {
    "actorId": "user-42",
    "changes": [
      {
        "type": "update",
        "placementId": "page-slot-3",
        "id": "annotation-nm-id",
        "spec": {
          "subtype": "square",
          "rect": { "left": 72, "top": 180, "right": 260, "bottom": 110 }
        }
      }
    ]
  }
}
```

A preview is transient drag geometry:

- it permits `update` changes only;
- it has no `operationId`, `baseRevision`, or assigned `revision`;
- the relay sends it to the other clients in the session, not to the sender;
- it does not mutate the relay snapshot, PDF, edit history, or saved output;
- receivers paint it in their annotation overlay and discard it when
  authoritative state replaces it;
- pointer release submits the final geometry as a normal
  `annotation.operation`.

The built-in collaborative viewer uses previews for body moves and
single/group anchor resizing. Modifier-drag duplication is committed normally
because its new annotation IDs do not yet exist in authoritative state.
Previews are best-effort visual state; clients must remain correct if some are
lost.

### Form operation

```json
{
  "type": "form.operation",
  "sessionId": "review-123",
  "request": {
    "operationId": "70ff38d2-aee0-4e25-b32d-f160886c3aa9",
    "actorId": "user-42",
    "baseRevision": 4,
    "change": {
      "documentId": "main",
      "fieldName": "customer.name",
      "value": "Alice"
    }
  }
}
```

Form values are `string`, `boolean`, or `string[]`. Fields are scoped by both
immutable source `documentId` and fully-qualified AcroForm `fieldName`.

## Relay-to-client messages

### Initial snapshots

```ts
{ type: 'session.snapshot'; sessionId: string;
  snapshot: { revision: number; pages: readonly PagePlacement[] } }

{ type: 'annotation.snapshot'; sessionId: string;
  snapshot: { revision: number; annotations: readonly {
    placementId: string; id: string; spec: PdfAnnotationSpec
  }[] } }

{ type: 'form.snapshot'; sessionId: string;
  snapshot: { revision: number; fields: readonly {
    documentId: string; fieldName: string; value: string | boolean | string[]
  }[] } }
```

Snapshots are complete materialized state for their stream. They allow a late
joiner or reconnecting client to rebuild without replaying the operation log.
Choice-form values use selected option-label arrays even for single-select
controls; scalar strings remain text values and radio export values.

### Committed operations

`page.committed`, `annotation.committed`, and `form.committed` contain the
corresponding request plus the authoritative `revision`:

```json
{
  "type": "annotation.committed",
  "sessionId": "review-123",
  "committed": {
    "operationId": "13fef33a-b3f2-4247-b9e7-4a4db05c26b7",
    "actorId": "user-42",
    "baseRevision": 12,
    "revision": 13,
    "change": { "...": "same shape as the request" }
  }
}
```

The relay also emits `annotation.preview` with the same `preview` payload
described above.

### Rejection

```ts
interface OperationRejected {
  type: 'operation.rejected';
  sessionId?: string;
  operationId?: string;
  code: string;
  message: string;
  currentRevision?: number;
}
```

Known codes include:

| Code | Meaning |
|---|---|
| `invalid-message` | Malformed JSON, envelope, operation, or unknown message type. |
| `session-not-found` | The requested session does not exist. |
| `not-joined` | A non-join message was sent before joining that session. |
| `authentication-failed` | The device membership token is invalid. |
| `admission-required` | The device has no membership and omitted request metadata. |
| `join-request-not-found` | The approval request expired or belongs to another session. |
| `invalid-envelope` | Invalid page protocol ID or revision. |
| `base-revision-mismatch` | Stale page operation. |
| `annotation-revision-mismatch` | Stale annotation operation. |
| `form-revision-mismatch` | Stale form operation. |
| `placement-not-found` | Annotation target placement is absent. |
| `document-not-found` | Form target source is absent from the arrangement. |

Page arrangement validation may also return its stable
`PageArrangementError.code`, for example for duplicate or missing placements.
The reference relay's `currentRevision` is the page revision even when an
annotation or form operation is rejected; consumers should reconnect for fresh
snapshots rather than assuming it identifies the rejected stream.

Client-side reducers additionally raise `unexpected-revision`,
`unexpected-annotation-revision`, or `unexpected-form-revision` when a commit
is replayed or a revision is skipped. These are local protocol failures, not
normal relay rejections.

## Reconnection and recovery

On transport loss, reject pending operations and create a new WebSocket. After
joining, replace all three local protocol snapshots with the three
authoritative snapshots before submitting more operations. The current
protocol has no resume cursor, operation-log replay, or automatic rebase.
A stale request is rejected rather than transformed.

Applications that retry must retain or deliberately regenerate operation IDs
according to their idempotency policy. The reference relay does not keep a
deduplication table, so production relays should add one if retrying the same
operation ID must be exactly-once.

## Source PDF HTTP side channel

Source bytes are not sent over WebSocket. The default endpoint is:

```text
PUT /sessions/:sessionId/sources/:documentId
GET /sessions/:sessionId/sources/:documentId
```

`relaySourceUrl()` derives this root-relative HTTP URL from the WebSocket host,
converting `ws:` to `http:` and `wss:` to `https:`.

Reference relay behavior:

- `PUT` stores a non-empty PDF under the session-scoped document ID and returns
  `201`.
- Re-uploading identical bytes is accepted and returns `201`.
- Reusing an ID for different bytes returns `409`.
- A source larger than 50 MiB returns `413`.
- Unknown paths or sources return `404`; unsupported methods return `405`.
- `GET` returns `application/pdf`.
- `OPTIONS` returns `204` with permissive development CORS headers.

Production services must authenticate both transports, authorize the session
on every request, validate content, impose quotas, and provide durable storage,
retention, malware scanning, and TLS. Long-lived credentials should not be put
in WebSocket URLs.

## Example: live resize followed by commit

```text
client A                         relay                         client B
   | annotation.preview           |                              |
   |----------------------------->| annotation.preview           |
   |                              |----------------------------->|
   | annotation.preview           |                              |
   |----------------------------->| annotation.preview           |
   |                              |----------------------------->|
   | annotation.operation (base 5)|                              |
   |----------------------------->| validate; annotation rev = 6 |
   |                              |                              |
   |<-----------------------------| annotation.committed (rev 6) |
   |                              |----------------------------->|
```

Only the final committed operation enters the annotation snapshot and PDF.
