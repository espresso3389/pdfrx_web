/**
 * Collaborative React viewer, strict-revision session protocols, browser relay
 * client, virtual-page adapter, and mixed-source PDF export composition for
 * the pdfrx package family.
 *
 * The package keeps rendering and PDF mutation client-local. A relay sequences
 * semantic page, annotation, and form operations; each participant applies the
 * resulting authoritative state to its own open `PdfDocument` instances.
 *
 * @packageDocumentation
 */
export * from './annotation-protocol.js';
export * from './client.js';
export * from './collaborative-viewer.js';
export * from './export-composer.js';
export * from './form-protocol.js';
export * from './page-adapter.js';
export * from './protocol.js';
export * from './ui-operations.js';
export * from './wire.js';
