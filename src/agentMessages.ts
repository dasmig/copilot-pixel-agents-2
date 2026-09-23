import type { AgentStore } from './agentStore.js';
import type { ServerMessage, ToolHistoryEntry, ToolStatus } from './types.js';

export type AgentMessageListener = (message: ServerMessage) => void;

export function subscribeToAgentMessages(store: AgentStore, listener: AgentMessageListener): () => void {
  const onAgentCreated = (agent: { id: string; name: string }): void => {
    listener({ type: 'agentCreated', id: agent.id, name: agent.name });
  };
  const onAgentRemoved = (id: string): void => {
    listener({ type: 'agentRemoved', id });
  };
  const onAgentToolStart = (
    id: string,
    toolId: string,
    toolName: string,
    status: ToolStatus,
    entry: ToolHistoryEntry,
  ): void => {
    listener({ type: 'agentToolStart', id, toolId, toolName, status, entry });
  };
  const onAgentToolDone = (id: string, toolId: string, entry: ToolHistoryEntry): void => {
    listener({ type: 'agentToolDone', id, toolId, entry });
  };
  const onAgentHistory = (id: string, history: ToolHistoryEntry[]): void => {
    listener({ type: 'agentHistory', id, history });
  };
  const onCaptureSettings = (enabled: boolean): void => {
    listener({ type: 'captureSettings', enabled });
  };
  const onAgentStatus = (id: string, status: 'idle' | 'waiting' | 'active'): void => {
    listener({ type: 'agentStatus', id, status });
  };
  const onAgentTokenUsage = (id: string, inputTokens: number, outputTokens: number): void => {
    listener({ type: 'agentTokenUsage', id, inputTokens, outputTokens });
  };

  store.on('agentCreated', onAgentCreated);
  store.on('agentRemoved', onAgentRemoved);
  store.on('agentToolStart', onAgentToolStart);
  store.on('agentToolDone', onAgentToolDone);
  store.on('agentHistory', onAgentHistory);
  store.on('captureSettings', onCaptureSettings);
  store.on('agentStatus', onAgentStatus);
  store.on('agentTokenUsage', onAgentTokenUsage);

  return () => {
    store.off('agentCreated', onAgentCreated);
    store.off('agentRemoved', onAgentRemoved);
    store.off('agentToolStart', onAgentToolStart);
    store.off('agentToolDone', onAgentToolDone);
    store.off('agentHistory', onAgentHistory);
    store.off('captureSettings', onCaptureSettings);
    store.off('agentStatus', onAgentStatus);
    store.off('agentTokenUsage', onAgentTokenUsage);
  };
}