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

## Installation

Open your terminal with Pi and run:
```bash
pi install git:github.com/mbenetti/pi-pi-meta-agent.git
```

## Usage

Launch the extension using the file path:
```bash
pi -e extensions/pi-pi-tree.ts
```

*This automatically loads the warm creative Rose Pine theme, establishes the active Tree layout widget tracking all experts in real-time, registers the `query_tree_researchers` tool for parallel execution, and listens for requests.*

## Custom Commands

- `/tree-team [name]` — Swaps or reloads the active research team (defaults to `pi-pi`)
- `/tree-status` — Outputs raw JSON-style current agent execution states and stats
