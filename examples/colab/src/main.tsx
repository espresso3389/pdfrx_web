import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { createRoot } from 'react-dom/client';
import { PDFDocument } from 'pdf-lib';
import {
  CollaborativePdfViewer,
  type CollaborationConnectionState,
  type CollaborationTransport,
} from '@pdfrx/colab';
import '@pdfrx/colab/styles.css';
import '@pdfrx/react/styles.css';
import './styles.css';

interface RuntimeConfig {
  readonly apiBase: string;
  readonly relayUrl: string;
  readonly wasmModulesUrl: string;
}

interface SessionInfo {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly pageCount: number;
}

interface CreatedSession extends SessionInfo {
  readonly memberToken: string;
}

interface ActiveSession {
  readonly info: SessionInfo;
  readonly memberToken: string;
  readonly actorId: string;
  readonly displayName: string;
  readonly source: ArrayBuffer;
}

const config: RuntimeConfig = {
  apiBase: new URL(import.meta.env.VITE_PDFRX_API_BASE ?? './api', location.href).toString().replace(/\/$/, ''),
  relayUrl: import.meta.env.VITE_PDFRX_RELAY_URL ??
    `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/relay`,
  wasmModulesUrl: new URL(import.meta.env.VITE_PDFRX_WASM_URL ?? './pdfium/', location.href).toString(),
};

function CollaborationApp() {
  const [active, setActive] = useState<ActiveSession | null>(null);
  if (active) {
    return <SessionViewer active={active} onLeave={() => {
      history.replaceState(null, '', location.pathname);
      setActive(null);
    }} />;
  }
  return <SessionGate onOpen={setActive} />;
}

