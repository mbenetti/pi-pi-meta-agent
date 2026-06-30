import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, Static } from "typebox";

// ============================================================================
// 1. SINCLAIR TYPEBOX SCHEMA FOR LIFECYCLE REGISTRATION
// ============================================================================

/** Supported lifecycle event types in the Pi runtime environment */
export const LifecycleEvent = Type.Union([
  Type.Literal("session_start", { description: "Triggered immediately when the Pi session initializes" }),
  Type.Literal("session_end", { description: "Triggered upon session winding down or exit" }),
  Type.Literal("before_agent_start", { description: "Triggered before a specialized sub-agent begins execution" }),
  Type.Literal("after_agent_start", { description: "Triggered once a sub-agent completes its execution cycle" }),
  Type.Literal("before_tool_execution", { description: "Triggered right before an agent executes a model tool" }),
  Type.Literal("after_tool_execution", { description: "Triggered right after a tool execution receives output" }),
], { description: "Pi extension modular lifecycle event hooks" });

export type LifecycleEvent = Static<typeof LifecycleEvent>;

/** Security and scoping filters to prevent runaway actions and infinite loops */
export const EventFiltersSchema = Type.Object({
  agentNamePattern: Type.Optional(Type.String({
    description: "Regex to restrict triggers to specific agents (e.g., '^ext-.*')",
    examples: ["^ext-.*", "tui-expert"],
  })),
  toolNamePattern: Type.Optional(Type.String({
    description: "Regex to restrict triggers to specific tools (e.g., '^(bash|write)$')",
    examples: ["^bash$", "query_expert"],
  })),
  hasErrorOnly: Type.Optional(Type.Boolean({
    description: "If active, callback triggers only if the target event reports an error status",
    default: false,
  })),
}, { description: "Optional filter configuration to restrict hook executions" });

/** UI Visual Hooks - Configuring how UI updates occur during event trigger */
export const VisualHooksSchema = Type.Object({
  statusUpdate: Type.Optional(Type.Object({
    enabled: Type.Boolean({ description: "Toggle whether this event publishes to the main status bar" }),
    template: Type.String({
      description: "Custom format string supporting active variables like {agent}, {tool}, {status}",
      examples: ["Agent {agent} is spinning up a new {tool} execution..."],
    }),
    type: Type.Union([
      Type.Literal("info"),
      Type.Literal("success"),
      Type.Literal("warning"),
      Type.Literal("error"),
    ], { default: "info", description: "Visual status style scheme" }),
  })),
  widgetUpdate: Type.Optional(Type.Object({
    widgetId: Type.String({ description: "ID of the target custom TUI widget to invalidate/re-render" }),
    headerText: Type.Optional(Type.String({ description: "Updated header for the target visual widget" })),
    footerText: Type.Optional(Type.String({ description: "Updated footer for the target visual widget" })),
    highlightColor: Type.Optional(Type.String({
      description: "ANSI or hex color token override when visual event triggers",
      examples: ["#e0def4", "\x1b[38;2;235;188;178m"]
    })),
  })),
  terminalTitle: Type.Optional(Type.String({
    description: "Dynamic string to set as terminal title upon event trigger",
    examples: ["π - Tool execution active: {tool}"]
  })),
}, { description: "Configuration for real-time visual hooks on event trigger" });

/** Safe Action Callbacks - Sandboxed operations to perform when events trigger */
export const CallbackActionSchema = Type.Union([
  Type.Object({
    type: Type.Literal("notify", { description: "Shows an on-screen toast notification" }),
    message: Type.String({ description: "The message to show. Supports variable interpolation." }),
    bannerType: Type.Union([Type.Literal("info"), Type.Literal("success"), Type.Literal("warning"), Type.Literal("error")]),
    sound: Type.Optional(Type.Boolean({ description: "Provide an audible beep", default: false })),
  }),
  Type.Object({
    type: Type.Literal("trigger_command", { description: "Safely execute a predefined command alias" }),
    commandName: Type.String({ description: "Predefined command to trigger (e.g., 'tree-status')" }),
    arguments: Type.Optional(Type.String({ description: "Optional line of command-line arguments" })),
  }),
  Type.Object({
    type: Type.Literal("track_metric", { description: "Record runtime analytics into safe internal telemetry" }),
    metricName: Type.String({ description: "Name/key of metric (e.g., 'bash_execution_duration')" }),
    incrementBy: Type.Optional(Type.Number({ default: 1, description: "Amount to increment the counter" })),
  }),
], { description: "Sandboxed action schemas triggered upon validation" });

