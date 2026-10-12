# Command history

How Tmux Companion keeps its internal tmux communication out of your shell history, and the recipe for giving [Relay](https://github.com/beecode-rs/relay) the same guarantee. The user-facing summary lives in the README; this page is the implementation record.

## The problem

Anything an app *types into an interactive shell* becomes shell history. Relay's SSH connect sequence is the canonical example — these are real lines from a login shell's history, typed by Relay on connect:

```
PATH=/home/linuxbrew/.linuxbrew/bin:...; relay_tmux_exe=$(readlink "/proc/$(pgrep ...)"); ... > "$HOME/.cmh-tmux-sessions"
echo __cmh_shell_"done"__
tmux attach-session -t my-session 2>/dev/null || tmux attach-session 2>/dev/null || tmux new-session -A -s s01 -c '/Users/milos'
```

The fix has two halves: prefer paths that never touch an interactive shell at all, and make the few commands that must be typed invisible to history.

## Why Tmux Companion's tmux traffic is already history-free

Everything the app does with tmux goes through one of these, none of which pass through an interactive shell's line editor:

- **PTY spawns are direct argv** — node-pty spawns `tmux new-session -A -s s01` (or `ssh … -- env PATH=… tmux …`) as a process, not as text typed into a shell. There is no shell in between to record anything.
- **Control mode is a `tmux -C` client process**, spawned the same way.
- **One-shot commands run as non-interactive exec** — `tmux list-sessions`, `switch-client`, etc. via `ExecFileUtil`, and remote ones via `ssh host -- env PATH=… tmux …`. A command run through ssh's exec channel is never added to the remote shell's history, because it is never typed into an interactive shell.

This is an invariant to preserve: **new tmux communication must be argv-spawn or non-interactive exec unless there is no alternative.**

## The one exception: external-terminal launches

Opening a session in Terminal.app types `tmux attach -t =name` into the new tab's shell (osascript `do script`), which lands in that shell's history. Launch templates come in two kinds:

- **Typing templates** — osascript `do script "{cmd}"` (Terminal.app) and iTerm `write text`, plus any custom template containing either marker. These get the history-safe wrapper below.
- **Exec templates** — iTerm2 `create window with default profile command`, and every `-e`/`-x`/`--` style invocation (Linux terminals, wezterm, Ghostty, kitty, alacritty, Warp). The command runs as the terminal session's process, no interactive shell types it, so no wrapper is needed and none is applied.

The wrapper is applied where the template command is rendered, keyed on the template's typing semantics — `toAttachArgs` itself is untouched.

## The mechanism: leading space + enable line

A command whose first character is a space is skipped by history in every mainstream shell — *if* the shell is configured to do so:

| Shell | Needs enabling | Enable line (sent first, itself space-prefixed) |
| --- | --- | --- |
| zsh (macOS default) | yes — `HIST_IGNORE_SPACE` is off by default | ` setopt HIST_IGNORE_SPACE` |
| bash | yes — `HISTCONTROL` must contain `ignorespace` | ` HISTCONTROL=ignorespace${HISTCONTROL:+:$HISTCONTROL}` (appends, never clobbers the user's setting) |
| fish | **no** — fish ignores space-prefixed commands by default; there is no `fish_history_ignore_space` variable | *(none)* |
| unknown | never send shell-specific syntax we haven't verified | *(none)* |

The payload for a typing template is therefore, for zsh:

```
 setopt HIST_IGNORE_SPACE
 tmux attach -t =my-session
```

and for bash:

```
 HISTCONTROL=ignorespace${HISTCONTROL:+:$HISTCONTROL}
 tmux attach -t =my-session
```

fish and unknown shells get only ` tmux attach -t =my-session`.

Two semantics matter and shaped the design:

- **The option is consulted when the line is accepted, before the command runs.** An inline `setopt HIST_IGNORE_SPACE; tmux …` on a single line does not protect that line — zsh decided whether to record it before `setopt` executed. That is why the enable step must be its own typed line preceding the command.
- **First run per fresh shell records one short line.** The enable line itself can't be protected by an option that isn't on yet. In every new shell session the app touches, history gains one ` setopt HIST_IGNORE_SPACE` (or HISTCONTROL assignment) once; every internal line after that — including later launches — is skipped. Existing history entries are never erased by this mechanism.

Leading space is semantically harmless for these commands: shells accept leading whitespace before an assignment or command.

### AppleScript detail

A raw newline cannot appear inside an AppleScript string literal, so the renderer emits `" & linefeed & "` for the payload's newline. The generated osascript source is exercised in the contract tests and has been validated with `osacompile`. Each command word is individually double-quoted in the typed text (` "tmux" "attach" "-t" "=x"`), so the leading space is the first byte of each line and the interactive shell strips the quotes on accept — verified byte-exact end-to-end through `/bin/sh -c` and the AppleScript runtime.

One guard for custom templates: when `{cmd}` is not inside single quotes in the template, the outer `/bin/sh -c` would expand the bash enable line's `${HISTCONTROL:+:$HISTCONTROL}` at launch time — usually to empty, which degrades it to a clobbering assignment. In that case the bash enable line is dropped and the command goes out space-prefixed only (zsh's `setopt` line carries no `$` and is kept).

## Shell/OS detection on connection

Which enable line to use depends on the shell that will type the command, so instances carry what the app detected on connect (`src/shared/instance-model.ts`):

```ts
detectedOs?: 'mac' | 'linux' | 'windows' | 'unknown'
detectedShell?: 'zsh' | 'bash' | 'fish' | 'unknown'
```

- **Local instances** — `process.platform` plus `process.env.SHELL` basename; no subprocess. The external-terminal launch uses this to pick the enable line, because even an ssh-wrapped attach command is typed into a *local* terminal.
- **SSH instances** — one non-interactive probe (`sh -c 'uname -s; printf %s "$SHELL"'`) over the same ssh transport at app start and at instance creation; failure keeps the previous values. The probe itself is an exec-channel command, so it adds no history either.
- The fields are app-managed: persisted with the instance, returned by `GET /api/instances`, and not settable through the instance update API.

Windows has no tmux path today (WSL targets behave as Linux); `windows` exists in the vocabulary so detection has somewhere to go if that changes.

## Tests

- `src/main/util/shell-history-util.contract.yaml` — payload shapes per shell, bash append-not-clobber, fish/unknown no-enable-line, env and probe parsing (including empty `$SHELL`).
- `src/main/business/service/terminal-launch-util.contract.yaml` — wrapped vs unwrapped templates, AppleScript linefeed rendering, exact typed text.
- `src/main/business/service/instance-service.test.ts` — detected-field round-trip through the settings store.

## Porting this to Relay

Relay's connect sequence is typed into the SSH login shell, so the same lines land in remote history. The recipe, in order:

1. **Detect the login shell once per connection, before typing anything.** Run `sh -c 'uname -s; printf %s "$SHELL"'` on an ssh exec channel (non-interactive, no history) and treat zsh/bash/fish/unknown as above. If the login shell isn't reliably `$SHELL`, `ps -o comm= -p $$` inside a typed probe also works but costs one recorded line — prefer the exec channel.
2. **Send the enable line as its own typed line first** (zsh: ` setopt HIST_IGNORE_SPACE`; bash: the HISTCONTROL append; fish/unknown: skip). Expect it to be recorded once per fresh shell session — that is the mechanism's one unavoidable trace.
3. **Space-prefix every internal typed line** — not just the attach chain: the `PATH=…`/`relay_tmux_exe` preamble, the `~/.cmh-tmux-sessions` write, `echo __cmh_shell_"done"__`, and the `exit`. All of them are commands typed into the shell, so all of them are history candidates.
4. **Move what you can off the typed channel.** Anything that doesn't need the interactive shell — session listing, environment probing, the `.cmh-tmux-sessions` write — can run as a non-interactive exec command (`ssh exec channel` or equivalent in-app SSH client), which never touches history and needs no space-prefixing. Reserve typed commands for the final interactive `tmux attach` and keep those space-prefixed.
5. **Keep the invariant** both apps share: tmux communication is either non-interactive exec or a space-prefixed typed line, and a typed line is only used when interactivity is genuinely required.
