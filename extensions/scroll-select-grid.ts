import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Theme } from "@earendil-works/pi-coding-agent";
import { Component, TUI, visibleWidth, truncateToWidth, Text } from "@earendil-works/pi-tui";
import { getKeybindings } from "@earendil-works/pi-tui";
import { Type, Static } from "typebox";

// ============================================================================
// 1. DATA MODELS & TYPEBOX PARAMETER SCHEMAS
// ============================================================================

/** Data item schema representing options selectable via the Scroll Layout Grid */
export interface GridSelectItem {
  value: string;
  label: string;
  category?: string;
  description?: string;
  details?: string;
  tags?: string[];
}

/** TUI Grid layout configuration metadata options */
export interface ScrollSelectGridOptions {
  title?: string;
  leftPaneRatio?: number; // Ratio of left pane size (e.g. 0.4 for 40%)
  maxHeight?: number;     // Maximum static height for custom window
}

/** Sinclair TypeBox Schema for safe trigger of item selection widget */
export const SelectionGridToolSchema = Type.Object({
  title: Type.Optional(Type.String({
    description: "Header title printed above the Split Grid",
    default: "Pi Operations Selection Control Panel",
    examples: ["Package Module Installer", "Specialized Agent Selector"],
  })),
  categoryFilter: Type.Optional(Type.String({
    description: "Initial group/category filter to restrict options",
    examples: ["tui", "extensions", "themes"],
  })),
  items: Type.Array(
    Type.Object({
      value: Type.String({ description: "Unique item code value identifier" }),
      label: Type.String({ description: "Friendly name displayed prominently in lists" }),
      category: Type.Optional(Type.String({ description: "Grouping tier context categorizations" })),
      description: Type.Optional(Type.String({ description: "Single-line summary displayed alongside value" })),
      details: Type.Optional(Type.String({ description: "Rich details shown in the Preview pane" })),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Quick metadata badges" })),
    }),
    {
      description: "Array of selectable elements built directly into the scroll list",
      minItems: 1,
    }
  ),
}, {
  $id: "SelectionGridToolSchema",
  title: "select_item_from_grid",
  description: "Prompt-driven interactive TUI grid workspace tool. Spawns full-screen multi-pane selection list viewport.",
});

export type SelectionGridToolParams = Static<typeof SelectionGridToolSchema>;

// ============================================================================
// 2. PRODUCTION WIDGET COMPONENT IMPLEMENTATION (SCROLL SELECT GRID)
// ============================================================================

/**
 * ScrollSelectGridComponent
 *
 * A stateful terminal split-pane list widget. It implements the standard Component
 * interface of `@earendil-works/pi-tui` and delivers:
 *   - Grid pane split rendering responsive to viewport changes.
 *   - Real-time search/fuzzy filter workspace overlay.
 *   - Boundary paging and viewport offset clamping.
 *   - Built-in ASCII vertical scrollbar rendering.
 *   - Rose Pine matching theme aesthetics.
 */
export class ScrollSelectGridComponent implements Component {
  private allItems: GridSelectItem[] = [];
  private filteredItems: GridSelectItem[] = [];
  
  private selectedIndex = 0;
  private scrollOffset = 0;
  
  private searchQuery = "";
  public isSearching = false;
  
  private title: string;
  private leftPaneRatio: number;
  private maxHeight: number;
  private theme: any;
  
  private callbackOnSelect?: (item: GridSelectItem) => void;
  private callbackOnCancel?: () => void;

  constructor(
    items: GridSelectItem[],
    options: ScrollSelectGridOptions = {},
    theme: any,
    onSelect?: (item: GridSelectItem) => void,
    onCancel?: (this: void) => void
  ) {
    this.allItems = items;
    this.filteredItems = [...items];
    this.title = options.title || " Pi selection grid ";
    this.leftPaneRatio = typeof options.leftPaneRatio === "number" ? options.leftPaneRatio : 0.45; // 45% left pane default
    this.maxHeight = typeof options.maxHeight === "number" ? options.maxHeight : 16;           // Fits nicely on standard terminals
    
    // --- AUTOMATED INITIAL BOUNDARY CHECKS IN CONSTRUCTOR ---
    this.maxHeight = Math.max(5, this.maxHeight);
    this.leftPaneRatio = Math.max(0.05, Math.min(0.95, this.leftPaneRatio));
    
    this.theme = theme;
    this.callbackOnSelect = onSelect;
    this.callbackOnCancel = onCancel;
  }

