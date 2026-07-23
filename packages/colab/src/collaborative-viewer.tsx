import {
  PdfSidebar,
  PdfAnnotationToolbar,
  PdfPageActions,
  PdfSaveButton,
  PdfToolbar,
  PdfViewerSurface,
  PdfrxProvider,
  IconAnnotate,
  IconOpenFile,
  imageBytesToPdf,
  isImageFile,
  isPdfFile,
  type PdfSource,
  usePdfDocument,
  usePdfrxViewer,
} from '@pdfrx/react';
import type {
  PdfAnnotationChange,
  PdfAnnotationSnapshot,
  PdfDocument,
  PdfFormField,
  PdfFormFieldValue,
} from '@pdfrx/engine';
import type { PagePlacementOperation } from '@pdfrx/viewer-core';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  fetchRelaySource,
  PageCollaborationClient,
  uploadRelaySource,
  type CollaborationConnectionState,
  type CollaborationTransport,
} from './client.js';
import { applyPagePlacementsToViewer, PageSourceRegistry } from './page-adapter.js';
import { encodeCollaborativePdf } from './export-composer.js';
import type { PageSessionSnapshot } from './protocol.js';
import {
  movePlacementToIndex,
  rotatePlacement,
} from './ui-operations.js';

const formFieldValue = (field: PdfFormField): PdfFormFieldValue => {
  if (field.type === 'checkBox') return field.isChecked === true;
  if (field.type === 'listBox' && field.options) {
    const selected = field.options.filter((option) => option.selected).map((option) => option.label);
    return selected.length > 1 ? selected : selected[0] ?? '';
  }
  return field.value;
};

const sameFormValue = (left: PdfFormFieldValue | undefined, right: PdfFormFieldValue): boolean =>
  left !== undefined && JSON.stringify(left) === JSON.stringify(right);

/** Configuration for the ready-made collaborative React viewer. */
export interface CollaborativePdfViewerProps {
  /** Stable participant identifier attached to page and annotation operations. */
  readonly actorId: string;
  /** WebSocket endpoint of the collaboration relay. */
  readonly relayUrl: string;
  /** Shared session identifier. */
  readonly sessionId: string;
  /** Device-specific membership token issued when this participant was admitted. */
  readonly memberToken?: string;
  /** Reports relay connection lifecycle changes. */
  readonly onConnectionStateChange?: (state: CollaborationConnectionState) => void;
  /** Reports the number of participants currently connected. */
  readonly onPresenceChange?: (connectedCount: number) => void;
  /** Accessible participant label shown in the built-in chrome. */
  readonly name?: string;
  /** Initial PDF used for the session's `main` source. */
  readonly src: PdfSource;
  /** Directory containing the PDFium worker assets. */
  readonly wasmModulesUrl?: string;
  /** Additional class applied to the outer `.collab-pane` element. */
  readonly className?: string;
  /** Authentication and routing hooks for relay WebSocket and source requests. */
  readonly transport?: CollaborationTransport;
}

/**
 * Ready-made `@pdfrx/react` viewer connected to a strict-revision relay.
 *
 * It owns its provider, opens missing shared sources, synchronizes page,
 * annotation, and form streams, and supplies import and collaborative export
 * UI. Hosts should import both `@pdfrx/react/styles.css` and
 * `@pdfrx/colab/styles.css` once.
 */
export function CollaborativePdfViewer({
  name,
  actorId,
  relayUrl,
  sessionId,
  memberToken,
  onConnectionStateChange,
  onPresenceChange,
  src,
  wasmModulesUrl = '/pdfium/',
  className,
  transport,
}: CollaborativePdfViewerProps): ReactNode {
  const displayName = name ?? actorId;
  return (
    <section className={`collab-pane ${className ?? ''}`.trim()} data-testid={`pane-${actorId}`}>
      <PdfrxProvider
        src={src}
        wasmModulesUrl={wasmModulesUrl}
        // Local history stores page positions and annotation snapshots that can
        // become stale after another participant edits the session. Keep it
        // disabled until collaborative undo is expressed as relay operations.
        editing={{ pages: true, annotations: true, history: false, actorId }}
      >
        <CollaborativeViewerContent
          name={displayName}
          actorId={actorId}
          relayUrl={relayUrl}
          sessionId={sessionId}
          memberToken={memberToken}
          onConnectionStateChange={onConnectionStateChange}
          onPresenceChange={onPresenceChange}
          transport={transport}
        />
      </PdfrxProvider>
    </section>
  );
}

