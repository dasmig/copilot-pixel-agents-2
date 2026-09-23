import type { ClientMessage, ServerMessage } from './types.js';

interface VsCodeApi {
  postMessage(message: ClientMessage): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

export interface HostTransport {
  readonly supportsCommands: boolean;
  post(message: ClientMessage): void;
  subscribe(listener: (message: ServerMessage) => void, onConnectionChange?: (state: ConnectionState) => void): void;
}

export type ConnectionState = 'connecting' | 'reconnecting' | 'disconnected' | 'connected';

export function createHostTransport(options: { disconnectTimeoutMs?: number } = {}): HostTransport {
  if (typeof window.acquireVsCodeApi === 'function') {
    const vscode = window.acquireVsCodeApi();
    return {
      supportsCommands: true,
      post: (message) => vscode.postMessage(message),
      subscribe: (listener) => {
        window.addEventListener('message', (event: MessageEvent<ServerMessage>) => listener(event.data));
      },
    };
  }

  return {
    supportsCommands: false,
    post: () => {},
    subscribe: (listener, onConnectionChange) => {
      const events = new EventSource(new URL('events', window.location.href));
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let state: ConnectionState = 'connecting';
      const report = (next: ConnectionState) => {
        state = next;
        onConnectionChange?.(next);
      };
      const awaitSnapshot = () => {
        if (timeout) return;
        timeout = setTimeout(() => {
          timeout = undefined;
          report('disconnected');
        }, options.disconnectTimeoutMs ?? 10_000);
      };
      report('connecting');
      awaitSnapshot();
      events.onopen = () => {
        report('reconnecting');
        awaitSnapshot();
      };
      events.onerror = () => {
        if (state === 'connected') report('reconnecting');
        awaitSnapshot();
      };
      events.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage;
          listener(message);
          if (message.type === 'existingAgents') {
            clearTimeout(timeout);
            timeout = undefined;
            report('connected');
          }
        } catch {
          console.warn('[Copilot Pixel Agents] Ignored an invalid browser event.');
        }
      };
    },
  };
}