  /**
   * Filter initial array list down matching current search sequence
   */
  private filterItems(): void {
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) {
      this.filteredItems = [...this.allItems];
    } else {
      this.filteredItems = this.allItems.filter(
        item => 
          item.label.toLowerCase().includes(q) || 
          item.value.toLowerCase().includes(q) || 
          (item.category && item.category.toLowerCase().includes(q))
      );
    }
    // Safe index adjustments
    this.selectedIndex = 0;
    this.scrollOffset = 0;
  }

  public invalidate(): void {
    // Stateless cleanup if cached lines existed
  }

  // Helper to construct spaces or padding
  private padLine(text: string, width: number, filler = " "): string {
    const visualLen = visibleWidth(text);
    if (visualLen === width) return text;
    if (visualLen > width) {
      return truncateToWidth(text, width, "...");
    }
    return text + filler.repeat(width - visualLen);
  }

  /**
   * Helper to build visual segment of an exact width to prevent layout overflow/underflow errors on labels.
   */
  private buildBorderSegmentWithColor(
    label: string, 
    targetWidth: number, 
    labelPainter: (t: string) => string, 
    barPainter: (t: string) => string, 
    padChar = "─"
  ): string {
    const minPadding = 4;
    const labelLen = visibleWidth(label);
    
    if (targetWidth <= 0) {
      return "";
    }
    
    if (targetWidth < minPadding + 4) {
      return barPainter(padChar.repeat(targetWidth));
    }
    
    if (labelLen + minPadding > targetWidth) {
      const truncatedLabel = truncateToWidth(label, targetWidth - minPadding, "..");
      const tLen = visibleWidth(truncatedLabel);
      const rightBarLen = Math.max(0, targetWidth - 2 - tLen);
      return barPainter(padChar.repeat(2)) + labelPainter(truncatedLabel) + barPainter(padChar.repeat(rightBarLen));
    } else {
      const rightBarLen = Math.max(0, targetWidth - 2 - labelLen);
      return barPainter(padChar.repeat(2)) + labelPainter(label) + barPainter(padChar.repeat(rightBarLen));
    }
  }

  /**
   * Composite grid render layout
   */
  public render(width: number): string[] {
    const lines: string[] = [];
    
    // ────────────────────────────────────────────────────────────────────────
    // 1. AUTOMATED HEIGHT BOUNDARY CHECKS
    // ────────────────────────────────────────────────────────────────────────
    // Total Height is calculated based on available content height:
    // The structural frame has: Header(1) + SearchBar(1) + Divider(1) + Footer(1) = 4 lines.
    // Ensure gridHeight is at least 5 so bodyHeight is at least 1, avoiding negative height calculations.
    const gridHeight = Math.max(5, this.maxHeight);
    const bodyHeight = Math.max(1, gridHeight - 4);
    
    // ────────────────────────────────────────────────────────────────────────
    // 2. AUTOMATED WIDTH BOUNDARY CHECKS & PROPORTIONAL PANE SPLITS
    // ────────────────────────────────────────────────────────────────────────
    // The borders and central divider consume exactly 3 columns (│ left_col │ right_col │).
    // Clamp actual width to ensure at least 10 printable character columns are available (minimum width 13).
    const actualWidth = Math.max(13, width);
    const availableWidth = actualWidth - 3; // Space left for printable columns
    
    // Proportional division with ratio clamped between 10% and 90%
    const safeRatio = Math.max(0.1, Math.min(0.9, this.leftPaneRatio));
    let leftColWidth = Math.floor(availableWidth * safeRatio);
    
    // Enforce reasonable boundaries so that neither column is collapsed to single-digit or empty space.
    // Minimum column width is 5 characters for both panes.
    const minLeftCol = 5;
    const minRightCol = 5;
    
    if (leftColWidth < minLeftCol) {
      leftColWidth = Math.min(availableWidth, minLeftCol);
    }
    if (availableWidth - leftColWidth < minRightCol) {
      leftColWidth = Math.max(0, availableWidth - minRightCol);
    }
    
    // Ensure final clamp respects total available content width bounds
    leftColWidth = Math.max(0, Math.min(availableWidth, leftColWidth));
    
    // Subtract to guarantee mathematically conservation of width:
    // (1 left border + leftColWidth) + (1 center divider + rightColWidth) + (1 right border) = actualWidth
    const rightColWidth = availableWidth - leftColWidth;

    // ────────────────────────────────────────────────────────────────────────
    // 3. SCROLL OFFSETS & INDEX ALIGNMENTS BOUNDS CHECKS
    // ────────────────────────────────────────────────────────────────────────
    const total = this.filteredItems.length;
    
    if (this.selectedIndex < 0) {
      this.selectedIndex = 0;
    } else if (this.selectedIndex >= total && total > 0) {
      this.selectedIndex = total - 1;
    }

    // Scroll offset positioning adjustments
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + bodyHeight) {
      this.scrollOffset = this.selectedIndex - bodyHeight + 1;
    }

    // Double-check offset overflow constraints
    const maxOffset = Math.max(0, total - bodyHeight);
    if (this.scrollOffset > maxOffset) {
      this.scrollOffset = maxOffset;
    }
    if (this.scrollOffset < 0) {
      this.scrollOffset = 0;
    }

    // Safe color formatting helpers
    const paintBorder = (char: string) => this.theme.fg("borderAccent", char);
    const paintMuted = (text: string) => this.theme.fg("muted", text);
    const paintDim = (text: string) => this.theme.fg("dim", text);

    // ────────────────────────────────────────────────────────────────────────
    // DRAW BORDER HEADER ROW
    // ────────────────────────────────────────────────────────────────────────
    // Looks like: ┌──── SELECT MODULE ────┬──────────────────────────────────────┐
    const headerTitleLeft = ` ${this.title.toUpperCase()} `;
    
    // Utilize safe builder segment to prevent any overflow or negative repeat padding bugs
    const leftBars = this.buildBorderSegmentWithColor(
      headerTitleLeft, 
      leftColWidth, 
      (t) => paintBorder(t), 
      (b) => paintBorder(b)
    );
    
    const rightBars = "─".repeat(rightColWidth);
    
    const borderHeader = paintBorder("┌") + 
                         leftBars + 
                         paintBorder("┬") + 
                         paintBorder(rightBars) + 
                         paintBorder("┐");
    lines.push(borderHeader);

    // ────────────────────────────────────────────────────────────────────────
    // DRAW SEARCH INPUT & METADATA BAR
    // ────────────────────────────────────────────────────────────────────────
    const searchStatusLabel = this.isSearching 
      ? ` 🔎 Find: ${this.searchQuery}_` 
      : this.searchQuery 
        ? ` 🔎 Find: ${this.searchQuery} ` 
        : ` (Press '/' to Search list...) `;

    const leftSearchField = this.isSearching 
      ? this.theme.fg("accent", this.padLine(searchStatusLabel, leftColWidth))
      : paintMuted(this.padLine(searchStatusLabel, leftColWidth));

    const previewBannerText = " SELECTION DATA VIEW ";
    const rightPreviewLabel = paintDim(this.padLine(`  ${previewBannerText}`, rightColWidth));

    const searchRow = paintBorder("│") + 
                      leftSearchField + 
                      paintBorder("│") + 
                      rightPreviewLabel + 
                      paintBorder("│");
    lines.push(searchRow);

    // Divider: ├───────────────────┼────────────────────────┤
    const middleDivider = paintBorder("├") + 
                          paintBorder("─".repeat(leftColWidth)) + 
                          paintBorder("┼") + 
                          paintBorder("─".repeat(rightColWidth)) + 
                          paintBorder("┤");
    lines.push(middleDivider);

    // ────────────────────────────────────────────────────────────────────────
    // DRAW LIST ITEMS & DETAILED DESCRIPTION PANEL GUTS
    // ────────────────────────────────────────────────────────────────────────
    const selectedItem = total > 0 ? this.filteredItems[this.selectedIndex] : null;

    // Pre-parse the right-hand details lines
    const rightPanelLines: string[] = [];
    if (selectedItem) {
      rightPanelLines.push(this.theme.fg("accent", ` 🎯 Label: `) + selectedItem.label);
      rightPanelLines.push(paintMuted(` 📦 Value: `) + selectedItem.value);
      if (selectedItem.category) {
        rightPanelLines.push(paintMuted(` 📂 Class: `) + selectedItem.category);
      }
      if (selectedItem.tags && selectedItem.tags.length > 0) {
        const tagText = selectedItem.tags.map(t => `[${t}]`).join(" ");
        rightPanelLines.push(paintMuted(` 🏷️ Tags : `) + this.theme.fg("warning", tagText));
      }
      rightPanelLines.push(paintBorder("─".repeat(rightColWidth)));
      
      // Multi-line detailed explanation
      const richDetails = selectedItem.details || selectedItem.description || "(No documents found)";
      const rawDetailLines = richDetails.split(/\n/);
      for (const rawLine of rawDetailLines) {
        // Safe wrap line
        if (visibleWidth(rawLine) <= rightColWidth - 2) {
          rightPanelLines.push(`  ${rawLine}`);
        } else {
          // split
          let content = rawLine;
          while (content.length > 0) {
            // Guard cutAt to be strictly positive to prevent infinite loops of size 0 slicing!
            const cutAt = Math.max(1, rightColWidth - 4);
            const piece = content.slice(0, cutAt);
            rightPanelLines.push(`  ${piece}`);
            content = content.slice(cutAt);
          }
        }
      }
    } else {
      rightPanelLines.push(paintMuted("  Select an item on the left pane"));
    }

    // Loop through the layout body
    for (let indexIdx = 0; indexIdx < bodyHeight; indexIdx++) {
      const itemIndex = this.scrollOffset + indexIdx;
      
      // LEFT PANE COLUMN RENDER
      let leftPaneContentStr = "";
      if (itemIndex < total) {
        const item = this.filteredItems[itemIndex];
        const isCurrent = itemIndex === this.selectedIndex;
        const prefix = isCurrent ? "→ " : "  ";
        const bulletText = item.category ? `[${item.category}] ` : "";
        const rawContent = `${prefix}${bulletText}${item.label}`;

        if (isCurrent) {
          // Apply cozy highlighted rose selections background
          leftPaneContentStr = this.theme.fg("bgPink", this.padLine(` ${rawContent}`, leftColWidth));
        } else {
          leftPaneContentStr = this.padLine(`  ${bulletText}${item.label}`, leftColWidth);
          // Highlight categories nicely
          if (item.category) {
            leftPaneContentStr = leftPaneContentStr.replace(bulletText, this.theme.fg("accent", bulletText));
          }
        }
      } else {
        leftPaneContentStr = this.padLine("", leftColWidth);
      }

      // INTEGRATE CUSTOM SLIDER BAR ON LEFT COLUMN EDGE
      // We calculate dynamic coordinate boundaries
      const scrollBarTrackWidth = 1;
      // Guard leftColContentWidth to prevent negative truncation parameters
      const leftColContentWidth = Math.max(0, leftColWidth - scrollBarTrackWidth);

      if (total > bodyHeight && bodyHeight > 0) {
        // Math proportional mapping for vertical scrollbar
        // Clamped inside safe structural bounds to prevent division by zero or negative size boundaries
        const barHeight = Math.max(1, Math.min(bodyHeight, Math.floor((bodyHeight / total) * bodyHeight)));
        const maxScrollIdx = Math.max(1, total - bodyHeight);
        
        const scrollPercent = Math.max(0, Math.min(1, this.scrollOffset / maxScrollIdx));
        const trackRemaining = bodyHeight - barHeight;
        const barStartOffset = Math.max(0, Math.min(trackRemaining, Math.round(scrollPercent * trackRemaining)));

        const isBarPosition = indexIdx >= barStartOffset && indexIdx < barStartOffset + barHeight;
        const barCharacter = isBarPosition ? paintBorder("█") : paintDim("░");
        
        leftPaneContentStr = truncateToWidth(leftPaneContentStr, leftColContentWidth) + barCharacter;
      }

      // RIGHT PANE COLUMN RENDER
      let rightPaneContentStr = "";
      if (indexIdx < rightPanelLines.length) {
        rightPaneContentStr = this.padLine(rightPanelLines[indexIdx], rightColWidth);
      } else {
        rightPaneContentStr = this.padLine("", rightColWidth);
      }

      // Combine column splits
      const combinedBodyRow = paintBorder("│") + 
                             leftPaneContentStr + 
                             paintBorder("│") + 
                             rightPaneContentStr + 
                             paintBorder("│");
      lines.push(combinedBodyRow);
    }

    // ────────────────────────────────────────────────────────────────────────
    // DRAW BOTTOM BOUNDARY BORDER ROW
    // ────────────────────────────────────────────────────────────────────────
    // Row looks like: └────────────────────┴───────────────────────────────────┘
    const boundsMarkerText = total > 0 ? ` [${this.selectedIndex + 1}/${total}] ` : " [Empty] ";
    
    // Utilize safe segment builder to prevent bounds overflow on small widths
    const bottomBarsLeft = this.buildBorderSegmentWithColor(
      boundsMarkerText, 
      leftColWidth, 
      (t) => paintDim(t), 
      (b) => paintBorder(b)
    );
    
    const bottomBarsRight = "─".repeat(rightColWidth);
    
    const borderBottom = paintBorder("└") + 
                         bottomBarsLeft + 
                         paintBorder("┴") + 
                         paintBorder(bottomBarsRight) + 
                         paintBorder("┘");
    lines.push(borderBottom);

    return lines;
  }

  /**
   * Handle interactive keystrokes
   */
  public handleInput(keyData: string): void {
    const kb = getKeybindings();

    // ────────────────────────────────────────────────────────────────────────
    // ACTIVE INPUT SEARCH FILTER KEY ACTIONS
    // ────────────────────────────────────────────────────────────────────────
    if (this.isSearching) {
      if (keyData === "\r" || keyData === "\n" || kb.matches(keyData, "tui.select.confirm")) {
        // Exit search bar mode on confirmation
        this.isSearching = false;
        return;
      }
      
      if (keyData === "\u001b" || kb.matches(keyData, "tui.select.cancel")) {
        // Deactivate filtering
        this.isSearching = false;
        if (this.searchQuery) {
          this.searchQuery = "";
          this.filterItems();
        }
        return;
      }

      if (keyData === "\x7f" || keyData === "\b") {
        // Character removals
        if (this.searchQuery.length > 0) {
          this.searchQuery = this.searchQuery.slice(0, -1);
          this.filterItems();
        }
        return;
      }

      // Append standard printable keys to fuzzy queries
      if (keyData.length === 1 && keyData.charCodeAt(0) >= 32 && keyData.charCodeAt(0) < 127) {
        this.searchQuery += keyData;
        this.filterItems();
        return;
      }
      return;
    }

    // ────────────────────────────────────────────────────────────────────────
    // COZY SELECTION LIST NAVIGATION KEY ACTIONS
    // ────────────────────────────────────────────────────────────────────────
    const total = this.filteredItems.length;
    const step = Math.max(1, this.maxHeight - 4);

    if (kb.matches(keyData, "tui.select.up") || keyData === "k" || keyData === "\u001b[A") {
      this.selectedIndex = this.selectedIndex <= 0 ? Math.max(0, total - 1) : this.selectedIndex - 1;
    } 
    else if (kb.matches(keyData, "tui.select.down") || keyData === "j" || keyData === "\u001b[B") {
      this.selectedIndex = this.selectedIndex >= total - 1 ? 0 : this.selectedIndex + 1;
    } 
    else if (kb.matches(keyData, "tui.select.pageUp") || keyData === "\u001b[5~") {
      this.selectedIndex = Math.max(0, this.selectedIndex - step);
    } 
    else if (kb.matches(keyData, "tui.select.pageDown") || keyData === "\u001b[6~") {
      this.selectedIndex = Math.min(Math.max(0, total - 1), this.selectedIndex + step);
    } 
    else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\r" || keyData === "\n" || keyData === " ") {
      const selected = this.filteredItems[this.selectedIndex];
      if (selected && this.callbackOnSelect) {
        this.callbackOnSelect(selected);
      }
    } 
    else if (kb.matches(keyData, "tui.select.cancel") || keyData === "\u001b" || keyData === "q") {
      if (this.callbackOnCancel) {
        this.callbackOnCancel();
      }
    } 
    else if (keyData === "/" || keyData === "f") {
      // Enter interactive filter mode
      this.isSearching = true;
    }
  }

  public getSelectedItem(): GridSelectItem | null {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.filteredItems.length) {
      return this.filteredItems[this.selectedIndex];
    }
    return null;
  }
}

