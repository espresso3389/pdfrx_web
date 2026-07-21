/**
 * A tiny, JavaScript-free evaluator for the most common AcroForm field
 * calculation: Acrobat's built-in `AFSimple_Calculate`. The vendored
 * `pdfium.wasm` has no JS engine, so calculate actions (`/AA/C`) are read but
 * never run; this recomputes the common cases on the client instead. Arbitrary
 * custom field JavaScript is intentionally not supported.
 */

/** Reduction operation of an `AFSimple_Calculate` action. */
export type FormCalcOp = 'SUM' | 'PRD' | 'AVG' | 'MIN' | 'MAX';

/** A parsed `AFSimple_Calculate(op, [fields])` calculation. */
export interface FormCalcSpec {
  readonly op: FormCalcOp;
  /** Fully-qualified names of the operand fields. */
  readonly fields: readonly string[];
}

const AFSIMPLE_RE =
  /AFSimple_Calculate\s*\(\s*["']([A-Za-z]+)["']\s*,\s*(?:new\s+Array\s*\(|\[)([\s\S]*?)(?:\)|\])/;

const isOp = (s: string): s is FormCalcOp =>
  s === 'SUM' || s === 'PRD' || s === 'AVG' || s === 'MIN' || s === 'MAX';

/**
 * Parses a calculate-action JavaScript source into a {@link FormCalcSpec}, or
 * returns `null` when it is not a recognized `AFSimple_Calculate` call (custom
 * scripts are left untouched).
 */
export function parseCalcAction(js: string | null | undefined): FormCalcSpec | null {
  if (!js) return null;
  const m = AFSIMPLE_RE.exec(js);
  if (!m) return null;
  const opRaw = m[1];
  const list = m[2];
  if (!opRaw || list === undefined) return null;
  const op = opRaw.toUpperCase();
  if (!isOp(op)) return null;
  const fields = [...list.matchAll(/["']([^"']+)["']/g)].map((x) => x[1]!).filter(Boolean);
  if (fields.length === 0) return null;
  return { op, fields };
}

/**
 * Parses a form-field display value to a number, stripping thousands
 * separators, currency symbols and other non-numeric decoration. Returns `null`
 * for blank or unparseable values.
 */
export function parseFieldNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const cleaned = value.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Formats a computed number as a plain string, killing float-rounding noise. */
function formatResult(n: number): string {
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n * 1e6) / 1e6);
}

/**
 * Evaluates a {@link FormCalcSpec} against the current field values. Blank or
 * unparseable operands are skipped (a `SUM` of no operands is `0`; the other
 * operations return `null` when there is nothing to combine, leaving the field
 * unchanged). Returns the computed value as a plain number string, or `null`.
 */
export function evaluateCalc(spec: FormCalcSpec, values: ReadonlyMap<string, string>): string | null {
  const nums: number[] = [];
  for (const name of spec.fields) {
    const n = parseFieldNumber(values.get(name));
    if (n !== null) nums.push(n);
  }
  switch (spec.op) {
    case 'SUM':
      return formatResult(nums.reduce((a, b) => a + b, 0));
    case 'PRD':
      return nums.length === 0 ? null : formatResult(nums.reduce((a, b) => a * b, 1));
    case 'AVG':
      return nums.length === 0 ? null : formatResult(nums.reduce((a, b) => a + b, 0) / nums.length);
    case 'MIN':
      return nums.length === 0 ? null : formatResult(Math.min(...nums));
    case 'MAX':
      return nums.length === 0 ? null : formatResult(Math.max(...nums));
  }
}