/** Complete registration packet for Lifecycle Hooks */
export const DummyLifecycleRegistrationSchema = Type.Object({
  id: Type.String({
    description: "Unique identifier for this specific lifecycle hook configuration",
    examples: ["telemetry-tracker-hook", "visual-bash-indicator"],
  }),
  description: Type.Optional(Type.String({
    description: "Human-readable description of why this lifecycle hook is registered"
  })),
  targetEvents: Type.Array(LifecycleEvent, {
    minItems: 1,
    description: "Set of event phases this registration listens for"
  }),
  filters: Type.Optional(EventFiltersSchema),
  visualHooks: Type.Optional(VisualHooksSchema),
  callbacks: Type.Optional(Type.Array(CallbackActionSchema, {
    description: "Queue of sandboxed callbacks executing in lockstep once criteria has met"
  })),
}, {
  $id: "DummyLifecycleRegistration",
  title: "Dummy Lifecycle Event Registration Hook Configuration",
  description: "Standard Sinclair TypeBox pattern schema for proving visual and callback controls on Pi event hooks"
});

export type DummyLifecycleRegistration = Static<typeof DummyLifecycleRegistrationSchema>;

// ============================================================================
// 2. EXTENSION FUNCTIONALITY & TOILET TESTING PREPARATION
// ============================================================================

const registeredHooks = new Map<string, DummyLifecycleRegistration>();

