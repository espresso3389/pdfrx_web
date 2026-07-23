import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createRoot } from 'react-dom/client';
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
  const [mode, setMode] = useState<'join' | 'create'>(() => isInvitation ? 'join' : 'create');
  const [invitedSession, setInvitedSession] = useState<SessionInfo | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('pdfrx-display-name') ?? '');
  const [file, setFile] = useState<File | null>(null);
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
      if (mode === 'create') {
        if (!file) throw new Error('PDFファイルを選択してください');
        if (file.type && file.type !== 'application/pdf') throw new Error('PDFファイルを選択してください');
        source = await file.arrayBuffer();
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
            <p>PDFを共有して、ページ・フォーム・注釈を共同編集します。</p>
          </div>
        </div>
        {isInvitation ? (
          <div className="invited-session-heading">
            <span>招待されたセッション</span>
            <strong>{invitedSession?.name ?? 'セッション情報を取得しています…'}</strong>
          </div>
        ) : (
          <div className="mode-tabs" role="tablist">
            <button type="button" className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>
              セッションに参加
            </button>
            <button type="button" className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>
              新規作成
            </button>
          </div>
        )}
        <form onSubmit={(event) => void submit(event)}>
          {mode === 'create' && (
            <>
              <label>
                <span className="label-heading">
                  セッション名
                  <small>参加画面に公開されます</small>
                </span>
                <input value={sessionName} onChange={(event) => setSessionName(event.target.value)} maxLength={100} />
              </label>
              <label>
                PDFファイル
                <input type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              </label>
            </>
          )}
          <label>
            あなたの表示名
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} />
          </label>
          {mode === 'join' && !isInvitation && (
            <div className="gate-status neutral">
              セッションへの参加には、参加中のメンバーから共有された招待用リンクが必要です。
            </div>
          )}
          {mode === 'join' && isInvitation && admissionState === 'idle' && !error && (
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
          <button className="primary-button" disabled={pending || retrySeconds > 0 || (mode === 'join' && !isInvitation)}>
            {admissionState === 'waiting'
              ? '承認待ち…'
              : admissionState === 'rejected'
                ? retrySeconds > 0 ? `参加を再申請 (${retrySeconds}秒)` : '参加を再申請'
                : pending
                  ? '準備しています…'
                  : mode === 'join'
                    ? isInvitation ? '参加を申請' : '招待用リンクを開いてください'
                    : 'セッションを作成'}
          </button>
        </form>
      </section>
    </main>
  );
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
