import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AnnotationSessionSnapshot,
  FormSessionSnapshot,
  PageSessionSnapshot,
} from '@pdfrx/colab';

export interface StoredSession {
  readonly id: string;
  name: string;
  readonly createdAt: string;
  updatedAt: string;
  memberTokenHashes: string[];
  pageSnapshot: PageSessionSnapshot;
  annotationSnapshot: AnnotationSessionSnapshot;
  formSnapshot: FormSessionSnapshot;
}

const safeId = (value: string): boolean => /^[A-Za-z0-9_-]{1,80}$/.test(value);

export class SessionStore {
  readonly #sessions = new Map<string, StoredSession>();
  readonly #queues = new Map<string, Promise<void>>();

  constructor(readonly dataDirectory: string) {}

  async open(): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true });
    for (const entry of await readdir(this.dataDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !safeId(entry.name)) continue;
      try {
        const session = JSON.parse(
          await readFile(join(this.dataDirectory, entry.name, 'state.json'), 'utf8'),
        ) as StoredSession;
        if (session.id === entry.name) this.#sessions.set(session.id, session);
      } catch (error) {
        console.error(`Could not load session ${entry.name}`, error);
      }
    }
  }

  get(id: string): StoredSession | null {
    return this.#sessions.get(id) ?? null;
  }

  verifyMemberToken(session: StoredSession, token: string): boolean {
    const actual = Buffer.from(hashToken(token), 'hex');
    return (session.memberTokenHashes ?? []).some((value) => {
      const expected = Buffer.from(value, 'hex');
      return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
    });
  }

  async create(
    name: string,
    source: Uint8Array,
    pageCount: number,
  ): Promise<{ readonly session: StoredSession; readonly memberToken: string }> {
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error('PDFにページがありません');
    let id = randomUUID().replaceAll('-', '').slice(0, 16);
    while (this.#sessions.has(id)) id = randomUUID().replaceAll('-', '').slice(0, 16);
    const memberToken = randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    const session: StoredSession = {
      id,
      name: name.trim().slice(0, 100) || 'PDF collaboration session',
      createdAt: now,
      updatedAt: now,
      memberTokenHashes: [hashToken(memberToken)],
      pageSnapshot: {
        revision: 0,
        pages: Array.from({ length: pageCount }, (_, pageIndex) => ({
          placementId: randomUUID(),
          source: { documentId: 'main', pageIndex },
          rotation: 0,
        })),
      },
      annotationSnapshot: { revision: 0, annotations: [] },
      formSnapshot: { revision: 0, fields: [] },
    };
    await mkdir(this.#sourceDirectory(id), { recursive: true });
    await writeFile(this.sourcePath(id, 'main'), source, { flag: 'wx' });
    this.#sessions.set(id, session);
    try {
      await this.persist(session);
    } catch (error) {
      this.#sessions.delete(id);
      throw error;
    }
    return { session, memberToken };
  }

  async issueMemberToken(session: StoredSession): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    session.memberTokenHashes ??= [];
    session.memberTokenHashes.push(hashToken(token));
    await this.persist(session);
    return token;
  }

  async persist(session: StoredSession): Promise<void> {
    session.updatedAt = new Date().toISOString();
    const previous = this.#queues.get(session.id) ?? Promise.resolve();
    const next = previous.then(async () => {
      const directory = join(this.dataDirectory, session.id);
      await mkdir(directory, { recursive: true });
      const temporary = join(directory, `state.${randomUUID()}.tmp`);
      await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
      await rename(temporary, join(directory, 'state.json'));
    });
    this.#queues.set(session.id, next);
    try {
      await next;
    } finally {
      if (this.#queues.get(session.id) === next) this.#queues.delete(session.id);
    }
  }

  sourcePath(sessionId: string, documentId: string): string {
    if (!safeId(sessionId) || !safeId(documentId)) throw new Error('Invalid source id');
    return join(this.#sourceDirectory(sessionId), `${documentId}.pdf`);
  }

  async sourceExists(sessionId: string, documentId: string): Promise<boolean> {
    try {
      return (await stat(this.sourcePath(sessionId, documentId))).isFile();
    } catch {
      return false;
    }
  }

  async putSource(sessionId: string, documentId: string, bytes: Uint8Array): Promise<'created' | 'existing'> {
    const path = this.sourcePath(sessionId, documentId);
    await mkdir(this.#sourceDirectory(sessionId), { recursive: true });
    try {
      await writeFile(path, bytes, { flag: 'wx' });
      return 'created';
    } catch (error) {
      if (!await this.sourceExists(sessionId, documentId)) throw error;
      const existing = await readFile(path);
      const digest = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
      if (digest(existing) !== digest(bytes)) throw new Error('source-conflict');
      return 'existing';
    }
  }

  #sourceDirectory(sessionId: string): string {
    return join(this.dataDirectory, sessionId, 'sources');
  }
}

const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');
