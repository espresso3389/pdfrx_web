# Customizing `PdfrxViewerApp`

`PdfrxViewerApp` provides the standard toolbar, responsive sidebar, page
surface, search, printing, annotation tools, image drops, and error chrome.
Most applications should configure it with its regular props and keep the
built-in editing behavior.

When an application needs to control how edits are performed, `renderContent`
places a controller inside the viewer's `PdfrxProvider`. The controller can use
the normal React hooks and call `renderChrome()` with only the operations it
needs to replace. Every omitted operation retains its built-in implementation.

```tsx
import {
  PdfrxViewerApp,
  type PdfrxViewerAppRenderContext,
} from '@pdfrx/react';

function CustomEditingController({
  renderChrome,
}: PdfrxViewerAppRenderContext) {
  const editing = useApplicationEditing();

  return renderChrome({
    openFile: editing.openFile,
    insertFiles: editing.insertFiles,
    movePage: editing.movePage,
    rotatePage: editing.rotatePage,
    deletePage: editing.deletePage,
    encode: editing.encode,
    beforeBody: editing.status,
    editingDisabled: !editing.ready,
  });
}

export function Viewer() {
  return (
    <PdfrxViewerApp
      src="/manual.pdf"
      enableFileOpen
      enablePageEditing
      renderContent={({ renderChrome }) => (
        <CustomEditingController renderChrome={renderChrome} />
      )}
    />
  );
}
```

## Editing operations

`openFile` replaces the file-open button's default behavior. `insertFiles`,
`movePage`, `rotatePage`, and `deletePage` replace the corresponding thumbnail
sidebar actions. `encode` replaces the data-generation step used by the
download button; `PdfrxViewerApp` still creates and downloads the resulting PDF
blob.

These overrides are useful when edits must pass through application-specific
validation, external persistence, an operation log, or a shared backend. They
are not required for ordinary local PDF editing.

## UI state and status

Set `editingDisabled` while the external editing implementation is unavailable
or busy. The app disables file and page editing controls, annotation entry, and
image drops while continuing to display the document.

`beforeBody` inserts application status or error UI between the standard chrome
above the document body and the main sidebar/surface row. Keep large custom
layouts outside `PdfrxViewerApp`; this slot is intended for compact banners and
notices.

## Choosing the right level

- Use ordinary `PdfrxViewerApp` props when the standard editing behavior is
  sufficient.
- Use `renderContent` and `PdfrxViewerAppOverrides` when the standard layout is
  desired but editing operations need application control.
- Compose `PdfrxProvider`, `PdfToolbar`, `PdfSidebar`, and `PdfViewerSurface`
  directly when the page structure or chrome itself must be different.

See the generated API reference for the exact callback signatures and argument
semantics.
