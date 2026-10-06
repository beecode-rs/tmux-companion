# Architecture

Electron's three-process layout:

- **shared** (`src/shared/`) — cross-process models and the pure session-naming utils that encode the Relay
  compatibility contract.
- **main** (`src/main/`) — settings repo (electron-store), an executor layer (local `execFile('tmux')` /
  `ssh … tmux` with shell-quoted args), services for tmux operations, instances, terminal detection/launch,
  ptys, control-mode event subscriptions, Ghostty theme import, tray and global hotkey — plus an Express+ws API
  on localhost that the renderer talks to.
- **renderer** (`src/renderer/`) — a React app shell: sidebar with instances and sessions, xterm.js terminal view
  over a WebSocket per instance, instance dialog, settings and about pages.

```
src/
  main/
    business/repo/        # electron-store persistence
    business/service/     # tmux, instance, terminal, pty, control-mode, theme, tray, hotkey services
    exec/                 # Executor interface + local/ssh implementations
    server/               # Express API + pty WebSocket
    util/                 # shell quoting, login PATH resolution
  preload/                # contextBridge: server port+token, selection/version IPC
  renderer/src/
    ui-component/         # app shell, terminal view, sidebar, dialogs, settings, about
  shared/                 # models, API DTOs, session-naming utils
```
