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
  subscribe(listener: (message: ServerMessage) => void): void;
}

export function createHostTransport(): HostTransport {
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
    subscribe: (listener) => {
      const events = new EventSource(new URL('events', window.location.href));
      events.onmessage = (event) => {
        try {
          listener(JSON.parse(event.data) as ServerMessage);
        } catch {
          console.warn('[Copilot Pixel Agents] Ignored an invalid browser event.');
        }
      };
    },
  };
}