# pi-term

Background terminals for [pi](https://pi.dev).

`bash` tool calls end when the command ends. That breaks for anything that has to keep running: dev servers, `flutter run`, REPLs, watchers, log tails. pi-term gives the agent named tmux sessions it can start, read and type into, without blocking the conversation.

```bash
pi install npm:pi-term
```

Requires `tmux` (`brew install tmux` or `apt install tmux`).

## What you get

**`term` tool for the agent**

| action | does |
|---|---|
| `start` | start `pi-<name>` in a directory, optionally running a command. Never restarts an existing session. |
| `read` | capture the last N lines of output |
| `send` | type input, with or without Enter (e.g. `r` for Flutter hot reload) |
| `list` | list `pi-` sessions |
| `kill` | stop a session |
| `open` | open the session in a terminal window for you |

**`/term` command for you**

- `/term` lists running sessions and opens the one you pick
- `/term <name>` opens `pi-<name>`, creating it if needed

On macOS it opens Ghostty, falling back to Terminal.app. On other systems it prints the `tmux attach` command to run.

**`term` skill** that tells the agent when to use `term` instead of `bash`.

## Cleanup

Every session records the pid of the pi process that created it. Quitting pi, `/new`, `/resume` or forking kills that process's sessions; `/reload` keeps them. If pi dies without a clean exit, the next pi start kills the leftovers. Sessions you start yourself without the `pi-` owner tag are never touched.

## Example

> start the web dev server and tell me when it's ready

```json
{ "action": "start", "name": "web", "command": "npm run dev" }
{ "action": "read", "name": "web" }
```

## License

MIT
