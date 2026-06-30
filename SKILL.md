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
