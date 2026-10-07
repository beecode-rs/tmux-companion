# Security

How Tmux Companion handles secrets and its internal communication. The user-facing summary lives in the README's Privacy & security section.

## SSH connections

- Remote instances run tmux commands through the system `ssh` binary — never an embedded SSH client.
- ssh runs in batch mode (`-o BatchMode=yes`) with connection multiplexing (`ControlMaster=auto`, `ControlPath=~/.ssh/cm-%C`), so repeated commands reuse one connection.
- Keys, agents, and passwords stay between you and ssh: the app never sees or stores a password, and identity files are referenced by path only.

## Local API

- The renderer talks to the main process over an Express + ws server bound to `127.0.0.1` only, on a random port (`listen(0)`) — nothing else on your network can reach it.
- Every launch generates a fresh random bearer token (`randomBytes`, hex-encoded, compared with `timingSafeEqual`). The renderer receives the port and token through the preload context bridge.

## What is stored, and what is not

- Settings and instances (including identity-file paths) live in `tmux-companion-settings.json` inside the app's own data folder.
- No SSH keys and no passwords are stored by the app, and nothing is telemetry'd anywhere — the app contains no analytics.
