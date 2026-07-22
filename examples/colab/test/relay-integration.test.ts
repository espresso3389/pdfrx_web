import type { PagePlacement, PagePlacementOperation } from '@pdfrx/viewer-core';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PageCollaborationClient,
  relaySourceUrl,
  startPageRelayServer,
  uploadRelaySource,
  type CollaborationWebSocket,
  type PageSessionSnapshot,
  type RunningPageRelayServer,
} from '../src/index.js';

const page = (placementId: string, pageIndex: number): PagePlacement => ({
  placementId,
  source: { documentId: 'main', pageIndex },
  rotation: 0,
});

const initial: PageSessionSnapshot = { revision: 0, pages: [page('a', 0), page('b', 1)] };

const socketFactory = (url: string): CollaborationWebSocket => new WebSocket(url) as unknown as CollaborationWebSocket;

const waitForRevision = (client: PageCollaborationClient, revision: number): Promise<PageSessionSnapshot> => {
  if (client.snapshot?.revision === revision) return Promise.resolve(client.snapshot);
  return new Promise((resolve) => {
    const unsubscribe = client.subscribe((snapshot) => {
      if (snapshot.revision === revision) {
        unsubscribe();
        resolve(snapshot);
      }
    });
  });
};

const waitForAnnotationRevision = (client: PageCollaborationClient, revision: number): Promise<void> => {
  if (client.annotationSnapshot?.revision === revision) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = client.subscribeAnnotations((snapshot) => {
      if (snapshot.revision === revision) {
        unsubscribe();
        resolve();
      }
    });
  });
};

const waitForFormRevision = (client: PageCollaborationClient, revision: number): Promise<void> => {
  if (client.formSnapshot?.revision === revision) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = client.subscribeForms((snapshot) => {
      if (snapshot.revision === revision) {
        unsubscribe();
        resolve();
      }
    });
  });
};

describe('WebSocket page relay', () => {
  let server: RunningPageRelayServer | null = null;
  const clients: PageCollaborationClient[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    await server?.close();
    server = null;
  });

  it('broadcasts committed operations to two clients in revision order', async () => {
    server = await startPageRelayServer({ sessions: { shared: initial } });
    const idsA = ['a-1', 'a-2'];
    const idsB = ['b-1'];
    const alice = new PageCollaborationClient('alice', () => idsA.shift()!, socketFactory);
    const bob = new PageCollaborationClient('bob', () => idsB.shift()!, socketFactory);
    clients.push(alice, bob);

    await Promise.all([alice.connect(server.url, 'shared'), bob.connect(server.url, 'shared')]);
    expect(alice.snapshot).toEqual(initial);
    expect(bob.snapshot).toEqual(initial);

    const bobAtOne = waitForRevision(bob, 1);
    const first = await alice.submit({ type: 'page.rotate', placementId: 'b', rotation: 90 });
    expect(first.revision).toBe(1);
    expect((await bobAtOne).pages[1]!.rotation).toBe(90);

    const aliceAtTwo = waitForRevision(alice, 2);
    const second = await bob.submit({ type: 'page.move', placementId: 'b', after: null });
    expect(second.revision).toBe(2);
    expect((await aliceAtTwo).pages.map((item) => item.placementId)).toEqual(['b', 'a']);
    expect(alice.snapshot).toEqual(bob.snapshot);
    expect(server.relay.snapshot('shared')).toEqual(alice.snapshot);
  });

  it('queues local commands so each uses the newly committed base revision', async () => {
    server = await startPageRelayServer({ sessions: { shared: initial } });
    const ids = ['op-1', 'op-2'];
    const client = new PageCollaborationClient('alice', () => ids.shift()!, socketFactory);
    clients.push(client);
    await client.connect(server.url, 'shared');

    const operations: PagePlacementOperation[] = [
      { type: 'page.rotate', placementId: 'a', rotation: 90 },
      { type: 'page.rotate', placementId: 'b', rotation: 180 },
    ];
    const committed = await Promise.all(operations.map((operation) => client.submit(operation)));

    expect(committed.map((item) => [item.baseRevision, item.revision])).toEqual([[0, 1], [1, 2]]);
    expect(client.snapshot?.pages.map((item) => item.rotation)).toEqual([90, 180]);
  });

  it('stores session PDF sources under a stable document id', async () => {
    server = await startPageRelayServer({ sessions: { shared: initial } });
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    await uploadRelaySource(server.url, 'shared', 'attachment-1', bytes.buffer);

    const response = await fetch(relaySourceUrl(server.url, 'shared', 'attachment-1'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);

    await expect(uploadRelaySource(server.url, 'shared', 'attachment-1', new Uint8Array([1]).buffer))
      .rejects.toThrow('409');
  });

  it('broadcasts annotation changes in their own strict revision stream', async () => {
    server = await startPageRelayServer({ sessions: { shared: initial } });
    const alice = new PageCollaborationClient('alice', () => 'annotation-1', socketFactory);
    const bob = new PageCollaborationClient('bob', () => 'unused', socketFactory);
    clients.push(alice, bob);
    await Promise.all([alice.connect(server.url, 'shared'), bob.connect(server.url, 'shared')]);

    const bobAtOne = waitForAnnotationRevision(bob, 1);
    const committed = await alice.submitAnnotation({
      type: 'add',
      placementId: 'a',
      id: 'box-1',
      spec: { subtype: 'square', rect: { left: 10, bottom: 10, right: 40, top: 40 } },
    });
    await bobAtOne;
    expect(committed.revision).toBe(1);
    expect(bob.annotationSnapshot).toEqual(alice.annotationSnapshot);
    expect(bob.annotationSnapshot?.annotations[0]?.placementId).toBe('a');
  });

  it('broadcasts typed form values in their own strict revision stream', async () => {
    server = await startPageRelayServer({ sessions: { shared: initial } });
    const alice = new PageCollaborationClient('alice', () => 'form-1', socketFactory);
    const bob = new PageCollaborationClient('bob', () => 'unused', socketFactory);
    clients.push(alice, bob);
    await Promise.all([alice.connect(server.url, 'shared'), bob.connect(server.url, 'shared')]);

    const bobAtOne = waitForFormRevision(bob, 1);
    const committed = await alice.submitForm({
      documentId: 'main',
      fieldName: 'preferences',
      value: ['email', 'sms'],
    });
    await bobAtOne;
    expect(committed.revision).toBe(1);
    expect(bob.formSnapshot).toEqual(alice.formSnapshot);
    expect(bob.formSnapshot?.fields[0]?.value).toEqual(['email', 'sms']);
  });
});
