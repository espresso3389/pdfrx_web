import type { AnnotationTool } from '@pdfrx/viewer';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { addCenteredImageAnnotation } from '../annotation-image.js';
import { usePdfrxViewer } from '../hooks/use-pdfrx-viewer.js';
import { usePdfrxStore } from '../context.js';
import { usePdfrxStrings } from '../strings.js';
import {
  IconArrowTool,
  IconClose,
  IconEllipse,
  IconHighlighter,
  IconImage,
  IconLine,
  IconNote,
  IconOpacity,
  IconPen,
  IconRectangle,
  IconTextSize,
  IconThickness,
  IconTrash,
} from './icons.js';

/** Props for {@link PdfAnnotationToolbar}. */
export interface PdfAnnotationToolbarProps {
  className?: string;
  style?: CSSProperties;
  /**
   * Which tools to show, in order. `rectangle` and legacy `freeText` both map
   * to the same box tool and are de-duplicated. Note remains opt-in.
   */
  tools?: readonly AnnotationTool[];
  /** Preset colors offered in the color picker. */
  colors?: readonly string[];
  /**
   * When provided, a close (✕) button is shown. The toolbar clears any active
   * drawing tool when it unmounts, so hosts can just hide it.
   */
  onClose?: () => void;
}

// Highlight is not a drawing tool here — it is applied to a text selection via
// the right-click context menu (a Highlight markup over the selected text).
const DEFAULT_TOOLS: readonly AnnotationTool[] = ['ink', 'rectangle', 'ellipse', 'line', 'arrow'];

const DEFAULT_COLORS: readonly string[] = ['#e53935', '#1e88e5', '#43a047', '#fbc02d', '#8e24aa', '#000000'];

type MixedAttribute =
  | 'stroke'
  | 'color'
  | 'fill'
  | 'textColor'
  | 'fontSize'
  | 'textAlign'
  | 'opacity'
  | 'width';

interface AnnotationToolbarDefaults {
  color: string;
  strokeEnabled: boolean;
  fillColor: string | null;
  textColor: string;
  fontSize: number;
  textAlign: 'left' | 'center' | 'right';
  textVerticalAlign: 'top' | 'middle' | 'bottom';
  opacity: number;
  width: number;
}

const NO_MIXED_ATTRIBUTES: Readonly<Record<MixedAttribute, boolean>> = {
  stroke: false,
  color: false,
  fill: false,
  textColor: false,
  fontSize: false,
  textAlign: false,
  opacity: false,
  width: false,
};