// ============================================================================
// 3. PI EXTENSION REGISTRATION HOOKS & DOCK COMMANDS
// ============================================================================

const MOCK_OPTIONS_STORE: GridSelectItem[] = [
  {
    value: "ext-expert-spec",
    label: "Extension Tool Specifier",
    category: "Experts",
    tags: ["typescript", "validation", "typebox"],
    description: "Builds custom registered extension tools and Sinclair validator schemas.",
    details: "Coordinates with sub-agents to generate strict typebox properties, handles validations, registers commands and action callback blocks dynamically."
  },
  {
    value: "theme-expert-spec",
    label: "Rose Pine Theme Builder",
    category: "Experts",
    tags: ["colors", "ansi", "rose-pine"],
    description: "Applies warm rose, gold, and foam design tokens to elements.",
    details: "Coordinates high-fidelity color design, sets up select selection highlighted tags, configures dim/muted comments, and customizes window frame colors."
  },
  {
    value: "tui-expert-spec",
    label: "Terminal UI layout coordinator",
    category: "Experts",
    tags: ["layout", "grids", "windows"],
    description: "Splits screen containers responsive to sizes, handles grids and editors.",
    details: "Arranges multi-column split panes on terminal, sets up interactive scroll limits, handles keyboard events, customizes text wrap to visual limits."
  },
  {
    value: "git-issue-fetcher",
    label: "Git issues telemetry analyzer",
    category: "Tools",
    tags: ["telemetry", "git", "bash"],
    description: "Spawns git repository probes to aggregate issues pipeline.",
    details: "Executes bash subprocess triggers safely in workspace folders to fetch and structure active issue tracking reports, and pushes metrics directly, ensuring trust."
  },
  {
    value: "session-history-replay",
    label: "Subagent event tracker replay",
    category: "Tools",
    tags: ["session", "telemetry", "replay"],
    description: "Loads and steps through stored event streams step by step.",
    details: "Loads stored model execution turn arrays from internal logs, formats prompt histories, and visualizes token expenditures cleanly."
  },
  {
    value: "cozy-terminal-border",
    label: "Duo border highlight widget",
    category: "Borders",
    tags: ["widget", "ansi", "ascii"],
    description: "Double border panel coordinator matching winter rose palettes.",
    details: "Uses advanced Unicode boundary boxes to group multi-agent terminals side-by-side, adding shadow overlays and blinking cursors."
  }
];

