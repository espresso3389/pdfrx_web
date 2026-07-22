# @pdfrx/colab

Collaborative PDF editing for the
[`@pdfrx/react`](https://www.npmjs.com/package/@pdfrx/react) viewer family.

`@pdfrx/colab` provides a ready-made React viewer, a strict-revision browser
client, shared page/annotation/form protocols, stable virtual-page adapters,
and mixed-source PDF export. Each participant renders and mutates its own local
`PdfDocument`; the relay sequences small semantic operations instead of
streaming rendered pages or repeatedly transferring the complete PDF.

**[Local example](https://github.com/espresso3389/pdfrx_web/tree/master/examples/colab)** ·
**[API reference](https://espresso3389.github.io/pdfrx_web/modules/_pdfrx_colab.html)**

```sh
npm install @pdfrx/colab @pdfrx/react react react-dom
```

## What is synchronized

- Page insertion, removal, movement, duplication, and rotation
- FreeText, ink, shape, markup, and note annotations
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

| Prop | Type | Meaning |
|---|---|---|
| `actorId` | `string` | Stable participant ID attached to submitted operations. |
| `relayUrl` | `string` | WebSocket endpoint implementing the relay wire protocol. |
| `sessionId` | `string` | Shared room/session identifier. Treat it as untrusted input, not authorization. |
| `src` | `string \| URL \| ArrayBuffer \| Uint8Array \| Blob` | Initial PDF registered as the session's `main` source. |
| `name` | `string?` | Accessible display label; defaults to `actorId`. |
| `wasmModulesUrl` | `string?` | Directory containing `pdfium_worker.js` and `pdfium.wasm`; defaults to `/pdfium/`. |
| `className` | `string?` | Additional class on the outer `.collab-pane`. |

The PDFium assets can be copied from `node_modules/@pdfrx/engine/assets/`, or
served from the package CDN:

```tsx
<CollaborativePdfViewer
  // ...
  wasmModulesUrl="https://cdn.jsdelivr.net/npm/@pdfrx/engine@0.9.0/assets/"
/>
```

## Architecture

The PDF is virtualized as an ordered list of stable placements:

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

Remote PDF mutations are applied with `origin: 'remote'`, which prevents
annotation and form event feedback loops. Missing source PDFs are fetched and
opened locally before placements that reference them are applied.

## Relay requirements

`CollaborativePdfViewer` and `PageCollaborationClient` expect the exported
`ClientRelayMessage` / `ServerRelayMessage` protocol:

- WebSocket join and authoritative session snapshots
- Strict `baseRevision` validation for page, annotation, and form operations
- Globally unique operation IDs and stable actor IDs
- Broadcast of committed operations to every participant, including the sender
- An immutable source endpoint at
  `PUT/GET /sessions/:sessionId/sources/:documentId`

Use `parseClientRelayMessage()` and `parseServerRelayMessage()` at trust
boundaries rather than accepting arbitrary parsed JSON. `relaySourceUrl()`
derives the HTTP source URL from the WebSocket relay URL, and
`uploadRelaySource()` uploads a PDF using the expected content type.

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

Use `PageCollaborationClient` when the UI or transport integration should be
yours:

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

`RelayOperationError` exposes the relay error `code` and optional
`currentRevision`, allowing a host to refresh or explain a stale operation.
The constructor accepts injectable operation-ID and WebSocket factories for
tests and non-browser hosts.

## Page source adapter

`PageSourceRegistry` maps session document IDs to open local `PdfDocument`
instances. `createPagePlacements()` creates stable initial placements,
`resolvePagePlacements()` converts an authoritative snapshot into local
`PdfPage` proxies, and `applyPagePlacementsToViewer()` applies the arrangement
without publishing it as another local edit.

Pure page-operation helpers are also exported:

| API | Purpose |
|---|---|
| `rotatePlacement()` | Produce an absolute rotation operation from a delta. |
| `duplicatePlacement()` | Insert another placement for the same source page. |
| `movePlacementToIndex()` | Express a drag/reorder using stable anchors. |
| `describePageOperation()` | Produce a concise activity label. |
| `commitPageOperation()` | Server-side validation and revision assignment. |
| `applyCommittedPageOperation()` | Apply an authoritative commit to a snapshot. |

Equivalent `commit*` and `applyCommitted*` reducers are exported for annotation
and form streams. They are transport-independent and suitable for a relay,
tests, persistence replay, or an alternative networking stack.

## Collaborative export

The displayed document may contain pages owned by several source PDFs.
`encodeCollaborativePdf()` materializes the authoritative arrangement without
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

`CollaborativePdfViewer` disables viewer-local Undo/Redo. Local history entries
contain page positions and annotation snapshots that can become stale after a
remote edit. Safe collaborative undo should submit a validated inverse relay
operation against stable placement/annotation IDs; replaying old client state
could overwrite another participant's work.

## API highlights

| Area | Main exports |
|---|---|
| React | `CollaborativePdfViewer`, `CollaborativePdfViewerProps` |
| Browser client | `PageCollaborationClient`, `RelayOperationError`, `relaySourceUrl`, `uploadRelaySource` |
| Page protocol | `PageSessionSnapshot`, `commitPageOperation`, `applyCommittedPageOperation`, `PageProtocolError` |
| Annotation protocol | `AnnotationSessionSnapshot`, `SharedAnnotationChange`, `commitAnnotationOperation`, `applyCommittedAnnotationOperation` |
| Form protocol | `FormSessionSnapshot`, `SharedFormFieldChange`, `commitFormOperation`, `applyCommittedFormOperation` |
| Source adapter | `PageSourceRegistry`, `createPagePlacements`, `resolvePagePlacements`, `applyPagePlacementsToViewer` |
| Export | `encodeCollaborativePdf`, `MappedOutlineNode` |
| Wire format | `ClientRelayMessage`, `ServerRelayMessage`, `parseClientRelayMessage`, `parseServerRelayMessage` |

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
