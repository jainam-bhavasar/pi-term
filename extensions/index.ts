import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	hasSession,
	killOrphanedSessions,
	killOwnedSessions,
	killSession,
	listSessions,
	openViewer,
	readSession,
	sendSession,
	sessionName,
	startSession,
} from "./tmux.ts";

export default function termExtension(pi: ExtensionAPI) {
	// Terminals live as long as the pi session that started them.
	pi.on("session_start", async () => {
		await killOrphanedSessions();
	});
	pi.on("session_shutdown", async (event) => {
		// reload keeps the same session and process, so keep its terminals running
		if (event.reason === "reload") return;
		await killOwnedSessions();
	});

	pi.registerTool({
		name: "term",
		label: "Terminal",
		description:
			"Run a long-lived interactive program in a named tmux session. The call returns immediately. Read output later and send keys without attaching.",
		promptSnippet: "Start, read, type into, list, or stop a background tmux terminal",
		promptGuidelines: [
			"Use term instead of bash when a command must keep running after the call returns, such as flutter run, a dev server, a REPL, or a log stream.",
			"Use term action read to inspect a session. Do not assume the first read contains the final result.",
			"Use term action send to type into a session. Never tmux attach from bash; attach blocks and dies when the tool call ends.",
			"Do not start a new command in a session that already exists. term start reports the existing session instead of restarting it.",
		],
		parameters: Type.Object({
			action: StringEnum(["start", "read", "send", "list", "kill", "open"] as const),
			name: Type.Optional(Type.String({ description: "Session name. Stored as pi-<name>." })),
			command: Type.Optional(Type.String({ description: "Command to type into a new session. Ignored if the session exists." })),
			cwd: Type.Optional(Type.String({ description: "Working directory for a new session. Defaults to the project cwd." })),
			input: Type.Optional(Type.String({ description: "Text to type for action send." })),
			submit: Type.Optional(Type.Boolean({ description: "Press Enter after input. Default true." })),
			lines: Type.Optional(Type.Number({ description: "Scrollback lines to capture. Default 200." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = params.cwd || ctx.cwd;
			switch (params.action) {
				case "list": {
					const sessions = await listSessions();
					return {
						content: [{ type: "text", text: sessions.length ? sessions.join("\n") : "No pi- terminals." }],
						details: { sessions },
					};
				}
				case "start": {
					if (!params.name) throw new Error("name is required");
					const text = await startSession(params.name, cwd, params.command);
					return { content: [{ type: "text", text }], details: { session: sessionName(params.name) } };
				}
				case "read": {
					if (!params.name) throw new Error("name is required");
					const text = await readSession(params.name, params.lines ?? 200);
					return { content: [{ type: "text", text }], details: { session: sessionName(params.name) } };
				}
				case "send": {
					if (!params.name) throw new Error("name is required");
					const text = await sendSession(params.name, params.input ?? "", params.submit !== false);
					const output = await readSession(params.name, 40);
					return { content: [{ type: "text", text: `${text}\n\n${output}` }], details: {} };
				}
				case "kill": {
					if (!params.name) throw new Error("name is required");
					return { content: [{ type: "text", text: await killSession(params.name) }], details: {} };
				}
				case "open": {
					if (!params.name) throw new Error("name is required");
					return { content: [{ type: "text", text: await openViewer(params.name) }], details: {} };
				}
			}
		},
	});

	pi.registerCommand("term", {
		description: "List background terminals, or open one in Ghostty: /term <name>",
		getArgumentCompletions: async (prefix) => {
			const sessions = await listSessions();
			const items = sessions
				.map((session) => session.replace(/^pi-/, ""))
				.filter((name) => name.startsWith(prefix))
				.map((name) => ({ value: name, label: name }));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			const name = args.trim().split(/\s+/)[0];
			if (!name) {
				const sessions = await listSessions();
				if (sessions.length === 0) {
					ctx.ui.notify("No pi- terminals. Ask pi to term start one.", "info");
					return;
				}
				const picked = await ctx.ui.select("Background terminals", sessions);
				if (!picked) return;
				ctx.ui.notify(await openViewer(picked.replace(/^pi-/, "")), "info");
				return;
			}
			if (!(await hasSession(name))) {
				await startSession(name, ctx.cwd);
			}
			ctx.ui.notify(await openViewer(name), "info");
		},
	});
}
