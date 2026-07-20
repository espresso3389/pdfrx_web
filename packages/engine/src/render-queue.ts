/**
 * Render scheduling and cancellation.
 *
 * The worker is single-threaded: a `renderPage` command posted to it runs to
 * completion and cannot be interrupted. Posting every render immediately
 * therefore builds a queue *inside* the worker that nothing can reach — scroll
 * quickly through a long document and the pages now on screen wait behind a
 * backlog of pages that scrolled away long ago.
 *
 * So the queue is kept here instead. At most {@link RenderQueue.concurrency}
 * renders are handed to the worker at a time; the rest wait where they can
 * still be dropped. This mirrors pdfrx's `PdfPageRenderCancellationToken`,
 * which likewise cancels work that has not started rather than aborting a
 * render already in progress.
 */

/**
 * Cancels a {@link PdfPage.render} that has not started yet.
 *
 * Create one with {@link PdfPage.createCancellationToken} and pass it as
 * {@link PdfPageRenderOptions.cancellationToken}. Cancelling makes `render`
 * resolve to `null`. A render already running in the worker cannot be
 * interrupted — it finishes, and its result is discarded.
 *
 * A token belongs to a single render; create a new one per call.
 *
 * @example
 * ```ts
 * const token = page.createCancellationToken();
 * const image = await page.render({ fullWidth, fullHeight, cancellationToken: token });
 * if (!image) return; // cancelled (or the document was disposed)
 * ```
 */
export class PdfPageRenderCancellationToken {
  private canceled = false;
  private onCancel: (() => void) | null = null;

  /** Whether {@link cancel} has been called. */
  get isCanceled(): boolean {
    return this.canceled;
  }

  /**
   * Cancels the render. If it is still queued it never runs and `render`
   * resolves to `null`; if the worker already started it, the result is
   * discarded when it arrives. Idempotent.
   */
  cancel(): void {
    if (this.canceled) return;
    this.canceled = true;
    const notify = this.onCancel;
    this.onCancel = null;
    notify?.();
  }

  /** @internal Registers the queue's drop hook (fires immediately if already cancelled). */
  attach(onCancel: () => void): void {
    if (this.canceled) onCancel();
    else this.onCancel = onCancel;
  }

  /** @internal Detaches the drop hook once the work is no longer droppable. */
  detach(): void {
    this.onCancel = null;
  }
}

interface QueueEntry {
  run: () => Promise<unknown>;
  settle: (value: unknown) => void;
  fail: (reason: unknown) => void;
  token: PdfPageRenderCancellationToken | undefined;
}

/**
 * @internal
 * Serializes render commands so that queued work stays cancellable. Owned by
 * {@link WorkerCommunicator} — one queue per worker, shared by every document
 * it opened, because the worker is what is actually being contended for.
 */
export class RenderQueue {
  /**
   * @param concurrency - Renders allowed to be in the worker at once. The
   *   worker runs them one at a time regardless; anything above 1 only buys a
   *   little pipelining in exchange for that many uncancellable renders.
   */
  constructor(private readonly concurrency = 1) {}

  private readonly queue: QueueEntry[] = [];
  private active = 0;
  private disposed = false;

  /** Number of renders waiting for a slot (excludes those already dispatched). */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * Queues `run`, resolving with its result — or with `null` if `token` was
   * cancelled before the result was in hand.
   */
  enqueue<T>(run: () => Promise<T>, token?: PdfPageRenderCancellationToken): Promise<T | null> {
    if (this.disposed || token?.isCanceled) return Promise.resolve(null);
    return new Promise<T | null>((resolve, reject) => {
      const entry: QueueEntry = {
        run: run as () => Promise<unknown>,
        settle: resolve as (value: unknown) => void,
        fail: reject,
        token,
      };
      this.queue.push(entry);
      // While queued the work can simply be dropped; once dispatched, the hook
      // is detached and cancellation only discards the result.
      token?.attach(() => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) {
          this.queue.splice(index, 1);
          resolve(null);
        }
      });
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      entry.token?.detach();
      this.active++;
      entry
        .run()
        .then((result) => entry.settle(entry.token?.isCanceled ? null : result))
        .catch(entry.fail)
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }

  /** Drops everything still queued; dispatched renders are left to settle. */
  clear(): void {
    for (const entry of this.queue.splice(0)) {
      entry.token?.detach();
      entry.settle(null);
    }
  }

  /** Drops queued work and refuses any more. */
  dispose(): void {
    this.disposed = true;
    this.clear();
  }
}
