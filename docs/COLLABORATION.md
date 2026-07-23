# Collaborative editing design

This document records the boundary between the reusable `@pdfrx/*` packages
and the collaborative PDF application in this repository. The browser-side
integration is published as `@pdfrx/colab`; the deployable single-viewer client,
persistent relay, and reference test fixture remain in the private
`examples/colab` workspace.

The scope is page arrangement (insert, remove, move, duplicate, and rotate),
content annotations, presence, and persistence. Editing existing PDF page
content is out of scope.

## Local editing foundation

The local editing stack supplies:

- `PdfDocument.setPages()` synchronously replaces the virtual page arrangement.
  Pages can be reordered, removed, duplicated, rotated, or borrowed from an
  open source document without rebuilding the PDF.
- `PdfrxViewer.setPages()` and `setPage()` add page edits to the viewer's common
  annotation/form/page undo history.
- `pagesRearranged` invalidates position-keyed viewer and React state while the
  render and thumbnail caches remain keyed by page content.
- annotations have stable PDF `/NM` IDs, full snapshot import/export, exact
  incremental `PdfAnnotationChange` values, `origin`, `transactionId`,
  `actorId`, and per-annotation revisions.
- `usePdfrxViewer()`, `useAnnotations()`, and the lower-level engine APIs allow
  a React application to control these features without putting networking in
  the viewer.

The transport and protocol remain application concerns. The application exposes
their React integration as a reusable `CollaborativePdfViewer` component: it
sends commands to the same engine/viewer mutations used by local UI and applies
remote commands with a remote origin so they are not echoed. The application
mounts one instance after creating or joining a protected session. See
[COLLABORATION-PROTOCOL.md](COLLABORATION-PROTOCOL.md) for the complete
WebSocket envelopes, sequencing rules, rejection codes, transient annotation
previews, and source-PDF HTTP endpoints.

## Collaboration adapter boundary

`pagesRearranged` reports origin/transaction/actor metadata and exact before and
after local arrangement descriptors. Those descriptors deliberately use
engine-process source identities, not network identities. Comparing
`PdfPage.renderKey` values across clients is not valid: the same physical page
can appear more than once, handles are process-local, and page numbers change
after every rearrangement. The adapter therefore maps them to stable session
placement and source-document IDs.

Annotations also report a page number. That is sufficient inside one current
arrangement, but a network operation must address a stable page placement so a
concurrent insertion or move cannot redirect the annotation to another page.

Annotation mutations on imported pages are routed to the `PdfDocument` that
owns the physical source page while their change events retain the arrangement's
1-based page number. Added PDF and image pages are therefore immediately
annotatable without first materializing the combined document.

The application uploads an imported PDF once to the relay under a session-scoped
source document ID. Page placements reference that ID and a physical page
index; each participant downloads and opens a missing source before applying
the committed placement. The relay stores source PDFs on disk, persists
materialized state using atomic file replacement, admits new devices after any
connected member approves them, and defaults to a 50 MiB limit.
Retention, malware scanning, per-user quotas, and multi-instance coordination
remain production concerns.

## Shared application model

Keep the session document as an application-owned model. A page placement has a
stable identity distinct from its source content identity.

```ts
type PagePlacementId = string;
type SourceDocumentId = string;

interface SharedPagePlacement {
  placementId: PagePlacementId;
  source: {
    documentId: SourceDocumentId;
    pageIndex: number;
  };
  rotation: 0 | 90 | 180 | 270;
}

interface SharedDocumentState {
  revision: number;
  pages: readonly SharedPagePlacement[];
}
```

`placementId` identifies one slot and survives moves and rotations. Two copies
of one source page have different placement IDs. `documentId` identifies an
uploaded immutable PDF asset; it must not be a browser-local engine handle.

Network annotations address `placementId`, while the adapter resolves that ID
to the current 1-based page number immediately before calling the engine.
Annotation geometry remains in PDF page coordinates.

The protocol maintains a second authoritative revision stream for
annotations. Exact add, update, and remove changes from `annotationsChanged`
are converted from page numbers to placement IDs, committed by the relay, and
converted back against each participant's current arrangement. Remote applies
use `origin: 'remote'`, preventing echo loops; the relay snapshot lets a later
participant reconstruct the current shared annotation set.

