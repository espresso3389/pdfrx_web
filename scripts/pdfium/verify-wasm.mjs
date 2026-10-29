import { readFile } from 'node:fs/promises';

const [candidate, reference, header, worker] = process.argv.slice(2);
if (!candidate || !reference || !header || !worker) throw new Error('Usage: node verify-wasm.mjs candidate.wasm reference.wasm fpdf_raw.h pdfium_worker.js');
const module = new WebAssembly.Module(await readFile(candidate));
const baseline = new WebAssembly.Module(await readFile(reference));
const exports = new Set(WebAssembly.Module.exports(module).map(({ name, kind }) => `${kind}:${name}`));
const imports = new Set(WebAssembly.Module.imports(baseline).map(({ module, name, kind }) => `${module}:${name}:${kind}`));
const requiredExports = new Set(WebAssembly.Module.exports(baseline).map(({ name, kind }) => `${kind}:${name}`));
const rawHeader = await readFile(header, 'utf8');
const workerSource = await readFile(worker, 'utf8');
for (const match of rawHeader.matchAll(/\b(FPDFRaw_\w+)\s*\(/g)) requiredExports.add(`function:${match[1]}`);
for (const match of workerSource.matchAll(/(?:wasmExports|\bw)\.(FPDF\w+|FORM_\w+|malloc|calloc|realloc|free)\b/g)) requiredExports.add(`function:${match[1]}`);
const missing = [...requiredExports].filter((name) => !exports.has(name));
// Explicitly reviewed additions implemented by the worker.
imports.add('env:emscripten_errn:function');
const newImports = WebAssembly.Module.imports(module).map(({ module, name, kind }) => `${module}:${name}:${kind}`).filter((name) => !imports.has(name));
if (missing.length || newImports.length) throw new Error(`Missing exports:\n${missing.sort().join('\n')}\nNew imports:\n${newImports.sort().join('\n')}`);
console.log(`Verified ${requiredExports.size} required exports and candidate imports against the bundled WASM.`);
