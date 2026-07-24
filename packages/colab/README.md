# @pdfrx/colab

Collaborative PDF editing for the
[`@pdfrx/react`](https://www.npmjs.com/package/@pdfrx/react) viewer family.

`@pdfrx/colab` provides a ready-made React viewer, a browser client that keeps
participants synchronized through ordered, revision-checked operations, shared
page/annotation/form protocols, stable virtual-page adapters, and mixed-source
PDF export. Each participant renders and mutates its own local
[`PdfDocument`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html);
the relay sequences small semantic operations instead of
streaming rendered pages or repeatedly transferring the complete PDF.

**[Local example](https://github.com/espresso3389/pdfrx_web/tree/master/examples/colab)** ·
**[API reference](https://espresso3389.github.io/pdfrx_web/modules/_pdfrx_colab.html)** ·
**[Wire protocol specification](https://github.com/espresso3389/pdfrx_web/blob/master/docs/COLLABORATION-PROTOCOL.md)**

```sh
npm install @pdfrx/colab @pdfrx/react react react-dom
```

## Before you start: provide a relay

`relayUrl` is the URL of an **application-hosted WebSocket server** that
implements the `@pdfrx/colab` wire protocol. It is not a hosted pdfrx service,
and the npm package does not start or bundle a production server.

For local development in this repository, run:

```sh
npm run dev:colab
```

That command starts the Vite client at `http://localhost:5173` and the
persistent relay at `http://localhost:5191`. Vite proxies its local `/api`
and `/relay` routes to that process.

```tsx
<CollaborativePdfViewer
  relayUrl="ws://localhost:5173/relay"
  sessionId={sessionId}
  memberToken={memberToken}
  // ...
/>
```

The deployable implementation lives in
[`examples/colab/server`](https://github.com/espresso3389/pdfrx_web/tree/master/examples/colab/server).
It persists session state and PDF sources, supports member-approved admission,
and is configured entirely through environment variables. Integration tests use
the in-memory `startPageRelayServer()` fixture.

For production, deploy an equivalent service yourself and pass its public
WebSocket URL, for example `wss://relay.example.com/collaboration`. The server
must provide both:

1. A WebSocket endpoint implementing the exported
   [`ClientRelayMessage`](https://espresso3389.github.io/pdfrx_web/types/_pdfrx_colab.ClientRelayMessage.html)
   and
   [`ServerRelayMessage`](https://espresso3389.github.io/pdfrx_web/types/_pdfrx_colab.ServerRelayMessage.html)
   messages. It joins sessions, validates base revisions, sequences operations,
   and broadcasts authoritative page, annotation, and form commits.
2. HTTP `PUT` and `GET` endpoints for immutable source PDFs at
   `/sessions/:sessionId/sources/:documentId` on the same host. The helper
   [`relaySourceUrl()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.relaySourceUrl.html)
   converts `ws:` to `http:` (or `wss:` to `https:`) and constructs this path.

Thus, for `relayUrl="wss://relay.example.com/collaboration"`, uploaded source
PDFs are stored and fetched through URLs such as:

```text
https://relay.example.com/sessions/<sessionId>/sources/<documentId>
```

The WebSocket path itself may be chosen by the host, but the current
[`relaySourceUrl()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.relaySourceUrl.html)
contract places source endpoints at the host root. Configure
the reverse proxy accordingly. Browsers also require `wss:` when the viewer is
served over HTTPS.

### Authentication transport hooks

Same-origin `Secure`/`HttpOnly` cookies can work with the defaults because the
browser supplies them to same-origin WebSocket and HTTP requests. For
cross-origin credentials, bearer-protected source endpoints, custom proxy
paths, or a WebSocket ticket, pass a stable
[`CollaborationTransport`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_colab.CollaborationTransport.html)
through the viewer's `transport` prop.

Use `useMemo` (or a module-level constant) so React does not interpret a newly
allocated transport object as a reason to reconnect:

```tsx
import { useMemo } from 'react';
import type { CollaborationTransport } from '@pdfrx/colab';

function AuthenticatedReviewRoom({ accessToken }: { accessToken: string }) {
  const transport = useMemo<CollaborationTransport>(() => ({
    // Covers cross-origin cookies and bearer-protected source GET/PUT.
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${accessToken}`);
      return fetch(input, { ...init, headers, credentials: 'include' });
    },

    // Use an application-specific source route instead of the default root path.
    resolveSourceUrl: (_relayUrl, sessionId, documentId) =>
      `https://api.example.com/collaboration/${encodeURIComponent(sessionId)}` +
      `/sources/${encodeURIComponent(documentId)}`,
  }), [accessToken]);

  return (
    <CollaborativePdfViewer
      actorId="user-42"
      relayUrl="wss://relay.example.com/collaboration"
      sessionId="review-123"
      src="/documents/review.pdf"
      transport={transport}
    />
  );
}
```

Browser WebSockets cannot attach an arbitrary `Authorization` header. Obtain a
short-lived, single-use connection ticket over authenticated HTTPS before
rendering, then inject the socket factory:

```tsx
const transport = useMemo<CollaborationTransport>(() => ({
  createWebSocket: (url) => {
    const socketUrl = new URL(url);
    socketUrl.searchParams.set('ticket', oneTimeWebSocketTicket);
    return new WebSocket(socketUrl);
  },
  fetch: authenticatedFetch,
}), [oneTimeWebSocketTicket]);
```

Do not put a long-lived access token in a WebSocket URL: URLs are commonly
captured by proxies and logs. The server must validate the authenticated user
against the requested session on the WebSocket join and on every source
GET/PUT. Client-supplied `actorId` is display/operation metadata, not proof of
identity; validate it against the authenticated principal or replace it when
creating committed operations.

## What is synchronized

- Page insertion, removal, movement, duplication, and rotation
- FreeText, ink, shape, markup, and note annotations
- Live non-persistent previews while annotations are moved or resized
- AcroForm text, choice, checkbox, and radio values
- Imported PDF and image sources through stable source and placement IDs
- The authoritative page, annotation, and form revisions used by late joiners

The package does not edit existing PDF page content. Presence UI, cursors,
comments, authentication, authorization, persistence, source retention, and
the production relay remain application responsibilities.

## Ready-made React viewer

Import both stylesheets once, give the viewer a stable participant ID and a
hard-to-guess session ID, then point it at your relay:

```tsx
import { CollaborativePdfViewer } from '@pdfrx/colab';
import '@pdfrx/react/styles.css';
import '@pdfrx/colab/styles.css';

export function ReviewRoom() {
  return (
    <CollaborativePdfViewer
      actorId="user-42"
      name="Alice"
      relayUrl="wss://relay.example.com/collaboration"
      sessionId="b035dd82-7b0e-4bdd-a9b7-e43c8029276f"
      src="/documents/review.pdf"
      wasmModulesUrl="/pdfium/"
      className="review-room"
    />
  );
}
```

Give the component a definite height through its parent or class:

```css
.review-room {
  height: 100dvh;
  min-height: 0;
}
```

The built-in viewer includes the standard toolbar, search, open/import,
printing, download, thumbnails, page actions, annotation tools, AcroForm
controls, connection state, and recent page activity. Opening a new file adds
it as an immutable shared source; its pages can then be arranged alongside
pages from every other source in the session.

### Component props

See [`CollaborativePdfViewerProps`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_colab.CollaborativePdfViewerProps.html)
for the complete source definition.

| Prop | Type | Meaning |
|---|---|---|
| `actorId` | `string` | Stable participant ID attached to submitted operations. |
| `relayUrl` | `string` | Application-hosted `ws:`/`wss:` endpoint described in [Provide a relay](#before-you-start-provide-a-relay). |
| `sessionId` | `string` | Shared room/session identifier. Treat it as untrusted input, not authorization. |
| `memberToken` | `string?` | Device-specific membership token issued after approval and never appended to the URL. |
| `src` | `string \| URL \| ArrayBuffer \| Uint8Array \| Blob` | Initial PDF registered as the session's `main` source. |
| `name` | `string?` | Accessible display label; defaults to `actorId`. |
| `wasmModulesUrl` | `string?` | Directory containing `pdfium_worker.js` and `pdfium.wasm`; defaults to `/pdfium/`. |
| `className` | `string?` | Additional class on the outer `.collab-pane`. |
| `transport` | [`CollaborationTransport`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_colab.CollaborationTransport.html)`?` | Optional WebSocket, authenticated fetch, and source-URL hooks. Keep its object identity stable. |

The PDFium assets can be copied from `node_modules/@pdfrx/engine/assets/`, or
served from the package CDN:

```tsx
<CollaborativePdfViewer
  // ...
  wasmModulesUrl="https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.15.0/assets/"
/>
```

## Architecture

The PDF is virtualized as an ordered list of stable
[`PagePlacement`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_viewer-core.PagePlacement.html)
values:

```ts
interface PagePlacement {
  placementId: string; // identifies this slot, including a duplicate
  source: {
    documentId: string; // identifies one immutable uploaded PDF
    pageIndex: number;  // zero-based physical page in that source
  };
  rotation: 0 | 90 | 180 | 270;
}
```

`placementId` survives moves and rotations. Two copies of the same physical
page have different placement IDs. Network annotations address a placement,
not a mutable page number; form values address the immutable source document
and fully-qualified AcroForm field name.

```text
local viewer mutation
        │ semantic operation + base revision
        ▼
authoritative relay ── validate, sequence, increment revision
        │ committed operation
        ▼
every client ── update snapshot ── apply to its local PdfDocument
```

Pages, annotations, and forms use independent monotonic revision streams. The
client sends one operation per stream at a time and resolves its promise only
after receiving the relay's authoritative commit. It does not optimistically
apply a second copy of an operation that the local viewer already performed.
Joining completes only after page, annotation, and form snapshots have all
arrived. The ready-made viewer automatically reconnects and rejoins after a
completed connection is interrupted.

Annotation movement and resizing additionally use best-effort transient
previews. They are broadcast to the other participants without consuming an
annotation revision, changing the authoritative snapshot, or entering the PDF
and edit history. The final pointer-up geometry is still submitted and
broadcast as a normal authoritative annotation operation.

Remote PDF mutations are applied with `origin: 'remote'`, which prevents
annotation and form event feedback loops. Missing source PDFs are fetched and
opened locally before placements that reference them are applied.

## Relay requirements

[`CollaborativePdfViewer`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.CollaborativePdfViewer.html)
and [`PageCollaborationClient`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_colab.PageCollaborationClient.html)
expect the exported
[`ClientRelayMessage`](https://espresso3389.github.io/pdfrx_web/types/_pdfrx_colab.ClientRelayMessage.html) /
[`ServerRelayMessage`](https://espresso3389.github.io/pdfrx_web/types/_pdfrx_colab.ServerRelayMessage.html)
protocol:

- WebSocket join and authoritative session snapshots
- Strict `baseRevision` validation for page, annotation, and form operations
- Globally unique operation IDs and stable actor IDs
- Broadcast of committed operations to every participant, including the sender
- Broadcast of transient annotation previews to every participant except the
  sender, without materializing them into the annotation snapshot
- An immutable source endpoint at
  `PUT/GET /sessions/:sessionId/sources/:documentId`

Use [`parseClientRelayMessage()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.parseClientRelayMessage.html)
and [`parseServerRelayMessage()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.parseServerRelayMessage.html)
at trust boundaries rather than accepting arbitrary parsed JSON.
[`relaySourceUrl()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.relaySourceUrl.html)
derives the HTTP source URL from the WebSocket relay URL, and
[`uploadRelaySource()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.uploadRelaySource.html)
uploads a PDF using the expected content type.

The complete transport contract—including all envelopes, independent revision
streams, preview semantics, recovery rules, error codes, and source endpoint
responses—is in the
[collaboration relay protocol specification](https://github.com/espresso3389/pdfrx_web/blob/master/docs/COLLABORATION-PROTOCOL.md).

The repository contains a small in-memory reference relay and a two-participant
example in `examples/colab`:

```sh
npm run dev:colab
```

The example is intentionally not deployed to GitHub Pages: Pages can host the
static viewer bundle but cannot run its WebSocket relay. That relay is for
development only. A production service should authenticate
the user, authorize every session and source operation, enforce size/rate
limits, validate content, use durable object storage, define retention, and
avoid treating a random session URL as the sole access-control mechanism.

## Using the lower-level client

Use [`PageCollaborationClient`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_colab.PageCollaborationClient.html)
when the UI or transport integration should be yours:

```ts
import {
  PageCollaborationClient,
  rotatePlacement,
} from '@pdfrx/colab';

const client = new PageCollaborationClient(currentUser.id);

const unsubscribePages = client.subscribe((snapshot, committed) => {
  renderAuthoritativeArrangement(snapshot.pages);
  if (committed) console.log(committed.actorId, committed.operation);
});

const unsubscribeAnnotations = client.subscribeAnnotations((snapshot) => {
  applyAuthoritativeAnnotations(snapshot.annotations);
});

const unsubscribeForms = client.subscribeForms((snapshot) => {
  applyAuthoritativeFormValues(snapshot.fields);
});

await client.connect('wss://relay.example.com/collaboration', sessionId);

const placement = client.snapshot?.pages[0];
if (placement) {
  await client.submit(rotatePlacement(placement, 90));
}

// Annotation and form streams have their own ordered queues.
await client.submitAnnotation(sharedAnnotationChange);
await client.submitForm({ documentId: 'main', fieldName: 'order.total', value: '4800' });

unsubscribePages();
unsubscribeAnnotations();
unsubscribeForms();
client.close();
```

[`RelayOperationError`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_colab.RelayOperationError.html)
exposes the relay error `code` and optional
`currentRevision`, allowing a host to refresh or explain a stale operation.
The constructor accepts injectable operation-ID and WebSocket factories for
tests and non-browser hosts.

## Page source adapter

[`PageSourceRegistry`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_colab.PageSourceRegistry.html)
maps session document IDs to open local
[`PdfDocument`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfDocument.html)
instances. [`createPagePlacements()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.createPagePlacements.html)
creates stable initial placements,
[`resolvePagePlacements()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.resolvePagePlacements.html)
converts an authoritative snapshot into local
[`PdfPage`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_engine.PdfPage.html)
proxies, and
[`applyPagePlacementsToViewer()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.applyPagePlacementsToViewer.html)
applies the arrangement
without publishing it as another local edit.

