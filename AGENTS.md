# AGENTS.md

## Verification commands

Run from the repo root; a task is verified only when all of these pass:

- `pnpm typecheck` — tsc over main+preload (node) and renderer (web) configs
- `pnpm lint` — prettier + eslint + jsonsort (run `pnpm lint-fix` first to auto-fix)
- `pnpm test:contract` — vitest contract tests from `*.contract.yaml` plus colocated `*.test.ts`
- `pnpm build` — electron-vite production build
- `pnpm dev` — run the app; temporary main-process smoke harnesses are wired behind `TMUX_COMPANION_SMOKE=1` and must be removed before the final gate
- `pnpm pack:dir` / `pnpm dist:mac` — packaged builds (current-arch app dir / universal dmg)

## Packaging notes

- electron-builder.yml excludes `node-pty/bin/**` and `node-pty/prebuilds/**` from packaging. Do not remove these negations: @electron/universal rejects Mach-O files that are byte-identical across the x64/arm64 per-arch builds, and both dirs are dead weight anyway (node-pty's runtime loader only reads `build/Release`, `build/Debug`, then `prebuilds/<platform>-<arch>` — and `build/Release` always exists after the per-arch rebuild).

## House rules

- Contract tests for pure logic live in `*.contract.yaml` next to the module; the local
  dev machine has live foreign tmux sessions (`*-mcode`) — never run `tmux kill-server`
  during verification; kill only app-owned sessions or app child processes.
