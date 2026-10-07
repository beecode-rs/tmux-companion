# Features

The detail behind the README's feature list — how sessions are named and numbered, what cloning does, and what each part of the app does.

## Instances and sessions

<img src="../screenshots/tmux-session-menu.png" height="480" alt="Session context menu with rename, clone, and kill" />

<img src="../screenshots/instance-menu.png" height="480" alt="Instance context menu with connect, new session, refresh, edit, and remove" />

<img src="../screenshots/add-new-ssh-instance.png" height="480" alt="New remote instance dialog with label, host, user, port, and identity file" />

- An **instance** is one connection to one machine: the built-in **Local** instance for the machine the app runs on (it cannot be removed, and its label cannot be changed), plus one SSH instance per remote machine.
- Adding an SSH instance takes a label, host, user, port, and an optional identity file. Aliases and keys from your `~/.ssh/config` work as-is.
- Each instance lists every tmux session on that machine — including sessions created by other tools, such as [Relay](https://github.com/beecode-rs/relay). Nothing is filtered, renamed, copied, or hidden.
- From the sidebar you can create, clone, rename, kill, and switch sessions. The instance menu also connects, refreshes the session list, edits, and removes instances.

## Session naming and numbering

- New sessions are auto-numbered with the next free plain `sNN` name — `s01`, `s02`, … (one above the highest existing plain number, zero-padded to two digits).
- Only plain `sNN` names count when numbering. Relay tags the sessions it creates with a per-connection suffix — for example `s01-a3f9c2` — which never matches the plain pattern, so a new session never takes a number or a name that a suffixed session is already using.
- Relay-created sessions are listed like any other and are never renumbered or renamed by Tmux Companion.
- Manual session names are 1–40 characters of letters, numbers, `_`, and `-` (no `.` or `:`).
- Sessions created here are ordinary tmux sessions on that machine — no special format, no lock-in — so they are waiting for you whichever device you connect from.

## Cloning

- Cloning duplicates a session into a fresh one that starts in the same working directory as the source session.
- The clone's default name derives from the source name: trailing number + 1, keeping the prefix and width, then the first free number with that prefix (`s01` → `s02`).

## Embedded terminal

<img src="../screenshots/terminal-view.png" height="480" alt="Embedded terminal running a tmux session, with instances and sessions in the sidebar" />

- An xterm.js terminal in the renderer backed by node-pty in the main process: your real shell inside your real tmux.
- `~/.tmux.conf` and shell rc files are never read or modified.
- Ptys keep running while you switch views — nothing is killed on navigation.

## Ghostty theme import

- Optional (off by default): imports your Ghostty theme so the embedded terminal matches your standalone terminal.

## External terminal launches

<img src="../screenshots/open-in-external-terminal.png" height="480" alt="The same tmux session opened in an external terminal next to the app" />

- Any session can be opened in a full OS terminal. Detected terminals:
  - macOS: Terminal, Ghostty, iTerm2, kitty, Alacritty, WezTerm, Warp
  - Linux: Ghostty, GNOME Terminal, Ptyxis, kitty, Alacritty, WezTerm, Konsole, Tilix, xterm
- Launch commands are user-editable templates with a `{cmd}` placeholder for the command to run.

## Settings

- **Confirm before kill** — ask before killing a session (off by default).
- **Ghostty theme import** — off by default.
- **Global hotkey** — show/hide the app window from anywhere (on by default, `Ctrl/Cmd+Alt+T`), alongside the tray icon.
- **External terminal** — the default terminal to launch into, and the per-terminal launch templates.
- Settings and instances are stored in `tmux-companion-settings.json` inside the app's own data folder. The window remembers its size and position and the selected instance.

For how SSH connections and the app's internal channel are locked down, see [security.md](security.md).