function CollaborativeViewerContent({
  name,
  actorId,
  relayUrl,
  sessionId,
  memberToken,
  onConnectionStateChange,
  onPresenceChange,
  transport,
}: {
  name: string;
  actorId: string;
  relayUrl: string;
  sessionId: string;
  memberToken?: string;
  onConnectionStateChange?: (state: CollaborationConnectionState) => void;
  onPresenceChange?: (connectedCount: number) => void;
  transport?: CollaborationTransport;
}): ReactNode {
  const viewer = usePdfrxViewer();
  const documentState = usePdfDocument();
  const [snapshot, setSnapshot] = useState<PageSessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [annotating, setAnnotating] = useState(true);
  const [joinRequests, setJoinRequests] = useState<readonly {
    requestId: string;
    actorId: string;
    displayName: string;
  }[]>([]);
  const clientRef = useRef<PageCollaborationClient | null>(null);
  const sourcesRef = useRef<PageSourceRegistry | null>(null);
  const sourceDocumentsRef = useRef<PdfDocument[]>([]);
  const sourceOpensRef = useRef(new Map<string, Promise<PdfDocument>>());
  const observeSourceFormsRef = useRef<(documentId: string, document: PdfDocument) => void>(() => {});
  const openFileInputRef = useRef<HTMLInputElement>(null);

  const ensureSource = useCallback(async (documentId: string): Promise<PdfDocument> => {
    const sources = sourcesRef.current;
    if (!viewer || !sources) throw new Error('PDFソースの準備ができていません');
    if (sources.has(documentId)) return sources.document(documentId);
    const existing = sourceOpensRef.current.get(documentId);
    if (existing) return existing;
    const opening = (async () => {
      const response = await fetchRelaySource(relayUrl, sessionId, documentId, transport);
      if (!response.ok) throw new Error(`共有PDFを取得できません (${response.status})`);
      const document = await viewer.engine.openData(await response.arrayBuffer(), { sourceName: `${documentId}.pdf` });
      sources.register(documentId, document);
      sourceDocumentsRef.current.push(document);
      observeSourceFormsRef.current(documentId, document);
      return document;
    })();
    sourceOpensRef.current.set(documentId, opening);
    try {
      return await opening;
    } finally {
      sourceOpensRef.current.delete(documentId);
    }
  }, [relayUrl, sessionId, transport, viewer]);

  useEffect(() => {
    const document = viewer?.document;
    if (!document || documentState.isLoading) return;
    const client = new PageCollaborationClient(actorId, undefined, transport?.createWebSocket);
    clientRef.current = client;
    const sources = new PageSourceRegistry();
    sources.register('main', document);
    sourcesRef.current = sources;
    let active = true;
    const formValues = new Map<string, PdfFormFieldValue>();
    const formDefaults = new Map<string, PdfFormFieldValue>();
    const formObservers = new Map<string, () => void>();
    const applyingRemoteForms = new WeakSet<PdfDocument>();
    const formKey = (documentId: string, fieldName: string): string => `${documentId}\u0000${fieldName}`;
    const readSourceForms = async (documentId: string, sourceDocument: PdfDocument, publish: boolean): Promise<void> => {
      const fields = await sourceDocument.loadFormFields();
      for (const field of fields) {
        if (!field.name) continue;
        const key = formKey(documentId, field.name);
        const value = formFieldValue(field);
        if (!formDefaults.has(key)) formDefaults.set(key, value);
        const previous = formValues.get(key);
        formValues.set(key, value);
        if (publish && !sameFormValue(previous, value)) {
          await client.submitForm({ documentId, fieldName: field.name, value });
        }
      }
    };
    const observeSourceForms = (documentId: string, sourceDocument: PdfDocument): void => {
      if (formObservers.has(documentId)) return;
      void readSourceForms(documentId, sourceDocument, false).catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
      const unsubscribeForms = sourceDocument.addEventListener('formFieldsChanged', () => {
        void readSourceForms(documentId, sourceDocument, !applyingRemoteForms.has(sourceDocument)).catch((reason: unknown) =>
          setError(reason instanceof Error ? reason.message : String(reason)),
        );
      });
      formObservers.set(documentId, unsubscribeForms);
    };
    observeSourceFormsRef.current = observeSourceForms;
    observeSourceForms('main', document);
    let applying = Promise.resolve();
    const unsubscribe = client.subscribe((next) => {
      applying = applying.then(async () => {
        const documentIds = new Set(next.pages.map((page) => page.source.documentId));
        await Promise.all([...documentIds].filter((id) => !sources.has(id)).map(ensureSource));
        if (!active) return;
        applyPagePlacementsToViewer(viewer, next.pages, sources, {
          origin: 'remote',
          transactionId: `revision-${next.revision}`,
          recordHistory: false,
        });
        setSnapshot(next);
        setError(null);
      }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    });
    let applyingAnnotations = Promise.resolve();
    const unsubscribeAnnotations = client.subscribeAnnotations((annotationSnapshot, committed) => {
      applyingAnnotations = applyingAnnotations.then(async () => {
        if (!active) return;
        if (committed?.actorId === actorId) return;
        if (!committed) {
          const annotations: PdfAnnotationSnapshot['annotations'][number][] = [];
          for (const record of annotationSnapshot.annotations) {
            const pageIndex = client.snapshot?.pages.findIndex((page) => page.placementId === record.placementId) ?? -1;
            if (pageIndex < 0) continue;
            const spec = structuredClone(record.spec);
            await viewer.prepareAnnotationAppearance(spec);
            annotations.push({ id: record.id, pageNumber: pageIndex + 1, spec });
          }
          await document.restoreAnnotations(
            { version: 1, annotations },
            { mode: 'replace', origin: 'remote', transactionId: 'annotation-snapshot' },
          );
          return;
        }
        const records = committed
          ? [committed.change]
          : [];
        const changes: PdfAnnotationChange[] = [];
        for (const record of records) {
          const pageIndex = client.snapshot?.pages.findIndex((page) => page.placementId === record.placementId) ?? -1;
          if (pageIndex < 0) continue;
          if (record.type === 'remove') {
            changes.push({ type: 'remove', id: record.id, pageNumber: pageIndex + 1 });
            continue;
          }
          const spec = structuredClone(record.spec);
          await viewer.prepareAnnotationAppearance(spec);
          changes.push({ type: record.type, id: record.id, pageNumber: pageIndex + 1, spec });
        }
        if (changes.length > 0) {
          await document.applyAnnotationChanges(changes, {
            origin: 'remote',
            actorId: committed?.actorId,
            transactionId: committed ? `annotation-revision-${committed.revision}` : 'annotation-snapshot',
          });
        }
      }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    });
    const unsubscribeAnnotationPreviews = client.subscribeAnnotationPreviews((preview) => {
      const changes = preview.changes.flatMap((record) => {
        const pageIndex = client.snapshot?.pages.findIndex((page) => page.placementId === record.placementId) ?? -1;
        return pageIndex < 0
          ? []
          : [{ pageNumber: pageIndex + 1, id: record.id, spec: structuredClone(record.spec) }];
      });
      viewer.applyAnnotationPreviewChanges(changes);
    });
    let applyingForms = Promise.resolve();
    const unsubscribeForms = client.subscribeForms((formSnapshot, committed) => {
      applyingForms = applyingForms.then(async () => {
        if (!active || committed?.actorId === actorId) return;
        if (!committed) {
          const authoritative = new Map(
            formSnapshot.fields.map((record) => [formKey(record.documentId, record.fieldName), record.value]),
          );
          const documentIds = new Set(client.snapshot?.pages.map((page) => page.source.documentId) ?? ['main']);
          for (const documentId of documentIds) {
            const sourceDocument = await ensureSource(documentId);
            const fields = await sourceDocument.loadFormFields();
            applyingRemoteForms.add(sourceDocument);
            try {
              for (const field of fields) {
                if (!field.name) continue;
                const key = formKey(documentId, field.name);
                const current = formFieldValue(field);
                if (!formDefaults.has(key)) formDefaults.set(key, current);
                const value = authoritative.get(key) ?? formDefaults.get(key) ?? current;
                if (!sameFormValue(current, value)) await sourceDocument.setFormFieldValue(field.name, value);
                formValues.set(key, value);
              }
            } finally {
              applyingRemoteForms.delete(sourceDocument);
            }
          }
          return;
        }
        const records = [committed.change];
        for (const record of records) {
          const sourceDocument = await ensureSource(record.documentId);
          applyingRemoteForms.add(sourceDocument);
          try {
            await sourceDocument.setFormFieldValue(record.fieldName, record.value);
            formValues.set(formKey(record.documentId, record.fieldName), record.value);
          } finally {
            applyingRemoteForms.delete(sourceDocument);
          }
        }
      }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    });
    const unsubscribeJoinRequests = client.subscribeJoinRequests((request) => {
      setJoinRequests((items) => [
        ...items.filter((item) => item.actorId !== request.actorId),
        { requestId: request.requestId, actorId: request.actorId, displayName: request.displayName },
      ]);
    });
    const unsubscribeJoinResolutions = client.subscribeJoinRequestResolutions((requestId) => {
      setJoinRequests((items) => items.filter((item) => item.requestId !== requestId));
    });
    const unsubscribeConnectionState = onConnectionStateChange
      ? client.subscribeConnectionState(onConnectionStateChange)
      : undefined;
    const unsubscribePresence = onPresenceChange
      ? client.subscribePresence(onPresenceChange)
      : undefined;
    const unsubscribeLocalAnnotations = document.addEventListener('annotationsChanged', (event) => {
      if (event.origin === 'remote') return;
      void (async () => {
        for (const change of event.changes) {
          const placement = client.snapshot?.pages[change.pageNumber - 1];
          if (!placement) throw new Error(`アノテーション対象ページ ${change.pageNumber} が見つかりません`);
          await client.submitAnnotation(change.type === 'remove'
            ? { type: 'remove', placementId: placement.placementId, id: change.id }
            : { type: change.type, placementId: placement.placementId, id: change.id, spec: change.spec });
        }
      })().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    });
    const unsubscribeLocalAnnotationPreviews = viewer.addAnnotationPreviewChangeListener((changes) => {
      const shared = changes.flatMap((change) => {
        const placement = client.snapshot?.pages[change.pageNumber - 1];
        return placement
          ? [{
              type: 'update' as const,
              placementId: placement.placementId,
              id: change.id,
              spec: structuredClone(change.spec),
            }]
          : [];
      });
      client.sendAnnotationPreview(shared);
    });
    void client.connect(relayUrl, sessionId, { memberToken, displayName: name, reconnect: true }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      active = false;
      unsubscribe();
      unsubscribeAnnotations();
      unsubscribeAnnotationPreviews();
      unsubscribeForms();
      unsubscribeJoinRequests();
      unsubscribeJoinResolutions();
      unsubscribeConnectionState?.();
      unsubscribePresence?.();
      unsubscribeLocalAnnotations();
      unsubscribeLocalAnnotationPreviews();
      for (const unsubscribeFormObserver of formObservers.values()) unsubscribeFormObserver();
      observeSourceFormsRef.current = () => {};
      if (clientRef.current === client) clientRef.current = null;
      client.close();
      sources.unregister('main');
      if (sourcesRef.current === sources) sourcesRef.current = null;
      for (const sourceDocument of sourceDocumentsRef.current.splice(0)) void sourceDocument.dispose();
      sourceOpensRef.current.clear();
    };
  }, [
    actorId,
    documentState.isLoading,
    ensureSource,
    memberToken,
    name,
    onConnectionStateChange,
    onPresenceChange,
    transport,
    viewer,
    viewer?.document,
  ]);

  const submit = useCallback(async (operation: PagePlacementOperation): Promise<void> => {
    setPending(true);
    try {
      const client = clientRef.current;
      if (!client) throw new Error('共同編集セッションへ接続していません');
      await client.submit(operation);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  }, []);

  const rotatePage = (pageNumber: number, delta: 90 | 180 | 270): void => {
    const placement = snapshot?.pages[pageNumber - 1];
    if (!placement) return;
    void submit(rotatePlacement(placement, delta));
  };
  const removePage = (pageNumber: number): void => {
    const placement = snapshot?.pages[pageNumber - 1];
    if (!placement || !snapshot || snapshot.pages.length <= 1) return;
    void submit({ type: 'page.remove', placementId: placement.placementId });
  };
  const reorder = (fromPageNumber: number, toIndex: number): void => {
    if (!snapshot) return;
    const operation = movePlacementToIndex(snapshot.pages, fromPageNumber, toIndex);
    if (operation) void submit(operation);
  };
  const insertFiles = async (files: File[], index: number): Promise<void> => {
    setPending(true);
    try {
      const client = clientRef.current;
      if (!client) throw new Error('共同編集セッションへ接続していません');
      if (!viewer) throw new Error('PDFビューアーの準備ができていません');
      let after = index === 0 ? null : client.snapshot?.pages[Math.min(index, client.snapshot.pages.length) - 1]?.placementId ?? null;
      for (const file of files) {
        if (!isPdfFile(file) && !isImageFile(file)) continue;
        const documentId = `source-${crypto.randomUUID()}`;
        const fileBytes = await file.arrayBuffer();
        const bytes = isImageFile(file)
          ? Uint8Array.from(await imageBytesToPdf(viewer.engine, fileBytes)).buffer
          : fileBytes;
        await uploadRelaySource(relayUrl, sessionId, documentId, bytes, transport);
        const sourceDocument = await ensureSource(documentId);
        for (let pageIndex = 0; pageIndex < sourceDocument.pages.length; pageIndex += 1) {
          const placementId = crypto.randomUUID();
          await client.submit({
            type: 'page.insert',
            page: { placementId, source: { documentId, pageIndex }, rotation: 0 },
            after,
          });
          after = placementId;
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  };

  const openSharedFile = async (file: File): Promise<void> => {
    setPending(true);
    try {
      const client = clientRef.current;
      if (!client) throw new Error('共同編集セッションへ接続していません');
      if (!viewer) throw new Error('PDFビューアーの準備ができていません');
      if (!isPdfFile(file) && !isImageFile(file)) throw new Error('PDFまたは画像を選択してください');
      const documentId = `source-${crypto.randomUUID()}`;
      const fileBytes = await file.arrayBuffer();
      const bytes = isImageFile(file)
        ? Uint8Array.from(await imageBytesToPdf(viewer.engine, fileBytes)).buffer
        : fileBytes;
      await uploadRelaySource(relayUrl, sessionId, documentId, bytes, transport);
      const sourceDocument = await ensureSource(documentId);
      await client.submit({
        type: 'page.replace',
        pages: sourceDocument.pages.map((_, pageIndex) => ({
          placementId: crypto.randomUUID(),
          source: { documentId, pageIndex },
          rotation: 0,
        })),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  };

  const connected = snapshot !== null && !pending;
  return (
    <>
      {joinRequests.map((request) => (
        <div className="collab-join-request" key={request.requestId}>
          <span>{request.displayName} さんが参加を希望しています</span>
          <span className="collab-join-actions">
            <button type="button" onClick={() => clientRef.current?.approveJoin(request.requestId)}>
              参加を承認
            </button>
            <button type="button" className="reject" onClick={() => clientRef.current?.rejectJoin(request.requestId)}>
              拒否
            </button>
          </span>
        </div>
      ))}
      <PdfToolbar
        beforeSearch={(
          <button
            type="button"
            className={`pdfrx-button${annotating ? ' pdfrx-button-active' : ''}`}
            aria-pressed={annotating}
            aria-label="アノテーション"
            title="アノテーション"
            onClick={() => setAnnotating((value) => !value)}
          >
            <IconAnnotate />
          </button>
        )}
      >
        <button
          type="button"
          className="pdfrx-button"
          aria-label="ファイルを開く"
          title="ファイルを開く"
          disabled={!connected}
          onClick={() => openFileInputRef.current?.click()}
        >
          <IconOpenFile />
        </button>
        <input
          ref={openFileInputRef}
          type="file"
          accept="application/pdf,.pdf,image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void openSharedFile(file);
          }}
        />
        <PdfSaveButton
          encode={async (rootDocument) => {
            const placements = clientRef.current?.snapshot?.pages;
            const sources = sourcesRef.current;
            return placements && sources
              ? encodeCollaborativePdf(rootDocument, placements, sources)
              : rootDocument.encodePdfCopy();
          }}
        />
      </PdfToolbar>
      {annotating && (
        <div className="pdfrx-toolbar pdfrx-toolbar-annot collab-annotation-toolbar">
          <PdfAnnotationToolbar
            onClose={() => setAnnotating(false)}
          />
        </div>
      )}
      {error && (
        <div className="collab-error" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="エラーを閉じる" onClick={() => setError(null)}>×</button>
        </div>
      )}
      <div className="collab-viewer-body">
        <PdfSidebar
          tabs={['thumbnails']}
          thumbnailWidth={96}
          style={{ width: 126 }}
          renderPageActions={(pageNumber) => (
            <PdfPageActions
              pageNumber={pageNumber}
              onRotatePage={rotatePage}
              onDeletePage={removePage}
              disabled={!connected}
            />
          )}
          onMovePage={connected ? reorder : undefined}
          onInsertFiles={connected ? (files, index) => void insertFiles(files, index) : undefined}
        />
        <PdfViewerSurface style={{ flex: 1, minWidth: 0 }} />
      </div>
    </>
  );
}