During object movement and anchor/group resizing, the viewer also broadcasts
non-persistent annotation previews. These update the other participants' SVG
overlays immediately but do not change the PDF, annotation revision, snapshot,
or undo history. Pointer release submits the final full annotation spec through
the ordered, revision-checked operation stream.

Forms use an independent ordered, revision-checked operation stream. A field is
addressed by immutable source `documentId` plus its fully-qualified AcroForm
field name; values retain
their `string | boolean | string[]` shape. The relay stores virtual field state,
while every participant calls `setFormFieldValue()` on its own source document.
Choice fields use selected option-label arrays, including single-select controls,
so PDFs whose export values differ from display labels replay correctly.
Remote applies are suppressed from publication to avoid echo loops. Because a
virtual arrangement can contain pages owned by imported documents, the viewer
subscribes to `formFieldsChanged` on every source document currently represented
by the arrangement, not only on its root `PdfDocument`.

Saving a replacement made entirely from one uploaded PDF uses that source PDF
as the export base. Page import alone cannot carry document-level dictionaries,
so cloning the source is required to retain its AcroForm, outline, metadata and
name trees. For mixed-source arrangements an export-only composition pass
rebuilds one outline against final page indices and one AcroForm from the Widget
annotations copied with each page. Source-scoped prefixes (`source_1.*`,
`source_2.*`) keep equal field names independent. This pass is loaded lazily so
ordinary viewing does not pay for the low-level PDF writer. PDFium's page-import
API cannot do this catalog merge itself. Recognized `AFSimple_Calculate`
actions have their operand names rewritten to the source namespace, and each
source `/CO` sequence is appended in source order to the merged calculation
order. XFA, signature preservation, and arbitrary JavaScript remain unsupported.

## Page operation protocol

The minimum protocol should express intent rather than transmit the entire
array. Position inserts and moves relative to another stable placement.

```ts
type PageOperation =
  | {
      type: 'page.replace';
      pages: readonly SharedPagePlacement[];
    }
  | {
      type: 'page.insert';
      page: SharedPagePlacement;
      after: PagePlacementId | null;
    }
  | {
      type: 'page.remove';
      placementId: PagePlacementId;
    }
  | {
      type: 'page.move';
      placementId: PagePlacementId;
      after: PagePlacementId | null;
    }
  | {
      type: 'page.rotate';
      placementId: PagePlacementId;
      rotation: 0 | 90 | 180 | 270;
    };

interface OperationEnvelope<T> {
  operationId: string;
  actorId: string;
  baseRevision: number;
  operation: T;
}
```

The server is authoritative. It validates each command, assigns a monotonically
increasing revision, and broadcasts the committed operation. Concurrent
commands are serialized in relay arrival order. Operations targeting a removed
placement are rejected. The current clients wait for committed operations
rather than applying optimistically and rebuild from snapshots when joining.

Do not send PDF bytes over the operation channel. Upload a source PDF first,
obtain its `documentId`, and then insert placements referring to that asset.

## Reusable APIs

The collaboration protocol itself must not be added to `@pdfrx/react` or its
lower packages. The reusable packages need only expose observable mutations and
origin-aware application primitives.

### Page mutation metadata

The page mutation APIs provide page equivalents of the annotation mutation
concepts:

- a page-change origin (`user`, `api`, `remote`, `restore`, `history`, or
  `materialize`);
- optional `transactionId` and `actorId`;
- before/after local arrangement descriptors;
- viewer entry points that apply a remote/restore page arrangement without
  publishing it again and, by default, without adding it to local undo history;
- `usePdfPageChanges()` for exact event subscription without inferring changes
  from a rerender.

`PdfrxViewer.setPages()` / `setPage()` accept mutation metadata and
`recordHistory`. Remote and restore callers can therefore apply an arrangement
without echoing it or adding it to the local user's Undo/Redo stack. The local
descriptors intentionally contain engine-process source identities, not session
placement IDs.

The ready-made `CollaborativePdfViewer` currently disables viewer-local
Undo/Redo entirely. A local entry can become stale after another participant
moves a page or updates the same annotation. Collaborative undo must instead
submit a validated inverse operation addressed by placement and annotation id.

Stable placement IDs should initially remain in the collaboration adapter,
because they are session identity rather than PDF identity. The
network-independent `PagePlacement` model and pure reducer live in
`@pdfrx/viewer-core`; the application remains responsible for generating IDs,
mapping source document IDs to open PDFs, and attaching server revisions.

