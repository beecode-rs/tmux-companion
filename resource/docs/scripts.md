# Scripts

Daily development commands. Requires [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io); a local tmux is
needed for the embedded terminal to attach to.

## First run

```bash
git clone https://github.com/beecode-rs/tmux-companion.git
cd tmux-companion
pnpm run init
pnpm dev
```

`pnpm run init` installs dependencies (compiling the native node-pty module against Electron) and verifies the
Electron binary is in place — pnpm occasionally skips Electron's download (a stale side-effects cache), which
`pnpm dev` then fails on with `Error: Electron uninstall`. The check runs automatically after every
`pnpm install`, so this only needs to be run once after cloning.

## Commands

| Script                         | Purpose                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `pnpm dev`                     | run the app in development                                                                          |
| `pnpm build`                   | build main/preload/renderer into `out/`                                                             |
| `pnpm start`                   | run the built app                                                                                   |
| `pnpm typecheck`               | typecheck the node and web projects                                                                 |
| `pnpm lint` / `pnpm lint-fix`  | ESLint + Prettier + json-sort-cli (check / write mode)                                              |
| `pnpm test:contract`           | run the contract tests (`*.contract.yaml` next to the code they test)                               |
| `pnpm dist:mac` / `dist:linux` | build installers into `dist/` (universal dmg; AppImage + deb)                                       |
| `pnpm pack:dir`                | unpacked build into `dist/` for a quick local smoke test, packaged as `Tmux Companion (dev).app` to distinguish it from release builds |
