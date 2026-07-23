import { describe, expect, it } from 'vitest';
import {
  PageCollaborationClient,
  type CollaborationConnectionState,
  type CollaborationWebSocket,
} from '../src/client.js';

class TestSocket implements CollaborationWebSocket {
  readonly readyState = 1;
  readonly sent: string[] = [];
  closed = false;
  readonly #listeners = new Map<string, Array<(event: Event | MessageEvent) => void>>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(type: 'open' | 'close' | 'error' | 'message', listener: (event: Event | MessageEvent) => void): void {
    const listeners = this.#listeners.get(type) ?? [];
    listeners.push(listener);
    this.#listeners.set(type, listeners);
  }

  emit(type: 'open' | 'close' | 'error', event = new Event(type)): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }

  message(message: object): void {
    const event = new MessageEvent('message', { data: JSON.stringify(message) });
    for (const listener of this.#listeners.get('message') ?? []) listener(event);
  }
}

describe('collaboration resynchronization', () => {
  it('closes a stale socket so automatic reconnect can fetch fresh snapshots', async () => {
    const socket = new TestSocket();
    const client = new PageCollaborationClient('alice', undefined, () => socket);
    const states: CollaborationConnectionState[] = [];
    client.subscribeConnectionState((state) => states.push(state));

    const connected = client.connect('ws://relay.test', 'session-a', { memberToken: 'token', reconnect: true });
    socket.emit('open');
    socket.message({ type: 'session.snapshot', sessionId: 'session-a', snapshot: { revision: 0, pages: [] } });
    socket.message({ type: 'annotation.snapshot', sessionId: 'session-a', snapshot: { revision: 0, annotations: [] } });
    socket.message({ type: 'form.snapshot', sessionId: 'session-a', snapshot: { revision: 0, fields: [] } });
    await connected;

    socket.message({
      type: 'operation.rejected',
      sessionId: 'session-a',
      code: 'page-revision-mismatch',
      message: 'stale revision',
      currentRevision: 1,
    });

    expect(socket.closed).toBe(true);
    expect(states).toEqual(['disconnected', 'connecting', 'connected']);
  });
});
