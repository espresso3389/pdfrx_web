# Customizing [`PdfrxViewerApp`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfrxViewerApp.html)

[`PdfrxViewerApp`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfrxViewerApp.html)
provides the standard toolbar, responsive sidebar, page surface, search,
printing, annotation tools, image drops, and error chrome. Most applications
should configure it with its regular
[`PdfrxViewerAppProps`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxViewerAppProps.html)
and keep the built-in editing behavior.

When an application needs to control how edits are performed,
[`renderContent`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxViewerAppProps.html#rendercontent)
places a controller inside the viewer's
[`PdfrxProvider`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfrxProvider.html).
The controller can use the normal React hooks and call
[`renderChrome()`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxViewerAppRenderContext.html#renderchrome)
with only the operations it needs to replace. Every omitted operation retains
its built-in implementation.

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
    onSaveError: editing.reportSaveError,
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

[`openFile`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxViewerAppOverrides.html#openfile)
replaces the file-open button's default behavior.
[`insertFiles`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxViewerAppOverrides.html#insertfiles),
[`movePage`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxViewerAppOverrides.html#movepage),
[`rotatePage`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxViewerAppOverrides.html#rotatepage),
and
[`deletePage`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxViewerAppOverrides.html#deletepage)
replace the corresponding thumbnail sidebar actions.
[`encode`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxViewerAppOverrides.html#encode)
replaces the data-generation step used by the download button;
[`PdfrxViewerApp`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfrxViewerApp.html)
still creates and downloads the resulting PDF blob.
During this work the button is disabled, shows a busy indicator, and exposes
`aria-busy="true"`.
[`onSaveError`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxViewerAppOverrides.html#onsaveerror)
receives an error thrown by text-edit flushing, encoding, blob creation, or
download startup so the host can present it through `beforeBody` or another
application error surface.

These overrides are useful when edits must pass through application-specific
validation, external persistence, an operation log, or a shared backend. They
are not required for ordinary local PDF editing.

## UI state and status

Set
[`editingDisabled`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxViewerAppOverrides.html#editingdisabled)
while the external editing implementation is unavailable or busy. The app
disables file and page editing controls, annotation entry, and image drops
while continuing to display the document.

[`beforeBody`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxViewerAppOverrides.html#beforebody)
inserts application status or error UI between the standard chrome above the
document body and the main sidebar/surface row. Keep large custom layouts
outside
[`PdfrxViewerApp`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfrxViewerApp.html);
this slot is intended for compact banners and notices.

## Choosing the right level

- Use ordinary
  [`PdfrxViewerAppProps`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxViewerAppProps.html)
  when the standard editing behavior is sufficient.
- Use
  [`renderContent`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxViewerAppProps.html#rendercontent)
  and
  [`PdfrxViewerAppOverrides`](https://espresso3389.github.io/pdfrx_web/interfaces/_pdfrx_react.PdfrxViewerAppOverrides.html)
  when the standard layout is desired but editing operations need application
  control.
- Compose
  [`PdfrxProvider`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfrxProvider.html),
  [`PdfToolbar`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfToolbar.html),
  [`PdfSidebar`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfSidebar.html),
  and
  [`PdfViewerSurface`](https://espresso3389.github.io/pdfrx_web/functions/_pdfrx_react.PdfViewerSurface.html)
  directly when the page structure or chrome itself must be different.

See the generated API reference for the exact callback signatures and argument
semantics.
