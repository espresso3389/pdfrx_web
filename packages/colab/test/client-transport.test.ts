import { describe, expect, it, vi } from 'vitest';
import {
  fetchRelaySource,
  uploadRelaySource,
  type CollaborationTransport,
} from '../src/client.js';

describe('collaboration transport hooks', () => {
  it('routes source downloads and uploads through host URL and fetch hooks', async () => {
    const request = vi.fn(async (_input: string | URL, init?: RequestInit) =>
      new Response(init?.method === 'PUT' ? null : new Uint8Array([1, 2, 3]), { status: init?.method === 'PUT' ? 201 : 200 }));
    const transport: CollaborationTransport = {
      resolveSourceUrl: (_relayUrl, sessionId, documentId) =>
        `https://api.example.test/private/${sessionId}/${documentId}`,
      fetch: request,
    };

    const downloaded = await fetchRelaySource('wss://relay.example.test/ws', 'session-a', 'document-b', transport);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(request).toHaveBeenNthCalledWith(1, 'https://api.example.test/private/session-a/document-b');

    const bytes = new Uint8Array([4, 5]).buffer;
    await uploadRelaySource('wss://relay.example.test/ws', 'session-a', 'document-b', bytes, transport);
    expect(request).toHaveBeenNthCalledWith(2, 'https://api.example.test/private/session-a/document-b', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: bytes,
    });
  });
});
