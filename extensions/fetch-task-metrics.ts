import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, Static } from "typebox";

// ============================================================================
// 1. SINCLAIR TYPEBOX PARAMETER VALIDATION SCHEMA
// ============================================================================

/**
 * Sinclair TypeBox parameter verification schema for the `fetch_task_metrics` custom tool.
 */
export const FetchTaskMetricsSchema = Type.Object({
  taskId: Type.Optional(Type.String({
    description: "Unique tracking ID of a specific task. If specified, retrieves detailed temporal and token metrics for that execution trace.",
    examples: ["task-8f3a3c20", "compile-and-test"],
  })),
  since: Type.Optional(Type.String({
    description: "Filters logs/metrics to those recorded after this absolute ISO timestamp or relative time notation (e.g., '15m', '2h', '1d').",
    default: "1h",
    examples: ["2026-06-30T12:00:00Z", "4h"],
  })),
  status: Type.Optional(Type.Union([
    Type.Literal("queued", { description: "Task is pending execution" }),
    Type.Literal("running", { description: "Task is currently active in the runner" }),
    Type.Literal("completed", { description: "Task successfully exited" }),
    Type.Literal("failed", { description: "Task exited with error code or timed out" }),
  ], {
    description: "Filters output metrics to only tasks that finished/exist with the specified terminal state."
  })),
  includeBreakdown: Type.Optional(Type.Boolean({
    description: "If active, reports granular per-agent performance characteristics, API call latencies, and tool usage summaries.",
    default: false
  })),
  limit: Type.Optional(Type.Integer({
    description: "Maximum number of discrete task traces or breakdown items to inspect inside the telemetry window.",
    minimum: 1,
    maximum: 100,
    default: 20
  })),
}, {
  $id: "FetchTaskMetricsSchema",
  title: "fetch_task_metrics_parameters",
  description: "Argument schema for fetch_task_metrics containing tracking constraints, time scope filters, and details parameters."
});

export type FetchTaskMetricsParams = Static<typeof FetchTaskMetricsSchema>;

// ============================================================================
// 2. PI EXTENSION REGISTRATION & MOCK CORE ENGINE
// ============================================================================

