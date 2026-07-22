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
  usePdfDocument,
  usePdfrxViewer,
} from '@pdfrx/react';
import type { PdfAnnotationChange, PdfDocument, PdfFormField, PdfFormFieldValue } from '@pdfrx/engine';
import type { PagePlacementOperation } from '@pdfrx/viewer-core';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { PageCollaborationClient, relaySourceUrl, uploadRelaySource } from './client.js';
import { applyPagePlacementsToViewer, PageSourceRegistry } from './page-adapter.js';
import { encodeCollaborativePdf } from './export-composer.js';
import type { PageSessionSnapshot } from './protocol.js';
import type { CommittedPageOperation } from './protocol.js';
import {
  describePageOperation,
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

export interface CollaborativePdfViewerProps {
  /** Stable participant identifier attached to page and annotation operations. */
  readonly actorId: string;
  /** WebSocket endpoint of the collaboration relay. */
  readonly relayUrl: string;
  /** Shared session identifier. */
  readonly sessionId: string;
  /** Accessible participant label shown in the built-in chrome. */
  readonly name?: string;
  /** Initial PDF used for the session's `main` source. */
  readonly src: string | URL | ArrayBuffer | Uint8Array | Blob;
  /** Directory containing the PDFium worker assets. */
  readonly wasmModulesUrl?: string;
  readonly className?: string;
}

export function CollaborativePdfViewer({
  name,
  actorId,
  relayUrl,
  sessionId,
  src,
  wasmModulesUrl = '/pdfium/',
  className,
}: CollaborativePdfViewerProps): ReactNode {
  const displayName = name ?? actorId;
  return (
    <section className={`collab-pane ${className ?? ''}`.trim()} data-testid={`pane-${actorId}`}>
      <PdfrxProvider
        src={src}
        wasmModulesUrl={wasmModulesUrl}
        editing={{ pages: true, annotations: true, history: true, actorId }}
      >
        <CollaborativeViewerContent
          name={displayName}
          actorId={actorId}
          relayUrl={relayUrl}
          sessionId={sessionId}
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
}: {
  name: string;
  actorId: string;
  relayUrl: string;
  sessionId: string;
}): ReactNode {
  const viewer = usePdfrxViewer();
  const documentState = usePdfDocument();
  const [snapshot, setSnapshot] = useState<PageSessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [activity, setActivity] = useState<readonly CommittedPageOperation[]>([]);
  const [annotationRevision, setAnnotationRevision] = useState(0);
  const [annotating, setAnnotating] = useState(true);
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
      const response = await fetch(relaySourceUrl(relayUrl, sessionId, documentId));
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
  }, [relayUrl, sessionId, viewer]);

  useEffect(() => {
    const document = viewer?.document;
    if (!document || documentState.isLoading) return;
    const client = new PageCollaborationClient(actorId);
    clientRef.current = client;
    const sources = new PageSourceRegistry();
    sources.register('main', document);
    sourcesRef.current = sources;
    let active = true;
    const formValues = new Map<string, PdfFormFieldValue>();
    const formObservers = new Map<string, () => void>();
    const applyingRemoteForms = new WeakSet<PdfDocument>();
    const formKey = (documentId: string, fieldName: string): string => `${documentId}\u0000${fieldName}`;
    const readSourceForms = async (documentId: string, sourceDocument: PdfDocument, publish: boolean): Promise<void> => {
      const fields = await sourceDocument.loadFormFields();
      for (const field of fields) {
        if (!field.name) continue;
        const key = formKey(documentId, field.name);
        const value = formFieldValue(field);
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
    const unsubscribe = client.subscribe((next, committed) => {
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
        if (committed) setActivity((items) => [committed, ...items].slice(0, 4));
        setError(null);
      }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    });
    let applyingAnnotations = Promise.resolve();
    const unsubscribeAnnotations = client.subscribeAnnotations((annotationSnapshot, committed) => {
      applyingAnnotations = applyingAnnotations.then(async () => {
        if (!active) return;
        setAnnotationRevision(annotationSnapshot.revision);
        if (committed?.actorId === actorId) return;
        const records = committed
          ? [committed.change]
          : annotationSnapshot.annotations.map((item) => ({ ...item, type: 'add' as const }));
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
    let applyingForms = Promise.resolve();
    const unsubscribeForms = client.subscribeForms((formSnapshot, committed) => {
      applyingForms = applyingForms.then(async () => {
        if (!active || committed?.actorId === actorId) return;
        const records = committed ? [committed.change] : formSnapshot.fields;
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
    void client.connect(relayUrl, sessionId).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      active = false;
      unsubscribe();
      unsubscribeAnnotations();
      unsubscribeForms();
      unsubscribeLocalAnnotations();
      for (const unsubscribeFormObserver of formObservers.values()) unsubscribeFormObserver();
      observeSourceFormsRef.current = () => {};
      if (clientRef.current === client) clientRef.current = null;
      client.close();
      sources.unregister('main');
      if (sourcesRef.current === sources) sourcesRef.current = null;
      for (const sourceDocument of sourceDocumentsRef.current.splice(0)) void sourceDocument.dispose();
      sourceOpensRef.current.clear();
    };
  }, [actorId, documentState.isLoading, ensureSource, viewer, viewer?.document]);

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
        await uploadRelaySource(relayUrl, sessionId, documentId, bytes);
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
      await uploadRelaySource(relayUrl, sessionId, documentId, bytes);
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
      <div className="collab-pane-header">
        <strong>{name}</strong>
        <span className={snapshot ? 'collab-status connected' : 'collab-status'}>
          {snapshot ? `connected · pages ${snapshot.revision} · notes ${annotationRevision}` : 'connecting…'}
        </span>
      </div>
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
            tools={['ink', 'rectangle', 'ellipse', 'line', 'arrow', 'freeText', 'note']}
            onClose={() => setAnnotating(false)}
          />
        </div>
      )}
      {error && <div className="collab-error" role="alert">{error}</div>}
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
      <div className="collab-activity" aria-label={`${name}: 操作履歴`}>
        {activity.length === 0
          ? <span>確定操作はまだありません</span>
          : activity.map((item) => (
              <span key={item.operationId}>rev {item.revision} · {item.actorId}: {describePageOperation(item.operation)}</span>
            ))}
      </div>
    </>
  );
}
