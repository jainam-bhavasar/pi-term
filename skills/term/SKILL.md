---
name: term
description: Keep interactive programs running in named tmux sessions via the term tool. Use for dev servers, flutter run, REPLs, watchers and log streams that must outlive a single shell call.
---

# term

Long-running programs go through the `term` tool, not `bash`. A session is `pi-<name>` and keeps running between tool calls until pi exits.

## Actions

- `start` with `name`, optional `command`, optional `cwd`. If the session exists, it is not restarted.
- `read` with `name` and optional `lines`. Poll until the output you need appears.
- `send` with `name` and `input`. Set `submit: false` for a single key such as Flutter hot reload `r`.
- `list`, `kill`, `open`.

`open` shows the session in a terminal window so the user can watch or type. Do not `tmux attach` yourself.

## Example

Start a dev server, then read it:

```json
{ "action": "start", "name": "web", "command": "npm run dev", "cwd": "/path/to/project" }
```

```json
{ "action": "read", "name": "web", "lines": 120 }
```

Hot reload a running Flutter app:

```json
{ "action": "send", "name": "app", "input": "r", "submit": false }
```
