import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentStore } from './agentStore.js';
import { subscribeToAgentMessages } from './agentMessages.js';
import type { ClientMessage, ServerMessage } from './types.js';

export class PixelOfficeViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: AgentStore,
    private readonly serverPort: number,
  ) {
    this.unsubscribe = subscribeToAgentMessages(store, (message) => this.post(message));
  }

  dispose(): void {
    this.unsubscribe();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'assets'),
      ],
    };

    webviewView.webview.html = this.buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: ClientMessage) => {
      this.handleClientMessage(msg);
    });
  }

  private handleClientMessage(msg: ClientMessage): void {
    switch (msg.type) {
      case 'webviewReady':
        this.post({ type: 'captureSettings', enabled: this.store.captureTaskDetails });
        this.sendExistingAgents();
        this.post({ type: 'serverPort', port: this.serverPort });
        break;
      case 'installHooks':
        vscode.commands.executeCommand('copilotPixelAgents.installHooks');
        break;
      case 'openCaptureSettings':
        vscode.commands.executeCommand('workbench.action.openSettings', 'copilotPixelAgents.captureTaskDetails');
        break;
      case 'focusAgent':
        break;
      case 'closeAgent':
        break;
    }
  }

  private sendExistingAgents(): void {
    const agents = this.store.getSnapshots();
    this.post({ type: 'existingAgents', agents });
  }

  private post(msg: ServerMessage): void {
    this.view?.webview.postMessage(msg);
  }

  private buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'main.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'main.css'),
    );
    const nonce = getNonce();
    // Base URI for loading sprite assets from the extension's dist/webview/assets/ folder.
    // Webview JS cannot use relative paths — it needs these resolved vscode-resource:// URIs.
    const assetsBaseUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'assets'),
    ).toString();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'nonce-${nonce}';
    style-src ${webview.cspSource} 'unsafe-inline';
    img-src ${webview.cspSource} data:;
    font-src ${webview.cspSource};
  " />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Copilot Pixel Agents</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">window.ASSETS_BASE_URI = "${assetsBaseUri}";</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
