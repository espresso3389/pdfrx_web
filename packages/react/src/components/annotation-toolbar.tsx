import type { AnnotationTool } from '@pdfrx/viewer';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { addCenteredImageAnnotation } from '../annotation-image.js';
import { usePdfrxViewer } from '../hooks/use-pdfrx-viewer.js';
import { usePdfrxStore } from '../context.js';
import { type PdfrxStrings, usePdfrxStrings } from '../strings.js';
import {
  IconArrowTool,
  IconClose,
  IconEllipse,
  IconHighlighter,
  IconImage,
  IconLine,
  IconNote,
  IconOpacity,
  IconObjectSelection,
  IconPen,
  IconRectangle,
  IconTextSelection,
  IconTextSize,
  IconThickness,
  IconTrash,
} from './icons.js';

/** Props for {@link PdfAnnotationToolbar}. */
export interface PdfAnnotationToolbarProps {
  className?: string;
  style?: CSSProperties;
  /** Which tools to show, in order. Note remains opt-in. */
  tools?: readonly AnnotationTool[];
  /**
   * Whether this toolbar currently enables annotation-object interaction.
   * Defaults to `true`; collapsible hosts should pass their visible/open state.
   */
  modeActive?: boolean;
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

const DEFAULT_COLORS: readonly string[] = [
  '#e53935',
  '#1e88e5',
  '#43a047',
  '#fbc02d',
  '#8e24aa',
  '#000000',
  '#ffffff',
];
const MAX_CUSTOM_COLORS = 4;
const ANNOTATION_PREFERENCES_STORAGE_KEY = 'pdfrx.annotation-toolbar.preferences.v1';

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

interface AnnotationToolbarPreferences {
  defaults: AnnotationToolbarDefaults;
  customColors: string[];
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

function isNearBlack(color: string): boolean {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
  if (!match) return false;
  const hex = match[1]!;
  const expanded = hex.length === 3 ? [...hex].map((value) => value + value).join('') : hex;
  return [0, 2, 4].every((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16) <= 24);
}

function normalizeHexColor(color: string): string | null {
  const trimmed = color.trim();
  return /^#[\da-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

function defaultAnnotationToolbarPreferences(firstColor: string): AnnotationToolbarPreferences {
  return {
    defaults: {
      color: firstColor,
      strokeEnabled: true,
      fillColor: null,
      textColor: '#000000',
      fontSize: 12,
      textAlign: 'left',
      textVerticalAlign: 'top',
      opacity: 1,
      width: 3,
    },
    customColors: [],
  };
}

function loadAnnotationToolbarPreferences(firstColor: string): AnnotationToolbarPreferences {
  const fallback = defaultAnnotationToolbarPreferences(firstColor);
  try {
    const stored = globalThis.localStorage?.getItem(ANNOTATION_PREFERENCES_STORAGE_KEY);
    if (!stored) return fallback;
    const value = JSON.parse(stored) as {
      defaults?: Partial<AnnotationToolbarDefaults>;
      customColors?: unknown;
    };
    const defaults = value.defaults ?? {};
    const color = typeof defaults.color === 'string' ? normalizeHexColor(defaults.color) : null;
    const fillColor =
      defaults.fillColor === null
        ? null
        : typeof defaults.fillColor === 'string'
          ? normalizeHexColor(defaults.fillColor)
          : fallback.defaults.fillColor;
    const textColor =
      typeof defaults.textColor === 'string' ? normalizeHexColor(defaults.textColor) : null;
    const fontSize =
      typeof defaults.fontSize === 'number' && defaults.fontSize >= 6 && defaults.fontSize <= 48
        ? defaults.fontSize
        : fallback.defaults.fontSize;
    const opacity =
      typeof defaults.opacity === 'number' && defaults.opacity >= 0.05 && defaults.opacity <= 1
        ? defaults.opacity
        : fallback.defaults.opacity;
    const width =
      typeof defaults.width === 'number' && defaults.width >= 1 && defaults.width <= 12
        ? defaults.width
        : fallback.defaults.width;
    const textAlign =
      defaults.textAlign === 'left' || defaults.textAlign === 'center' || defaults.textAlign === 'right'
        ? defaults.textAlign
        : fallback.defaults.textAlign;
    const textVerticalAlign =
      defaults.textVerticalAlign === 'top'
      || defaults.textVerticalAlign === 'middle'
      || defaults.textVerticalAlign === 'bottom'
        ? defaults.textVerticalAlign
        : fallback.defaults.textVerticalAlign;
    const customColors = Array.isArray(value.customColors)
      ? value.customColors
        .flatMap((candidate) =>
          typeof candidate === 'string' ? [normalizeHexColor(candidate)].filter(Boolean) : [],
        )
        .slice(-MAX_CUSTOM_COLORS) as string[]
      : [];
    return {
      defaults: {
        color: color ?? fallback.defaults.color,
        strokeEnabled:
          typeof defaults.strokeEnabled === 'boolean'
            ? defaults.strokeEnabled
            : fallback.defaults.strokeEnabled,
        fillColor,
        textColor: textColor ?? fallback.defaults.textColor,
        fontSize,
        textAlign,
        textVerticalAlign,
        opacity,
        width,
      },
      customColors: [...new Set(customColors)].slice(-MAX_CUSTOM_COLORS),
    };
  } catch {
    return fallback;
  }
}

function saveAnnotationToolbarPreferences(preferences: AnnotationToolbarPreferences): void {
  try {
    globalThis.localStorage?.setItem(
      ANNOTATION_PREFERENCES_STORAGE_KEY,
      JSON.stringify(preferences),
    );
  } catch {
    // Storage can be unavailable in privacy modes or restricted embeds.
  }
}

function hexToHsv(color: string): { hue: number; saturation: number; brightness: number } {
  const normalized = normalizeHexColor(color) ?? '#000000';
  const red = Number.parseInt(normalized.slice(1, 3), 16) / 255;
  const green = Number.parseInt(normalized.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { hue, saturation: max === 0 ? 0 : delta / max, brightness: max };
}

function hsvToHex(hue: number, saturation: number, brightness: number): string {
  const chroma = brightness * saturation;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [redPart, greenPart, bluePart] =
    sector < 1 ? [chroma, x, 0]
    : sector < 2 ? [x, chroma, 0]
    : sector < 3 ? [0, chroma, x]
    : sector < 4 ? [0, x, chroma]
    : sector < 5 ? [x, 0, chroma]
    : [chroma, 0, x];
  const offset = brightness - chroma;
  return `#${[redPart, greenPart, bluePart]
    .map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

const TOOL_ICON: Record<AnnotationTool, () => ReactNode> = {
  ink: IconPen,
  rectangle: IconRectangle,
  ellipse: IconEllipse,
  line: IconLine,
  arrow: IconArrowTool,
  highlight: IconHighlighter,
  note: IconNote,
};

/**
 * The annotation toolbar starts in annotation-object mode and provides
 * object/text selection toggles, drawing tools, an image picker, plus
 * color/width pickers. Closing it returns to normal viewing; Alt/Option
 * temporarily swaps the two selection modes and their pressed states.
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
  modeActive = true,
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
  };
  const visibleTools = tools.filter((tool, index, all) => all.indexOf(tool) === index);
  const [initialPreferences] = useState(() =>
    loadAnnotationToolbarPreferences(colors[0] ?? '#e53935'),
  );
  const initialDefaults = initialPreferences.defaults;
  const [active, setActive] = useState<AnnotationTool | null>(null);
  const [objectSelectionMode, setObjectSelectionMode] = useState(modeActive);
  const [modeModifierHeld, setModeModifierHeld] = useState(false);
  const [color, setColor] = useState(initialDefaults.color);
  const [strokeEnabled, setStrokeEnabled] = useState(initialDefaults.strokeEnabled);
  const [fillColor, setFillColor] = useState<string | null>(initialDefaults.fillColor);
  const [textColor, setTextColor] = useState(initialDefaults.textColor);
  const [fontSize, setFontSize] = useState(initialDefaults.fontSize);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>(initialDefaults.textAlign);
  const [textVerticalAlign, setTextVerticalAlign] = useState<'top' | 'middle' | 'bottom'>(
    initialDefaults.textVerticalAlign,
  );
  /** Whole-annotation opacity, 0-1. */
  const [opacity, setOpacity] = useState(initialDefaults.opacity);
  const [width, setWidth] = useState(initialDefaults.width);
  const [hasSelection, setHasSelection] = useState(false);
  const [selectionPopupPosition, setSelectionPopupPosition] = useState<{
    left: number;
    top: number;
    above: boolean;
  } | null>(null);
  const [selectionPopupTheme, setSelectionPopupTheme] = useState<CSSProperties>({});
  const [mixed, setMixed] = useState<Readonly<Record<MixedAttribute, boolean>>>(NO_MIXED_ATTRIBUTES);
  const [customColors, setCustomColors] = useState<string[]>(initialPreferences.customColors);
  const [preferencesRevision, setPreferencesRevision] = useState(0);
  const [customPicker, setCustomPicker] = useState<'stroke' | 'fill' | 'textColor' | null>(null);
  const [customColorInput, setCustomColorInput] = useState('#000000');
  const defaultsRef = useRef<AnnotationToolbarDefaults>(initialDefaults);
  /** Which attribute popup is open, if any. */
  const [openPalette, setOpenPalette] = useState<'stroke' | 'fill' | 'textColor' | 'textSize' | 'textAlign' | 'opacity' | 'width' | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const paletteHostRef = useRef<HTMLSpanElement>(null);
  const sliderGestureRef = useRef<{ key: string; sequence: number } | null>(null);
  const sliderSequenceRef = useRef(0);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const displayColors = [
    ...colors,
    ...customColors.filter((custom) => !colors.some((preset) => preset.toLowerCase() === custom)),
  ];
  const normalizedCustomColor = normalizeHexColor(customColorInput);
  const markPreferencesChanged = (): void => {
    setPreferencesRevision((revision) => revision + 1);
  };
  const updateSelectionPopupPosition = (): void => {
    const rect = viewer?.getSelectedAnnotationClientRect();
    if (!rect) {
      setSelectionPopupPosition(null);
      return;
    }
    const gap = 10;
    const popupWidth = Math.min(
      paletteHostRef.current?.getBoundingClientRect().width ?? 300,
      window.innerWidth - 16,
    );
    const popupHeight = paletteHostRef.current?.getBoundingClientRect().height ?? 38;
    const halfWidth = popupWidth / 2;
    const above =
      rect.bottom + popupHeight + gap > window.innerHeight
      && rect.top > popupHeight + gap;
    setSelectionPopupPosition({
      left: Math.max(halfWidth + 8, Math.min(window.innerWidth - halfWidth - 8, rect.left + rect.width / 2)),
      top: above ? rect.top - gap : rect.bottom + gap,
      above,
    });
    if (toolbarRef.current) {
      const computed = getComputedStyle(toolbarRef.current);
      const theme = Object.fromEntries(
        [
          '--pdfrx-accent',
          '--pdfrx-accent-contrast',
          '--pdfrx-fg',
          '--pdfrx-fg-muted',
          '--pdfrx-bg',
          '--pdfrx-bg-subtle',
          '--pdfrx-border',
          '--pdfrx-hover',
          '--pdfrx-danger',
          '--pdfrx-radius',
          '--pdfrx-font',
        ].map((name) => [name, computed.getPropertyValue(name)]),
      );
      setSelectionPopupTheme(theme as CSSProperties);
    }
  };

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
    viewer.setAnnotationMode(modeActive);
    setObjectSelectionMode(modeActive);
    const syncMode = (): void => {
      const tool = viewer.getAnnotationTool();
      setActive(tool);
      if (tool) setObjectSelectionMode(true);
    };
    syncMode();
    const unsubscribe = viewer.addAnnotationToolChangeListener(syncMode);
    return () => {
      unsubscribe();
      viewer.setAnnotationMode(false);
    };
  }, [viewer, modeActive]);

  useEffect(() => {
    const onModifierDown = (event: KeyboardEvent): void => {
      if (event.key === 'Alt') setModeModifierHeld(true);
    };
    const onModifierUp = (event: KeyboardEvent): void => {
      if (event.key === 'Alt') setModeModifierHeld(false);
    };
    const resetModifier = (): void => setModeModifierHeld(false);
    window.addEventListener('keydown', onModifierDown);
    window.addEventListener('keyup', onModifierUp);
    window.addEventListener('blur', resetModifier);
    return () => {
      window.removeEventListener('keydown', onModifierDown);
      window.removeEventListener('keyup', onModifierUp);
      window.removeEventListener('blur', resetModifier);
    };
  }, []);

  useEffect(() => {
    if (!viewer) return;
    const defaults = defaultsRef.current;
    viewer.setAnnotationStyle({
      color: defaults.color,
      fillColor: defaults.fillColor,
      strokeWidth: defaults.strokeEnabled ? defaults.width : 0,
      opacity: defaults.opacity,
      textColor: defaults.textColor,
      fontSize: defaults.fontSize,
      textAlign: defaults.textAlign,
      textVerticalAlign: defaults.textVerticalAlign,
    });
  }, [viewer]);

  useEffect(() => {
    if (preferencesRevision === 0) return;
    saveAnnotationToolbarPreferences({
      defaults: defaultsRef.current,
      customColors,
    });
  }, [customColors, preferencesRevision]);

  useEffect(() => {
    if (!viewer) return;
    const syncSelectionStyle = (): void => {
      const annotations = viewer.getSelectedAnnotations();
      setHasSelection(viewer.getSelectedAnnotationIds().length > 0);
      requestAnimationFrame(updateSelectionPopupPosition);
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
    const unsubscribeSelection = viewer.addAnnotationSelectionChangeListener(syncSelectionStyle);
    const unsubscribeTransform = viewer.addTransformChangeListener(updateSelectionPopupPosition);
    const unsubscribePreview = viewer.addAnnotationPreviewChangeListener(updateSelectionPopupPosition);
    window.addEventListener('resize', updateSelectionPopupPosition);
    return () => {
      unsubscribeSelection();
      unsubscribeTransform();
      unsubscribePreview();
      window.removeEventListener('resize', updateSelectionPopupPosition);
    };
  }, [viewer]);

  // Dismiss an open palette on outside pointerdown or Escape.
  useEffect(() => {
    if (!openPalette) return;
    const onDown = (e: PointerEvent): void => {
      if (!paletteHostRef.current?.contains(e.target as Node)) {
        setOpenPalette(null);
        setCustomPicker(null);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpenPalette(null);
        setCustomPicker(null);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [openPalette]);

  useEffect(() => {
    return () => viewer?.clearSelectionStylePreview();
  }, [viewer, customPicker]);

  const applyMode = (mode: AnnotationTool): void => {
    const next = active === mode ? null : mode;
    if (next) {
      setObjectSelectionMode(true);
      viewer?.setAnnotationMode(true);
    }
    setActive(next);
    viewer?.setAnnotationTool(next);
  };
  const applyInteractionMode = (objectMode: boolean): void => {
    const persistentMode = objectMode !== modeModifierHeld;
    setObjectSelectionMode(persistentMode);
    viewer?.setAnnotationMode(persistentMode);
  };
  const effectiveObjectSelectionMode =
    modeActive && objectSelectionMode !== modeModifierHeld;
  const rememberCustomColor = (selectedColor: string): void => {
    const normalized = selectedColor.toLowerCase();
    if (colors.some((preset) => preset.toLowerCase() === normalized)) return;
    setCustomColors((current) => [
      ...current.filter((candidate) => candidate !== normalized),
      normalized,
    ].slice(-MAX_CUSTOM_COLORS));
    markPreferencesChanged();
  };
  const togglePalette = (
    palette: 'stroke' | 'fill' | 'textColor' | 'textSize' | 'textAlign' | 'opacity' | 'width',
  ): void => {
    setCustomPicker(null);
    setOpenPalette(openPalette === palette ? null : palette);
  };
  const pickStroke = (c: string): void => {
    const shouldRestoreWidth = !strokeEnabled || mixed.stroke;
    const restoredWidth = defaultsRef.current.width;
    defaultsRef.current.color = c;
    defaultsRef.current.strokeEnabled = true;
    markPreferencesChanged();
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
    markPreferencesChanged();
    setStrokeEnabled(false);
    setMixed((value) => ({ ...value, stroke: false }));
    setOpenPalette(null);
    viewer?.setAnnotationStyle({ strokeWidth: 0 });
    void viewer?.applyStyleToSelection({ strokeWidth: 0 });
  };
  const pickFill = (c: string | null): void => {
    defaultsRef.current.fillColor = c;
    markPreferencesChanged();
    setFillColor(c);
    setMixed((value) => ({ ...value, fill: false }));
    setOpenPalette(null);
    viewer?.setAnnotationStyle({ fillColor: c });
    void viewer?.applyStyleToSelection({ fillColor: c });
  };
  const pickTextColor = (c: string): void => {
    defaultsRef.current.textColor = c;
    markPreferencesChanged();
    setTextColor(c);
    setMixed((value) => ({ ...value, textColor: false }));
    setOpenPalette(null);
    viewer?.setAnnotationStyle({ textColor: c });
    void viewer?.applyStyleToSelection({ textColor: c });
  };
  const pickTextSize = (size: number): void => {
    defaultsRef.current.fontSize = size;
    markPreferencesChanged();
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
    markPreferencesChanged();
    setTextAlign(horizontal);
    setTextVerticalAlign(vertical);
    setMixed((value) => ({ ...value, textAlign: false }));
    viewer?.setAnnotationStyle({ textAlign: horizontal, textVerticalAlign: vertical });
    void viewer?.applyStyleToSelection({ textAlign: horizontal, textVerticalAlign: vertical });
  };
  const pickOpacity = (v: number): void => {
    defaultsRef.current.opacity = v;
    markPreferencesChanged();
    setOpacity(v);
    setMixed((value) => ({ ...value, opacity: false }));
    viewer?.setAnnotationStyle({ opacity: v });
    void viewer?.applyStyleToSelection({ opacity: v }, sliderMergeKey('opacity'));
  };
  const pickWidth = (w: number): void => {
    defaultsRef.current.width = w;
    defaultsRef.current.strokeEnabled = true;
    markPreferencesChanged();
    setWidth(w);
    setStrokeEnabled(true);
    setMixed((value) => ({ ...value, stroke: false, width: false }));
    viewer?.setAnnotationStyle({ strokeWidth: w });
    void viewer?.applyStyleToSelection({ strokeWidth: w }, sliderMergeKey('strokeWidth'));
  };
  const openCustomColorPicker = (palette: 'stroke' | 'fill' | 'textColor'): void => {
    const current = palette === 'stroke' ? color : palette === 'fill' ? fillColor : textColor;
    setCustomColorInput(normalizeHexColor(current ?? '') ?? '#000000');
    setCustomPicker(palette);
  };
  const applyCustomColor = (): void => {
    if (!normalizedCustomColor || !customPicker) return;
    rememberCustomColor(normalizedCustomColor);
    if (customPicker === 'stroke') pickStroke(normalizedCustomColor);
    else if (customPicker === 'fill') pickFill(normalizedCustomColor);
    else pickTextColor(normalizedCustomColor);
    setCustomPicker(null);
  };
  const previewCustomColor = (nextColor: string): void => {
    setCustomColorInput(nextColor);
    const normalized = normalizeHexColor(nextColor);
    if (!normalized || !customPicker) {
      viewer?.clearSelectionStylePreview();
      return;
    }
    if (customPicker === 'stroke') viewer?.previewStyleToSelection({ color: normalized });
    else if (customPicker === 'fill') viewer?.previewStyleToSelection({ fillColor: normalized });
    else viewer?.previewStyleToSelection({ textColor: normalized });
  };
  return (
    <div ref={toolbarRef} className={['pdfrx-annot-toolbar', className].filter(Boolean).join(' ')} style={style}>
      <InteractionModeButton
        active={effectiveObjectSelectionMode}
        onClick={() => applyInteractionMode(true)}
        title={strings.objectSelection}
      >
        <IconObjectSelection />
      </InteractionModeButton>
      <InteractionModeButton
        active={!effectiveObjectSelectionMode}
        onClick={() => applyInteractionMode(false)}
        title={strings.textSelection}
      >
        <IconTextSelection />
      </InteractionModeButton>
      <span className="pdfrx-toolbar-separator" aria-hidden />
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
      {hasSelection && selectionPopupPosition && createPortal(
        <div
          className={[
            'pdfrx-toolbar',
            'pdfrx-annot-selection-popup',
            selectionPopupPosition.above ? 'pdfrx-annot-selection-popup-above' : '',
          ].filter(Boolean).join(' ')}
          style={{
            ...selectionPopupTheme,
            left: selectionPopupPosition.left,
            top: selectionPopupPosition.top,
          }}
        >
          <span className="pdfrx-annot-colors" ref={paletteHostRef}>
        <span className="pdfrx-annot-colorbtn">
          <button
            type="button"
            className={['pdfrx-button', openPalette === 'stroke' ? 'pdfrx-button-active' : ''].filter(Boolean).join(' ')}
            title={strings.strokeColor}
            aria-label={strings.strokeColor}
            aria-expanded={openPalette === 'stroke'}
            onClick={() => togglePalette('stroke')}
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
              {displayColors.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="option"
                  aria-selected={!mixed.stroke && !mixed.color && strokeEnabled && color === c}
                  className={[
                    'pdfrx-annot-swatch',
                    isNearBlack(c) ? 'pdfrx-annot-swatch-near-black' : '',
                    !mixed.stroke && !mixed.color && strokeEnabled && color === c ? 'pdfrx-annot-swatch-active' : '',
                  ].filter(Boolean).join(' ')}
                  aria-label={`${strings.strokeColor}: ${c}`}
                  onClick={() => {
                    rememberCustomColor(c);
                    pickStroke(c);
                  }}
                  style={{ background: c }}
                />
              ))}
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="pdfrx-annot-custom-trigger"
                onClick={() => openCustomColorPicker('stroke')}
              >
                {strings.otherColor}
              </button>
              {customPicker === 'stroke' && (
                <CustomColorEditor
                  value={customColorInput}
                  valid={normalizedCustomColor !== null}
                  strings={strings}
                  onChange={previewCustomColor}
                  onApply={applyCustomColor}
                />
              )}
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
            onClick={() => togglePalette('fill')}
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
              {displayColors.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="option"
                  aria-selected={!mixed.fill && fillColor === c}
                  className={[
                    'pdfrx-annot-swatch',
                    isNearBlack(c) ? 'pdfrx-annot-swatch-near-black' : '',
                    !mixed.fill && fillColor === c ? 'pdfrx-annot-swatch-active' : '',
                  ].filter(Boolean).join(' ')}
                  aria-label={`${strings.fillColor}: ${c}`}
                  onClick={() => {
                    rememberCustomColor(c);
                    pickFill(c);
                  }}
                  style={{ background: c }}
                />
              ))}
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="pdfrx-annot-custom-trigger"
                onClick={() => openCustomColorPicker('fill')}
              >
                {strings.otherColor}
              </button>
              {customPicker === 'fill' && (
                <CustomColorEditor
                  value={customColorInput}
                  valid={normalizedCustomColor !== null}
                  strings={strings}
                  onChange={previewCustomColor}
                  onApply={applyCustomColor}
                />
              )}
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
            onClick={() => togglePalette('textColor')}
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
              {displayColors.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="option"
                  aria-selected={!mixed.textColor && textColor === c}
                  className={[
                    'pdfrx-annot-swatch',
                    isNearBlack(c) ? 'pdfrx-annot-swatch-near-black' : '',
                    !mixed.textColor && textColor === c ? 'pdfrx-annot-swatch-active' : '',
                  ].filter(Boolean).join(' ')}
                  aria-label={`${strings.textColor}: ${c}`}
                  onClick={() => {
                    rememberCustomColor(c);
                    pickTextColor(c);
                  }}
                  style={{ background: c }}
                />
              ))}
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="pdfrx-annot-custom-trigger"
                onClick={() => openCustomColorPicker('textColor')}
              >
                {strings.otherColor}
              </button>
              {customPicker === 'textColor' && (
                <CustomColorEditor
                  value={customColorInput}
                  valid={normalizedCustomColor !== null}
                  strings={strings}
                  onChange={previewCustomColor}
                  onApply={applyCustomColor}
                />
              )}
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
        </div>,
        document.body,
      )}
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

function CustomColorEditor({
  value,
  valid,
  strings,
  onChange,
  onApply,
}: {
  value: string;
  valid: boolean;
  strings: Pick<
    PdfrxStrings,
    'customColor' | 'saturationBrightness' | 'hue' | 'colorCode' | 'applyColor'
  >;
  onChange: (value: string) => void;
  onApply: () => void;
}): ReactNode {
  const initial = hexToHsv(value);
  const [hue, setHue] = useState(initial.hue);
  const [saturation, setSaturation] = useState(initial.saturation);
  const [brightness, setBrightness] = useState(initial.brightness);
  const updateSpectrum = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const nextSaturation = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const nextBrightness = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / Math.max(1, rect.height)));
    setSaturation(nextSaturation);
    setBrightness(nextBrightness);
    onChange(hsvToHex(hue, nextSaturation, nextBrightness));
  };
  const updateFromCode = (nextValue: string): void => {
    onChange(nextValue);
    const normalized = normalizeHexColor(nextValue);
    if (!normalized) return;
    const next = hexToHsv(normalized);
    setHue(next.hue);
    setSaturation(next.saturation);
    setBrightness(next.brightness);
  };
  return (
    <form
      className="pdfrx-annot-custom-editor"
      aria-label={strings.customColor}
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <div
        className="pdfrx-annot-custom-spectrum"
        role="slider"
        aria-label={strings.saturationBrightness}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(brightness * 100)}
        aria-valuetext={`${Math.round(saturation * 100)}%, ${Math.round(brightness * 100)}%`}
        tabIndex={0}
        style={{ backgroundColor: `hsl(${hue} 100% 50%)` }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          updateSpectrum(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSpectrum(event);
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.1 : 0.01;
          let nextSaturation = saturation;
          let nextBrightness = brightness;
          if (event.key === 'ArrowLeft') nextSaturation -= step;
          else if (event.key === 'ArrowRight') nextSaturation += step;
          else if (event.key === 'ArrowDown') nextBrightness -= step;
          else if (event.key === 'ArrowUp') nextBrightness += step;
          else return;
          event.preventDefault();
          nextSaturation = Math.max(0, Math.min(1, nextSaturation));
          nextBrightness = Math.max(0, Math.min(1, nextBrightness));
          setSaturation(nextSaturation);
          setBrightness(nextBrightness);
          onChange(hsvToHex(hue, nextSaturation, nextBrightness));
        }}
      >
        <span
          className="pdfrx-annot-custom-spectrum-handle"
          style={{ left: `${saturation * 100}%`, top: `${(1 - brightness) * 100}%` }}
          aria-hidden
        />
      </div>
      <input
        className="pdfrx-annot-custom-hue"
        type="range"
        min={0}
        max={359}
        value={Math.round(hue)}
        aria-label={strings.hue}
        onChange={(event) => {
          const nextHue = Number(event.target.value);
          setHue(nextHue);
          onChange(hsvToHex(nextHue, saturation, brightness));
        }}
      />
      <input
        className="pdfrx-annot-custom-code"
        type="text"
        value={value}
        aria-label={strings.colorCode}
        aria-invalid={!valid}
        maxLength={7}
        spellCheck={false}
        onChange={(event) => updateFromCode(event.target.value)}
      />
      <button type="submit" className="pdfrx-annot-custom-apply" disabled={!valid}>
        {strings.applyColor}
      </button>
    </form>
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

/** One interaction-mode choice in {@link PdfAnnotationToolbar}. */
function InteractionModeButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      className={['pdfrx-button', active ? 'pdfrx-button-active' : ''].filter(Boolean).join(' ')}
      aria-pressed={active}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}
