# Development

Setup and daily workflow for working on Tmux Companion itself.

## Prerequisites

[Node.js](https://nodejs.org), [pnpm](https://pnpm.io), and a local [tmux](https://github.com/tmux/tmux) — the embedded terminal needs it to attach to.

## Bootstrap

```bash
git clone https://github.com/beecode-rs/tmux-companion.git
cd tmux-companion
pnpm run init   # one-time: install deps (compiles node-pty against Electron)
pnpm dev        # run the app in development
```

`pnpm run init` installs dependencies (compiling the native node-pty module against Electron) and verifies the Electron binary is in place — pnpm occasionally skips Electron's download (a stale side-effects cache), which `pnpm dev` then fails on with `Error: Electron uninstall`. The check runs automatically after every `pnpm install`, so `init` only needs to be run once after cloning.

## Daily commands

- `pnpm dev` — run the app in development
- `pnpm build` — build main/preload/renderer into `out/`
- `pnpm start` — run the built app
- `pnpm pack:dir` — unpacked build into `dist/` for a quick local smoke test, packaged as `Tmux Companion (dev).app` to distinguish it from release builds
- `pnpm dist:mac` / `pnpm dist:linux` — build installers into `dist/` (universal dmg; AppImage + deb)

The full command list lives in [scripts.md](scripts.md).

## Quality gates

- `pnpm typecheck` — typecheck the node and web projects
- `pnpm lint` / `pnpm lint-fix` — ESLint + Prettier + json-sort-cli (check / write mode)
- `pnpm test:contract` — run the contract tests (`*.contract.yaml` next to the code they test)

## Tech stack

[Electron](https://www.electronjs.org) + [TypeScript](https://www.typescriptlang.org), with a [React](https://react.dev) renderer; [xterm.js](https://xtermjs.org) and node-pty for the embedded terminal; an Express + ws API on localhost for the renderer; electron-vite for builds and electron-store for settings.

## Further reading

- [scripts.md](scripts.md) — the full command list and the one-time `pnpm run init` note
- [architecture.md](architecture.md) — Electron's three-process layout and the source tree
- [security.md](security.md) — how SSH and the local API are locked down
