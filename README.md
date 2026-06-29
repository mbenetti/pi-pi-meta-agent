# Pi-Pi Parallel Meta-Agent Builder

A parallel multi-agent development engine for [Pi Coding Agent](https://pi.dev). Pi-Pi acts as a meta-developer: when you ask it to build an agent, extension, or theme, it spawns 5 specialized expert sub-agents in parallel, collects their fresh documentation findings and patterns, and merges them into code.

## Expert Roster

| Specialist | Domain |
|------------|--------|
| `ext-expert` | Custom tools, parameters, shortcuts, API bindings |
| `theme-expert` | Theme JSON specifications, color tokens |
| `skill-expert` | SKILL.md folder capabilities and execution safety |
| `config-expert` | Global settings, provider models, model registration |
| `tui-expert` | Scroll screens, UI boxes, inputs, editors, and buttons |

## Installation

Open your terminates with Pi and run:
```bash
pi install git:github.com/mbenetti/pi-pi-meta-agent.git
```

## Usage

Launch the extension using the file path:
```bash
pi -e extensions/pi-pi.ts
```

*This automatically loads the warm creative Rose Pine theme, establishes the active status bar widget, registers `query_expert` for parallel sub-threads, and listens for requests.*
