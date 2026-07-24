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
  /** Whole-annotation opacity, 0-1. */
  const [opacity, setOpacity] = useState(1);
  const [width, setWidth] = useState(3);
  /** Which attribute popup is open, if any. */
  const [openPalette, setOpenPalette] = useState<'stroke' | 'fill' | 'textColor' | 'textSize' | 'opacity' | 'width' | null>(null);
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
    setColor(c);
    setStrokeEnabled(true);
    setOpenPalette(null);
    viewer?.setAnnotationStyle({ color: c, strokeWidth: width });
    // Also restyle any currently selected annotations (no-op if none selected).
    void viewer?.applyStyleToSelection({ color: c, strokeWidth: width });
  };
  const pickNoStroke = (): void => {
    setStrokeEnabled(false);
    setOpenPalette(null);
    viewer?.setAnnotationStyle({ strokeWidth: 0 });
    void viewer?.applyStyleToSelection({ strokeWidth: 0 });
  };
  const pickFill = (c: string | null): void => {
    setFillColor(c);
    setOpenPalette(null);
    viewer?.setAnnotationStyle({ fillColor: c });
    void viewer?.applyStyleToSelection({ fillColor: c });
  };
  const pickTextColor = (c: string): void => {
    setTextColor(c);
    setOpenPalette(null);
    viewer?.setAnnotationStyle({ textColor: c });
    void viewer?.applyStyleToSelection({ textColor: c });
  };
  const pickTextSize = (size: number): void => {
    setFontSize(size);
    viewer?.setAnnotationStyle({ fontSize: size });
    void viewer?.applyStyleToSelection({ fontSize: size }, sliderMergeKey('fontSize'));
  };
  const pickOpacity = (v: number): void => {
    setOpacity(v);
    viewer?.setAnnotationStyle({ opacity: v });
    void viewer?.applyStyleToSelection({ opacity: v }, sliderMergeKey('opacity'));
  };
  const pickWidth = (w: number): void => {
    setWidth(w);
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
                strokeEnabled ? '' : 'pdfrx-annot-color-none',
              ]
                .filter(Boolean)
                .join(' ')}
              style={strokeEnabled ? { borderColor: color } : undefined}
            />
          </button>
          {openPalette === 'stroke' && (
            <div className="pdfrx-annot-popup" role="listbox" aria-label={strings.strokeColor}>
              <button
                type="button"
                role="option"
                aria-selected={!strokeEnabled}
                className={[
                  'pdfrx-annot-swatch',
                  'pdfrx-annot-color-none',
                  strokeEnabled ? '' : 'pdfrx-annot-swatch-active',
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
                  aria-selected={strokeEnabled && color === c}
                  className={['pdfrx-annot-swatch', strokeEnabled && color === c ? 'pdfrx-annot-swatch-active' : ''].filter(Boolean).join(' ')}
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
              className={['pdfrx-annot-color-dot', fillColor ? '' : 'pdfrx-annot-color-none'].filter(Boolean).join(' ')}
              style={fillColor ? { background: fillColor } : undefined}
            />
          </button>
          {openPalette === 'fill' && (
            <div className="pdfrx-annot-popup" role="listbox" aria-label={strings.fillColor}>
              <button
                type="button"
                role="option"
                aria-selected={fillColor === null}
                className={[
                  'pdfrx-annot-swatch',
                  'pdfrx-annot-color-none',
                  fillColor === null ? 'pdfrx-annot-swatch-active' : '',
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
                  aria-selected={fillColor === c}
                  className={['pdfrx-annot-swatch', fillColor === c ? 'pdfrx-annot-swatch-active' : ''].filter(Boolean).join(' ')}
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
              <span className="pdfrx-annot-slider-value">{Math.round(opacity * 100)}%</span>
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
              <span className="pdfrx-annot-slider-value">{width}</span>
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
                textColorTone(textColor) ? `pdfrx-annot-text-color-icon-${textColorTone(textColor)}` : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ color: textColor }}
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
                  aria-selected={textColor === c}
                  className={['pdfrx-annot-swatch', textColor === c ? 'pdfrx-annot-swatch-active' : ''].filter(Boolean).join(' ')}
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
              <span className="pdfrx-annot-slider-value">{fontSize}</span>
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
      </span>
      {onClose && (
        <>
          <span className="pdfrx-toolbar-separator" aria-hidden />
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
