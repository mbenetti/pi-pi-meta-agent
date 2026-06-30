![Pi-Pi Tree Dashboard](assets/Screenshot%202026-06-30%20at%2019.53.12.png)

# Pi-Pi Tree Parallel Meta-Agent Builder

A parallel multi-agent development engine with a gorgeous tree-structured dashboard for [Pi Coding Agent](https://pi.dev). Pi-Pi acts as a meta-developer: when you ask it to build an agent, extension, or theme, it spawns 5 specialized expert sub-agents in parallel, collects their fresh documentation findings and patterns, and merges them into code.

All of these are visualised dynamically in real-time in a structured TUI Tree Layout!

## Expert Roster

| Specialist | Domain | Color Code |
|------------|--------|------------|
| `ext-expert` | Custom tools, parameters, shortcuts, API bindings | Lavender |
| `theme-expert` | Theme JSON specifications, color tokens | Rose |
| `skill-expert` | SKILL.md folder capabilities and execution safety | Gold |
| `config-expert` | Global settings, provider models, model registration | Teal |
| `tui-expert` | Scroll screens, UI boxes, inputs, editors, and buttons | Iris |

## Installation & Running

You have two convenient ways to use the Pi-Pi Tree meta-agent dashboard: either by installing it as a package, or running it locally in a cloned repository.

### Option A: Install via Pi Package Manager (Discreet & On-Demand)

This extension is configured to be **disabled by default upon installation**. This ensures your standard daily terminal chats remain clean and lightweight, allowing you to load this immersive dashboard only when you explicitly need it.

1. **Install the package:**
   ```bash
   pi install git:github.com/mbenetti/pi-pi-meta-agent.git
   ```

2. **Launch on-demand:**
   Run the executor by referencing the installed module path depending on your project type:

   * **If installed globally:**
     ```bash
     pi -e ~/.pi/agent/git/github.com/mbenetti/pi-pi-meta-agent/extensions/pi-pi-tree.ts
     ```

   * **If installed in a local workspace directory:**
     ```bash
     pi -e node_modules/pi-pi-meta-agent/extensions/pi-pi-tree.ts
     ```

---

### Option B: Local Repository Dev (Clone & Run)

If you are developing extensions, custom tools, or want to run the dashboard directly within a local clone:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/mbenetti/pi-pi-meta-agent.git
   cd pi-pi-meta-agent
   ```

2. **Run the local extension:**
   Execute directly using the local path:
   ```bash
   pi -e extensions/pi-pi-tree.ts
   ```

*This automatically loads the warm creative Rose Pine theme, establishes the active Tree layout widget tracking all experts in real-time, registers the `query_tree_researchers` tool for parallel execution, and listens for requests.*

## Custom Commands

- `/tree-team [name]` — Swaps or reloads the active research team (defaults to `pi-pi`)
- `/tree-status` — Outputs raw JSON-style current agent execution states and stats