function SessionGate({ onOpen }: { onOpen: (session: ActiveSession) => void }) {
  const invitedSessionId = useMemo(() => new URL(location.href).searchParams.get('session')?.trim() ?? '', []);
  const isInvitation = invitedSessionId.length > 0;
  const [invitedSession, setInvitedSession] = useState<SessionInfo | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('pdfrx-display-name') ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const [pending, setPending] = useState(false);
  const [admissionState, setAdmissionState] = useState<'idle' | 'waiting' | 'rejected'>('idle');
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));

  useEffect(() => {
    if (!isInvitation) return;
    let cancelled = false;
    void (async () => {
      try {
        const info = await responseJson<SessionInfo>(await fetch(
          `${config.apiBase}/sessions/${encodeURIComponent(invitedSessionId)}`,
        ));
        if (!cancelled) setInvitedSession(info);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invitedSessionId, isInvitation]);

  useEffect(() => {
    if (admissionState !== 'rejected' || retrySeconds === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [admissionState, retrySeconds]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (admissionState === 'rejected' && retrySeconds > 0) return;
    setPending(true);
    setError(null);
    try {
      if (!displayName.trim()) throw new Error('表示名を入力してください');
      localStorage.setItem('pdfrx-display-name', displayName.trim());
      let info: SessionInfo;
      let memberToken: string;
      let source: ArrayBuffer;
      if (!isInvitation) {
        if (!file) throw new Error('PDFまたは画像ファイルを選択してください');
        source = await fileAsPdf(file);
        const response = await fetch(`${config.apiBase}/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/pdf',
            'X-Pdfrx-Session-Name': encodeURIComponent(sessionName.trim()),
          },
          body: source,
        });
        const created = await responseJson<CreatedSession>(response);
        info = created;
        memberToken = created.memberToken;
      } else {
        if (!invitedSessionId) throw new Error('招待用リンクから開いてください');
        info = await responseJson<SessionInfo>(await fetch(
          `${config.apiBase}/sessions/${encodeURIComponent(invitedSessionId)}`,
        ));
        const tokenKey = `pdfrx-member-${info.id}`;
        memberToken = localStorage.getItem(tokenKey) ?? '';
        let response = memberToken ? await fetchSource(info.id, memberToken) : null;
        if (!response?.ok) {
          localStorage.removeItem(tokenKey);
          setAdmissionState('waiting');
          memberToken = await requestAdmission(config.relayUrl, info.id, getActorId(), displayName.trim());
          setAdmissionState('idle');
          response = await fetchSource(info.id, memberToken);
        }
        if (!response.ok) throw new Error(await responseError(response));
        source = await response.arrayBuffer();
      }
      localStorage.setItem(`pdfrx-member-${info.id}`, memberToken);
      onOpen({
        info,
        memberToken,
        displayName: displayName.trim(),
        actorId: getActorId(),
        source,
      });
    } catch (reason) {
      if (reason instanceof AdmissionRejectedError) {
        setAdmissionState('rejected');
        setNow(Date.now());
        setRetryAt(Date.now() + reason.retryAfterMs);
      } else {
        setAdmissionState('idle');
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="session-gate">
      <section className="session-card">
        <div className="brand">
          <span className="brand-mark">P</span>
          <div>
            <h1>PDF Collaboration</h1>
            <p>PDFや画像を共有して、ページ・フォーム・注釈を共同編集します。</p>
          </div>
        </div>
        {isInvitation ? (
          <div className="invited-session-heading">
            <span>招待されたセッション</span>
            <strong>{invitedSession?.name ?? 'セッション情報を取得しています…'}</strong>
          </div>
        ) : null}
        <form onSubmit={(event) => void submit(event)}>
          {!isInvitation && (
            <>
              <label>
                <span className="label-heading">
                  セッション名
                  <small>参加画面に公開されます</small>
                </span>
                <input value={sessionName} onChange={(event) => setSessionName(event.target.value)} maxLength={100} />
              </label>
              <div className="file-field">
                <span>PDFまたは画像ファイル</span>
                <label
                  className={`file-drop-zone${draggingFile ? ' dragging' : ''}`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setDraggingFile(true);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                    setDraggingFile(true);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFile(false);
                  }}
                  onDrop={(event: DragEvent<HTMLLabelElement>) => {
                    event.preventDefault();
                    setDraggingFile(false);
                    const dropped = event.dataTransfer.files[0];
                    if (dropped) setFile(dropped);
                  }}
                >
                  <input
                    type="file"
                    accept="application/pdf,.pdf,image/*"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                  <strong>{file?.name ?? 'ファイルを選択'}</strong>
                  <small>{file ? '別のファイルを選択、またはドロップ' : 'クリックして選択、またはここにドロップ'}</small>
                </label>
              </div>
            </>
          )}
          <label>
            あなたの表示名
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} />
          </label>
          {isInvitation && admissionState === 'idle' && !error && (
            <div className="gate-status neutral">
              初めて参加する端末は、現在参加中のメンバーによる承認が必要です。
            </div>
          )}
          {admissionState === 'waiting' && (
            <div className="gate-status waiting">参加中のメンバーによる承認を待っています…</div>
          )}
          {admissionState === 'rejected' && (
            <div className="gate-status rejected" role="alert">
              参加申請が拒否されました
              {retrySeconds > 0 && `。${retrySeconds}秒後に再申請できます`}
            </div>
          )}
          {error && <div className="gate-status rejected" role="alert">{error}</div>}
          <button className="primary-button" disabled={pending || retrySeconds > 0}>
            {admissionState === 'waiting'
              ? '承認待ち…'
              : admissionState === 'rejected'
                ? retrySeconds > 0 ? `参加を再申請 (${retrySeconds}秒)` : '参加を再申請'
                : pending
                  ? '準備しています…'
                  : isInvitation ? '参加を申請' : 'セッションを作成'}
          </button>
        </form>
      </section>
    </main>
  );
}

const IMAGE_EXTENSION = /\.(avif|bmp|gif|ico|jpe?g|png|webp)$/i;

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || (file.type === '' && IMAGE_EXTENSION.test(file.name));
}

async function fileAsPdf(file: File): Promise<ArrayBuffer> {
  if (isPdfFile(file)) return file.arrayBuffer();
  if (!isImageFile(file)) throw new Error('PDFまたは画像ファイルを選択してください');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('画像ファイルを読み込めませんでした');
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('画像をPDFに変換できませんでした');
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('画像をPDFに変換できませんでした')), 'image/png');
    });
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(await png.arrayBuffer());
    const page = pdf.addPage([bitmap.width, bitmap.height]);
    page.drawImage(image, { x: 0, y: 0, width: bitmap.width, height: bitmap.height });
    return (await pdf.save()).buffer as ArrayBuffer;
  } finally {
    bitmap.close();
  }
}

function SessionViewer({ active, onLeave }: { active: ActiveSession; onLeave: () => void }) {
  const [copied, setCopied] = useState(false);
  const [displayName, setDisplayName] = useState(active.displayName);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(active.displayName);
  const [connectionState, setConnectionState] = useState<CollaborationConnectionState>('connecting');
  const [hasConnected, setHasConnected] = useState(false);
  const [connectedCount, setConnectedCount] = useState(0);
  const [elapsed, setElapsed] = useState(() => formatElapsed(active.info.createdAt));
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const sessionUrl = useMemo(() => {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('session', active.info.id);
    return url.toString();
  }, [active.info.id]);
  const transport = useMemo<CollaborationTransport>(() => ({
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('X-Pdfrx-Member-Token', encodeURIComponent(active.memberToken));
      return fetch(input, { ...init, headers });
    },
    resolveSourceUrl: (_relayUrl, sessionId, documentId) =>
      `${config.apiBase}/sessions/${encodeURIComponent(sessionId)}/sources/${encodeURIComponent(documentId)}`,
  }), [active.memberToken]);

  useEffect(() => {
    history.replaceState(null, '', sessionUrl);
  }, [sessionUrl]);

  useEffect(() => {
    if (editingName) nameInputRef.current?.select();
  }, [editingName]);

  useEffect(() => {
    const update = (): void => setElapsed(formatElapsed(active.info.createdAt));
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [active.info.createdAt]);

  useEffect(() => {
    if (connectionState === 'connected') setHasConnected(true);
  }, [connectionState]);

  const copySessionUrl = async () => {
    await navigator.clipboard.writeText(sessionUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const saveDisplayName = (): void => {
    const nextName = nameDraft.trim();
    if (nextName) {
      setDisplayName(nextName);
      localStorage.setItem('pdfrx-display-name', nextName);
    } else {
      setNameDraft(displayName);
    }
    setEditingName(false);
  };

  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveDisplayName();
    } else if (event.key === 'Escape') {
      setNameDraft(displayName);
      setEditingName(false);
    }
  };

  return (
    <main className="collab-app">
      <header className="collab-header">
        <h1>{active.info.name}</h1>
        <div className="session-actions">
          <div className={`connection-summary ${connectionState}`} title={`接続状態: ${connectionState}`}>
            <span className="connection-dot" aria-hidden="true" />
            <span>{connectionState === 'connected' ? `${connectedCount}人接続中` : '接続中…'}</span>
            <span className="elapsed-time">開始から{elapsed}</span>
          </div>
          <button type="button" className="invite-link-button" onClick={() => void copySessionUrl()}>
            {copied ? 'コピーしました' : '招待用リンク'}
          </button>
          <div className="current-user">
            <span className="user-avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
            {editingName ? (
              <input
                ref={nameInputRef}
                aria-label="表示名"
                value={nameDraft}
                maxLength={80}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={saveDisplayName}
                onKeyDown={handleNameKeyDown}
              />
            ) : (
              <button type="button" className="user-name-button" onClick={() => setEditingName(true)}>
                {displayName}
              </button>
            )}
          </div>
          <button
            type="button"
            className="leave-button"
            onClick={() => {
              if (window.confirm('このセッションから退出しますか？')) onLeave();
            }}
          >
            退出
          </button>
        </div>
      </header>
      {hasConnected && connectionState !== 'connected' && (
        <div className="reconnecting-banner" role="status">
          <span className="reconnecting-spinner" aria-hidden="true" />
          <span>
            {connectionState === 'disconnected'
              ? '接続が一時的に切れました。再接続を試みています…'
              : 'リレーへ再接続しています…'}
          </span>
        </div>
      )}
      <CollaborativePdfViewer
        name={displayName}
        actorId={active.actorId}
        relayUrl={config.relayUrl}
        sessionId={active.info.id}
        memberToken={active.memberToken}
        onConnectionStateChange={setConnectionState}
        onPresenceChange={setConnectedCount}
        src={active.source}
        wasmModulesUrl={config.wasmModulesUrl}
        transport={transport}
      />
    </main>
  );
}

function formatElapsed(createdAt: string): string {
  const elapsedMs = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  if (totalMinutes < 1) return '1分未満';
  if (totalMinutes < 60) return `${totalMinutes}分`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}時間${totalMinutes % 60}分`;
  const days = Math.floor(totalHours / 24);
  return `${days}日${totalHours % 24}時間`;
}

const fetchSource = (sessionId: string, memberToken: string): Promise<Response> =>
  fetch(`${config.apiBase}/sessions/${encodeURIComponent(sessionId)}/sources/main`, {
    headers: { 'X-Pdfrx-Member-Token': encodeURIComponent(memberToken) },
  });

function requestAdmission(
  relayUrl: string,
  sessionId: string,
  actorId: string,
  displayName: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(relayUrl);
    let settled = false;
    socket.addEventListener('open', () => socket.send(JSON.stringify({
      type: 'session.join',
      sessionId,
      actorId,
      displayName,
    })));
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as {
          type?: string;
          memberToken?: string;
          message?: string;
          retryAfterMs?: number;
        };
        if (message.type === 'session.join.approved' && message.memberToken) {
          settled = true;
          socket.close();
          resolve(message.memberToken);
        } else if (message.type === 'session.join.rejected') {
          settled = true;
          socket.close();
          reject(new AdmissionRejectedError(message.retryAfterMs ?? 5_000));
        } else if (message.type === 'operation.rejected') {
          settled = true;
          socket.close();
          reject(new Error(message.message ?? '参加申請が拒否されました'));
        }
      } catch (error) {
        settled = true;
        socket.close();
        reject(error);
      }
    });
    socket.addEventListener('error', () => {
      if (!settled) reject(new Error('リレーへ接続できません'));
    });
    socket.addEventListener('close', () => {
      if (!settled) reject(new Error('承認待ちの接続が切断されました'));
    });
  });
}

class AdmissionRejectedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super('参加申請が拒否されました');
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<T>;
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    if (body.error === 'authentication-failed') return 'この端末の参加情報が無効です';
    if (body.error === 'session-not-found') return 'セッションが見つかりません';
    if (body.error === 'source-too-large') return 'PDFファイルが大きすぎます';
    return body.error ?? `サーバーエラー (${response.status})`;
  } catch {
    return `サーバーエラー (${response.status})`;
  }
}

function getActorId(): string {
  const existing = localStorage.getItem('pdfrx-actor-id');
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem('pdfrx-actor-id', id);
  return id;
}

createRoot(document.getElementById('root')!).render(<CollaborationApp />);
