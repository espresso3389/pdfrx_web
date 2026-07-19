// Generates examples/basic/public/nofont.pdf: a minimal PDF that uses
// non-embedded fonts (Arial + MS-PGothic Type0/90ms-RKSJ-H), which the
// pdfium WASM engine cannot render without the font fallback machinery.

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(repoRoot, 'examples', 'basic', 'public', 'nofont.pdf');

// "日本語のテキスト" in Shift-JIS (90ms-RKSJ-H encoding)
const sjisHex = '93FA967B8CEA82CC8365834C83588367';

const content = [
  'BT /F1 24 Tf 40 240 Td (Missing Font Fallback) Tj ET',
  'BT /F1 14 Tf 40 210 Td (Times-like text uses Tinos substitute.) Tj ET',
  `BT /F2 24 Tf 40 160 Td <${sjisHex}> Tj ET`,
].join('\n');

const widths = Array(91).fill(500).join(' ');

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] ' +
    '/Resources << /Font << /F1 4 0 R /F2 6 0 R >> >> /Contents 8 0 R >>',
  `<< /Type /Font /Subtype /TrueType /BaseFont /Arial /Encoding /WinAnsiEncoding ` +
    `/FirstChar 32 /LastChar 122 /Widths [${widths}] /FontDescriptor 5 0 R >>`,
  '<< /Type /FontDescriptor /FontName /Arial /Flags 32 /FontBBox [-100 -300 1000 900] ' +
    '/ItalicAngle 0 /Ascent 728 /Descent -210 /CapHeight 716 /StemV 87 >>',
  '<< /Type /Font /Subtype /Type0 /BaseFont /MS-PGothic /Encoding /90ms-RKSJ-H /DescendantFonts [7 0 R] >>',
  '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /MS-PGothic ' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> ' +
    '/FontDescriptor 9 0 R /DW 1000 >>',
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  '<< /Type /FontDescriptor /FontName /MS-PGothic /Flags 4 /FontBBox [-100 -300 1100 900] ' +
    '/ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 716 /StemV 87 >>',
];

let pdf = '%PDF-1.4\n';
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xrefOffset = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += '0000000000 65535 f \n';
for (const offset of offsets) {
  pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

writeFileSync(outFile, pdf, 'latin1');
console.log(`Wrote ${outFile} (${pdf.length} bytes)`);
