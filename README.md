<p align="center">
  <img src="resource/app-icon.png" width="160" alt="Tmux Companion icon" />
</p>

<h1 align="center">Tmux Companion</h1>

<p align="center">
  <img src="https://img.shields.io/github/package-json/v/beecode-rs/tmux-companion?label=version" alt="Version badge" />
  <img src="https://img.shields.io/badge/status-proof%20of%20concept-orange" alt="Proof of concept badge" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue" alt="Platform badge" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License badge" />
</p>

<p align="center">
  Made by
  <a href="https://beecode.rs"><img src="resource/brand/beecode-logo.png" width="20" alt="Beecode logo" /></a>
  <a href="https://beecode.rs"><strong>Beecode</strong></a>
</p>

A small Electron + TypeScript desktop app for managing tmux sessions across the local machine and SSH machines. It does five things:

- **Instances & suffixed sessions** — each instance is one connection to one machine and owns tmux sessions named `<base>-<sessionId>`, auto-numbered `s01`, `s02`, …, listed in a sidebar where you can create, rename, kill, and switch them.
- **Embedded terminal** — an xterm.js terminal backed by node-pty that runs your real shell inside your real tmux. Your `~/.tmux.conf` and shell rc are never touched, and ptys keep running while you switch views.
- **External terminal picker** — launch any session in Ghostty, Terminal.app, iTerm2, or whatever your OS has installed, with user-editable launch templates.
- **SSH instances** — remote machines go through the system `ssh` binary with your keys and `~/.ssh/config` aliases. The app never handles passwords.
- **Works hand-in-hand with Relay** — the same suffixed session naming as [Relay](https://github.com/beecode-rs/relay), the mobile SSH app, so phone and desktop continue the same tmux sessions on the same machine.

## Screenshots

|                                                                                                  Terminal view                                                                                                   |                                                                                     Session menu                                                                                      |                                                                                             Instance menu                                                                                              |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
| <a href="resource/screenshots/terminal-view.png"><img src="resource/screenshots/terminal-view.png" width="320" alt="Embedded terminal running a tmux session, with instances and sessions in the sidebar" /></a> | <a href="resource/screenshots/tmux-session-menu.png"><img src="resource/screenshots/tmux-session-menu.png" width="320" alt="Session context menu with rename, clone, and kill" /></a> | <a href="resource/screenshots/instance-menu.png"><img src="resource/screenshots/instance-menu.png" width="320" alt="Instance context menu with connect, new session, refresh, edit, and remove" /></a> |

|                                                                                                 New remote instance                                                                                                  |                                                                                                Open in external terminal                                                                                                 |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
| <a href="resource/screenshots/add-new-ssh-instance.png"><img src="resource/screenshots/add-new-ssh-instance.png" width="320" alt="New remote instance dialog with label, host, user, port, and identity file" /></a> | <a href="resource/screenshots/open-in-external-terminal.png"><img src="resource/screenshots/open-in-external-terminal.png" width="320" alt="The same tmux session opened in an external terminal next to the app" /></a> |

## Status: Proof of Concept

Tmux Companion is at **v0.1.0** and still a proof of concept. It was built through rapid AI-assisted iteration ("vibe coding") rather than carefully reviewed engineering, so expect rough edges, missing pieces, and breaking changes without notice. While it remains a POC the version stays on `0.x`; the move out of the POC phase coincides with the major version moving to `1`.

## Why this exists

I move between a desktop and a phone all day: long-form work happens in tmux on the desktop, then continues from the couch or on the go through Relay on my phone. The missing piece was a desktop sidekick that treats those sessions as first-class citizens — a sidebar of sessions per machine, an embedded terminal that is just my real tmux, and one-click launches into a proper OS terminal — without either app stomping on the other's sessions. Shared naming conventions make the two apps one continuous workspace.

## Works with Relay

Both apps tag "their" tmux sessions with a per-connection suffix: a full session name is `<base>-<sessionId>`, for example `s01-a3f9c2`. Each app lists only sessions whose name ends with its own `-<sessionId>`, and new sessions are auto-numbered `s01`, `s02`, … (the next free number, zero-padded).

That makes adoption trivial in both directions:

- Type an existing Relay Session ID when creating (or editing) an instance here, and its sessions appear immediately — nothing is renamed or copied.
- Type this app's Session ID into Relay's server profile, and the phone picks up the same sessions.

The Session ID stays editable on an instance at any time: changing it re-targets ownership, and sessions carrying the old suffix simply show up as untagged (adoptable) instead of being renamed.

## Download & install

Downloads live on the [GitHub Releases](https://github.com/beecode-rs/tmux-companion/releases) page.

### macOS

Apple Silicon & Intel, one universal build: download `Tmux-Companion-<version>-universal.dmg` and drag **Tmux Companion** to Applications. The app is unsigned, so macOS blocks the first launch — after one failed open attempt, go to **System Settings → Privacy & Security → Open Anyway**, or clear the quarantine flag from a Terminal:

```bash
xattr -cr '/Applications/Tmux Companion.app'
```

### Ubuntu — AppImage

Make it executable and run it (no install needed):

```bash
chmod +x Tmux-Companion-<version>.AppImage
./Tmux-Companion-<version>.AppImage
```

### Ubuntu — deb package

```bash
sudo apt install ./tmux-companion_<version>_amd64.deb
```

## Security

- The internal API binds to `127.0.0.1` on a random port with a random bearer token generated on every launch — nothing on your network can reach it.
- SSH uses the system `ssh` binary in batch mode with connection multiplexing. Keys, agents, and passwords stay between you and ssh; the app never sees or stores a password.
- Settings and instances live in `tmux-companion-settings.json` inside the app's own data folder. Nothing is telemetry'd anywhere.

## Development

Requires [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io). A local tmux is needed for the embedded terminal to attach to.

```bash
git clone https://github.com/beecode-rs/tmux-companion.git
cd tmux-companion
pnpm run init
pnpm dev
```

- [Scripts](resource/docs/scripts.md) — daily commands and the one-time `pnpm run init` note
- [Architecture](resource/docs/architecture.md) — Electron's three-process layout and the source tree

## Todo

- [ ] **Keep-awake option** — add an option per OS (macOS/Linux/Windows) to prevent the laptop from going into sleep mode when the lid is closed, so long-running tmux sessions stay alive.
  - ⚠️ Disclaimer: used at your own risk — with lid-close sleep disabled, the laptop keeps running while closed, so it may overheat or drain its battery because it will not sleep when the lid is closed.

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/beecode-rs/tmux-companion/issues). Keep the [status](#status-proof-of-concept) in mind — the codebase is still a POC, so structural cleanups and platform testing are the most useful contributions.

## License

[MIT](LICENSE)