Pure page-operation helpers are also exported:

| API | Purpose |
|---|---|
| [`rotatePlacement()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.rotatePlacement.html) | Produce an absolute rotation operation from a delta. |
| [`duplicatePlacement()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.duplicatePlacement.html) | Insert another placement for the same source page. |
| [`movePlacementToIndex()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.movePlacementToIndex.html) | Express a drag/reorder using stable anchors. |
| [`describePageOperation()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.describePageOperation.html) | Produce a concise activity label. |
| [`commitPageOperation()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.commitPageOperation.html) | Server-side validation and revision assignment. |
| [`applyCommittedPageOperation()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.applyCommittedPageOperation.html) | Apply an authoritative commit to a snapshot. |

Equivalent reducers are exported for annotations
([`commitAnnotationOperation()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.commitAnnotationOperation.html),
[`applyCommittedAnnotationOperation()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.applyCommittedAnnotationOperation.html))
and forms
([`commitFormOperation()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.commitFormOperation.html),
[`applyCommittedFormOperation()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.applyCommittedFormOperation.html)).
They are transport-independent and suitable for a relay, tests, persistence
replay, or an alternative networking stack.

## Collaborative export

The displayed document may contain pages owned by several source PDFs.
[`encodeCollaborativePdf()`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.encodeCollaborativePdf.html)
materializes the authoritative arrangement without
mutating the live viewer document:

