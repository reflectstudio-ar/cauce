# Cauce

A free desktop UI for [gentle-shell](https://github.com/Gentleman-Programming/gentle-shell), the
Pi-native agent workspace by Gentleman Programming — for everyone who wants the agent's full power
without living in a terminal.

> **Status: early preview.** The chat core and per-chat helpers work. Diffs, ODD progress,
> providers and the remaining screens are on the roadmap.

Cauce is a fork of
[`gentle-shell-desktop`](https://github.com/Gentleman-Programming/gentle-shell-desktop) (MIT).
It is an independent project: it is **not** affiliated with, endorsed by, or supported by
Gentleman Programming, and `gentle-shell`/`gentle-pi` remain their author's trademarks.

## What works today

- Sidebar with your existing chats, grouped by day, plus **New chat**
- Streaming conversation with the agent, abort, and extension dialogs (permissions, questions)
- **Helpers** tab: every subagent a chat started, with its live thread
- Native application menu (`Cmd/Ctrl+N` for a new chat)
- Light and dark schemes following the OS
- First-run choice between your existing `~/.pi/agent` setup and an isolated home

## Requirements

- Node.js 22.19 or newer, and pnpm 11 (`corepack pnpm@11 …` works without a global install)
- The `gentle-shell` launcher, which ships with `gentle-pi` 3.7.0 or newer:

  ```sh
  npm install -g gentle-pi
  gentle-shell --version
  ```

- A signed-in model provider. The app uses whatever Pi is signed in to; sign in once with
  `gentle-shell` in a terminal if you have not.

## Run from source

```sh
corepack pnpm@11 install
corepack pnpm@11 dev
```

Electron 44 no longer downloads its binary from a package postinstall, so this
repo's own `postinstall` runs `node node_modules/electron/install.js` for you.
If you ever see `Error: Electron uninstall`, run that command by hand.

`corepack pnpm@11 dev:web` runs the renderer alone against an in-memory mock bridge at
`http://localhost:5173`, which is handy for UI work without spawning a real agent.

If the app cannot find the launcher (opened from Finder on macOS, for example), set
`GENTLE_SHELL_BIN` to the full path (`which gentle-shell`).

## Checks

```sh
corepack pnpm@11 typecheck
corepack pnpm@11 test
corepack pnpm@11 build
corepack pnpm@11 package        # unsigned bundle under release/
```

## How it is put together

Three Electron processes and one `gentle-shell --mode rpc` child per chat:

| Layer | Responsibility |
| --- | --- |
| `src/main` | Spawns the launcher, decodes the JSONL RPC stream, folds events with a pure reducer, owns the session list |
| `src/preload` | The typed, sandboxed `GentleBridge` |
| `src/renderer` | React UI, one feature folder per product concern |
| `src/shared` | Types and IPC channel names that cross process boundaries |

The agent protocol is Pi's documented RPC mode: JSON commands on stdin, one JSON record per line
on stdout, plus Pi's extension-UI subprotocol for dialogs. The app sets
`GENTLE_SHELL_INTERACTIVE_HOST=1` so gentle-pi enables those dialogs and publishes subagent
activity.

## License

MIT. The original application and the agent harness are © Gentleman Programming; Cauce's
modifications are © Reflect Studio. See [LICENSE](LICENSE).
