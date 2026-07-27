# @pdfrx/colab

Collaborative PDF editing for `@pdfrx/react`. It provides a ready-made React
viewer plus the browser client, operation protocols, page-source adapter, and
mixed-source export tools needed to synchronize page, annotation, and form
changes through an application-hosted relay.

**[Local example](https://github.com/espresso3389/pdfrx_web/tree/master/examples/colab)** ·
**[API reference](https://espresso3389.github.io/pdfrx_web/modules/_pdfrx_colab.html)** ·
**[Detailed guide](https://github.com/espresso3389/pdfrx_web/blob/master/docs/COLAB-GUIDE.md)**

## Highlights

- Synchronizes page insertion, removal, movement, duplication, and rotation;
  annotations; and AcroForm values.
- Ordered, revision-checked semantic operations keep WebSocket traffic small
  and provide authoritative late-join snapshots.
- Page, annotation, and form changes use independent revision streams so one
  kind of edit does not block the others.
- Transient move/resize previews appear remotely without entering persistent
  snapshots, PDF state, or Undo/Redo history.
- Stable page-placement and source IDs support documents assembled from
  multiple immutable PDFs and images.
- The ready-made React viewer retains the standard `@pdfrx/react` toolbar,
  responsive layout, editing tools, and export UI.
- Lower-level clients, reducers, source adapters, and mixed-source PDF export
  are available for custom applications and relay implementations.
- Authentication, persistence, admission, retention, and deployment remain
  explicit application responsibilities rather than hidden hosted services.

## Install

```sh
npm install @pdfrx/colab @pdfrx/react react react-dom
```

## Minimal usage

```tsx
import { CollaborativePdfViewer } from '@pdfrx/colab';
import '@pdfrx/react/styles.css';
import '@pdfrx/colab/styles.css';

export function ReviewRoom() {
  return (
    <CollaborativePdfViewer
      actorId="user-42"
      relayUrl="wss://relay.example.com/collaboration"
      sessionId="review-123"
      src="/documents/review.pdf"
      wasmModulesUrl="/pdfium/"
      className="review-room"
    />
  );
}
```

```css
.review-room {
  height: 100dvh;
  min-height: 0;
}
```

## Required relay

`relayUrl` must be an application-hosted WebSocket service implementing the
exported collaboration protocol. This package does not include or operate a
hosted production service. The relay must sequence revision-checked page,
annotation, and form operations and expose immutable PDF/raster source
`PUT`/`GET` endpoints.

Run `npm run dev:colab` in this repository to start the example application and
reference relay for local development.

## Next steps

- The [Colab guide](https://github.com/espresso3389/pdfrx_web/blob/master/docs/COLAB-GUIDE.md)
  covers authentication hooks, synchronized state, lower-level clients,
  adapters, export, conflicts, and production responsibilities.
- The [wire protocol specification](https://github.com/espresso3389/pdfrx_web/blob/master/docs/COLLABORATION-PROTOCOL.md)
  is the authoritative relay contract.
- [`CollaborativePdfViewerProps`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_colab.CollaborativePdfViewerProps.html)
  documents all component inputs.
- The [collaboration example](https://github.com/espresso3389/pdfrx_web/tree/master/examples/colab)
  documents local relay configuration, persistence, and deployment boundaries.

## License

MIT
