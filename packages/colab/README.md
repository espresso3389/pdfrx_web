# `@pdfrx/colab`

Collaborative React viewer for [`@pdfrx/react`](https://www.npmjs.com/package/@pdfrx/react). It synchronizes page
arrangements, annotations, and AcroForm values through a relay while each
participant renders and edits its own local `PdfDocument` instances.

```tsx
import { CollaborativePdfViewer } from '@pdfrx/colab';
import '@pdfrx/react/styles.css';
import '@pdfrx/colab/styles.css';

<CollaborativePdfViewer
  actorId="alice"
  name="Alice"
  relayUrl="wss://relay.example.test"
  sessionId="random-session-key"
  src="/document.pdf"
  wasmModulesUrl="/pdfium/"
/>
```

The package contains the browser client, shared protocol types, virtual-page
adapter, and mixed-source export composer. Hosting, authentication, persistence,
authorization, and the WebSocket relay remain application responsibilities.

The bundled client expects the reference relay protocol and source endpoints
documented by the exported wire types. A production application may instead use
the lower-level protocol and adapter exports with its own transport.
