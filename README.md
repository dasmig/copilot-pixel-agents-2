# Copilot Pixel Agents

**Version 0.8.0** - an isometric pixel office with a task inspector and a read-only live browser view. Supports **GitHub Copilot Agent Mode** and **Claude Code**.

[Releases for this fork](https://github.com/dasmig/copilot-pixel-agents-2/releases) | [Changelog](CHANGELOG.md) | [Upstream Marketplace listing](https://marketplace.visualstudio.com/items?itemName=cl-oliveira.copilot-pixel-agents)

The Marketplace listing belongs to the upstream publisher and may not contain this fork's latest features. Install this fork's VSIX from its GitHub release to get the browser view and reliability updates.

![Copilot Pixel Agents 0.6.0: an isometric office with seated agents and the task inspector open on Output](.github/preview-v0.6.0.png)

> Historical screenshot from **0.6.0**, using sample agents and tasks. The office layout, seating, and inspector are shown; newer connection and asset warnings are not pictured.

## What's New in 0.8.0

- Open a token-scoped, read-only live office in your browser with **Show Pixel Office in Browser**. Keep VS Code running; the browser reconnects to its extension host and reports when the scene may be stale.
- Agents choose collision-aware routes around furniture and replan when the room changes. Leisure seats have capacity-aware reservations.
- Tool, waiting, and leisure state transitions no longer leave characters running in place, heading for an obsolete destination, or showing a stale speech bubble.
- Long pauses in a hidden tab expire bubbles and leisure activities without teleporting agents. Missing character sprites are reported while the office retains procedural fallbacks.

If upgrading, run **Install Copilot Hooks** again; existing hook scripts are not silently replaced. **Capture Task Details** is optional, off by default, and only retains details of future tasks after you enable it.

---

## How It Works

```
Agent (Copilot / Claude Code)
    │ PreToolUse / PostToolUse / Stop hooks
        ▼
 Hook script ──POST──▶ Local server (127.0.0.1)
                                │
           ┌──────────┴──────────┐
           │                     │
           ▼                     ▼
         postMessage                SSE
    VS Code panel       Local browser
           │                     │
           └──────────┬──────────┘
            ▼
         Isometric 2.5D canvas
```

Each session identified by the hooks becomes a character. The first tool call can create a character even without a session-start event. Tool names determine reading, writing, execution, and search animations.

The server listens only on `127.0.0.1`, starting at port `7823`. If that port is busy, it tries subsequent ports and records the active one for the hooks. The same office is available in a VS Code panel and a read-only local browser view. Selecting a character does not start, stop, or control the real AI agent. Keep the owning VS Code window open for browser updates; separate windows do not yet share a single live agent store.

---

## Quick Start (Fork VSIX)

### Requirements

- VS Code desktop: the manifest supports **1.70.0 or later**, but Copilot hook integration requires a version that supports the hooks in use. Prefer a current release.
- GitHub Copilot with Agent Mode enabled, or a separately installed and configured Claude Code.
- **macOS/Linux:** `sh` and `python3` on the hook process's PATH. Current scripts use the Python standard library for JSON and HTTP; older scripts may require `curl`.
- **Windows:** `powershell` on the PATH. The generated script uses PowerShell JSON commands and .NET HTTP with a timeout and no proxy or redirect forwarding.

**Compatibility**

| Component | Supported | Notes |
|---|---|---|
| VS Code Desktop | `^1.70.0` (declared in `package.json`) | Prefer a current version; Copilot's hook integration evolves with VS Code. |
| GitHub Copilot | Agent Mode with `chat.hookFilesLocations` where supported | Hook configuration varies by version; see [Changelog](CHANGELOG.md). |
| Claude Code | Hooks through `~/.claude/settings.json` | Supported since 0.4.0. |
| Node.js (local builds only) | 20.x in CI; use a supported LTS release locally | Not required for installing the VSIX. |
| macOS/Linux hook runtime | `sh` and `python3` on the PATH | Script-to-HTTP-to-store tests run in CI when the runtime is available. |
| Windows hook runtime | `powershell` / `pwsh` on the PATH | The generated `.ps1` is tested with `pwsh` when available. |

You do not need to clone the repository or install Node.js to use the fork's VSIX.

1. Download the VSIX from the [fork's Releases page](https://github.com/dasmig/copilot-pixel-agents-2/releases) and choose **Extensions: Install from VSIX...** in VS Code.
2. On first activation, if hooks are not configured, select **Install Hooks (automatic)** in the installation prompt.
3. Start a new Copilot Agent Mode or Claude Code session. Reinstall hooks after upgrading the extension so the generated scripts match this version.

You can also run **Copilot Pixel Agents: Install Copilot Hooks** from the Command Palette, or use **Install / Reinstall Hooks** in an empty office.

The installer writes settings immediately and can update its scripts without duplicating owned hook registrations. If an existing session does not pick up the change, start a new one. Installation errors are reported per integration.

### Installed Hook Files

Paths below are relative to your home directory (`~` on macOS/Linux; `%USERPROFILE%` on Windows).

| Home-relative path | Purpose |
|---|---|
| `.copilot-pixel-agents/hook.sh` | Generated macOS/Linux hook script |
| `.copilot-pixel-agents/hook.cmd` and `hook.ps1` | Windows entry point and JSON-processing script |
| `.copilot/hooks/hooks.json` | Copilot hooks in the installer's default directory |
| `.copilot-pixel-agents/copilot-hooks/hooks.json` | Custom-location copy registered through `chat.hookFilesLocations` when supported |
| `.claude/settings.json` | Claude Code settings, merged with existing hooks |
| `.copilot-pixel-agents/port` | Active port, written by the server and read by hook scripts |
| `.copilot-pixel-agents/hook-debug.log` | Legacy diagnostic file; new scripts do not write to it or delete old logs |

The installer uses one hook definition file per directory and removes its older per-event files. It treats `chat.hookFilesLocations` as an object mapping paths to boolean values; versions without that setting can still use the default directory.

**Important:** legacy `.vscode/agent-hooks.json` is no longer an installer target. Use the extension command to install or update hooks. The scripts are generated by [src/hooksInstaller.ts](src/hooksInstaller.ts), not copied from the reference examples in [hooks/hook.sh](hooks/hook.sh) and [hooks/hook.cmd](hooks/hook.cmd).

---

## Using the Office

After installing hooks:

1. Open **Copilot Pixel Agents → Pixel Office** in the sidebar, run **Show Pixel Office**, or run **Show Pixel Office in Browser** from the Command Palette.
2. Start an agent session normally (Copilot Agent Mode or `claude` in a terminal).
3. Each session appears as a character in the office.

### Isometric Office

The **2.5D** office has diamond floor tiles, walls, furniture, shadows, and depth ordering while preserving upright pixel-art characters.

- **Drag** to pan around the room. Use **+ / -** to zoom between **50% and 300%**; these controls are buttons, not keyboard shortcuts.
- **Reset view** returns to **100%** of the automatic fit and clears panning.
- Select a character on the canvas or in the bottom strip to inspect its activity.
- The room grows with additional agents; resizing the panel does not interrupt their work.

### Agents, Inspector, and History

- Characters cycle through **six palettes** and display their name, activity indicator, and a bubble for the current tool or leisure activity.
- Select a character to open the inspector. Close it with **X** or by clicking an empty part of the room.
- The inspector shows activity, elapsed session time, input/output tokens, active tools, and task history with durations and relative times.
- History keeps **up to 50 entries per agent**; the **Tools** count reflects retained entries, not an unlimited session total.
- Hit testing uses the camera projection, so dragging the room does not open the inspector accidentally.

### Inspecting a Task

1. Run **Install Copilot Hooks** after installing or upgrading to update event transport.
2. Enable **Copilot Pixel Agents: Capture Task Details** (`copilotPixelAgents.captureTaskDetails`) in Settings. **Enable in Settings** in the history view opens the setting but does not enable it for you.
3. Start a **new task**, select its character, and choose the task in **History**.
4. Inspect its tabs:

| Tab | Contents |
|---|---|
| **Input** | Provider arguments, such as a path, command, or edit contents |
| **Output** | Result supplied by a completion hook, when available |
| **Error** | Hook error; an absent error payload does not prove success |
| **Event** | Normalized invocation/tool IDs, timestamps, status, and origin |

Use **History** to return to the list and **Close** to dismiss it. History rows are keyboard-accessible buttons; in tabs, use Left/Right or Home/End. JSON is formatted when possible. Text and code are displayed literally, **never executed as HTML or Markdown**.

The selected task remains open as other events arrive. Output appears after completion if the provider sends it. Failure and interruption are distinct; `Stop` marks pending tasks **Interrupted**. Events lacking a reliable ID or matching start are **Unmatched**, rather than being arbitrarily paired by tool name. A task without a start event has no reliable runtime duration.

**This is not the VS Code chat debugger.** The extension does not read transcripts, system prompts, model reasoning, or chat debug files. Only allowlisted fields received through hooks are shown; some providers omit arguments or results. Past events cannot be reconstructed. The tabs report missing data or disabled capture instead of inventing it.

#### Retention and Privacy

- Capture is **off by default**. Updated scripts forward allowlisted fields to the loopback server, which discards content when capture is disabled.
- Up to **50 entries per agent**, including pending tasks, are retained. Older entries are evicted; evicted pending tasks are marked interrupted. Invocation identity is separate from `tool_id`, allowing IDs to be reused after completion.
- Each retained field is limited to **16,000 characters**, **8 levels** of nesting, and **2,000 nodes**. Limited content is marked truncated; hook scripts may omit fields larger than the **60,000-byte per-field** transport limit.
- HTTP requests larger than **256 KiB** receive **413**; invalid JSON or metadata receives **400**. Scripts can omit oversized details while preserving valid metadata and return the `allow` decision even if delivery fails.
- Sensitive keys and common credential patterns are redacted; environment fields, prompts, and transcripts are excluded from retention. Redaction is **best-effort**, not a guarantee. Arguments and results may contain source code or private data.
- New captures are kept in memory, not written to disk. Disabling capture **clears retained details**, including live tasks and the open view; reenabling it does not restore them. Older local diagnostic logs are not removed automatically.

### Breaks and Pet

- Idle agents may wander, drink coffee, play games, or watch TV. At the coffee station, an agent picks up a cup and periodically lifts it for a sip; reduced-motion settings keep the cup still. These are UI animations, not actions performed by the real agent.
- After a randomized timer based on 10 seconds, an idle agent has a 45% chance to select an available leisure spot. A break lasts **15-35 seconds** at the destination and expires on elapsed time even after a hidden-tab pause.
- Each current leisure spot holds one agent at a time. Walkers plan around furniture and yield contested destinations; a room change invalidates old routes. New props and editable layouts require their own reachability validation.
- File lookups such as `file_search`, `grep_search`, and `list_dir` send an agent to the bookshelf to scan rows and retrieve a folder. Only one agent can use it at a time; others search at their desks. Web search and non-search tools stay at the desk. A search that finishes early cancels the walk; the real tool never waits for the animation. This uses tool names, even with task-detail capture disabled.
- Read/view tools display an open document in the agent's hands, with occasional page turns. After a shelf search, a read started while the agent is still at the shelf can continue there; otherwise reading happens at the desk. Reduced-motion settings keep the document still. The office never draws document contents.
- Writing and editing tools animate alternating typing hands, brief mouse reaches, keyboard highlights, and one of three abstract monitor layouts. Agents do not animate in lockstep; reduced-motion settings keep the monitor and mouse pose steady. The screen never shows tool inputs or source text.
- When other tools start, a seated character rises, heads to its desk, and sits again; the real tool can finish before the animation does.
- The animated pet wanders, naps, grooms, and sometimes follows a nearby agent to an open spot. It routes around furniture when following and settles back to rest if the agent leaves or the route closes.

### Tokens and Persistence

The UI accepts `token_usage` events with input and output counts. When supplied, the inspector shows those counts and a bar under the name shows their sum, visually capped at **200,000 tokens** and turning red above 80% of that reference.

**Normal tool calls do not automatically provide token counts.** Scripts may forward a `token_usage` event when the provider supplies one, but the installer does not register a token-collection hook. Otherwise counts remain zero. The fixed 200,000-token reference is not a model context limit or cost estimate.

Agent state lives in the extension host's memory, not in a persistent database. Hiding the panel retains its state; recreating the webview restores up to 50 tasks, active tools, token counts, and session start while the host remains active. Ending a session removes its character and history; restarting VS Code discards in-memory state.

---

## Supported Events

### Hooks Installed Automatically

- **Copilot:** `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, and `UserPromptSubmit`, each registered with `type: command`.
- **Claude Code:** those events plus `PostToolUseFailure` and `SessionEnd`. The additional events are not in the [current VS Code hooks documentation](https://code.visualstudio.com/docs/copilot/customization/hooks), so they are not registered for Copilot.
- Reinstallation updates only commands owned by this extension; unrelated hooks and valid settings remain untouched. Invalid configurations are reported rather than silently replaced.

Generated scripts accept camelCase and snake_case fields, such as `sessionId`/`session_id`, `toolName`/`tool_name`, and `hookEventName`/`hook_event_name`. They normalize event names and return `{"permissionDecision":"allow"}` to stdout for the Copilot hooks protocol.

### Events Accepted by the Server

Not every accepted event is installed or sent by default.

| Internal event | Effect |
|---|---|
| `session_start` | Character enters the office |
| `pre_tool_use` (read/view) | Reading |
| `pre_tool_use` (write/edit) | Typing |
| `pre_tool_use` (bash/exec) | Executing |
| `pre_tool_use` (search/grep) | Searching |
| `post_tool_use` | Finishes a tool; becomes idle when no other tools remain active |
| `waiting` | Waiting for input |
| `stop` | Marks the session idle; does not remove its character |
| `session_end` | Character leaves the office |
| `token_usage` | Updates token counts of an existing agent |

The normalizer also recognizes `SubagentStart`, `SubagentStop`, and variants such as `preToolUse`, `agentStop`, and `userPromptSubmitted`. Subagent hooks are not installed automatically: **accepting an event does not install its hook**. Support and payload availability depend on the provider version.

Recognized content fields include `tool_input`/`toolInput`/`toolArgs`, `tool_response`/`toolResponse`/`tool_result`/`toolResult`, and `error`/`tool_error`/`toolError`. Failure events, `success: false`, and response error flags remain available even when capture is off.

Custom integrations can POST JSON to the active local port with `event`, `session_id`, and the applicable fields in [src/types.ts](src/types.ts). Use the same `tool_id` to pair tool start and finish. GET routes are available only under the random browser-view path; the server root is reserved for hooks.

---

## Commands

Available from the Command Palette under **Copilot Pixel Agents**:

| Command | Action |
|---|---|
| **Show Pixel Office** | Open or focus the office view |
| **Show Pixel Office in Browser** | Open the local read-only browser view |
| **Install Copilot Hooks** | Install or update scripts and configure Copilot and Claude Code |
| **Show Hooks Configuration** | Show the hook configuration paths |

Use the [installed hook files](#installed-hook-files) table for the actual destinations of generated scripts; reference scripts in the repository are not the installed versions.

## Settings

Open VS Code Settings and search for `copilotPixelAgents`:

| Key | Default | Description |
|---|---|---|
| `copilotPixelAgents.port` | `7823` | Hook server port |
| `copilotPixelAgents.autoShowPanel` | `false` | Open the panel automatically at startup |
| `copilotPixelAgents.captureTaskDetails` | `false` | Keep tool inputs, outputs, and errors in memory; turning it off purges captured details |

Port and automatic opening are read at extension activation; reload the window after changing them. **Capture Task Details applies immediately**. The VS Code panel's status bar shows the actual port. Hook scripts discover the active port from the server's port file, so changing the port alone does not require reinstalling them.

## Troubleshooting

### No Agents Appear

1. Open **View → Output** and select **Copilot Pixel Agents**. Look for the server startup message and event metadata.
2. Run **Install Copilot Hooks** again and check for integration-specific warnings.
3. Check that `python3` is on the hook process's PATH on macOS/Linux (older scripts may also require `curl`), or that PowerShell is available on Windows.
4. Start a new agent session and ask it to use a tool; opening chat alone might not trigger an event.
5. Check the active port in the panel and the metadata-only Output channel. Old log files do not prove that the new scripts are receiving events.

### Port Busy or Multiple VS Code Windows

The server tries the next available port. The per-user port file is shared between windows: the last window to write it receives subsequent hook events. There is no cross-window, workspace-aware live-office broker yet.

### Character Remains After the Agent Stops

`Stop` means idle, not removed. Removal requires `session_end`; the installer registers `SessionEnd` for Claude Code. Copilot does not document that event, so a character may remain idle until the extension reloads.

### Diagnostics and Privacy

New scripts do not write stdin, environment variables, or tool payloads to disk. The Output channel logs fixed event metadata and size or rejection status, not task contents. Legacy logs may contain private data and are not deleted automatically. **Review anything you share, even after inspector redaction.** The server binds to loopback. Browser viewing uses a random path rotated on activation and does not enable CORS; hook POST remains unauthenticated. Do not expose the port to the network or share the browser URL.

---

## Local Development

```bash
git clone https://github.com/dasmig/copilot-pixel-agents-2.git
cd copilot-pixel-agents-2
npm ci
npm --prefix webview-ui ci
```

Use a current Node.js LTS compatible with Vite 6 (CI uses Node.js 20). Open the cloned folder in VS Code and select **Run Extension**; **F5** runs the build task and opens an Extension Development Host.

### Build and Validation

Run commands from the repository root:

| Command | Purpose |
|---|---|
| `npm test` | Run extension-host and webview tests |
| `npm run typecheck` | Typecheck both projects |
| `npm run vscode:prepublish` | Build the webview and extension |
| `npm run build:webview` | Build the Vite webview |
| `npm run build` | Build only the extension with esbuild |
| `npm run test:package` | Check all registered sprites in `dist/webview/assets` after building |
| `npm run package` | Build and produce a VSIX |
| `npm run dev` | Watch the extension bundle (not the webview) |

Tests cover office projection, controls, poses, inspector safety and history, hooks and HTTP validation, SSE snapshots and reconnects, collision-aware routing, reservations, deadlines, and asset fallbacks. They bundle production TypeScript in memory using esbuild; install dependencies for both projects.

Real hook-script execution tests are optional locally. Set `PIXEL_TEST_PYTHON` or `PIXEL_TEST_PWSH` to the installed runtime path before `npm test`; unavailable runtimes cause only those cases to skip. They use a temporary home directory and test HTTP server, not your installed hooks. When GitHub Actions is enabled for this fork, CI detects available `python3`/`pwsh` runtimes automatically.

The webview chooses `acquireVsCodeApi` in the panel or Server-Sent Events in the browser. Browser updates require the extension host to remain running; reopening a connection starts with an authoritative snapshot.

### Packaging and Releases

- `npm run package` builds and packages the version declared in [package.json](package.json); run `npm run test:package` after building to check registered sprite assets.
- The VSIX includes compiled extension and webview code, assets, icons, hooks, license, and README. Development source, tests, dependencies, source maps, and the unpublished office evolution plan are excluded by [.vscodeignore](.vscodeignore).
- Install this fork's artifact with **Extensions: Install from VSIX...**. Do not confuse it with the upstream Marketplace listing, which has a different publisher and release schedule.
- To publish a fork GitHub Release, keep root and webview manifests and lockfiles at the same version, update [CHANGELOG.md](CHANGELOG.md), pass typecheck/tests/build/packaging, and tag the merged commit `v0.8.0`. The [release workflow](.github/workflows/release.yml) creates a GitHub Release with a VSIX when Actions is enabled on the fork.
- Marketplace publishing additionally requires permission and credentials for the configured `cl-oliveira` publisher; this fork's GitHub Release does **not** publish to that Marketplace listing. Never put access tokens in files or commits.

Changing this README on GitHub does not change an already published VSIX; the packaged README is fixed at build time.

---

## Project Structure

```
copilot-pixel-agents/
├── src/                    # VS Code extension (TypeScript)
│   ├── extension.ts        # Entry point and hook setup prompt
│   ├── hooksServer.ts      # Loopback HTTP hook server
│   ├── agentStore.ts       # In-memory agent state
│   ├── agentMessages.ts    # Shared UI message mapping
│   ├── browserOffice.ts    # Token-scoped browser page and SSE stream
│   ├── viewProvider.ts     # WebviewViewProvider
│   ├── hooksInstaller.ts   # Generates Unix/Windows scripts and settings
│   ├── hookScripts.ts      # Allowlisted JSON transport
│   ├── hooksConfig.ts      # Hook registration and merging
│   ├── hookHttp.ts         # Bounded and validated HTTP intake
│   ├── hookPayload.ts      # Event normalization
│   ├── taskDetails.ts      # Content redaction and limits
│   └── types.ts
├── webview-ui/src/         # Pixel-art canvas (TypeScript + Vite)
│   ├── engine.ts           # Simulation, layout, and camera controls
│   ├── characterController.ts # Agent intent, pose, and bubble transitions
│   ├── gridPathfinder.ts   # Four-connected route search
│   ├── interactionRegistry.ts # Leisure capacity and reservations
│   ├── isometric.ts        # 2.5D projection and depth ordering
│   ├── seating.ts          # Seated poses and stand/sit transitions
│   ├── history.ts          # Per-invocation history synchronization
│   ├── taskInspector.ts    # Inspector and task payload tabs
│   ├── hostTransport.ts    # VS Code messages or browser SSE
│   ├── sprites.ts          # Asset registry and sprite loading
│   ├── main.ts             # UI bootstrap and message dispatch
│   └── style.css
├── hooks/
│   ├── hook.sh             # Unix reference, not the installed generator
│   └── hook.cmd            # Windows reference
└── media/icon.png
```

Tests include [backend](tests/backend.test.mjs), [rendering](webview-ui/tests/isometric.test.mjs), [seating](webview-ui/tests/seating.test.mjs), and [inspector](webview-ui/tests/taskInspector.test.mjs). Debugging uses [.vscode/launch.json](.vscode/launch.json) and the build task in [.vscode/tasks.json](.vscode/tasks.json).

---

## License

MIT. Pixel-art sprites are based on [Pixel Agents](https://github.com/pablodelucca/pixel-agents) by [@pablodelucca](https://github.com/pablodelucca).
