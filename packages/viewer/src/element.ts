import { PdfrxViewer } from './viewer.js';

// Keep the module importable in non-browser environments (SSR); the element
// is only usable in a browser, but importing it must not throw.
const HTMLElementBase: typeof HTMLElement =
  typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as unknown as typeof HTMLElement);

/**
 * Custom element wrapping {@link PdfrxViewer}: `<pdfrx-viewer>`.
 *
 * A thin declarative shell that constructs a {@link PdfrxViewer} into itself on
 * connect and opens the `src` URL. The element fills its own box; size it with
 * CSS (it defaults to `display: block`). Register the tag once with
 * {@link definePdfrxViewerElement} before use.
 *
 * Attributes:
 * - `src` — document URL to open (observed; changing it reloads via
 *   {@link PdfrxViewer.openUrl}, so the server must allow CORS).
 * - `wasm-modules-url` — directory that contains `pdfium_worker.js` and
 *   `pdfium.wasm`; passed through as the engine's `wasmModulesUrl`. Read once on
 *   connect; defaults to `'pdfium/'`.
 *
 * Events (both `CustomEvent`):
 * - `load` — dispatched on every document change (including programmatic opens
 *   and the automatic reopen after missing-font registration); `detail.src`
 *   holds the current `src`.
 * - `error` — dispatched when opening `src` fails; `detail` holds `{ src, error }`.
 *
 * @example
 * ```html
 * <pdfrx-viewer src="doc.pdf" wasm-modules-url="pdfium/" style="height: 100vh"></pdfrx-viewer>
 * <script type="module">
 *   import { definePdfrxViewerElement } from '@pdfrx/viewer';
 *   definePdfrxViewerElement();
 * </script>
 * ```
 */
export class PdfrxViewerElement extends HTMLElementBase {
  static observedAttributes = ['src'];

  #viewer: PdfrxViewer | null = null;

  /** The underlying {@link PdfrxViewer}, or `null` before connect / after disconnect. */
  get viewer(): PdfrxViewer | null {
    return this.#viewer;
  }

  /** Creates the viewer, wires up the `load` event, and opens `src` if present. */
  connectedCallback(): void {
    if (!this.style.display) this.style.display = 'block';
    this.#viewer = new PdfrxViewer(this, {
      engineOptions: { wasmModulesUrl: this.getAttribute('wasm-modules-url') ?? 'pdfium/' },
    });
    // Fires for every document change, including programmatic opens and the
    // automatic reopen after missing-font registration.
    this.#viewer.addDocumentChangeListener(() => {
      this.dispatchEvent(new CustomEvent('load', { detail: { src: this.getAttribute('src') } }));
    });
    const src = this.getAttribute('src');
    if (src) void this.#load(src);
  }

  /** Disposes the viewer (tearing down the worker) when removed from the DOM. */
  disconnectedCallback(): void {
    this.#viewer?.dispose();
    this.#viewer = null;
  }

  /** Reloads the document when the observed `src` attribute changes to a new value. */
  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (name === 'src' && this.#viewer && newValue && newValue !== oldValue) {
      void this.#load(newValue);
    }
  }

  /** Opens `src`, dispatching an `error` event on failure. */
  async #load(src: string): Promise<void> {
    try {
      await this.#viewer?.openUrl(src);
    } catch (e) {
      this.dispatchEvent(new CustomEvent('error', { detail: { src, error: e } }));
    }
  }
}

/**
 * Registers {@link PdfrxViewerElement} as a custom element (no-op if the tag is
 * already defined or `customElements` is unavailable, e.g. during SSR).
 *
 * @param tagName - Tag name to register under. Defaults to `'pdfrx-viewer'`.
 *
 * @example
 * ```ts
 * import { definePdfrxViewerElement } from '@pdfrx/viewer';
 * definePdfrxViewerElement();
 * // then: <pdfrx-viewer src="doc.pdf" wasm-modules-url="pdfium/"></pdfrx-viewer>
 * ```
 */
export function definePdfrxViewerElement(tagName = 'pdfrx-viewer'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tagName)) {
    customElements.define(tagName, PdfrxViewerElement);
  }
}
