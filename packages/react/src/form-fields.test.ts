import { decodeFormFieldFlags, pdfFormFieldTypeFromCode } from '@pdfrx/engine';
import { describe, expect, it } from 'vitest';

describe('pdfFormFieldTypeFromCode', () => {
  it('maps the FPDF_FORMFIELD_* codes to names', () => {
    expect(pdfFormFieldTypeFromCode(0)).toBe('unknown');
    expect(pdfFormFieldTypeFromCode(1)).toBe('pushButton');
    expect(pdfFormFieldTypeFromCode(2)).toBe('checkBox');
    expect(pdfFormFieldTypeFromCode(3)).toBe('radioButton');
    expect(pdfFormFieldTypeFromCode(4)).toBe('comboBox');
    expect(pdfFormFieldTypeFromCode(5)).toBe('listBox');
    expect(pdfFormFieldTypeFromCode(6)).toBe('textField');
    expect(pdfFormFieldTypeFromCode(7)).toBe('signature');
  });

  it('falls back to unknown for out-of-range codes', () => {
    expect(pdfFormFieldTypeFromCode(99)).toBe('unknown');
    expect(pdfFormFieldTypeFromCode(-1)).toBe('unknown');
  });
});

describe('decodeFormFieldFlags', () => {
  it('decodes each FPDF_FORMFLAG_* bit independently', () => {
    expect(decodeFormFieldFlags(0)).toEqual({ readOnly: false, required: false, noExport: false });
    expect(decodeFormFieldFlags(1)).toEqual({ readOnly: true, required: false, noExport: false });
    expect(decodeFormFieldFlags(2)).toEqual({ readOnly: false, required: true, noExport: false });
    expect(decodeFormFieldFlags(4)).toEqual({ readOnly: false, required: false, noExport: true });
  });

  it('decodes combined bits', () => {
    expect(decodeFormFieldFlags(1 | 2)).toEqual({ readOnly: true, required: true, noExport: false });
    expect(decodeFormFieldFlags(1 | 2 | 4)).toEqual({ readOnly: true, required: true, noExport: true });
    // Higher bits (e.g. Multiline = 1<<12) do not affect the three decoded flags.
    expect(decodeFormFieldFlags(1 | (1 << 12))).toEqual({ readOnly: true, required: false, noExport: false });
  });
});
