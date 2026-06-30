---
name: pi-pi-builder
description: Guide the orchestrator to build high-performance terminal extensions, themes, and layouts using the parallel expert agents
---

# Pi-Pi Meta Agent Builder Skill

This skill teaches the supervisor agent how to orchestrate the parallel team of pi-pi meta-experts (`ext-expert`, `theme-expert`, `skill-expert`, `config-expert`, `tui-expert`) to build, style, and structure advanced Pi coding agent components.

---

## ⚙️ Parallel Research & Orchestration Flow

When writing custom custom extensions, widgets, or commands, ALWAYS prioritize parallelized research using **`query_tree_researchers`** over sequential single-agent queries. This ensures highly deep context harvesting across multiple domains simultaneously.

### 1. Matrix Spawning (Parallel Mapping)

Break down the user's task and dispatch queries to the relevant experts:

* **Custom Tools, Command Hooks, or Lifecycle Listeners?** $\rightarrow$ Request from `ext-expert` for Sinclair TypeBox JSON schemas, parameter validation, and event hook formats.
* **Colors, Borders, or Theme JSON Mapping?** $\rightarrow$ Request from `theme-expert` for visual tokens and color harmony matching terminal styles.
* **Folder execution, permissions, binary compatibility, or safety standards?** $\rightarrow$ Request from `skill-expert` for sandboxing practices.
* **Configuration registration or `settings.json` bounds?** $\rightarrow$ Request from `config-expert`.
* **Footer/Header layouts, selection scroll boxes, dynamic widgets, or editors?** $\rightarrow$ Request from `tui-expert`.

### 2. Multi-Expert Query Example

If a user requests: *"Build a git issue tracker extension with a scrollable TUI list panel and cozy dark rose colors."*
You should immediately call `query_tree_researchers` in parallel:

```json
{
  "queries": [
    {
      "agent": "ext-expert",
      "question": "What are the best practices and parameter schemas (using Sinclair TypeBox if required) for registering a custom tool to fetch git issue details from a shell repo? Provide TypeScript tool definition code."
    },
    {
      "agent": "tui-expert",
      "question": "How do we render a scrollable list selection widget (SelectList or scroll window) inside a Pi layout? Provide complete TypeScript rendering functions and input handler standards."
    },
    {
      "agent": "theme-expert",
      "question": "Which visual theme tokens inside themes/*.json control borders, list selection highlights, and muted text for a cozy dark rose terminal? Provide a JSON theme snip matching these tones."
    }
  ]
}
```

---

## 🛠️ Code Merging & Synthesis Guidelines

Once sub-agents return their results:
1. **Never Dump Bloated Outputs into main context:** Keep your summaries in the manager turn context compact, letting the detail expand in the TUI tree naturally.
2. **Merge Experts Harmoniously:** Synthesize the parameters and tools from `ext-expert`, the visual layout wrappers from `tui-expert`, and the bootstrap theme configs from `theme-expert` into a single, cohesive modular file under `extensions/` or `themes/`.
3. **Set Theme Assignment Default:** Integrate the custom theme in `extensions/themeMap.ts` using `applyExtensionDefaults(import.meta.url, ctx)` to automatically apply the proper aesthetic on initialization.

---

## 🧪 Validation & Verification Routine

To verify any newly produced extension or layout:
1. Stage the file to `extensions/<name>.ts`.
2. run a dry verification using non-interactive print mode:
   ```bash
   pi -e extensions/<name>.ts -p "hello"
   ```
3. Fix any TypeScript interface, type, or parameter inconsistencies identified.

## 🛡️ Tool Safety Parameter Verification Checklist

When building or updating custom tools within this extension, the **skill-expert** guidelines require that all parameters and execution patterns be checked against this safety checklist to prevent runtime errors, security issues, or privilege escalations:

- [ ] **Strict Schema Validation (TypeBox / Run-time Constraints)**
  - Is the parameter schema fully typed using Sinclair TypeBox (or runtime TypeScript assertion guards)?
  - Are bounds established on free-form text params (e.g., standard regex patterns, strict character length restrictions via `minLength`/`maxLength`)?
  - Are unknown keys or unexpected properties rejected at the tool entry point?

- [ ] **Directory Boundary & Path Traversal Shields**
  - Do paths received as parameters undergo normalization (`path.normalize`, `path.resolve`) before execution?
  - Is there an explicit check verifying that the resolved target directory remains strictly within the workspace folder or the designated repository root (e.g., `resolvedPath.startsWith(workspaceRoot)`)?
  - Are directory traversal attempts (e.g., `..`, relative paths escaping the sandbox) cleanly caught and rejected?

