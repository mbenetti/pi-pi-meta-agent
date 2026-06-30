import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { applyExtensionDefaults } from "./themeMap.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..");

// ── Active process tracking to prevent zombie processes ───────────────────────
const activeProcesses = new Set<any>();
process.on("exit", () => {
  for (const proc of activeProcesses) {
    try {
      proc.kill("SIGKILL");
    } catch {}
  }
});

/**
 * Tree TUI — Tree-style TUI dashboard for pi-pi meta agents
 *
 * Shows one line per agent with activity indicators (activity icons,
 * elapsed time, tool count) and colored agent names from frontmatter colors.
 *
 * Commands:
 *   /tree-team [team] — load team from teams.yaml (default: pi-pi)
 *   /tree-status      — show current tree state and agent status
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExpertDef {
  name: string;
  displayName: string;
  description: string;
  tools: string[];
  systemPrompt: string;
  file: string;
  color?: string;
}

type ActivityIcon = "context" | "search" | "read" | "write" | "edit" | "bash" | "grep" | "find" | "ls" | "custom" | null;

interface AgentActivity {
  contextLoaded: boolean;
  lastTool: string | null;
  lastToolIcon: ActivityIcon;
  toolCount: Record<string, number>;
  currentTask: string;
  lastOutputLine: string;
  elapsed: number;
  startTime: number | null;
  contextValue: number;
}

interface AgentState {
  def: ExpertDef;
  status: "idle" | "researching" | "done" | "error";
  activity: AgentActivity;
  color: { bg: string; br: string };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function displayName(name: string): string {
  return name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function parseAgentFile(filePath: string): ExpertDef | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return null;

    const frontmatter: Record<string, string> = {};
    for (const line of match[1].split(/\r?\n/)) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        let val = line.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        frontmatter[key] = val;
      }
    }

    if (!frontmatter.name) return null;

    return {
      name: frontmatter.name,
      displayName: displayName(frontmatter.name),
      description: frontmatter.description || "",
      tools: (frontmatter.tools || "read,grep,find,ls").split(",").map(t => t.trim()),
      systemPrompt: match[2].trim(),
      file: filePath,
      color: frontmatter.color,
    };
  } catch {
    return null;
  }
}

function parseTeamsYaml(filePath: string): Record<string, string[]> {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const teams: Record<string, string[]> = {};
    let currentTeam = "";

    for (const line of raw.split(/\r?\n/)) {
      const trimmedRight = line.trimEnd();
      if (!trimmedRight) continue;

      if (!line.startsWith(" ") && trimmedRight.endsWith(":")) {
        currentTeam = trimmedRight.slice(0, -1).trim();
        teams[currentTeam] = [];
      } else if (trimmedRight.trim().startsWith("- ") && currentTeam) {
        teams[currentTeam].push(trimmedRight.trim().slice(2).trim());
      }
    }
    return teams;
  } catch {
    return {};
  }
}

const FG_RESET = "\x1b[39m";
const BG_RESET = "\x1b[49m";

function hexToAnsiParams(hex: string): { bg: string; br: string } {
  if (!hex) return { bg: "\x1b[48;2;42;34;54m", br: "\x1b[38;2;235;188;178m" }; // Rose pine subtle default
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return { bg: "\x1b[48;2;42;34;54m", br: "\x1b[38;2;235;188;178m" };

  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);

  // Background is 25% brightness for elegant card/block feel
  const bgR = Math.floor(r * 0.25);
  const bgG = Math.floor(g * 0.25);
  const bgB = Math.floor(b * 0.25);

  // Bright color for high contrast text/borders
  const brR = Math.min(255, Math.floor(r * 1.1));
  const brG = Math.min(255, Math.floor(g * 1.1));
  const brB = Math.min(255, Math.floor(b * 1.1));

  return {
    bg: `\x1b[48;2;${bgR};${bgG};${bgB}m`,
    br: `\x1b[38;2;${brR};${brG};${brB}m`,
  };
}

function toolToIcon(toolName: string): ActivityIcon {
  const t = toolName.toLowerCase().replace(/_/g, "");
  switch (t) {
    case "web_search":
    case "tavily":
    case "search":
      return "search";
    case "read":
      return "read";
    case "write":
      return "write";
    case "edit":
      return "edit";
    case "bash":
      return "bash";
    case "grep":
      return "grep";
    case "find":
      return "find";
    case "ls":
      return "ls";
    default:
      return t.includes("search") ? "search"
           : t.includes("read") ? "read"
           : t.includes("write") ? "write"
           : t.includes("edit") ? "edit"
           : t.includes("bash") || t.includes("run") || t.includes("exec") ? "bash"
           : "custom";
  }
}

function activityIconToEmoji(icon: ActivityIcon): string {
  switch (icon) {
    case "context": return "📄";
    case "search":  return "🔍";
    case "read":    return "📖";
    case "write":   return "✏️";
    case "edit":    return "🔧";
    case "bash":    return "⚙️";
    case "grep":    return "🔎";
    case "find":    return "📂";
    case "ls":      return "📋";
    case "custom":  return "🔨";
    default:        return "";
  }
}

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  agents: new Map<string, AgentState>(),
  currentTeam: "pi-pi",
  widgetCtx: null as any,
};

// ── Extension ─────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let teamLoaded = false;

  function loadTeam(cwd: string, teamName: string) {
    let agentsDir = join(cwd, "agents");
    if (!existsSync(agentsDir)) agentsDir = join(packageRoot, "agents");
    const teamsFile = join(agentsDir, "teams.yaml");

    state.agents.clear();
    state.currentTeam = teamName;

    if (!existsSync(teamsFile)) {
      console.warn("teams.yaml not found at", teamsFile);
      return;
    }

    const teams = parseTeamsYaml(teamsFile);
    let members = teams[teamName];

    if (!members) {
      const firstTeam = Object.keys(teams)[0];
      if (firstTeam) {
        state.currentTeam = firstTeam;
        members = teams[firstTeam];
      } else {
        console.warn(`Team "${teamName}" not found in teams.yaml`);
        return;
      }
    }

    for (const member of members) {
      const fullPath = join(agentsDir, `${member}.md`);
      if (existsSync(fullPath)) {
        const def = parseAgentFile(fullPath);
        if (def) {
          const colors = hexToAnsiParams(def.color || "");
          const key = member.toLowerCase().replace(/-/g, "_");
          state.agents.set(key, {
            def,
            status: "idle",
            activity: {
              contextLoaded: false,
              lastTool: null,
              lastToolIcon: null,
              toolCount: {},
              currentTask: "",
              lastOutputLine: "",
              elapsed: 0,
              startTime: null,
              contextValue: 0,
            },
            color: colors,
          });
        }
      }
    }

    teamLoaded = true;
  }

  function truncateTo(str: string, maxLen: number): string {
    const clean = str.replace(/[\r\n\t]/g, " ");
    if (visibleWidth(clean) <= maxLen) return clean;
    return truncateToWidth(clean, maxLen - 3) + "...";
  }

  function updateWidget() {
    if (!state.widgetCtx || !teamLoaded) return;

    state.widgetCtx.ui.setWidget("pi-pi-tree", (_tui: any, theme: any) => ({
      render(width: number): string[] {
        if (state.agents.size === 0) {
          return [
            "",
            theme.fg("dim", `  No members for team: ${state.currentTeam}`),
            theme.fg("dim", `  Check agents/teams.yaml`),
          ];
        }

        const lines: string[] = [];

        // Header
        const header = theme.fg("accent", theme.bold("  ⚙️  Pi-Pi Meta Agent Builder"))
          + theme.fg("dim", `  │  Team: ${state.currentTeam}`);
        lines.push(header);
        lines.push(theme.fg("dim", "  " + "─".repeat(Math.min(60, Math.floor(width / 3)))));

        // Agent lines
        for (const [key, agent] of state.agents) {
          const line = renderAgentLine(agent, width - 4, theme);
          lines.push(line);
        }

        // Footer
        lines.push("");
        const active = Array.from(state.agents.values()).filter(a => a.status === "researching").length;
        const done = Array.from(state.agents.values()).filter(a => a.status === "done").length;
        const total = state.agents.size;

        if (active > 0) {
          lines.push(theme.fg("accent", `  ◉ ${active} active`) + theme.fg("dim", `  ·  ${done}/${total} done`));
        } else if (done > 0) {
          lines.push(theme.fg("success", `  ✓ All ${done} agents completed`) + theme.fg("dim", `  ·  ${done}/${total}`));
        } else {
          lines.push(theme.fg("dim", `  ○ Waiting for research to begin...`));
        }

        lines.push(theme.fg("dim", `  ↑↓ navigate  ↑ space toggle  esc close`));

        return lines.map(l => truncateToWidth(l, width));
      },
      invalidate() {},
      handleInput: undefined,
    }));
  }

  function getContextLevel(val: number): number {
    if (!val || val <= 0) return 0;
    if (val < 1000) return 1;
    if (val < 4000) return 2;
    if (val < 10000) return 3;
    if (val < 25000) return 4;
    if (val < 60000) return 5;
    return 6;
  }

  function renderAgentLine(agent: AgentState, maxWidth: number, theme: any): string {
    const { def, status, activity, color } = agent;

    // Status icon + color
    const statusColor = status === "idle" ? "dim"
      : status === "researching" ? "accent"
      : status === "done" ? "success"
      : "error";

    const statusIcon = status === "idle" ? "○"
      : status === "researching" ? "◉"
      : status === "done" ? "✓"
      : "✗";

    // Build activity badges — show at most 2 most recent icons to prevent overflow
    const badges: string[] = [];

    if (activity.lastTool) {
      const icon = activityIconToEmoji(activity.lastToolIcon);
      badges.unshift(icon); // newest first
    }

    if (badges.length === 0 && activity.contextLoaded) {
      badges.push(activityIconToEmoji("context"));
    }

    // Count tools used for metadata
    const totalTools = Object.values(activity.toolCount).reduce((a, b) => a + b as number, 0) as number;
    if (totalTools > 0 && badges.length === 0) {
      badges.push(activityIconToEmoji("custom"));
    }

    // Fixed-width badge column (8 chars) — only show most recent 2 icons
    const MAX_BADGES = 2;
    const badgeText = badges.slice(0, MAX_BADGES).join("") || "  ";
    const badgeVisible = visibleWidth(badgeText);
    const badgeWidth = 8; // Fixed column width

    // Name with color (use agent's custom color via ANSI if available)
    const nameStr = color.br
      ? color.br + theme.bold(def.displayName) + FG_RESET
      : theme.fg("accent", theme.bold(def.displayName));

    const nameColWidth = 15;
    const plainNameLen = visibleWidth(def.displayName);
    const padName = " ".repeat(Math.max(0, nameColWidth - plainNameLen));

    // Time + tool count column width
    const elapsedText = activity.startTime
      ? theme.fg("dim", ` (${Math.round(activity.elapsed / 1000)}s)`)
      : "";
    const toolText = totalTools > 0
      ? theme.fg("dim", ` [${totalTools}t]`)
      : "";
    const metaText = elapsedText + toolText;
    const metaVisible = visibleWidth(activity.startTime ? ` (${Math.round(activity.elapsed / 1000)}s)` : "") + (totalTools > 0 ? ` [${totalTools}t]`.length : 0);

    // Context box variables
    const contextVal = activity.contextValue || 0;
    const dotsInBox = 6;
    const level = getContextLevel(contextVal);

    const filledDot = theme.fg("error", "•");
    const emptyDot = theme.fg("dim", "·");
    const dotString = filledDot.repeat(level) + emptyDot.repeat(dotsInBox - level);
    const contextBoxStr = theme.fg("dim", "[") + dotString + theme.fg("dim", "]");
    // Column 4 is exactly 11 characters visual width: "  [••••••] "
    const col4Width = 11;

    // Remaining space for task column
    const consumedWidth = 4 + badgeWidth + nameColWidth + col4Width + metaVisible + 4;
    const remaining = Math.max(15, maxWidth - consumedWidth);
    const taskText = truncateTo(activity.currentTask || def.description, remaining);

    // Compose line with FIXED COLUMNS
    const bg = color.bg ? color.bg : "";
    const bgR = color.bg ? BG_RESET : "";

    const colorize = (s: string, c: string) => {
      return (bg ? bg : "") + theme.fg(c, s) + (bg ? bgR : "");
    };

    // Column 1: Status icon (fixed 4 characters)
    let line = colorize(`  ${statusIcon} `, statusColor);

    // Column 2: Activity badges (fixed 8 characters, left-aligned)
    const padBadge = " ".repeat(Math.max(0, badgeWidth - badgeVisible));
    line += colorize(badgeText + padBadge, status === "researching" ? "accent" : "dim");

    // Column 3: Agent name block (fixed 15 characters, left-aligned)
    let coloredName = color.br
      ? nameStr
      : theme.fg("accent", theme.bold(def.displayName));

    let col3 = coloredName + padName;
    if (bg) {
      col3 = bg + col3 + bgR;
    }
    line += col3;

    // Column 4: Context Indicator Box (fixed 11 characters, aligned!)
    const col4 = colorize("  ", "dim") + contextBoxStr + colorize(" ", "dim");
    line += col4;

    // Column 5: Task (muted, left-aligned in column)
    if (taskText) {
      line += colorize(`  ${taskText}`, "muted");
      // Add padding to keep metadata trailing neat if required
      const taskVisible = visibleWidth(taskText);
      const padTask = " ".repeat(Math.max(0, remaining - taskVisible));
      line += colorize(padTask, "muted");
    } else {
      line += colorize(" ".repeat(remaining + 2), "muted");
    }

    // Column 6: Time + tool count (dim)
    if (metaText) {
      line += colorize(`  ${metaText}`, "dim");
    }

    return truncateToWidth(line, maxWidth + 2);
  }



  // ── query_tree_researchers Tool ───────────────────────────────────────────

  pi.registerTool({
    name: "query_tree_researchers",
    label: "Query Researchers",
    description: "Query one or more research agents IN PARALLEL. All agents run simultaneously as concurrent subprocesses.\nPass an array of queries — each with an agent name and a specific question. All agents start at the same time and their results are returned together.",

    parameters: Type.Object({
      queries: Type.Array(
        Type.Object({
          agent: Type.String({ description: "Agent name (e.g. ext-expert, theme-expert, skill-expert, config-expert, tui-expert)" }),
          question: Type.String({ description: "Task or question to assign to this researcher." }),
        }),
        { description: "Array of research tasks to run in parallel" },
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const { queries } = params as { queries: { agent: string; question: string }[] };

      // Reset all agents to idle before starting a new batch of parallel queries
      for (const [_, agent] of state.agents) {
        agent.status = "idle";
      }

      if (!queries || queries.length === 0) {
        return {
          content: [{ type: "text", text: "No queries provided." }],
          details: { results: [], status: "error" },
        };
      }

      const names = queries.map(q => displayName(q.agent)).join(", ");
      if (onUpdate) {
        onUpdate({
          content: [{ type: "text", text: `Querying ${queries.length} agents in parallel: ${names}` }],
          details: { queries, status: "researching", results: [] },
        });
      }

      const settled = await Promise.allSettled(
        queries.map(async ({ agent, question }) => {
          const result = await queryResearcher(agent, question, ctx);
          const truncated = result.output.length > 12000
            ? result.output.slice(0, 12000) + "\n\n... [truncated — ask follow-up for more]"
            : result.output;
          const status = result.exitCode === 0 ? "done" : "error";
          return {
            agent,
            question,
            status,
            elapsed: result.elapsed,
            exitCode: result.exitCode,
            output: truncated,
            fullOutput: result.output,
          };
        }),
      );

      const results = settled.map((s, i) =>
        s.status === "fulfilled"
          ? s.value
          : {
            agent: queries[i].agent,
            question: queries[i].question,
            status: "error" as const,
            elapsed: 0,
            exitCode: 1,
            output: `Error: ${(s.reason as any)?.message || s.reason}`,
            fullOutput: "",
          },
      );

      // Update agent states based on results
      for (const result of results) {
        const key = result.agent.toLowerCase().replace(/-/g, "_");
        const agent = state.agents.get(key);
        if (agent) {
          agent.status = result.status === "done" ? "done" : "error";
          agent.activity.elapsed = result.elapsed;
          agent.activity.currentTask = result.status === "done" ? "Complete" : "Failed";
          agent.activity.contextLoaded = false;
          updateWidget();
        }
      }

      // CONTEXT SAFETY: Never dump full output into manager context.
      // Return only metadata/summaries. Full content stored in `details` for expand-only.
      const summaryLines = results.map((r, i) => {
        const icon = r.status === "done" ? "✓" : "✗";
        const brief = r.output
          ? r.output.split(/\n/).filter((l: string) => l.trim()).slice(0, 3).join(" | ").slice(0, 200)
          : "(no output)";
        return `${icon} [${i + 1}] ${displayName(r.agent)} (${Math.round(r.elapsed / 1000)}s): ${brief}`;
      });

      return {
        content: [{ type: "text", text: summaryLines.join("\n\n") }],
        details: {
          results,
          status: results.every(r => r.status === "done") ? "done" : "partial",
        },
      };
    },

    renderCall(args, theme) {
      const queries = (args as any).queries || [];
      const names = queries.map((q: any) => displayName(q.agent || "?")).join(", ");
      return new Text(
        theme.fg("toolTitle", theme.bold("query_tree_researchers ")) +
        theme.fg("accent", `${queries.length} parallel`) +
        theme.fg("dim", " — ") +
        theme.fg("muted", names),
        0, 0,
      );
    },

    renderResult(result, options, theme) {
      const details = result.details as any;
      if (!details?.results) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      if (options.isPartial || details.status === "researching") {
        const count = details.queries?.length || "?";
        return new Text(
          theme.fg("accent", `◉ ${count} agents`) +
          theme.fg("dim", " researching in parallel..."),
          0, 0,
        );
      }

      // Compact summary (always visible) — metadata only, no content
      const lines = (details.results as any[]).map((r: any) => {
        const icon = r.status === "done" ? "✓" : "✗";
        const color = r.status === "done" ? "success" : "error";
        const elapsed = typeof r.elapsed === "number" ? Math.round(r.elapsed / 1000) : 0;
        const brief = (r.output || "(empty)").split(/\r?\n/).filter((l: string) => l.trim()).slice(0, 2).join(" | ");
        return theme.fg(color, `${icon} [${r.agent}] ${displayName(r.agent)}`) +
          theme.fg("dim", ` ${elapsed}s — `) +
          theme.fg("muted", ` ${brief.slice(0, 60)}`);
      });

      const header = lines.join("\n");

      // Full content ONLY on expand
      if (options.expanded && details.results) {
        const expanded = (details.results as any[]).map((r: any) => {
          const output = r.fullOutput || r.output || "";
          const truncated = output.length > 3000 ? output.slice(0, 3000) + "\n... [truncated]" : output;
          return theme.fg("accent", `── ${displayName(r.agent)} ── (${r.elapsed}ms) ──`) + "\n" + theme.fg("muted", truncated);
        });
        return new Text(header + "\n\n" + expanded.join("\n\n"), 0, 0);
      }

      return new Text(header + "\n\n" + theme.fg("dim", "[expand to see full results]"), 0, 0);
    },
  });

  // ── query_expert Tool (Companion Single Query Orchestration) ────────────────

  pi.registerTool({
    name: "query_expert",
    label: "Query Expert",
    description: "Query a single specialized Pi-Pi meta-agent for configuration, extension, theme, or TUI logic.",
    parameters: Type.Object({
      expert: Type.String({ description: "Expert to query: ext-expert, theme-expert, skill-expert, config-expert, tui-expert" }),
      question: Type.String({ description: "The specific research task, query, or design standard request" }),
    }),
    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("query_expert ")) +
        theme.fg("accent", `[${args.expert}]`) +
        theme.fg("dim", " — ") +
        theme.fg("muted", args.question.slice(0, 50)),
        0, 0,
      );
    },
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const { expert, question } = params;
      const key = expert.toLowerCase().replace(/-/g, "_");
      
      const agent = state.agents.get(key);
      if (agent) {
        agent.status = "researching";
        updateWidget();
      }

      const result = await queryResearcher(expert, question, ctx);

      if (agent) {
        agent.status = result.exitCode === 0 ? "done" : "error";
        agent.activity.elapsed = result.elapsed;
        agent.activity.currentTask = result.exitCode === 0 ? "Complete" : "Failed";
        updateWidget();
      }

      return {
        content: [{ type: "text", text: result.output }],
        details: { result, status: result.exitCode === 0 ? "done" : "error" },
      };
    },
  });

  // ── Helper: Spawn Researcher Sub-process ─────────────────────────────

  function queryResearcher(
    expertName: string,
    question: string,
    ctx: any,
  ): Promise<{ output: string; exitCode: number; elapsed: number }> {
    const targetName = expertName.toLowerCase();

    let stateKey: string | null = null;
    let totalCount = 0;

    for (const [key, s] of state.agents) {
      if (s.def.name.toLowerCase() === targetName) {
        totalCount++;
        if (s.status !== "researching" && !stateKey) {
          stateKey = key;
        }
      }
    }

    if (!stateKey) {
      if (totalCount === 0) {
        const available = Array.from(state.agents.values()).map(s => displayName(s.def.name)).join(", ");
        return Promise.resolve({
          output: `Team member "${expertName}" not found. Available: ${available}`,
          exitCode: 1,
          elapsed: 0,
        });
      } else {
        const statuses = Array.from(state.agents.entries()).map(([k, s]) => `${k}=${s.status}`).join(", ");
        return Promise.resolve({
          output: `All ${totalCount} instances of "${displayName(expertName)}" are currently busy. Wait for them to finish. Current states: ${statuses}`,
          exitCode: 1,
          elapsed: 0,
        });
      }
    }

    // Mark agent as researching so other concurrent queries see it as busy
    const agent = state.agents.get(stateKey);
    if (agent) {
      agent.status = "researching";
      agent.activity.startTime = Date.now();
      agent.activity.currentTask = question.slice(0, 60);
      agent.activity.elapsed = 0;
      agent.activity.contextValue = 0;
      updateWidget();
    }

    const startTime = Date.now();
    let model = ctx.model
      ? `${ctx.model.provider}/${ctx.model.id}`
      : "openrouter/google/gemini-2.5-flash";

    const langfuseExt = join(ctx.cwd || process.cwd(), "extensions", "langfuse-trace.ts");
    const args: string[] = [
      "--mode", "json",
      "-p",
      "--no-session",
      "--no-extensions"
    ];

    if (existsSync(langfuseExt)) {
      args.push("-e", langfuseExt);
    }

    args.push(
      "--model", model,
      "--tools", state.agents.get(stateKey)!.def.tools.join(","),
      "--system-prompt", state.agents.get(stateKey)!.def.systemPrompt,
      question
    );

    const textChunks: string[] = [];
    let buffer = "";

    return new Promise((resolve) => {
      const proc = spawn("pi", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });
      activeProcesses.add(proc);

      proc.stdout!.setEncoding("utf-8");
      proc.stdout!.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            let cleanLine = line.trim();
            if (cleanLine.startsWith("[")) cleanLine = cleanLine.slice(1);
            if (cleanLine.endsWith("]")) cleanLine = cleanLine.slice(0, -1);
            if (cleanLine.startsWith(",")) cleanLine = cleanLine.slice(1);
            if (cleanLine.endsWith(",")) cleanLine = cleanLine.slice(0, -1);
            cleanLine = cleanLine.trim();
            if (!cleanLine) continue;

            const event = JSON.parse(cleanLine);
            const usage = event.message?.usage || event.assistantMessageEvent?.partial?.usage || event.assistantMessageEvent?.usage;
            if (usage && typeof usage.input === "number") {
              const a = state.agents.get(stateKey!);
              if (a) {
                a.activity.contextValue = Math.max(a.activity.contextValue || 0, usage.input);
              }
            }
            const delta = event.assistantMessageEvent;
            if (event.type === "text_delta" || (event.type === "message_update" && delta?.type === "text_delta")) {
              if (delta) {
                textChunks.push(delta.delta || "");
                const full = textChunks.join("");
                const last = full.split("\n").filter((l: string) => l.trim()).pop() || "";
                const a = state.agents.get(stateKey!);
                if (a) {
                  a.activity.lastOutputLine = last;
                  a.activity.currentTask = last.slice(0, 60);
                  updateWidget();
                }
              }
            } else if (event.type === "tool_execution_start") {
              const a = state.agents.get(stateKey!);
              if (a) {
                a.activity.lastTool = event.toolName;
                a.activity.lastToolIcon = toolToIcon(event.toolName);
                a.activity.toolCount[event.toolName] = (a.activity.toolCount[event.toolName] || 0) + 1;
                a.activity.contextLoaded = true;
                a.activity.currentTask = `Running: ${event.toolName}`;
                updateWidget();
              }
            } else if (event.type === "tool_execution_end") {
              const a = state.agents.get(stateKey!);
              if (a) {
                a.activity.elapsed = Date.now() - (a.activity.startTime || Date.now());
                const preview = event.result?.content?.[0]?.text || "";
                const cleanPreview = preview.split(/\r?\n/).filter((l: string) => l.trim()).pop() || "";
                if (cleanPreview) {
                  a.activity.currentTask = cleanPreview.slice(0, 60);
                }
                updateWidget();
              }
            } else if (event.type === "turn_start") {
              const a = state.agents.get(stateKey!);
              if (a) {
                if (!a.activity.startTime) {
                  a.activity.startTime = Date.now();
                }
                updateWidget();
              }
            }
          } catch {}
        }
      });

      proc.stderr!.setEncoding("utf-8");
      proc.stderr!.on("data", () => {});

      proc.on("close", (code: number | null) => {
        activeProcesses.delete(proc);
        if (buffer.trim()) {
          try {
            let cleanLine = buffer.trim();
            if (cleanLine.startsWith("[")) cleanLine = cleanLine.slice(1);
            if (cleanLine.endsWith("]")) cleanLine = cleanLine.slice(0, -1);
            if (cleanLine.startsWith(",")) cleanLine = cleanLine.slice(1);
            if (cleanLine.endsWith(",")) cleanLine = cleanLine.slice(0, -1);
            cleanLine = cleanLine.trim();

            const event = JSON.parse(cleanLine);
            const delta = event.assistantMessageEvent;
            if (event.type === "text_delta" || (event.type === "message_update" && delta?.type === "text_delta")) {
              if (delta) textChunks.push(delta.delta || "");
            }
          } catch {}
        }

        const elapsed = Date.now() - startTime;
        const a = state.agents.get(stateKey!);
        if (a) {
          a.status = code === 0 ? "done" : "error";
          a.activity.elapsed = elapsed;
          a.activity.currentTask = code === 0 ? "Complete" : `Error (exit ${code})`;
          a.activity.contextLoaded = false;
          updateWidget();
        }

        ctx.ui.notify(
          `${displayName(expertName)} ${code === 0 ? "done" : "error"} in ${Math.round(elapsed / 1000)}s`,
          code === 0 ? "success" : "error"
        );

        resolve({
          output: textChunks.join(""),
          exitCode: code ?? 1,
          elapsed,
        });
      });

      proc.on("error", (err: Error) => {
        activeProcesses.delete(proc);
        const elapsed = Date.now() - startTime;
        const a = state.agents.get(stateKey!);
        if (a) {
          a.status = "error";
          a.activity.currentTask = `Error: ${err.message}`;
          updateWidget();
        }

        resolve({
          output: `Error spawning expert: ${err.message}`,
          exitCode: 1,
          elapsed,
        });
      });
    });
  }

  // ── Commands ─────────────────────────────────────────────────────────

  pi.registerCommand("tree-team", {
    description: "Load a specific team from teams.yaml: /tree-team [team-name]",
    handler: async (args, _ctx) => {
      const team = (args?.trim() || "pi-pi") as string;
      state.widgetCtx = _ctx;
      loadTeam(_ctx.cwd, team);
      updateWidget();
      _ctx.ui.notify(`Loaded team: ${team} with ${state.agents.size} members`, "info");
      _ctx.ui.setStatus("pi-pi-tree", `Team: ${team}`);
    },
  });

  pi.registerCommand("tree-status", {
    description: "Show current tree state and agent status",
    handler: async (_args, _ctx) => {
      const lines = Array.from(state.agents.values())
        .map(s => `${displayName(s.def.name)}: ${s.status}${s.activity.lastTool ? ` (last: ${s.activity.lastTool})` : ""}`)
        .join("\n");
      _ctx.ui.notify(lines || `No agents loaded in team ${state.currentTeam}`, "info");
    },
  });

  // ── System Prompt ────────────────────────────────────────────────────

  pi.on("before_agent_start", async (_event, _ctx) => {
    const expertCatalog = Array.from(state.agents.values())
      .map(s => `### ${displayName(s.def.name)}\n**Query as:** \`${s.def.name}\`\n${s.def.description}`)
      .join("\n\n");

    const expertNames = Array.from(state.agents.values()).map(s => displayName(s.def.name)).join(", ");

    const systemPrompt = `You are leading the ${state.currentTeam}. You have access to ${state.agents.size} team members.
You can query them individually using \`query_expert\` or run multiple queries simultaneously in parallel using the highly efficient \`query_tree_researchers\` tool.
Available members: ${expertNames}

${expertCatalog}`;

    return { systemPrompt };
  });

  // ── Session Start ────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    applyExtensionDefaults(import.meta.url, ctx);

    state.widgetCtx = ctx;
    loadTeam(ctx.cwd, state.currentTeam);
    updateWidget();

    const expertNames = Array.from(state.agents.values()).map(s => displayName(s.def.name)).join(", ");
    ctx.ui.setStatus("pi-pi-tree", `Team: ${state.currentTeam}`);
    ctx.ui.notify(
      `pi-pi-tree loaded — ${state.agents.size} members in ${state.currentTeam}: ${expertNames}\n\n` +
      `/tree-team [name]      Switch teams (e.g. /tree-team pi-pi)\n` +
      `/tree-status           Show current agent status\n\n` +
      `Use the query_tree_researchers tool to use them!`,
      "info",
    );

    // Custom footer
    ctx.ui.setFooter((_t: any, theme: any, _fd: any) => ({
      dispose: () => {},
      invalidate() {},
      render(width: number): string[] {
        const model = ctx.model?.id || "no-model";
        const usage = (ctx as any).getContextUsage?.();
        const pct = usage ? usage.percent : 0;
        const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
        const bar = "#".repeat(filled) + "-".repeat(10 - filled);

        const active = Array.from(state.agents.values()).filter(a => a.status === "researching").length;
        const done = Array.from(state.agents.values()).filter(a => a.status === "done").length;

        const left = theme.fg("dim", ` ${model}`)
          + theme.fg("muted", " · ")
          + theme.fg("accent", state.currentTeam);
        const mid = active > 0
          ? theme.fg("accent", ` ◉ ${active} active`)
          : done > 0
          ? theme.fg("success", ` ✓ ${done} done`)
          : theme.fg("dim", " ○ idle");
        const right = theme.fg("dim", `[${bar}] ${Math.round(pct)}%`);

        const leftW = visibleWidth(left);
        const midW = visibleWidth(mid);
        const rightW = visibleWidth(right);
        const padLen = width - leftW - midW - rightW;
        const pad = padLen > 0 ? " ".repeat(padLen) : " ";

        return [truncateToWidth(left + mid + pad + right, width)];
      },
    }));
  });
}