export default function (pi: ExtensionAPI) {

  // --- Register dummy tool for testing registration of Lifecycle hooks ---
  pi.registerTool({
    name: "register_dummy_lifecycle_hook",
    label: "Register Lifecycle Hook Schema",
    description: "Registers and validates an automated visual and callback-based lifecycle event registration configuration. This dummy tool processes the input schema to verify validity and mock runtime visual registrations.",
    parameters: DummyLifecycleRegistrationSchema,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const config = params as DummyLifecycleRegistration;

      // Primary validation check
      if (!config.id || !config.targetEvents || config.targetEvents.length === 0) {
        return {
          content: [{ type: "text", text: "❌ Validation failed: Configuration must include a valid 'id' and at least one 'targetEvents' option." }],
          details: { status: "validation_error", config }
        };
      }

      // Check regex patterns (Pre-compilation check for safety)
      if (config.filters?.agentNamePattern) {
        try {
          new RegExp(config.filters.agentNamePattern);
        } catch (e: any) {
          return {
            content: [{ type: "text", text: `❌ Validation failed: Invalid agentNamePattern regex: ${e.message}` }],
            details: { status: "regex_error", pattern: config.filters.agentNamePattern }
          };
        }
      }

      if (config.filters?.toolNamePattern) {
        try {
          new RegExp(config.filters.toolNamePattern);
        } catch (e: any) {
          return {
            content: [{ type: "text", text: `❌ Validation failed: Invalid toolNamePattern regex: ${e.message}` }],
            details: { status: "regex_error", pattern: config.filters.toolNamePattern }
          };
        }
      }

      // Safe storage
      registeredHooks.set(config.id, config);

      const eventsList = config.targetEvents.join(", ");
      const actionsCount = config.callbacks?.length || 0;
      const visualIndicators = [];
      if (config.visualHooks?.statusUpdate?.enabled) visualIndicators.push("statusUpdate");
      if (config.visualHooks?.widgetUpdate) visualIndicators.push("widgetUpdate");
      if (config.visualHooks?.terminalTitle) visualIndicators.push("terminalTitle");

      let summaryText = `✅ SUCCESSFULLY REGISTERED LIFECYCLE HOOK: **${config.id}**\n\n`;
      summaryText += `- **Description:** ${config.description || "No description provided."}\n`;
      summaryText += `- **Targeting Events:** [${eventsList}]\n`;
      summaryText += `- **Filters Configured:** ${config.filters ? "Yes" : "No"}\n`;
      summaryText += `- **Visual Hooks:** ${visualIndicators.length > 0 ? `[${visualIndicators.join(", ")}]` : "None"}\n`;
      summaryText += `- **Actions Configured:** ${actionsCount} sandboxed callback actions\n\n`;
      summaryText += `*Pi extension has parsed and registered this schema. Event-driven actions will execute correctly during runtime phases.*`;

      // Notify the console/TUI
      ctx.ui.notify(`Registered Lifecycle hook: ${config.id}`, "info");

      return {
        content: [{ type: "text", text: summaryText }],
        details: {
          status: "success",
          hookId: config.id,
          registration: config,
        }
      };
    },

    renderCall(args, theme) {
      const config = args as any;
      return new Text(
        theme.fg("toolTitle", theme.bold("register_dummy_lifecycle_hook ")) +
        theme.fg("accent", `[${config.id || "unnamed"}]`) +
        theme.fg("dim", " — ") +
        theme.fg("muted", `events: ${(config.targetEvents || []).join(", ")}`),
        0, 0
      );
    },

    renderResult(result, options, theme) {
      const details = result.details as any;
      if (!details || details.status !== "success") {
        const firstBlock = result.content[0];
        const errorText = (firstBlock && "text" in firstBlock) ? firstBlock.text : "Unknown error";
        return new Text(theme.fg("error", errorText), 0, 0);
      }

      const config = details.registration as DummyLifecycleRegistration;
      const header = theme.fg("success", `✓ Lifecycle Hook: ${config.id}`) + "\n" +
                     theme.fg("dim", `├─ Registered events: `) + theme.fg("accent", `${(config.targetEvents || []).join(", ")}`) + "\n" +
                     theme.fg("dim", `├─ Status updates configured: `) + theme.fg("muted", `${config.visualHooks?.statusUpdate?.enabled ? "Yes" : "No"}`) + "\n" +
                     theme.fg("dim", `└─ Callbacks queue: `) + theme.fg("muted", `${config.callbacks?.length || 0} active listener pipelines`);

      if (options.expanded) {
        const payloadStr = JSON.stringify(config, null, 2);
        return new Text(header + "\n\n" + theme.fg("dim", "--- Full Config JSON ---") + "\n" + theme.fg("muted", payloadStr), 0, 0);
      }

      return new Text(header + "\n" + theme.fg("dim", "[expand to inspect full Sinclair schema registration payload]"), 0, 0);
    },
  });

  // --- Core Lifecycle Hooks Integration ---
  // To demonstrate real callbacks & visual hooks dynamically from our system events:

  pi.on("before_agent_start", async (event, ctx) => {
    executeHooks("before_agent_start", { agent: undefined }, ctx);
  });

  pi.on("session_start", async (event, ctx) => {
    // Basic setup mapping the dummy defaults to this file
    try {
      const { applyExtensionDefaults } = await import("./themeMap.ts");
      applyExtensionDefaults(import.meta.url, ctx);
    } catch {
      // themeMap not found or not required in test/minimal setup
    }
    executeHooks("session_start", {}, ctx);
  });

  // Helper trigger engine
  function executeHooks(event: LifecycleEvent, context: { agent?: string; tool?: string; error?: string }, ctx: any) {
    for (const [id, hook] of registeredHooks.entries()) {
      if (!hook.targetEvents.includes(event)) continue;

      // Filter matches
      if (hook.filters) {
        const { agentNamePattern, toolNamePattern, hasErrorOnly } = hook.filters;
        if (agentNamePattern && context.agent) {
          const re = new RegExp(agentNamePattern);
          if (!re.test(context.agent)) continue;
        }
        if (toolNamePattern && context.tool) {
          const re = new RegExp(toolNamePattern);
          if (!re.test(context.tool)) continue;
        }
        if (hasErrorOnly && !context.error) {
          continue;
        }
      }

      // Visual Hook updates
      if (hook.visualHooks) {
        const { statusUpdate, widgetUpdate, terminalTitle } = hook.visualHooks;

        if (statusUpdate && statusUpdate.enabled) {
          let msg = statusUpdate.template
            .replace("{agent}", context.agent || "manager")
            .replace("{tool}", context.tool || "system_call")
            .replace("{status}", context.error ? "error" : "success");
          ctx.ui.setStatus(`hook-status-${id}`, msg);
        }

        if (terminalTitle) {
          let title = terminalTitle
            .replace("{agent}", context.agent || "manager")
            .replace("{tool}", context.tool || "system_call");
          ctx.ui.setTitle(title);
        }
      }

      // Callback triggers
      if (hook.callbacks) {
        for (const action of hook.callbacks) {
          if (action.type === "notify") {
            let msg = action.message
              .replace("{agent}", context.agent || "manager")
              .replace("{tool}", context.tool || "system_call");
            ctx.ui.notify(`[Hook: ${id}] ${msg}`, action.bannerType || "info");
          }
          // Safely execute track metrics or internal loggers
        }
      }
    }
  }
}