```ts
import { encodeCollaborativePdf } from '@pdfrx/colab';

const bytes = await encodeCollaborativePdf(
  viewer.document!,
  client.snapshot!.pages,
  sourceRegistry,
);
```

For a single source, the source document remains the export base, preserving
its document-level structures. For mixed sources, the export composition pass:

- maps outlines/bookmarks to final page indices;
- merges AcroForms whose Widget annotations arrived with imported pages;
- prefixes colliding field names by source;
- rewrites recognized `AFSimple_Calculate` operands; and
- appends each source's calculation order in source order.

PDFium page import does not merge document catalogs, so this is necessarily an
export-only composition step. XFA, signature preservation, arbitrary PDF
JavaScript, and arbitrary cross-document catalog/name-tree merging are not
supported.

## Conflict and Undo/Redo policy

The relay serializes commands in arrival order and rejects invalid or stale
operations. Operations targeting a removed placement are errors rather than
silent no-ops. Applications can choose a more advanced transformation policy,
but must still broadcast one canonical committed operation.

[`CollaborativePdfViewer`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.CollaborativePdfViewer.html)
disables viewer-local Undo/Redo. Local history entries
contain page positions and annotation snapshots that can become stale after a
remote edit. Safe collaborative undo should submit a validated inverse relay
operation against stable placement/annotation IDs; replaying old client state
could overwrite another participant's work.