The reducer validates unique placement IDs, source descriptors, anchors, and
the minimum page count. Missing targets are explicit validation errors rather
than implicit no-ops; the authoritative server decides whether a stale command
is rejected or transformed before broadcasting its committed form. In
particular, the server must canonicalize multiple inserts at the same anchor if
it wants commit order rather than the natural reverse order of repeated
"insert immediately after" operations.

### Annotation and form adapters

The adapter maps network `placementId` values to current page numbers at apply
time. Annotation writes are routed to the physical source owner, including for
newly imported PDF and image pages. Remote changes use `origin: 'remote'` and
stay outside local undo history. Form changes use the source `documentId` plus
fully-qualified field name and are applied independently by every client.
Retention/restoration policy for annotations belonging to a removed placement
remains an application/session-history decision.

### Collaboration package and application workspace

`@pdfrx/colab` contains the shared protocol, browser client, React viewer,
client adapter, and export composer. `PageSourceRegistry` maps stable session `documentId`
values to client-local open `PdfDocument` instances; `resolvePagePlacements()`
turns the session model into engine `PdfPage` proxies, and
`applyPagePlacementsToViewer()` preserves origin/transaction/actor metadata.

The strict protocol primitive accepts a command only at its declared
`baseRevision`, assigns the next revision, and applies committed events only in
sequence. A revision gap is treated as an error; production recovery must
rejoin for a fresh snapshot rather than guessing at state. The browser client
waits for page, annotation, and form snapshots before it reports a completed
join or sends queued operations. The production relay serializes each
session's operations, persists accepted state, and only then broadcasts the
commit. Integration tests use `InMemoryPageRelay` as a fast relay fixture.

Run `npm run dev:colab` for the end-to-end application. It starts the
single-viewer session client and Node.js relay. Users create a session from a PDF or
request admission using its shared URL. Any connected member may approve.

The same integration can be embedded without the demo shell:

```tsx
import { CollaborativePdfViewer } from '@pdfrx/colab';
import '@pdfrx/react/styles.css';
import '@pdfrx/colab/styles.css';

<CollaborativePdfViewer
  actorId={currentUser.id}
  name={currentUser.displayName}
  sessionId={sessionId}
  relayUrl="wss://relay.example.com"
  src="/document.pdf"
  wasmModulesUrl="/pdfium/"
/>
```

The app's `main.tsx` provides session creation/joining and the single-viewer
shell. Viewer synchronization behavior lives in the published package; the
Relay server remains application code because authentication, storage, retention,
and deployment policy belong to the host.

The implemented application covers:

1. create a durable session from a PDF and receive its first device membership;
2. join from independent browser clients;
3. synchronize rotate, move, insert, and remove by placement ID;
4. synchronize annotation add, update, and remove using exact change metadata;
5. synchronize typed AcroForm values against source document IDs and field names;
6. reconnect pages, annotations, and forms from independent revision snapshots;
7. export mixed-source outlines and namespaced AcroForms, including recognized
   `AFSimple_Calculate` references and calculation order;
8. apply remote changes without echoing or polluting local undo.

User accounts, read-only roles, audit-log retention, administrative deletion,
and final server-side PDF generation are outside the current application scope.

## Current semantics and remaining decisions

The following semantics affect the data model and should not be left implicit:

- **Duplicate independence.** Recommended: duplicating a page creates an
  independent placement whose annotations can diverge. The current borrowed
  `PdfPage` proxy may share underlying annotation state, so materialization or a
  placement-level annotation overlay is required.
- **Last-page removal.** The engine currently rejects an empty arrangement.
  Keep the application invariant of at least one page.
- **Page removal.** Recommended: retain the removed placement and its annotation
  state in the operation history so an authorized undo can restore both.
- **Concurrent annotation edits.** Recommended: reject stale per-annotation
  revisions and let the client rebase; use temporary UI locks only as a user
  experience aid, not as the consistency mechanism.

## Package ownership

| Concern | Owner |
|---|---|
| PDF loading, page proxies, encoding, annotation persistence | `@pdfrx/engine` |
| Pure placement/reducer logic, if generalized | `@pdfrx/viewer-core` |
| Observable local mutations, remote application, rendering | `@pdfrx/viewer` |
| Hooks and React composition | `@pdfrx/react` |
| Session model, placement IDs, optimistic state, WebSocket | collaborative app |
| Revision ordering, authorization, snapshots, asset storage | relay server |
