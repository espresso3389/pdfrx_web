import { describe, expect, it } from 'vitest';
import {
  annotationColorPreviewStyle,
  annotationPopupHistoryAction,
  annotationSelectionControls,
  annotationTextAlignmentPreviewStyle,
  popupViewportShift,
} from './components/annotation-toolbar.js';

describe('annotationSelectionControls', () => {
  it('shows every applicable control for a text box', () => {
    expect(annotationSelectionControls([{ subtype: 'freeText' }])).toEqual({
      stroke: true,
      fill: true,
      text: true,
      opacity: true,
      width: true,
    });
  });

  it('limits image stamps to opacity', () => {
    expect(annotationSelectionControls([{ subtype: 'stamp' }])).toEqual({
      stroke: false,
      fill: false,
      text: false,
      opacity: true,
      width: false,
    });
  });

  it('shows text controls for a rectangle only after text has been entered', () => {
    expect(annotationSelectionControls([
      { subtype: 'square', contents: '   ' },
    ]).text).toBe(false);
    expect(annotationSelectionControls([
      { subtype: 'square', contents: 'Label' },
    ]).text).toBe(true);
  });

  it('uses only controls shared by a mixed selection', () => {
    expect(annotationSelectionControls([
      { subtype: 'square' },
      { subtype: 'line' },
    ])).toEqual({
      stroke: true,
      fill: false,
      text: false,
      opacity: true,
      width: true,
    });
  });

  it('hides the popup when no selected annotation supports its controls', () => {
    expect(annotationSelectionControls([{ subtype: 'unknown' }])).toEqual({
      stroke: false,
      fill: false,
      text: false,
      opacity: false,
      width: false,
    });
  });
});

describe('annotationPopupHistoryAction', () => {
  const event = (
    key: string,
    target: EventTarget,
    overrides: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>> = {},
  ) => ({
    key,
    target,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  });

  it('maps Ctrl/Cmd history shortcuts outside text editors', () => {
    const range = document.createElement('input');
    range.type = 'range';
    expect(annotationPopupHistoryAction(event('z', range))).toBe('undo');
    expect(annotationPopupHistoryAction(event('Z', range, { shiftKey: true }))).toBe('redo');
    expect(annotationPopupHistoryAction(event('y', range))).toBe('redo');
    expect(annotationPopupHistoryAction(event('z', range, { ctrlKey: false, metaKey: true }))).toBe('undo');
  });

  it('leaves text editing history to the focused control', () => {
    const text = document.createElement('input');
    text.type = 'text';
    const textarea = document.createElement('textarea');
    expect(annotationPopupHistoryAction(event('z', text))).toBeNull();
    expect(annotationPopupHistoryAction(event('z', textarea))).toBeNull();
  });
});

describe('popupViewportShift', () => {
  it('moves nested panels back inside every viewport edge', () => {
    expect(popupViewportShift(
      { left: -12, top: -8, right: 88, bottom: 92 },
      { width: 320, height: 240 },
    )).toEqual({ x: 16, y: 12 });
    expect(popupViewportShift(
      { left: 270, top: 190, right: 350, bottom: 270 },
      { width: 320, height: 240 },
    )).toEqual({ x: -34, y: -34 });
  });

  it('does not move a panel that already fits', () => {
    expect(popupViewportShift(
      { left: 20, top: 30, right: 120, bottom: 130 },
      { width: 320, height: 240 },
    )).toEqual({ x: 0, y: 0 });
  });
});

describe('annotationColorPreviewStyle', () => {
  it('maps each palette color to its transient annotation style', () => {
    expect(annotationColorPreviewStyle('stroke', '#e53935')).toEqual({ color: '#e53935' });
    expect(annotationColorPreviewStyle('fill', '#43a047')).toEqual({ fillColor: '#43a047' });
    expect(annotationColorPreviewStyle('fill', null)).toEqual({ fillColor: null });
    expect(annotationColorPreviewStyle('textColor', '#1e88e5')).toEqual({ textColor: '#1e88e5' });
  });
});

describe('annotationTextAlignmentPreviewStyle', () => {
  it('previews both horizontal and vertical placement together', () => {
    expect(annotationTextAlignmentPreviewStyle('right', 'bottom')).toEqual({
      textAlign: 'right',
      textVerticalAlign: 'bottom',
    });
  });
});
