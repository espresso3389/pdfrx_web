import type { PdfDest, PdfOutlineNode } from '@pdfrx/engine';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { usePdfNavigation } from '../hooks/use-pdf-navigation.js';
import { usePdfOutline } from '../hooks/use-pdf-outline.js';
import { usePdfrxStrings } from '../strings.js';
import { IconChevronDown, IconChevronRight } from './icons.js';
import { joinClass } from './toolbar-parts.js';

/** Props for {@link PdfOutlineTree}. */
export interface PdfOutlineTreeProps {
  className?: string;
  style?: CSSProperties;
  /** How many levels start expanded. Defaults to `1` (top level only). */
  defaultExpandedDepth?: number;
  /** Called after a node is activated — e.g. to close a drawer on a phone. */
  onNavigate?: (node: PdfOutlineNode) => void;
  /** Shown when the document has no outline. Defaults to the localized `noOutline` string. */
  emptyMessage?: ReactNode;
}

/**
 * The document's outline (bookmarks) as a collapsible tree. Clicking a node
 * jumps to its destination.
 *
 * Nodes are addressed by their path in the tree rather than by title, because
 * PDFs regularly repeat titles ("Overview" under three different chapters) and
 * collapsing one would otherwise collapse all of them.
 *
 * @example
 * ```tsx
 * <PdfOutlineTree defaultExpandedDepth={2} onNavigate={() => setDrawerOpen(false)} />
 * ```
 */
export function PdfOutlineTree({
  className,
  style,
  defaultExpandedDepth = 1,
  onNavigate,
  emptyMessage,
}: PdfOutlineTreeProps): ReactNode {
  const { outline, isLoading } = usePdfOutline();
  const { goToDest } = usePdfNavigation();
  const strings = usePdfrxStrings();
  // Only nodes the user has actually clicked are recorded; everything else
  // falls back to `defaultExpandedDepth`.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(EMPTY_OVERRIDES);

  if (isLoading && !outline) return <div className={joinClass('pdfrx-outline', className)} style={style} />;
  if (!outline || outline.length === 0) {
    return (
      <div className={joinClass('pdfrx-outline pdfrx-outline-empty', className)} style={style}>
        {emptyMessage ?? strings.noOutline}
      </div>
    );
  }

  const toggle = (path: string, isExpanded: boolean): void =>
    setOverrides((previous) => new Map(previous).set(path, !isExpanded));

  const activate = (node: PdfOutlineNode, dest: PdfDest | null): void => {
    goToDest(dest, 300);
    onNavigate?.(node);
  };

  const renderNodes = (nodes: readonly PdfOutlineNode[], depth: number, parentPath: string): ReactNode =>
    nodes.map((node, index) => {
      const path = `${parentPath}/${index}`;
      const hasChildren = node.children.length > 0;
      const isExpanded = hasChildren && (overrides.get(path) ?? depth < defaultExpandedDepth);
      return (
        <li key={path} className="pdfrx-outline-node" role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined}>
          <div className="pdfrx-outline-row" style={{ paddingInlineStart: `${depth * 14}px` }}>
            {hasChildren ? (
              <button
                className="pdfrx-outline-toggle"
                onClick={() => toggle(path, isExpanded)}
                aria-label={isExpanded ? strings.collapse : strings.expand}
              >
                {isExpanded ? <IconChevronDown /> : <IconChevronRight />}
              </button>
            ) : (
              <span className="pdfrx-outline-toggle pdfrx-outline-toggle-empty" />
            )}
            <button className="pdfrx-outline-title" title={node.title} onClick={() => activate(node, node.dest)}>
              {node.title}
            </button>
          </div>
          {hasChildren && isExpanded && <ul className="pdfrx-outline-children">{renderNodes(node.children, depth + 1, path)}</ul>}
        </li>
      );
    });

  return (
    <ul className={joinClass('pdfrx-outline', className)} style={style} role="tree">
      {renderNodes(outline, 0, '')}
    </ul>
  );
}

const EMPTY_OVERRIDES: ReadonlyMap<string, boolean> = new Map();