export default function (pi: ExtensionAPI) {
  
  pi.registerTool({
    name: "fetch_task_metrics",
    label: "Fetch Task Metrics",
    description: "Retrieves runtime operational metrics for tasks execution history. Supports tracking throughput, queue delays, LLM token expenditures, execution durations, and error breakdowns.",
    parameters: FetchTaskMetricsSchema,

    /**
     * Executes the task metric collection lifecycle.
     */
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // Safely parse validated input coordinates
      const { taskId, since = "1h", status, includeBreakdown = false, limit = 20 } = params as FetchTaskMetricsParams;

      // Provide real-time intermediate feedback loop
      if (onUpdate) {
        onUpdate({
          content: [{ type: "text", text: `Gathering telemetry streams for task query: scope=${taskId ?? "global"} window=${since}...` }],
          details: { status: "fetching", taskId, since }
        });
      }

      // Simulate network / database metrics fetching
      const now = new Date().toISOString();
      
      const aggregated = {
        totalTasks: taskId ? 1 : 142,
        succeeded: taskId ? 1 : 134,
        failed: taskId ? 0 : 6,
        queued: taskId ? 0 : 2,
        running: taskId ? 0 : 0,
        avgDurationMs: taskId ? 4250 : 2840,
        tokensSpent: {
          prompt: taskId ? 8400 : 842000,
          completion: taskId ? 1200 : 114000
        }
      };

      const breakdowns = includeBreakdown ? [
        { category: "Ext Expert", calls: 12, success: 11, avgLatencyMs: 4120 },
        { category: "TUI Expert", calls: 8, success: 8, avgLatencyMs: 1800 },
        { category: "Grep-Find Tool", calls: 62, success: 60, avgLatencyMs: 340 },
        { category: "Bash Tool", calls: 45, success: 42, avgLatencyMs: 2950 },
      ] : undefined;

      // Output system-level notification block
      if (ctx.ui?.notify) {
        ctx.ui.notify(`Metrics compiled: scope=${taskId ?? "global"} since=${since}`, "info");
      }

      // Build fallback presentation structure in markdown (seen in chats, non-TUI output renders)
      let markdownSummary = `### 📊 Task Operations Telemetry (${since})\n\n`;
      markdownSummary += `| Metric | Value | Details |\n`;
      markdownSummary += `| :--- | :--- | :--- |\n`;
      markdownSummary += `| **Scope** | \`${taskId ?? "Global Workspace"}\` | Analyzed total of ${aggregated.totalTasks} task records |\n`;
      markdownSummary += `| **Success Rate** | \`${((aggregated.succeeded / aggregated.totalTasks) * 100).toFixed(1)}%\` | Succeeded: ${aggregated.succeeded} / Failed: ${aggregated.failed} |\n`;
      markdownSummary += `| **Avg Latency** | \`${aggregated.avgDurationMs} ms\` | Includes network-to-runner residency margins |\n`;
      markdownSummary += `| **LLM Tokens** | \`${(aggregated.tokensSpent.prompt + aggregated.tokensSpent.completion).toLocaleString()}\` | Prompt: ${aggregated.tokensSpent.prompt.toLocaleString()} / Comp: ${aggregated.tokensSpent.completion.toLocaleString()} |\n`;

      if (breakdowns) {
        markdownSummary += `\n### 🔍 Subsystem/Agent Performance Detail\n\n`;
        markdownSummary += `| Subsystem | Execution Count | Success Rate | Average Latency |\n`;
        markdownSummary += `| :--- | :---: | :---: | :---: |\n`;
        for (const b of breakdowns) {
          const rate = ((b.success / b.calls) * 100).toFixed(0);
          markdownSummary += `| ${b.category} | ${b.calls} | ${rate}% | ${b.avgLatencyMs} ms |\n`;
        }
      }

      return {
        content: [{ type: "text", text: markdownSummary }],
        details: {
          status: "success",
          query: { taskId, since, status, limit },
          timestamp: now,
          metrics: {
            aggregated,
            breakdowns
          }
        }
      };
    },

    /**
     * Elegant UI rendering of the active tool call on screen.
     */
    renderCall(args, theme) {
      const params = args as FetchTaskMetricsParams;
      const scope = params.taskId 
        ? theme.fg("accent", `[task: ${params.taskId}]`)
        : theme.fg("dim", "[global scope]");
      
      return new Text(
        theme.fg("toolTitle", theme.bold("fetch_task_metrics ")) +
        scope +
        theme.fg("dim", " — ") +
        theme.fg("muted", `since: ${params.since || "1h"}`),
        0, 0
      );
    },

    /**
     * Exquisite UI layout displaying results differently in collapsed versus expanded mode.
     */
    renderResult(result, options, theme) {
      const details = result.details as any;
      if (!details || details.status !== "success") {
        const firstBlock = result.content?.[0];
        const errorText = (firstBlock && "text" in firstBlock) ? firstBlock.text : "Telemetry fetch failed";
        return new Text(theme.fg("error", errorText), 0, 0);
      }

      const agg = details.metrics.aggregated;
      const total = agg.totalTasks;
      const successRate = total > 0 ? Math.round((agg.succeeded / total) * 100) : 0;

      let buildOutput = theme.fg("success", `✓ Task Metrics Successfully Retrieved (since: ${details.query.since})`) + "\n" +
                        theme.fg("dim", "├─ Telemetry Scope: ") + theme.fg("accent", details.query.taskId || "Entire Workspace") + "\n" +
                        theme.fg("dim", "├─ Success Rate   : ") + theme.fg("success", theme.bold(`${successRate}%`)) + theme.fg("dim", ` (${agg.succeeded}/${total} tasks completed)`) + "\n" +
                        theme.fg("dim", "├─ LLM Token Cost : ") + theme.fg("muted", `${(agg.tokensSpent.prompt + agg.tokensSpent.completion).toLocaleString()} tokens total`) + "\n" +
                        theme.fg("dim", "└─ Average Latency: ") + theme.fg("warning", `${agg.avgDurationMs}ms`);

      if (options.expanded) {
        buildOutput += "\n\n" + theme.fg("dim", "┌── Metric Category Breakdown " + "─".repeat(24)) + "\n";
        const breakdowns = details.metrics.breakdowns;
        if (breakdowns && breakdowns.length > 0) {
          for (const item of breakdowns) {
            const itemRate = Math.round((item.success / item.calls) * 100);
            buildOutput += theme.fg("dim", `│ `) + 
                           theme.fg("accent", `${item.category.padEnd(16)}`) +
                           theme.fg("muted", ` calls:${String(item.calls).padEnd(2)} | `) +
                           theme.fg("success", ` ok:${String(itemRate).padEnd(3)}% | `) +
                           theme.fg("warning", ` latency:${item.avgLatencyMs}ms`) + "\n";
          }
        } else {
          buildOutput += theme.fg("dim", "│ Metric breakdowns was not requested or is empty.\n") +
                         theme.fg("dim", "│ Re-run with includeBreakdown=true parameter.\n");
        }
        buildOutput += theme.fg("dim", "└──" + "─".repeat(50));
      } else {
        buildOutput += "\n" + theme.fg("dim", "[expand result to view granular tool/agent categorizations and latencies]");
      }

      return new Text(buildOutput, 0, 0);
    }
  });
}
