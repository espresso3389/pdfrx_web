import type { AnnotationMode, AnnotationTool } from '@pdfrx/viewer';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { usePdfrxViewer } from '../hooks/use-pdfrx-viewer.js';
import { usePdfrxStrings } from '../strings.js';
import {
  IconArrowTool,
  IconClose,
  IconCursorText,
  IconEllipse,
  IconHighlighter,
  IconLine,
  IconNote,
  IconOpacity,
  IconPen,
  IconRectangle,
  IconSelectObject,
  IconTextBox,
  IconThickness,
} from './icons.js';

/** The mutually-exclusive interaction modes offered by the toolbar. */
type ToolbarMode = 'text' | 'select' | AnnotationTool;

/** Props for {@link PdfAnnotationToolbar}. */
export interface PdfAnnotationToolbarProps {
  className?: string;
  style?: CSSProperties;
  /** Which tools to show, in order. Note remains available as an opt-in tool. */
  tools?: readonly AnnotationTool[];
  /** Preset colors offered in the color picker. */
  colors?: readonly string[];
  /**
   * When provided, a close (✕) button is shown. The toolbar always returns the
   * viewer to text-selection mode when it unmounts, so hosts can just hide it.
   */
  onClose?: () => void;
}

// Highlight is not a drawing tool here — it is applied to a text selection via
// the right-click context menu (a Highlight markup over the selected text).
const DEFAULT_TOOLS: readonly AnnotationTool[] = ['ink', 'rectangle', 'ellipse', 'line', 'arrow', 'freeText'];

const DEFAULT_COLORS: readonly string[] = ['#e53935', '#1e88e5', '#43a047', '#fbc02d', '#8e24aa', '#000000'];

const TOOL_ICON: Record<AnnotationTool, () => ReactNode> = {
  ink: IconPen,
  rectangle: IconRectangle,
  ellipse: IconEllipse,
  line: IconLine,
  arrow: IconArrowTool,
  highlight: IconHighlighter,
  note: IconNote,
  freeText: IconTextBox,
};

/**
 * The annotation mode bar: mutually-exclusive toggles for text selection,
 * object selection and each drawing tool, plus color/width pickers — wired to
 * {@link PdfrxViewer.setAnnotationTool} /
 * `setAnnotationSelectMode` / `setAnnotationStyle`. Requires a
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
  const strings = usePdfrxStrings();
  const toolTitles: Record<AnnotationTool, string> = {
    ink: strings.penTool,
    rectangle: strings.rectangleTool,
    ellipse: strings.ellipseTool,
    line: strings.lineTool,
    arrow: strings.arrowTool,
    highlight: strings.highlighterTool,
    note: strings.noteTool,
    freeText: strings.textBoxTool,
  };
  // One active mode at a time: 'text' = normal text-selection viewing,
  // 'select' = object select (marquee/multi-select), a tool name = draw.
  const [active, setActive] = useState<ToolbarMode>('select');
  const [color, setColor] = useState(colors[0] ?? '#e53935');
  const [strokeEnabled, setStrokeEnabled] = useState(true);
  const [fillColor, setFillColor] = useState<string | null>(null);
  /** Whole-annotation opacity, 0-1. */
  const [opacity, setOpacity] = useState(1);
  const [width, setWidth] = useState(3);
  /** Which attribute popup is open, if any. */
  const [openPalette, setOpenPalette] = useState<'stroke' | 'fill' | 'opacity' | 'width' | null>(null);
  const paletteHostRef = useRef<HTMLSpanElement>(null);
  const sliderGestureRef = useRef<{ key: string; sequence: number } | null>(null);
  const sliderSequenceRef = useRef(0);

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

  // Start in object-select mode when the toolbar appears, and return to text
  // mode when it unmounts (so closing it restores normal text selection).
  useEffect(() => {
    if (!viewer) return;
    const syncMode = (mode: AnnotationMode): void => setActive(mode ?? 'text');
    viewer.setAnnotationSelectMode(true);
    syncMode(viewer.getAnnotationMode());
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

  const applyMode = (mode: ToolbarMode): void => {
    setActive(mode);
    if (mode === 'text') viewer?.setAnnotationTool(null);
    else if (mode === 'select') viewer?.setAnnotationSelectMode(true);
    else viewer?.setAnnotationTool(mode);
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
      <ModeButton mode="text" active={active} onClick={applyMode} title={strings.textSelection}>
        <IconCursorText />
      </ModeButton>
      <ModeButton mode="select" active={active} onClick={applyMode} title={strings.selectObjects}>
        <IconSelectObject />
      </ModeButton>
      <span className="pdfrx-toolbar-separator" aria-hidden />
      {tools.map((tool) => {
        const ToolIcon = TOOL_ICON[tool];
        return (
          <ModeButton key={tool} mode={tool} active={active} onClick={applyMode} title={toolTitles[tool]}>
            <ToolIcon />
          </ModeButton>
        );
      })}
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

/** One mutually-exclusive mode button in {@link PdfAnnotationToolbar}. */
function ModeButton({
  mode,
  active,
  onClick,
  title,
  children,
}: {
  mode: ToolbarMode;
  active: ToolbarMode;
  onClick: (mode: ToolbarMode) => void;
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