## API highlights

| Area | Main exports |
|---|---|
| React | [`CollaborativePdfViewer`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.CollaborativePdfViewer.html), [`CollaborativePdfViewerProps`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_colab.CollaborativePdfViewerProps.html) |
| Browser client | [`PageCollaborationClient`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_colab.PageCollaborationClient.html), [`CollaborationTransport`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_colab.CollaborationTransport.html), [`RelayOperationError`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_colab.RelayOperationError.html), [`fetchRelaySource`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.fetchRelaySource.html), [`relaySourceUrl`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.relaySourceUrl.html), [`uploadRelaySource`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.uploadRelaySource.html) |
| Page protocol | [`PageSessionSnapshot`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_colab.PageSessionSnapshot.html), [`commitPageOperation`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.commitPageOperation.html), [`applyCommittedPageOperation`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.applyCommittedPageOperation.html), [`PageProtocolError`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_colab.PageProtocolError.html) |
| Annotation protocol | [`AnnotationSessionSnapshot`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_colab.AnnotationSessionSnapshot.html), [`SharedAnnotationChange`](https://espresso3389.github.io/pdfrx_web/types/_pdfrx_colab.SharedAnnotationChange.html), [`commitAnnotationOperation`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.commitAnnotationOperation.html), [`applyCommittedAnnotationOperation`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.applyCommittedAnnotationOperation.html) |
| Form protocol | [`FormSessionSnapshot`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_colab.FormSessionSnapshot.html), [`SharedFormFieldChange`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_colab.SharedFormFieldChange.html), [`commitFormOperation`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.commitFormOperation.html), [`applyCommittedFormOperation`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.applyCommittedFormOperation.html) |
| Source adapter | [`PageSourceRegistry`](https://espresso3389.github.io/pdfrx_web/classes/_pdfrx_colab.PageSourceRegistry.html), [`createPagePlacements`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.createPagePlacements.html), [`resolvePagePlacements`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.resolvePagePlacements.html), [`applyPagePlacementsToViewer`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.applyPagePlacementsToViewer.html) |
| Export | [`encodeCollaborativePdf`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.encodeCollaborativePdf.html), [`MappedOutlineNode`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_colab.MappedOutlineNode.html) |
| Wire format | [`ClientRelayMessage`](https://espresso3389.github.io/pdfrx_web/types/_pdfrx_colab.ClientRelayMessage.html), [`ServerRelayMessage`](https://espresso3389.github.io/pdfrx_web/types/_pdfrx_colab.ServerRelayMessage.html), [`parseClientRelayMessage`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.parseClientRelayMessage.html), [`parseServerRelayMessage`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_colab.parseServerRelayMessage.html) |

See the full
[`@pdfrx/colab` API reference](https://espresso3389.github.io/pdfrx_web/modules/_pdfrx_colab.html)
for exact request, snapshot, committed-operation, and error types.

## The pdfrx_web family

| Package | Role |
|---|---|
| **`@pdfrx/colab`** (this package) | Collaborative React viewer, protocols, client, source adapter, and export composition. |
| [`@pdfrx/react`](https://www.npmjs.com/package/@pdfrx/react) | React components and hooks over `@pdfrx/viewer`. |
| [`@pdfrx/viewer`](https://www.npmjs.com/package/@pdfrx/viewer) | Framework-agnostic canvas viewer and `<pdfrx-viewer>` element. |
| [`@pdfrx/viewer-core`](https://www.npmjs.com/package/@pdfrx/viewer-core) | DOM-free geometry, layout, selection, and page-placement reducers. |
| [`@pdfrx/engine`](https://www.npmjs.com/package/@pdfrx/engine) | Typed PDFium/WASM worker client and document API. |

Full [API reference](https://espresso3389.github.io/pdfrx_web/) ·
[repository](https://github.com/espresso3389/pdfrx_web) ·
[collaboration design](https://github.com/espresso3389/pdfrx_web/blob/master/docs/COLLABORATION.md) ·
[architecture notes](https://github.com/espresso3389/pdfrx_web/blob/master/docs/ARCHITECTURE.md)

## License

MIT
