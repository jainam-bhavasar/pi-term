import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const NAME_RE = /^[A-Za-z0-9_-]+$/;

export function sessionName(name: string): string {
	if (!NAME_RE.test(name)) {
		throw new Error(`Invalid terminal name "${name}". Use letters, digits, "-" and "_" only.`);
	}
	return name.startsWith("pi-") ? name : `pi-${name}`;
}

async function tmuxBin(): Promise<string> {
	const candidates = [process.env.TMUX_BIN, "/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "tmux"].filter(
		(value): value is string => Boolean(value),
	);
	for (const bin of candidates) {
		try {
			await execFileAsync(bin, ["-V"]);
			return bin;
		} catch {
			// try the next candidate
		}
	}
	throw new Error("tmux is not installed. Install it with: brew install tmux");
}

async function tmux(args: string[], cwd?: string): Promise<string> {
	const bin = await tmuxBin();
	try {
		const { stdout, stderr } = await execFileAsync(bin, args, {
			cwd,
			maxBuffer: 1024 * 1024,
		});
		return `${stdout}${stderr}`.trimEnd();
	} catch (error) {
		const err = error as { stdout?: string; stderr?: string; message?: string; code?: number };
		const detail = `${err.stderr ?? ""}${err.stdout ?? ""}`.trim();
		if (err.code === 1 && args[0] === "has-session") return "";
		throw new Error(detail || err.message || "tmux failed");
	}
}

export async function hasSession(name: string): Promise<boolean> {
	const bin = await tmuxBin();
	try {
		await execFileAsync(bin, ["has-session", "-t", sessionName(name)]);
		return true;
	} catch {
		return false;
	}
}

export async function listSessions(): Promise<string[]> {
	try {
		const out = await tmux(["list-sessions", "-F", "#{session_name}"]);
		return out
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.startsWith("pi-"));
	} catch {
		return [];
	}
}

// Each session records the pid of the pi process that created it in the
// tmux user option @pi_owner, so pi can clean up after itself on exit.
const OWNER_OPT = "@pi_owner";

async function newSession(target: string, cwd: string): Promise<void> {
	await tmux(["new-session", "-d", "-s", target, "-c", cwd]);
	await tmux(["set-option", "-t", target, OWNER_OPT, String(process.pid)]);
}

async function sessionsWithOwner(): Promise<{ name: string; owner: number | null }[]> {
	try {
		const out = await tmux(["list-sessions", "-F", `#{session_name}\t#{${OWNER_OPT}}`]);
		return out
			.split("\n")
			.map((line) => line.trim().split("\t"))
			.filter(([name]) => name?.startsWith("pi-"))
			.map(([name, owner]) => ({ name, owner: owner && /^\d+$/.test(owner) ? Number(owner) : null }));
	} catch {
		return [];
	}
}

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** Kill every pi- session created by this pi process. Idempotent. */
export async function killOwnedSessions(): Promise<string[]> {
	const mine = (await sessionsWithOwner()).filter((s) => s.owner === process.pid);
	for (const s of mine) await tmux(["kill-session", "-t", s.name]).catch(() => {});
	return mine.map((s) => s.name);
}

/** Kill pi- sessions whose owning pi process is gone (e.g. it crashed or the window was closed). */
export async function killOrphanedSessions(): Promise<string[]> {
	const orphans = (await sessionsWithOwner()).filter((s) => s.owner !== null && s.owner !== process.pid && !pidAlive(s.owner));
	for (const s of orphans) await tmux(["kill-session", "-t", s.name]).catch(() => {});
	return orphans.map((s) => s.name);
}

export async function startSession(name: string, cwd: string, command?: string): Promise<string> {
	const target = sessionName(name);
	if (await hasSession(name)) {
		return `exists ${target}\n${await readSession(name, 80)}`;
	}
	await newSession(target, cwd);
	if (command?.trim()) {
		await tmux(["send-keys", "-t", target, "-l", "--", command]);
		await tmux(["send-keys", "-t", target, "Enter"]);
	}
	return `started ${target}${command?.trim() ? `\n$ ${command}` : ""}`;
}

export async function readSession(name: string, lines = 200): Promise<string> {
	const target = sessionName(name);
	if (!(await hasSession(name))) throw new Error(`No session ${target}`);
	const text = await tmux(["capture-pane", "-p", "-t", target, "-S", `-${Math.max(1, lines)}`]);
	return text.trim() ? text : `(${target} is empty)`;
}

export async function sendSession(name: string, input: string, submit = true): Promise<string> {
	const target = sessionName(name);
	if (!(await hasSession(name))) throw new Error(`No session ${target}`);
	if (input) await tmux(["send-keys", "-t", target, "-l", "--", input]);
	if (submit) await tmux(["send-keys", "-t", target, "Enter"]);
	return `sent to ${target}`;
}

export async function killSession(name: string): Promise<string> {
	const target = sessionName(name);
	await tmux(["kill-session", "-t", target]);
	return `killed ${target}`;
}

async function attachScript(target: string): Promise<string> {
	const dir = join(homedir(), ".pi", "agent", "pi-term");
	await mkdir(dir, { recursive: true });
	const path = join(dir, `attach-${target}.sh`);
	// Ghostty runs `-e` through /usr/bin/login, which execs that string as one path.
	// A shebang script is a real executable and can see Homebrew's tmux.
	const body = [
		"#!/bin/zsh",
		"export PATH=\"/opt/homebrew/bin:/usr/local/bin:$PATH\"",
		`exec tmux attach -t ${JSON.stringify(target)}`,
		"",
	].join("\n");
	await writeFile(path, body);
	await chmod(path, 0o755);
	return path;
}

export async function openViewer(name: string): Promise<string> {
	const target = sessionName(name);
	if (!(await hasSession(name))) {
		await newSession(target, process.cwd());
	}
	if (process.platform !== "darwin") {
		return `run in another terminal: tmux attach -t ${target}`;
	}
	const script = await attachScript(target);
	try {
		await execFileAsync("open", ["-na", "Ghostty.app", "--args", "-e", script]);
		return `opened Ghostty on ${target}`;
	} catch {
		const command = `export PATH=\"/opt/homebrew/bin:$PATH\"; tmux attach -t ${target}`;
		await execFileAsync("osascript", ["-e", `tell application \"Terminal\" to do script ${JSON.stringify(command)}`]);
		return `opened Terminal on ${target}`;
	}
}
