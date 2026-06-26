/**
 * Pi Pi Meta-Agent Builder — Parallel Expert Research Engine
 * Hot-Theme: Rose Pine 🌹
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Container, Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { spawn } from "child_process";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

// ── Types ──────────────────────────────────────────────────────────────────

interface ExpertDef {
	name: string;
	description: string;
	tools: string;
	systemPrompt: string;
	file: string;
	color?: string;
}

interface ExpertState {
	def: ExpertDef;
	status: "idle" | "researching" | "done" | "error";
	question: string;
	elapsed: number;
	lastLine: string;
	runCount: number;
	timer?: ReturnType<typeof setInterval>;
}

// Derive package paths dynamically
import { fileURLToPath } from "url";
import { dirname } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..");

// ── State variables ────────────────────────────────────────────────────────

let allExperts: Record<string, ExpertDef> = {};
const activeExperts = new Map<string, ExpertState>();
let gridColumns = 2;
let displayWidgetRef: any = null;

// ── Load Experts Logic ──────────────────────────────────────────────────────

function parseExpertFile(filePath: string): ExpertDef | null {
	try {
		const content = readFileSync(filePath, "utf-8");
		const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
		if (!frontmatterMatch) return null;

		const fmText = frontmatterMatch[1];
		const body = content.substring(frontmatterMatch[0].length).trim();

		const lines = fmText.split("\n");
		let name = "";
		let description = "";
		let tools = "read,grep,find,ls,bash";
		let color = "#e0def4";

		for (const line of lines) {
			const splitIdx = line.indexOf(":");
			if (splitIdx === -1) continue;
			const key = line.slice(0, splitIdx).trim();
			const val = line.slice(splitIdx + 1).replace(/["']/g, "").trim();
			if (key === "name") name = val;
			if (key === "description") description = val;
			if (key === "tools") tools = val;
			if (key === "color") color = val;
		}

		if (!name) return null;
		return { name, description, tools, systemPrompt: body, file: filePath, color };
	} catch {
		return null;
	}
}

function loadExperts() {
	allExperts = {};
	const dirs = [
		join(process.cwd(), "agents"),
		join(process.cwd(), ".pi", "agents"),
		join(packageRoot, "agents"),
	];

	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		try {
			for (const file of readdirSync(dir)) {
				if (!file.endsWith(".md")) continue;
				const parsed = parseExpertFile(join(dir, file));
				if (parsed && ["ext-expert", "theme-expert", "skill-expert", "config-expert", "tui-expert"].includes(parsed.name)) {
					allExperts[parsed.name] = parsed;
				}
			}
		} catch {}
	}
}

// ── TUI Hex Color Converter ────────────────────────────────────────────────

function hexToAnsi(hex: string | undefined): { bg: string; br: string } {
	if (!hex) return { bg: "\x1b[48;2;42;34;54m", br: "\x1b[38;2;235;188;178m" }; // Rose pine subtle default
	const clean = hex.replace("#", "");
	if (clean.length !== 6) return { bg: "\x1b[48;2;42;34;54m", br: "\x1b[38;2;235;188;178m" };
	const r = parseInt(clean.substring(0,2), 16);
	const g = parseInt(clean.substring(2,4), 16);
	const b = parseInt(clean.substring(4,6), 16);

	const bgR = Math.floor(r * 0.25);
	const bgG = Math.floor(g * 0.25);
	const bgB = Math.floor(b * 0.25);

	const brR = Math.min(255, Math.floor(r * 1.1));
	const brG = Math.min(255, Math.floor(g * 1.1));
	const brB = Math.min(255, Math.floor(b * 1.1));

	return {
		bg: `\x1b[48;2;${bgR};${bgG};${bgB}m`,
		br: `\x1b[38;2;${brR};${brG};${brB}m`,
	};
}

// ── Parallel Expert Query Runner ───────────────────────────────────────────

async function runExpert(name: string, question: string, model: string): Promise<string> {
	const expert = allExperts[name];
	if (!expert) return `[System Error] Expert '${name}' is not configured in layout.`;

	const state: ExpertState = {
		def: expert,
		status: "researching",
		question,
		elapsed: 0,
		lastLine: "Initializing core...",
		runCount: 1,
	};
	activeExperts.set(name, state);

	const startTime = Date.now();
	state.timer = setInterval(() => {
		state.elapsed = Math.floor((Date.now() - startTime) / 1000);
		if (displayWidgetRef) displayWidgetRef.update();
	}, 1000);

	const args = [
		"--output-format", "json",
		"--no-extensions",
		"--model", model,
		"--tools", expert.tools,
		"--thinking", "off",
		"--append-system-prompt", expert.systemPrompt,
		"--no-session"
	];
	args.push(question);

	return new Promise<string>((resolve) => {
		const proc = spawn("pi", args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env },
		});

		let output = "";
		let buffer = "";

		proc.stdout!.setEncoding("utf-8");
		proc.stdout!.on("data", (chunk: string) => {
			buffer += chunk;
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const event = JSON.parse(line);
					if (event.type === "message_update") {
						const delta = event.assistantMessageEvent;
						if (delta?.type === "text_delta" && delta.text) {
							output += delta.text;
							state.lastLine = delta.text.trim().split("\n").pop() || state.lastLine;
						}
					} else if (event.type === "tool_call_start") {
						state.lastLine = `Using tool: ${event.toolCall.name}`;
					}
				} catch {
					state.lastLine = line.length > 50 ? line.substring(0, 47) + "..." : line;
				}
			}
			if (displayWidgetRef) displayWidgetRef.update();
		});

		proc.on("close", (code) => {
			if (state.timer) clearInterval(state.timer);
			state.status = code === 0 ? "done" : "error";
			if (displayWidgetRef) displayWidgetRef.update();
			resolve(output || `(Expert returned empty results with exit code ${code})`);
		});
	});
}

// ── Extension API Hook ──────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {

	pi.on("session_start", (_, ctx) => {
		loadExperts();
		// Apply Rose Pine Theme automatically on hook start
		ctx.ui.setTheme("rose-pine");
		ctx.ui.setStatus("pi-pi", "Rose Pine · Meta System Active");
	});

	// Register parallel orchestrator tool
	pi.registerTool({
		name: "query_expert",
		label: " query_expert",
		description: "Query a domain expert for Pi specifications and templates. Experts run in parallel.",
		parameters: Type.Object({
			expert: Type.String({ description: "Expert to query: ext-expert, theme-expert, skill-expert, config-expert, tui-expert" }),
			question: Type.String({ description: "Explain what design standards, parameters or components you need to research" }),
		}),
		renderCall(args, theme) {
			return new Text(theme.fg("accent", `🌹 querying specialist [${args.expert}]...`));
		},
		async execute(args, ctx) {
			const model = ctx.model;
			return await runExpert(args.expert, args.question, model);
		}
	});

	// Create Grid panel Widget
	pi.registerWidget({
		name: "pi-pi-widget",
		position: "top",
		height: 12,
		render(width, height, theme) {
			displayWidgetRef = this;
			const container = new Container(width, height);

			if (activeExperts.size === 0) {
				container.addChild(new Text(theme.fg("accent", "🌹 Pi Pi Meta-Agent Core | Ready for build requests"), 1, 1));
				container.addChild(new Text(theme.fg("muted", "Querying experts in parallel registers status blocks here..."), 1, 3));
				return container;
			}

			const experts = Array.from(activeExperts.entries());
			const cellWidth = Math.floor((width - 4) / gridColumns) - 1;
			const cellHeight = 4;

			experts.forEach(([name, state], idx) => {
				const col = idx % gridColumns;
				const row = Math.floor(idx / gridColumns);
				const x = 2 + col * (cellWidth + 2);
				const y = 1 + row * (cellHeight + 1);

				if (x + cellWidth > width || y + cellHeight > height) return;

				const colors = hexToAnsi(state.def.color);
				const label = name.replace("-", " ").toUpperCase();
				const elapsedText = `${state.elapsed}s`;

				// Colors matching visual states
				let statusStr = "IDLE";
				let statusColor = "muted";
				if (state.status === "researching") { statusStr = "RESEARCHING"; statusColor = "accent"; }
				if (state.status === "done") { statusStr = "COMPLETED"; statusColor = "success"; }
				if (state.status === "error") { statusStr = "CRASHED"; statusColor = "error"; }

				const cell = new Container(cellWidth, cellHeight);
				// Custom borders matching hex colors
				const bgCode = colors.bg;
				const brCode = colors.br;

				cell.addChild(new Text(`${brCode}┌${"─".repeat(cellWidth - 2)}┐\x1b[39m\x1b[49m`, 0, 0));
				cell.addChild(new Text(`${brCode}│\x1b[39m ${theme.bold(label)} ${" ".repeat(Math.max(0, cellWidth - 5 - label.length - elapsedText.length))}${theme.fg("muted", elapsedText)} ${brCode}│\x1b[39m`, 0, 1));
				
				const statusLabel = `Status: ${statusStr}`;
				cell.addChild(new Text(`${brCode}│\x1b[39m ${theme.fg(statusColor as any, statusLabel)}${" ".repeat(Math.max(0, cellWidth - 4 - statusLabel.length))} ${brCode}│\x1b[39m`, 0, 2));

				const lastLineText = truncateToWidth(state.lastLine, cellWidth - 4);
				cell.addChild(new Text(`${brCode}│\x1b[39m ${theme.fg("muted", lastLineText)}${" ".repeat(Math.max(0, cellWidth - 4 - visibleWidth(lastLineText)))} ${brCode}│\x1b[39m`, 0, 3));
				cell.addChild(new Text(`${brCode}└${"─".repeat(cellWidth - 2)}┘\x1b[39m`, 0, cellHeight));

				container.addChild(cell, x, y);
			});

			return container;
		}
	});
}