- [ ] **Command & Shell Injection Mitigation**
  - Is the use of raw shell interpreters (`child_process.exec`) avoided? Prefer argument-array APIs (`child_process.spawn` or `execFile`) to prevent parameter passing through a shell prompt parsing.
  - If dynamic execution is unavoidable, are all string arguments sanitised or fully shell-escaped (neutralizing characters such as `;`, `&`, `|`, `` ` ``, `$()`, and redirection operators)?
  - Are inputs matching a filepath pattern validated to ensure they actually correspond to physical files rather than inline commands?

- [ ] **System Binaries & Dependency Availability Checks**
  - Does the tool verify that any external binary it depends on (e.g., `git`, `fd`, `rg`) exists and is accessible before calling it? (Verify using a non-blocking `which` lookup or node-based environment check).
  - Are graceful, context-sensitive error messages displayed if a required system dependency is missing, instead of leaking raw call-stack or shell errors?

- [ ] **Script Permission & Path Privilege Safeguards**
  - If the tool invokes shell scripts locally, does it verify executable permissions first (e.g., checking `fs.constants.X_OK`)?
  - Are file writes restricted from modifying protected operational scripts, `.git` configs, or executable binaries within the repository without explicit permission?
  - If a script is dynamically written or executed, is its shebang verified, and is execution isolated to temporary directories?


## 💎 Tool Output Parameter Compliance Checklist

When registering or updating custom tools within this extension, all tool execution return payloads and terminal rendering layouts must strictly comply with the following compliance and structured formatting rules:

- [ ] **Structured Payload Separation (`content` vs. `details`)**
  - Does the tool's execute() hook return a strictly typed object containing exactly a `content` array and a `details` object?
  - Is `content` formatted as an array of message blocks with `type: "text"` containing a human-readable string summary?
  - Is `details` a flat or structured programmatic payload meant for machine/subsequent tool consumption?
  - Are raw, bare string or bare JSON array returns avoided, preventing upstream orchestrator crashes?

- [ ] **Robust Error & Exception Serialization**
  - Is the entire tool execution block wrapped in a safe standard try-catch block?
  - When an error is caught, does the tool output gracefully return `status: "error"` within the `details` object instead of throwing or bubbling up the exception?
  - Are exceptions fully serialized to plain strings? (Ensure no circular references, non-serializable Error objects, or giant stack traces are dumped into `details`).
  - Are internal system-specific Absolute Paths (e.g., `/app/workspace/secrets/...`) or credentials sanitized or stripped from error logs and content blocks before returning?

- [ ] **Fallback Markdown Representation Compatibility**
  - Is the string content in the `content` array rich enough to act as an aesthetic fallback for standard terminal chats and non-interactive logs?
  - Is the markdown well-structured, utilizing tables, bulleted lists, headers, and code fences where appropriate to represent output records?
  - Is the human-readable text free of hardcoded raw ANSI escapes, carriage returns, or cursor movement codes that could clutter clean markdown rendering environments?

- [ ] **Rich Telemetry, Metadata & State Preservation**
  - Does `details` include the critical query context (e.g., returning input filters, parameters as a standard block like `query` or `params` metadata)?
  - Is a standardized `status` flag (such as `success`, `error`, `done`, or `aborted`) present on the root of the `details` object?
  - Are telemetry markers (such as execution duration/elapsed time in milliseconds, status codes, query counts, and accurate timestamps) returned inside `details` for metrics logging?

- [ ] **Double-State TUI Component Rendering (`renderCall` & `renderResult`)**
  - Do tools implement a complete custom interactive render design with both `renderCall(args, theme)` and `renderResult(result, options, theme)` hooks?
  - Does `renderResult` elegantly handle collapsible layout states using the `options.expanded` flag?
    - **Collapsed Mode (`options.expanded === false`):** Displays a brief, high-contrast, inline status summary line (e.g., `✓ Task Metrics Successfully Retrieved`).
    - **Expanded Mode (`options.expanded === true`):** Beautifully prints comprehensive breakdowns, structured tables, and detailed nested lists using box-drawing characters and alignment helpers.
  - Are standard theme utility calls (e.g., `theme.fg(...)`, `theme.bold(...)`) consistently used instead of hardcoded raw terminal color codes to maintain theme compatibility (e.g. cozy dark rose or classic themes)?
