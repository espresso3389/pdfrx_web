import type { PdfrxViewer } from '@pdfrx/viewer';
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { usePdfrxStore } from '../context.js';

/** Subscribes to whichever viewer events a hook cares about. Returns an unsubscribe function. */
export type ViewerSubscribe = (viewer: PdfrxViewer, onChange: () => void) => () => void;

/**
 * The plumbing every state hook in this package shares: subscribe to viewer
 * events, re-read a value when they fire, and feed the result to React through
 * `useSyncExternalStore` so it behaves under concurrent rendering.
 *
 * Two details make this work with object-shaped snapshots, which
 * `useSyncExternalStore` otherwise loops on:
 *
 * - the value is recomputed only after a notification, not on every render;
 * - `isEqual` lets a recomputed-but-unchanged value keep its previous identity,
 *   so React can bail out of the re-render.
 *
 * The viewer can be `null` (before {@link PdfViewerSurface} mounts, and during
 * SSR), so `getSnapshot` must handle that.
 */
export function useViewerSnapshot<T>(
  subscribe: ViewerSubscribe,
  getSnapshot: (viewer: PdfrxViewer | null) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const store = usePdfrxStore();

  // Latest-ref so callers can pass inline closures without resubscribing.
  const subscribeRef = useRef(subscribe);
  subscribeRef.current = subscribe;
  const getSnapshotRef = useRef(getSnapshot);
  getSnapshotRef.current = getSnapshot;
  const isEqualRef = useRef(isEqual);
  isEqualRef.current = isEqual;

  const cache = useRef<{ valid: boolean; hasValue: boolean; value: T }>({
    valid: false,
    hasValue: false,
    value: undefined as T,
  });

  const subscribeToStore = useCallback(
    (onStoreChange: () => void) => {
      let unsubscribeViewer: (() => void) | null = null;
      const invalidate = (): void => {
        cache.current.valid = false;
        onStoreChange();
      };
      // The viewer is created and destroyed under us, so the per-viewer
      // subscription is rebuilt whenever the store reports a new one.
      const rebind = (): void => {
        unsubscribeViewer?.();
        unsubscribeViewer = null;
        const viewer = store.getViewer();
        if (viewer) unsubscribeViewer = subscribeRef.current(viewer, invalidate);
      };
      const unsubscribeStore = store.subscribe(() => {
        rebind();
        invalidate();
      });
      rebind();
      return () => {
        unsubscribeStore();
        unsubscribeViewer?.();
      };
    },
    [store],
  );

  const read = useCallback((): T => {
    if (!cache.current.valid) {
      const next = getSnapshotRef.current(store.getViewer());
      if (!cache.current.hasValue || !isEqualRef.current(cache.current.value, next)) {
        cache.current.value = next;
        cache.current.hasValue = true;
      }
      cache.current.valid = true;
    }
    return cache.current.value;
  }, [store]);

  return useSyncExternalStore(subscribeToStore, read, read);
}

/** Shallow object comparison, the usual `isEqual` for record-shaped snapshots. */
export function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => Object.is(a[k], b[k]));
}
