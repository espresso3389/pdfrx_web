import { evaluateCalc, parseCalcAction, parseFieldNumber, type FormCalcSpec } from '@pdfrx/engine';
import { describe, expect, it } from 'vitest';

describe('parseCalcAction', () => {
  it('parses AFSimple_Calculate with new Array(...)', () => {
    expect(parseCalcAction('AFSimple_Calculate("SUM", new Array ("a", "b"));')).toEqual({
      op: 'SUM',
      fields: ['a', 'b'],
    });
    expect(parseCalcAction('AFSimple_Calculate("PRD", new Array("x","y"))')).toEqual({
      op: 'PRD',
      fields: ['x', 'y'],
    });
  });

  it('parses the array-literal form and single quotes', () => {
    expect(parseCalcAction("AFSimple_Calculate('AVG', ['p', 'q', 'r'])")).toEqual({
      op: 'AVG',
      fields: ['p', 'q', 'r'],
    });
  });

  it('returns null for unrecognized / custom scripts', () => {
    expect(parseCalcAction('event.value = this.getField("a").value * 1.1;')).toBeNull();
    expect(parseCalcAction('AFSimple_Calculate("BOGUS", new Array("a"))')).toBeNull();
    expect(parseCalcAction('')).toBeNull();
    expect(parseCalcAction(null)).toBeNull();
  });
});

describe('parseFieldNumber', () => {
  it('strips thousands separators and currency', () => {
    expect(parseFieldNumber('1,234.50')).toBe(1234.5);
    expect(parseFieldNumber('$ 42')).toBe(42);
    expect(parseFieldNumber('-7')).toBe(-7);
  });
  it('returns null for blank / unparseable', () => {
    expect(parseFieldNumber('')).toBeNull();
    expect(parseFieldNumber(null)).toBeNull();
    expect(parseFieldNumber('abc')).toBeNull();
  });
});

describe('evaluateCalc', () => {
  const values = new Map([
    ['a', '2'],
    ['b', '3'],
    ['c', ''],
    ['d', '10'],
  ]);
  const spec = (op: FormCalcSpec['op'], fields: string[]): FormCalcSpec => ({ op, fields });

  it('SUM treats blanks as zero (and empty SUM is 0)', () => {
    expect(evaluateCalc(spec('SUM', ['a', 'b', 'c']), values)).toBe('5');
    expect(evaluateCalc(spec('SUM', ['c']), values)).toBe('0');
  });
  it('PRD multiplies non-blank operands', () => {
    expect(evaluateCalc(spec('PRD', ['a', 'b']), values)).toBe('6');
    expect(evaluateCalc(spec('PRD', ['c']), values)).toBeNull();
  });
  it('AVG / MIN / MAX over non-blank operands', () => {
    expect(evaluateCalc(spec('AVG', ['a', 'b', 'd']), values)).toBe('5');
    expect(evaluateCalc(spec('MIN', ['a', 'b', 'd']), values)).toBe('2');
    expect(evaluateCalc(spec('MAX', ['a', 'b', 'd']), values)).toBe('10');
  });
  it('kills floating-point noise', () => {
    expect(evaluateCalc(spec('SUM', ['x', 'y']), new Map([['x', '0.1'], ['y', '0.2']]))).toBe('0.3');
  });
});
