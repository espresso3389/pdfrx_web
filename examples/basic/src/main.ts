import { definePdfrxViewerElement, type PdfrxViewerElement } from '@pdfrx/viewer';

definePdfrxViewerElement();

const el = document.getElementById('viewer') as PdfrxViewerElement;
const selEl = document.getElementById('sel')!;

el.addEventListener('load', () => {
  console.log(`loaded: ${el.viewer?.document?.pages.length} pages`);
});
el.addEventListener('error', (e) => {
  console.error('failed to load PDF:', (e as CustomEvent).detail);
});

// Show the current selection in the header (poll for demo simplicity)
setInterval(() => {
  const text = el.viewer?.selectedText ?? '';
  selEl.textContent = text ? `sel: ${JSON.stringify(text.length > 40 ? text.slice(0, 40) + '…' : text)}` : '';
}, 300);
