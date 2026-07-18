import { PdfrxViewer } from './viewer.js';

/**
 * `<pdfrx-viewer src="doc.pdf" wasm-modules-url="pdfium/">`
 *
 * A thin custom-element wrapper over `PdfrxViewer`. The element fills its own
 * box; size it with CSS.
 */
export class PdfrxViewerElement extends HTMLElement {
  static observedAttributes = ['src'];

  #viewer: PdfrxViewer | null = null;

  get viewer(): PdfrxViewer | null {
    return this.#viewer;
  }

  connectedCallback(): void {
    if (!this.style.display) this.style.display = 'block';
    this.#viewer = new PdfrxViewer(this, {
      engineOptions: { wasmModulesUrl: this.getAttribute('wasm-modules-url') ?? 'pdfium/' },
    });
    const src = this.getAttribute('src');
    if (src) void this.#load(src);
  }

  disconnectedCallback(): void {
    this.#viewer?.dispose();
    this.#viewer = null;
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (name === 'src' && this.#viewer && newValue && newValue !== oldValue) {
      void this.#load(newValue);
    }
  }

  async #load(src: string): Promise<void> {
    try {
      await this.#viewer?.openUrl(src);
      this.dispatchEvent(new CustomEvent('load', { detail: { src } }));
    } catch (e) {
      this.dispatchEvent(new CustomEvent('error', { detail: { src, error: e } }));
    }
  }
}

export function definePdfrxViewerElement(tagName = 'pdfrx-viewer'): void {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, PdfrxViewerElement);
  }
}
