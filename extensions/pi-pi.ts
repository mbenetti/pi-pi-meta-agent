/**
 * Pi Pi Meta-Agent Builder — Parallel Expert Research Engine
 * Hot-Theme: Rose Pine 🌹
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
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
let tuiRef: any = null;

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
		tuiRef?.requestRender();
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
			tuiRef?.requestRender();
		});

		proc.on("close", (code) => {
			if (state.timer) clearInterval(state.timer);
			state.status = code === 0 ? "done" : "error";
			tuiRef?.requestRender();
			resolve(output || `(Expert returned empty results with exit code ${code})`);
		});
	});
}

function renderCard(name: string, state: ExpertState, cellWidth: number, theme: any): string[] {
	const colors = hexToAnsi(state.def.color);
	const label = name.replace("-", " ").toUpperCase();
	const elapsedText = `${state.elapsed}s`;

	// Colors matching visual states
	let statusStr = "IDLE";
	let statusColor = "muted";
	if (state.status === "researching") { statusStr = "RESEARCHING"; statusColor = "accent"; }
	if (state.status === "done") { statusStr = "COMPLETED"; statusColor = "success"; }
	if (state.status === "error") { statusStr = "CRASHED"; statusColor = "error"; }

	const brCode = colors.br;

	// Line 0: top border
	const line0 = `${brCode}┌${"─".repeat(cellWidth - 2)}┐\x1b[39m\x1b[49m`;

	// Line 1: Header/Label + Elapsed time
	const labelBold = theme.bold(label);
	const elapsedMuted = theme.fg("muted", elapsedText);
	const labelLen = visibleWidth(label);
	const elapsedLen = visibleWidth(elapsedText);
	const padding1 = Math.max(0, cellWidth - 4 - labelLen - elapsedLen);
	const line1 = `${brCode}│\x1b[39m ${labelBold}${" ".repeat(padding1)}${elapsedMuted} ${brCode}│\x1b[39m`;

	// Line 2: Status
	const statusLabel = `Status: ${statusStr}`;
	const statusFormatted = theme.fg(statusColor as any, statusLabel);
	const statusLen = visibleWidth(statusLabel);
	const padding2 = Math.max(0, cellWidth - 4 - statusLen);
	const line2 = `${brCode}│\x1b[39m ${statusFormatted}${" ".repeat(padding2)} ${brCode}│\x1b[39m`;

	// Line 3: Last Line
	const truncatedLastLine = truncateToWidth(state.lastLine, cellWidth - 4);
	const lastLineLen = visibleWidth(truncatedLastLine);
	const padding3 = Math.max(0, cellWidth - 4 - lastLineLen);
	const line3 = `${brCode}│\x1b[39m ${theme.fg("muted", truncatedLastLine)}${" ".repeat(padding3)} ${brCode}│\x1b[39m`;

	// Line 4: bottom border
	const line4 = `${brCode}└${"─".repeat(cellWidth - 2)}┘\x1b[39m`;

	return [line0, line1, line2, line3, line4];
}

// ── Extension API Hook ──────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {

	pi.on("session_start", (_, ctx) => {
		loadExperts();
		// Apply Rose Pine Theme automatically on hook start
		ctx.ui.setTheme("rose-pine");
		ctx.ui.setStatus("pi-pi", "Rose Pine · Meta System Active");

		if (ctx.hasUI) {
			ctx.ui.setWidget("pi-pi-widget", (tui, theme) => {
				tuiRef = tui;
				return {
					invalidate() {},
					render(width) {
						if (activeExperts.size === 0) {
							return [
								theme.fg("accent", "🌹 Pi Pi Meta-Agent Core | Ready for build requests"),
								"",
								theme.fg("muted", "Querying experts in parallel registers status blocks here...")
							];
						}

						const experts = Array.from(activeExperts.entries());
						const leftMargin = "  "; // 2 spaces left margin
						const colSpacing = "  "; // 2 spaces between columns
						const cellWidth = Math.floor((width - 4 - (gridColumns - 1) * 2) / gridColumns);
						if (cellWidth < 10) return []; // Too narrow

						const lines: string[] = [];
						for (let i = 0; i < experts.length; i += gridColumns) {
							const chunk = experts.slice(i, i + gridColumns);
							const chunkCards = chunk.map(([name, state]) => renderCard(name, state, cellWidth, theme));
							for (let lineIdx = 0; lineIdx < 5; lineIdx++) {
								let lineStr = leftMargin;
								for (let colIdx = 0; colIdx < chunkCards.length; colIdx++) {
									if (colIdx > 0) {
										lineStr += colSpacing;
									}
									lineStr += chunkCards[colIdx][lineIdx];
								}
								lines.push(lineStr);
							}
							lines.push("");
						}
						return lines;
					}
				};
			});
		}
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
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
			const resultText = await runExpert(params.expert, params.question, model);
			return {
				content: [{ type: "text", text: resultText }],
				details: {},
			};
		}
	});
}