function annotationColorToCss(color: { r: number; g: number; b: number } | null): string | null {
  if (!color) return null;
  return `#${[color.r, color.g, color.b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function commonValue<T>(values: readonly T[]): { value: T; mixed: boolean } {
  const value = values[0]!;
  return { value, mixed: values.some((candidate) => candidate !== value) };
}

/** Classifies hexadecimal colors that may disappear into a light/dark toolbar. */
function textColorTone(color: string): 'dark' | 'light' | null {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
  if (!match) return null;
  const hex = match[1]!;
  const expanded = hex.length === 3 ? [...hex].map((value) => value + value).join('') : hex;
  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  if (luminance < 80) return 'dark';
  if (luminance > 220) return 'light';
  return null;
}

const TOOL_ICON: Record<AnnotationTool, () => ReactNode> = {
  ink: IconPen,
  rectangle: IconRectangle,
  ellipse: IconEllipse,
  line: IconLine,
  arrow: IconArrowTool,
  highlight: IconHighlighter,
  note: IconNote,
  freeText: IconRectangle,
};

/**
 * The annotation toolbar: drawing-tool toggles, an image picker, plus
 * color/width pickers. Text interaction remains on the primary mouse button
 * and annotation selection remains available independently of the toolbar:
 * primary-click/body/anchor interaction edits one object and secondary drag
 * marquee-selects. The image picker adds a printable stamp annotation
 * to the center of the current page, using the same sizing as image drop (240pt
 * wide at most, with additional proportional scaling when needed to fit the page). Drawing
 * controls are wired to {@link PdfrxViewer.setAnnotationTool} /
 * `setAnnotationStyle`. Requires a
 * {@link PdfrxProvider} ancestor and the viewer's `interactiveAnnotations`
 * option (on by default). Import `@pdfrx/react/styles.css` for the default
 * look, or style the `pdfrx-annot-*` class names yourself.
 */
export function PdfAnnotationToolbar({
  className,
  style,
  tools = DEFAULT_TOOLS,
  colors = DEFAULT_COLORS,
  onClose,
}: PdfAnnotationToolbarProps): ReactNode {
  const viewer = usePdfrxViewer();
  const store = usePdfrxStore();
  const strings = usePdfrxStrings();
  const toolTitles: Record<AnnotationTool, string> = {
    ink: strings.penTool,
    rectangle: strings.rectangleTool,
    ellipse: strings.ellipseTool,
    line: strings.lineTool,
    arrow: strings.arrowTool,
    highlight: strings.highlighterTool,
    note: strings.noteTool,
    freeText: strings.rectangleTool,
  };
  const visibleTools = tools
    .map((tool) => (tool === 'freeText' ? 'rectangle' : tool))
    .filter((tool, index, all) => all.indexOf(tool) === index);
  const [active, setActive] = useState<AnnotationTool | null>(null);
  const [color, setColor] = useState(colors[0] ?? '#e53935');
  const [strokeEnabled, setStrokeEnabled] = useState(true);
  const [fillColor, setFillColor] = useState<string | null>(null);
  const [textColor, setTextColor] = useState('#000000');
  const [fontSize, setFontSize] = useState(12);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('left');
  const [textVerticalAlign, setTextVerticalAlign] = useState<'top' | 'middle' | 'bottom'>('top');
  /** Whole-annotation opacity, 0-1. */
  const [opacity, setOpacity] = useState(1);
  const [width, setWidth] = useState(3);
  const [hasSelection, setHasSelection] = useState(false);
  const [mixed, setMixed] = useState<Readonly<Record<MixedAttribute, boolean>>>(NO_MIXED_ATTRIBUTES);
  const defaultsRef = useRef<AnnotationToolbarDefaults>({
    color: colors[0] ?? '#e53935',
    strokeEnabled: true,
    fillColor: null as string | null,
    textColor: '#000000',
    fontSize: 12,
    textAlign: 'left',
    textVerticalAlign: 'top',
    opacity: 1,
    width: 3,
  });
  /** Which attribute popup is open, if any. */
  const [openPalette, setOpenPalette] = useState<'stroke' | 'fill' | 'textColor' | 'textSize' | 'textAlign' | 'opacity' | 'width' | null>(null);
  const paletteHostRef = useRef<HTMLSpanElement>(null);
  const sliderGestureRef = useRef<{ key: string; sequence: number } | null>(null);
  const sliderSequenceRef = useRef(0);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const beginSliderGesture = (key: string): void => {
    if (sliderGestureRef.current?.key === key) return;
    sliderGestureRef.current = { key, sequence: ++sliderSequenceRef.current };
  };
  const endSliderGesture = (): void => {
    sliderGestureRef.current = null;
  };
  const sliderMergeKey = (key: string): string | undefined => {
    const gesture = sliderGestureRef.current;
    return gesture?.key === key ? `${key}:${gesture.sequence}` : undefined;
  };

  // Keep the pressed tool in sync with programmatic changes. Closing the
  // toolbar returns to the tool-free interaction state.
  useEffect(() => {
    if (!viewer) return;
    const syncMode = (): void => setActive(viewer.getAnnotationTool());
    syncMode();
    const unsubscribe = viewer.addAnnotationModeChangeListener(syncMode);
    return () => {
      unsubscribe();
      viewer.setAnnotationTool(null);
    };
  }, [viewer]);

  useEffect(() => {
    if (!viewer) return;
    const syncSelectionStyle = (): void => {
      const annotations = viewer.getSelectedAnnotations();
      setHasSelection(viewer.getSelectedAnnotationIds().length > 0);
      if (annotations.length === 0) {
        const defaults = defaultsRef.current;
        setColor(defaults.color);
        setStrokeEnabled(defaults.strokeEnabled);
        setFillColor(defaults.fillColor);
        setTextColor(defaults.textColor);
        setFontSize(defaults.fontSize);
        setTextAlign(defaults.textAlign);
        setTextVerticalAlign(defaults.textVerticalAlign);
        setOpacity(defaults.opacity);
        setWidth(defaults.width);
        setMixed(NO_MIXED_ATTRIBUTES);
        return;
      }

      const strokes = commonValue(annotations.map((annotation) => annotation.borderWidth > 0));
      const strokeColors = commonValue(annotations.map((annotation) => annotationColorToCss(annotation.color) ?? '#000000'));
      const fills = commonValue(annotations.map((annotation) => annotationColorToCss(annotation.interiorColor)));
      const textColors = commonValue(annotations.map((annotation) => annotationColorToCss(annotation.textColor) ?? defaultsRef.current.textColor));
      const fontSizes = commonValue(annotations.map((annotation) => annotation.fontSize ?? defaultsRef.current.fontSize));
      const horizontal = commonValue(annotations.map((annotation) => annotation.textAlign));
      const vertical = commonValue(annotations.map((annotation) => annotation.textVerticalAlign));
      const opacities = commonValue(annotations.map((annotation) => {
        const alpha = annotation.color?.a ?? annotation.interiorColor?.a ?? annotation.textColor?.a ?? 255;
        return alpha / 255;
      }));
      const widths = commonValue(annotations.map((annotation) => annotation.borderWidth));

      setStrokeEnabled(strokes.value);
      setColor(strokeColors.value);
      setFillColor(fills.value);
      setTextColor(textColors.value);
      setFontSize(fontSizes.value);
      setTextAlign(horizontal.value);
      setTextVerticalAlign(vertical.value);
      setOpacity(opacities.value);
      setWidth(widths.value);
      setMixed({
        stroke: strokes.mixed,
        color: strokeColors.mixed,
        fill: fills.mixed,
        textColor: textColors.mixed,
        fontSize: fontSizes.mixed,
        textAlign: horizontal.mixed || vertical.mixed,
        opacity: opacities.mixed,
        width: widths.mixed,
      });
    };
    syncSelectionStyle();
    return viewer.addAnnotationSelectionChangeListener(syncSelectionStyle);
  }, [viewer]);

  // Dismiss an open palette on outside pointerdown or Escape.
  useEffect(() => {
    if (!openPalette) return;
    const onDown = (e: PointerEvent): void => {
      if (!paletteHostRef.current?.contains(e.target as Node)) setOpenPalette(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpenPalette(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [openPalette]);

  const applyMode = (mode: AnnotationTool): void => {
    const next = active === mode ? null : mode;
    setActive(next);
    viewer?.setAnnotationTool(next);
  };
  const pickStroke = (c: string): void => {
    const shouldRestoreWidth = !strokeEnabled || mixed.stroke;
    const restoredWidth = defaultsRef.current.width;
    defaultsRef.current.color = c;
    defaultsRef.current.strokeEnabled = true;
    setColor(c);
    setStrokeEnabled(true);
    setMixed((value) => ({ ...value, stroke: false, color: false }));
    setOpenPalette(null);
    viewer?.setAnnotationStyle({ color: c, strokeWidth: restoredWidth });
    // Also restyle any currently selected annotations (no-op if none selected).
    void viewer?.applyStyleToSelection(shouldRestoreWidth ? { color: c, strokeWidth: restoredWidth } : { color: c });
  };
  const pickNoStroke = (): void => {
    defaultsRef.current.strokeEnabled = false;
    setStrokeEnabled(false);
    setMixed((value) => ({ ...value, stroke: false }));
    setOpenPalette(null);
    viewer?.setAnnotationStyle({ strokeWidth: 0 });
    void viewer?.applyStyleToSelection({ strokeWidth: 0 });
  };
  const pickFill = (c: string | null): void => {
    defaultsRef.current.fillColor = c;
    setFillColor(c);
    setMixed((value) => ({ ...value, fill: false }));
    setOpenPalette(null);
    viewer?.setAnnotationStyle({ fillColor: c });
    void viewer?.applyStyleToSelection({ fillColor: c });
  };
  const pickTextColor = (c: string): void => {
    defaultsRef.current.textColor = c;
    setTextColor(c);
    setMixed((value) => ({ ...value, textColor: false }));
    setOpenPalette(null);
    viewer?.setAnnotationStyle({ textColor: c });
    void viewer?.applyStyleToSelection({ textColor: c });
  };
  const pickTextSize = (size: number): void => {
    defaultsRef.current.fontSize = size;
    setFontSize(size);
    setMixed((value) => ({ ...value, fontSize: false }));
    viewer?.setAnnotationStyle({ fontSize: size });
    void viewer?.applyStyleToSelection({ fontSize: size }, sliderMergeKey('fontSize'));
  };
  const pickTextAlignment = (
    horizontal: 'left' | 'center' | 'right',
    vertical: 'top' | 'middle' | 'bottom',
  ): void => {
    defaultsRef.current.textAlign = horizontal;
    defaultsRef.current.textVerticalAlign = vertical;
    setTextAlign(horizontal);
    setTextVerticalAlign(vertical);
    setMixed((value) => ({ ...value, textAlign: false }));
    viewer?.setAnnotationStyle({ textAlign: horizontal, textVerticalAlign: vertical });
    void viewer?.applyStyleToSelection({ textAlign: horizontal, textVerticalAlign: vertical });
  };
  const pickOpacity = (v: number): void => {
    defaultsRef.current.opacity = v;
    setOpacity(v);
    setMixed((value) => ({ ...value, opacity: false }));
    viewer?.setAnnotationStyle({ opacity: v });
    void viewer?.applyStyleToSelection({ opacity: v }, sliderMergeKey('opacity'));
  };
  const pickWidth = (w: number): void => {
    defaultsRef.current.width = w;
    defaultsRef.current.strokeEnabled = true;
    setWidth(w);
    setStrokeEnabled(true);
    setMixed((value) => ({ ...value, stroke: false, width: false }));
    viewer?.setAnnotationStyle({ strokeWidth: w });
    void viewer?.applyStyleToSelection({ strokeWidth: w }, sliderMergeKey('strokeWidth'));
  };

  return (
    <div className={['pdfrx-annot-toolbar', className].filter(Boolean).join(' ')} style={style}>
      {visibleTools.map((tool) => {
        const ToolIcon = TOOL_ICON[tool];
        return (
          <ModeButton key={tool} mode={tool} active={active} onClick={applyMode} title={toolTitles[tool]}>
            <ToolIcon />
          </ModeButton>
        );
      })}
      <button
        type="button"
        className="pdfrx-button"
        onClick={() => imageInputRef.current?.click()}
        disabled={!viewer?.document}
        title={strings.addImage}
        aria-label={strings.addImage}
      >
        <IconImage />
      </button>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*,.svg,.heic,.heif"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file && viewer) {
            void addCenteredImageAnnotation(viewer, file, undefined, store.imageDecoder)
              .catch((error: unknown) => {
                console.error(`Failed to add image annotation from ${file.name}:`, error);
                store.reportImportError(error, file.name);
              });
          }
        }}
      />
      <span className="pdfrx-toolbar-separator" aria-hidden />
      <span className="pdfrx-annot-colors" ref={paletteHostRef}>
        <span className="pdfrx-annot-colorbtn">
          <button
            type="button"
            className={['pdfrx-button', openPalette === 'stroke' ? 'pdfrx-button-active' : ''].filter(Boolean).join(' ')}
            title={strings.strokeColor}
            aria-label={strings.strokeColor}
            aria-expanded={openPalette === 'stroke'}
            onClick={() => setOpenPalette(openPalette === 'stroke' ? null : 'stroke')}
          >
            <span
              className={[
                'pdfrx-annot-color-ring',
                mixed.stroke || mixed.color ? 'pdfrx-annot-color-mixed' : '',
                strokeEnabled ? '' : 'pdfrx-annot-color-none',
              ]
                .filter(Boolean)
                .join(' ')}
              style={strokeEnabled && !mixed.color && !mixed.stroke ? { borderColor: color } : undefined}
            />
          </button>
          {openPalette === 'stroke' && (
            <div className="pdfrx-annot-popup" role="listbox" aria-label={strings.strokeColor}>
              <button
                type="button"
                role="option"
                aria-selected={!mixed.stroke && !strokeEnabled}
                className={[
                  'pdfrx-annot-swatch',
                  'pdfrx-annot-color-none',
                  !mixed.stroke && !strokeEnabled ? 'pdfrx-annot-swatch-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-label={strings.noStroke}
                title={strings.noStroke}
                onClick={pickNoStroke}
              />
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="option"
                  aria-selected={!mixed.stroke && !mixed.color && strokeEnabled && color === c}
                  className={['pdfrx-annot-swatch', !mixed.stroke && !mixed.color && strokeEnabled && color === c ? 'pdfrx-annot-swatch-active' : ''].filter(Boolean).join(' ')}
                  aria-label={`${strings.strokeColor}: ${c}`}
                  onClick={() => pickStroke(c)}
                  style={{ background: c }}
                />
              ))}
            </div>
          )}
        </span>
        <span className="pdfrx-annot-colorbtn">
          <button
            type="button"
            className={['pdfrx-button', openPalette === 'fill' ? 'pdfrx-button-active' : ''].filter(Boolean).join(' ')}
            title={strings.fillColor}
            aria-label={strings.fillColor}
            aria-expanded={openPalette === 'fill'}
            onClick={() => setOpenPalette(openPalette === 'fill' ? null : 'fill')}
          >
            <span
              className={[
                'pdfrx-annot-color-dot',
                mixed.fill ? 'pdfrx-annot-color-mixed' : '',
                !mixed.fill && !fillColor ? 'pdfrx-annot-color-none' : '',
              ].filter(Boolean).join(' ')}
              style={!mixed.fill && fillColor ? { background: fillColor } : undefined}
            />
          </button>
          {openPalette === 'fill' && (
            <div className="pdfrx-annot-popup" role="listbox" aria-label={strings.fillColor}>
              <button
                type="button"
                role="option"
                aria-selected={!mixed.fill && fillColor === null}
                className={[
                  'pdfrx-annot-swatch',
                  'pdfrx-annot-color-none',
                  !mixed.fill && fillColor === null ? 'pdfrx-annot-swatch-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-label={strings.noFill}
                title={strings.noFill}
                onClick={() => pickFill(null)}
              />
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="option"
                  aria-selected={!mixed.fill && fillColor === c}
                  className={['pdfrx-annot-swatch', !mixed.fill && fillColor === c ? 'pdfrx-annot-swatch-active' : ''].filter(Boolean).join(' ')}
                  aria-label={`${strings.fillColor}: ${c}`}
                  onClick={() => pickFill(c)}
                  style={{ background: c }}
                />
              ))}
            </div>
          )}
        </span>
        <span className="pdfrx-annot-colorbtn">
          <button
            type="button"
            className={['pdfrx-button', openPalette === 'opacity' ? 'pdfrx-button-active' : ''].filter(Boolean).join(' ')}
            title={strings.opacity}
            aria-label={strings.opacity}
            aria-expanded={openPalette === 'opacity'}
            onClick={() => setOpenPalette(openPalette === 'opacity' ? null : 'opacity')}
          >
            <IconOpacity />
          </button>
          {openPalette === 'opacity' && (
            <div className="pdfrx-annot-slider-popup" role="dialog" aria-label={strings.opacity}>
              <span className="pdfrx-annot-slider-value">{mixed.opacity ? '—' : `${Math.round(opacity * 100)}%`}</span>
              <input
                className="pdfrx-annot-slider-vertical"
                type="range"
                min={5}
                max={100}
                step={5}
                value={Math.round(opacity * 100)}
                onChange={(e) => pickOpacity(Number(e.target.value) / 100)}
                onPointerDown={() => beginSliderGesture('opacity')}
                onPointerUp={endSliderGesture}
                onKeyDown={() => beginSliderGesture('opacity')}
                onKeyUp={endSliderGesture}
                onBlur={endSliderGesture}
                aria-label={strings.opacity}
              />
            </div>
          )}
        </span>
        <span className="pdfrx-annot-colorbtn">
          <button
            type="button"
            className={['pdfrx-button', openPalette === 'width' ? 'pdfrx-button-active' : ''].filter(Boolean).join(' ')}
            title={strings.thickness}
            aria-label={strings.thickness}
            aria-expanded={openPalette === 'width'}
            onClick={() => setOpenPalette(openPalette === 'width' ? null : 'width')}
            disabled={!strokeEnabled}
          >
            <IconThickness />
          </button>
          {openPalette === 'width' && strokeEnabled && (
            <div className="pdfrx-annot-slider-popup" role="dialog" aria-label={strings.thickness}>
              <span className="pdfrx-annot-slider-value">{mixed.width ? '—' : width}</span>
              <input
                className="pdfrx-annot-slider-vertical"
                type="range"
                min={1}
                max={12}
                value={width}
                onChange={(e) => pickWidth(Number(e.target.value))}
                onPointerDown={() => beginSliderGesture('strokeWidth')}
                onPointerUp={endSliderGesture}
                onKeyDown={() => beginSliderGesture('strokeWidth')}
                onKeyUp={endSliderGesture}
                onBlur={endSliderGesture}
                aria-label={strings.thickness}
              />
            </div>
          )}
        </span>
        <span className="pdfrx-annot-colorbtn">
          <button
            type="button"
            className={['pdfrx-button', openPalette === 'textColor' ? 'pdfrx-button-active' : ''].filter(Boolean).join(' ')}
            title={strings.textColor}
            aria-label={strings.textColor}
            aria-expanded={openPalette === 'textColor'}
            onClick={() => setOpenPalette(openPalette === 'textColor' ? null : 'textColor')}
          >
            <span
              aria-hidden
              className={[
                'pdfrx-annot-text-color-icon',
                mixed.textColor ? 'pdfrx-annot-color-mixed' : '',
                textColorTone(textColor) ? `pdfrx-annot-text-color-icon-${textColorTone(textColor)}` : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={mixed.textColor ? undefined : { color: textColor }}
            >
              A
            </span>
          </button>
          {openPalette === 'textColor' && (
            <div className="pdfrx-annot-popup" role="listbox" aria-label={strings.textColor}>
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="option"
                  aria-selected={!mixed.textColor && textColor === c}
                  className={['pdfrx-annot-swatch', !mixed.textColor && textColor === c ? 'pdfrx-annot-swatch-active' : ''].filter(Boolean).join(' ')}
                  aria-label={`${strings.textColor}: ${c}`}
                  onClick={() => pickTextColor(c)}
                  style={{ background: c }}
                />
              ))}
            </div>
          )}
        </span>
        <span className="pdfrx-annot-colorbtn">
          <button
            type="button"
            className={['pdfrx-button', openPalette === 'textSize' ? 'pdfrx-button-active' : ''].filter(Boolean).join(' ')}
            title={strings.textSize}
            aria-label={strings.textSize}
            aria-expanded={openPalette === 'textSize'}
            onClick={() => setOpenPalette(openPalette === 'textSize' ? null : 'textSize')}
          >
            <IconTextSize />
          </button>
          {openPalette === 'textSize' && (
            <div className="pdfrx-annot-slider-popup" role="dialog" aria-label={strings.textSize}>
              <span className="pdfrx-annot-slider-value">{mixed.fontSize ? '—' : fontSize}</span>
              <input
                className="pdfrx-annot-slider-vertical"
                type="range"
                min={6}
                max={48}
                step={1}
                value={fontSize}
                onChange={(e) => pickTextSize(Number(e.target.value))}
                onPointerDown={() => beginSliderGesture('fontSize')}
                onPointerUp={endSliderGesture}
                onKeyDown={() => beginSliderGesture('fontSize')}
                onKeyUp={endSliderGesture}
                onBlur={endSliderGesture}
                aria-label={strings.textSize}
              />
            </div>
          )}
        </span>
        <span className="pdfrx-annot-colorbtn">
          <button
            type="button"
            className={['pdfrx-button', openPalette === 'textAlign' ? 'pdfrx-button-active' : ''].filter(Boolean).join(' ')}
            title={strings.textAlignment}
            aria-label={strings.textAlignment}
            aria-expanded={openPalette === 'textAlign'}
            onClick={() => setOpenPalette(openPalette === 'textAlign' ? null : 'textAlign')}
          >
            <TextAlignIcon horizontal={textAlign} vertical={textVerticalAlign} />
          </button>
          {openPalette === 'textAlign' && (
            <div className="pdfrx-annot-align-popup" role="dialog" aria-label={strings.textAlignment}>
              {(['top', 'middle', 'bottom'] as const).flatMap((vertical) =>
                (['left', 'center', 'right'] as const).map((horizontal) => {
                  const horizontalLabel =
                    horizontal === 'left' ? strings.alignLeft : horizontal === 'center' ? strings.alignCenter : strings.alignRight;
                  const verticalLabel =
                    vertical === 'top' ? strings.alignTop : vertical === 'middle' ? strings.alignMiddle : strings.alignBottom;
                  const selected = !mixed.textAlign && textAlign === horizontal && textVerticalAlign === vertical;
                  return (
                    <button
                      key={`${vertical}-${horizontal}`}
                      type="button"
                      className={['pdfrx-annot-align-option', selected ? 'pdfrx-annot-align-option-active' : ''].filter(Boolean).join(' ')}
                      aria-pressed={selected}
                      aria-label={`${verticalLabel}, ${horizontalLabel}`}
                      title={`${verticalLabel}, ${horizontalLabel}`}
                      onClick={() => pickTextAlignment(horizontal, vertical)}
                    >
                      <TextAlignIcon horizontal={horizontal} vertical={vertical} />
                    </button>
                  );
                }),
              )}
            </div>
          )}
        </span>
      </span>
      <span className="pdfrx-toolbar-separator" aria-hidden />
      <button
        type="button"
        className="pdfrx-button pdfrx-danger"
        disabled={!viewer || !hasSelection}
        onClick={() => void viewer?.deleteSelectedAnnotation()}
        title={strings.deleteAnnotations}
        aria-label={strings.deleteAnnotations}
      >
        <IconTrash />
      </button>
      {onClose && (
        <>
          <button
            type="button"
            className="pdfrx-button pdfrx-annot-close"
            onClick={onClose}
            title={strings.closeAnnotationToolbar}
            aria-label={strings.closeAnnotationToolbar}
          >
            <IconClose />
          </button>
        </>
      )}
    </div>
  );
}

function TextAlignIcon({
  horizontal,
  vertical,
}: {
  horizontal: 'left' | 'center' | 'right';
  vertical: 'top' | 'middle' | 'bottom';
}): ReactNode {
  const top = vertical === 'top' ? 2 : vertical === 'middle' ? 5 : 8;
  const widths = [13, 9, 11];
  const line = (width: number, index: number): string => {
    const x = horizontal === 'left' ? 2 : horizontal === 'center' ? (18 - width) / 2 : 16 - width;
    return `M${x} ${top + index * 3}h${width}`;
  };
  return (
    <svg className="pdfrx-icon" viewBox="0 0 18 18" aria-hidden>
      <path
        d={widths.map(line).join('')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** One drawing-tool toggle in {@link PdfAnnotationToolbar}. */
function ModeButton({
  mode,
  active,
  onClick,
  title,
  children,
}: {
  mode: AnnotationTool;
  active: AnnotationTool | null;
  onClick: (mode: AnnotationTool) => void;
  title: string;
  children: ReactNode;
}): ReactNode {
  const isActive = active === mode;
  return (
    <button
      type="button"
      className={['pdfrx-button', isActive ? 'pdfrx-button-active' : ''].filter(Boolean).join(' ')}
      aria-pressed={isActive}
      onClick={() => onClick(mode)}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}