export default function (pi: ExtensionAPI) {

  // --- 1. Register interactive selection grid tool ---
  pi.registerTool({
    name: "select_item_from_grid",
    label: "Select Option from Grid Interface",
    description: "Opens an interactive terminal selection pane representing options in a multi-column layout grid. Ideal for prompt selection queries.",
    parameters: SelectionGridToolSchema,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const toolParams = params as SelectionGridToolParams;
      const items = toolParams.items as GridSelectItem[];
      const title = toolParams.title || " Pi selection grid ";

      if (!ctx.ui || !ctx.hasUI) {
        return {
          content: [{ type: "text", text: `❌ Interactive TUI mode required to load selection list.` }],
          details: { status: "no_terminal_ui" }
        };
      }

      ctx.ui.notify("Loading interactive Split Scroll Selection list grid...", "info");

      // Spawn custom interactive TUI dialog overlay
      const choice = await ctx.ui.custom<GridSelectItem | null>(
        (tui: any, theme: any, keybindings: any, done: (result: GridSelectItem | null) => void) => {
          
          const component = new ScrollSelectGridComponent(
            items,
            { title, maxHeight: 15, leftPaneRatio: 0.4 },
            theme,
            (selected) => {
              ctx.ui.notify(`Selected choice finalized: ${selected.label}`, "info");
              done(selected);
            },
            () => {
              ctx.ui.notify(`Selection session cancelled by user.`, "warning");
              done(null);
            }
          );

          // Force input handler state tracking
          return component;
        },
        {
          overlay: true,
          overlayOptions: {
            width: "85%",
            maxHeight: 15,
            anchor: "center"
          }
        }
      );

      if (!choice) {
        return {
          content: [{ type: "text", text: "⚠️ Grid list selection process exited with no option finalized." }],
          details: { status: "cancelled" }
        };
      }

      return {
        content: [{ type: "text", text: `✅ finalize option: **${choice.label}** (\`${choice.value}\`)\n\n- **Summary:** ${choice.description || "(No description)"}` }],
        details: { status: "success", selection: choice }
      };
    },

    renderCall(args, theme) {
      const params = args as SelectionGridToolParams;
      return new Text(
        theme.fg("toolTitle", theme.bold("select_item_from_grid ")) +
        theme.fg("accent", `[items count: ${params.items?.length || 0}]`) +
        theme.fg("dim", " — ") +
        theme.fg("muted", params.title || "Selection Workspace"),
        0, 0
      );
    },

    renderResult(result, options, theme) {
      const details = result.details as any;
      if (!details || details.status !== "success") {
        const firstBlock = result.content[0];
        const errorText = (firstBlock && "text" in firstBlock) ? firstBlock.text : "Selection exited.";
        return new Text(theme.fg("warning", errorText), 0, 0);
      }
      const choice = details.selection as GridSelectItem;
      return new Text(
        theme.fg("success", `✓ Grid selection item finalized`) + "\n" +
        theme.fg("dim", `├─ Code Identifier : `) + theme.fg("accent", choice.value) + "\n" +
        theme.fg("dim", `├─ Visual Label    : `) + theme.bold(choice.label) + "\n" +
        theme.fg("dim", `└─ Description Summary: `) + theme.fg("muted", choice.description || ""),
        0, 0
      );
    }
  });

  // --- 2. Create interactive custom Slash command ---
  pi.registerCommand("grid-select", {
    description: "Launch cozy live split-pane interactive selection layout simulation with keyboard controls.",
    handler: async (args, ctx) => {
      if (!ctx.ui) {
        ctx.shutdown();
        return;
      }

      ctx.ui.notify("Starting cozy layout grid workspace selection simulation...", "info");

      // Custom dialog launch
      const finalized = await ctx.ui.custom<GridSelectItem | null>(
        (tui: any, theme: any, keybindings: any, done: (result: GridSelectItem | null) => void) => {
          ctx.ui.notify("Grid container online. Press '↑' / '↓' to select, '/' to filter values, 'Enter' to confirm.", "info");
          
          return new ScrollSelectGridComponent(
            MOCK_OPTIONS_STORE,
            {
              title: " Rose Pine Selection Console ",
              maxHeight: 16,
              leftPaneRatio: 0.45
            },
            theme,
            (selected) => done(selected),
            () => done(null)
          );
        },
        {
          overlay: true,
          overlayOptions: {
            width: "85%",
            maxHeight: 16,
            anchor: "center"
          }
        }
      );

      if (finalized) {
        ctx.ui.notify(`Simulation finished: Committed [${finalized.label}] perfectly!`, "info");
      } else {
        ctx.ui.notify("Simulation finished: selection dialogue dismissed with no final code choice.", "warning");
      }
    }
  });

  // --- 3. Dynamic Footer hook injection for interactive hints ---
  pi.on("session_start", async (event, ctx) => {
    ctx.ui.notify("π Scroll Selection Grid active. Type `/grid-select` to launch interactive simulation! ", "info");

    // Override and setup a custom footer showing key clues responsive to layout grid state
    ctx.ui.setFooter((tui: any, theme: any, footerData: any) => ({
      dispose: () => {},
      invalidate() {},
      render(width: number): string[] {
        const leftNotes = theme.fg("accent", " π Selection Panel ") + theme.fg("dim", " │ ");
        const hotkeys = theme.bold("↑↓") + theme.fg("dim", " Scroll ") +
                        theme.bold("/") + theme.fg("dim", " Search/Filter ") +
                        theme.bold("Enter") + theme.fg("dim", " Select ") +
                        theme.bold("Esc") + theme.fg("dim", " Dismiss ");
        
        const usage = ctx.getContextUsage?.();
        const tokensSpentStr = usage ? `[Cost: ${Math.round(usage.percent)}% Used]` : "";
        const rightNotes = theme.fg("muted", tokensSpentStr);

        const leftWidth = visibleWidth(leftNotes);
        const hotkeysWidth = visibleWidth(hotkeys);
        const rightWidth = visibleWidth(rightNotes);
        
        const paddingLen = Math.max(1, width - leftWidth - hotkeysWidth - rightWidth - 2);
        const totalFooterStr = leftNotes + hotkeys + " ".repeat(paddingLen) + rightNotes;

        return [truncateToWidth(totalFooterStr, width)];
      }
    }));
  });
}
