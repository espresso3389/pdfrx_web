import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PdfrxEngine } from '@pdfrx/engine';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { SessionStore } from '../server/store.js';

describe('persistent collaboration session store', () => {
  const directories: string[] = [];
  const engine = new PdfrxEngine();

  afterAll(() => engine.dispose());

  afterEach(async () => {
    for (const directory of directories.splice(0)) {
      const target = resolve(directory);
      if (!target.startsWith(resolve(tmpdir()))) throw new Error(`Refusing to remove non-temporary path: ${target}`);
      await rm(target, { recursive: true, force: true });
    }
  });

  it('persists snapshots, source bytes, and non-recoverable member tokens', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pdfrx-colab-'));
    directories.push(directory);
    const bytes = await createTestPdf(engine, 2);
    const store = new SessionStore(directory);
    await store.open();
    const created = await store.create('Persistent room', bytes, 2);
    const { session, memberToken } = created;

    expect(store.verifyMemberToken(session, memberToken)).toBe(true);
    expect(store.verifyMemberToken(session, 'incorrect-token-value')).toBe(false);
    expect(session.pageSnapshot.pages).toHaveLength(2);
    expect(await readFile(store.sourcePath(session.id, 'main'))).toEqual(Buffer.from(bytes));

    session.pageSnapshot = { ...session.pageSnapshot, revision: 3 };
    await store.persist(session);

    const reopened = new SessionStore(directory);
    await reopened.open();
    const restored = reopened.get(session.id);
    expect(restored?.pageSnapshot.revision).toBe(3);
    expect(restored?.memberTokenHashes.join('')).not.toContain(memberToken);
    expect(restored && reopened.verifyMemberToken(restored, memberToken)).toBe(true);
    const admittedToken = restored && await reopened.issueMemberToken(restored);
    expect(restored && admittedToken && reopened.verifyMemberToken(restored, admittedToken)).toBe(true);
  });

  it('persists a source password for authenticated participants without exposing it in page state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pdfrx-colab-'));
    directories.push(directory);
    const bytes = await createTestPdf(engine, 1);
    const store = new SessionStore(directory);
    await store.open();

    const { session } = await store.create('Protected source', bytes, 1, 'internal-secret');
    expect(session.sourcePasswords).toEqual({ main: 'internal-secret' });
    expect(JSON.stringify(session.pageSnapshot)).not.toContain('internal-secret');

    const reopened = new SessionStore(directory);
    await reopened.open();
    expect(reopened.get(session.id)?.sourcePasswords).toEqual({ main: 'internal-secret' });
  });

  it('accepts identical source retries and rejects conflicting bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pdfrx-colab-'));
    directories.push(directory);
    const bytes = await createTestPdf(engine, 1);
    const store = new SessionStore(directory);
    await store.open();
    const { session } = await store.create('Sources', bytes, 1);

    expect(await store.putSource(session.id, 'imported', bytes)).toBe('created');
    expect(await store.putSource(session.id, 'imported', bytes)).toBe('existing');
    await expect(store.putSource(session.id, 'imported', new Uint8Array([1, 2, 3]))).rejects.toThrow('source-conflict');
  });
});

async function createTestPdf(engine: PdfrxEngine, pageCount: number): Promise<Uint8Array> {
  const document = await engine.createFromImages(Array.from({ length: pageCount }, () => ({
    pixels: new Uint8Array([255, 255, 255, 255]),
    width: 1,
    height: 1,
  })));
  try {
    return await document.encodePdf();
  } finally {
    await document.dispose();
  }
}
