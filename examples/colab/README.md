# `@pdfrx/colab` example

Two independent `CollaborativePdfViewer` instances connected to the reference
in-memory WebSocket relay. The example demonstrates synchronized page
arrangement, annotations, AcroForm values, imported PDF/image sources, and
mixed-source export.

From the repository root:

```sh
npm run dev:colab
```

The command starts Vite on port 5173 and owns the reference relay on port 5191.
Both ports are strict: check for an existing server before starting another
instance. The relay is intentionally for local demonstration and tests; it has
no authentication, durable persistence, or production authorization model.

Reusable browser and React code lives in [`packages/colab`](../../packages/colab/README.md).
The example workspace contains only the two-pane shell and reference relay.
