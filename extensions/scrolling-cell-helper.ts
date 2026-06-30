import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Component, visibleWidth, truncateToWidth, Text, getKeybindings } from "@earendil-works/pi-tui";
import { Type, Static } from "typebox";
import { applyExtensionDefaults } from "./themeMap.ts";

// ============================================================================
// 1. DATA MODELS & TYPES
// ============================================================================

export interface HighlightableCellColumn {
  /** The text value of this column cell */
  text: string;
  /** The exact visual content width of this column. If "remaining", it takes leftover space. */
  width: number | "remaining";
  /** Alignment of content within the column */
  align?: "left" | "right";
  /** Styling when item is NOT selected */
  normalStyle?: string;
  /** Styling when item IS selected */
  selectedStyle?: string;
  /** Whether to perform sub-string highlighting for current search query inside this column */
  highlightMatches?: boolean;
}

export interface ListEntry {
  id: string;
  name: string;
  status: "success" | "warning" | "error" | "info" | "neutral" | string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  progress: number; // 0 to 100
  elapsed: string;
  category: string;
  details: string;
}

// ============================================================================
// 2. CORE RENDERING HELPER (ScrollingListCellHelper)
// ============================================================================

/**
 * ScrollingListCellHelper
 *
 * Provides specialized rendering capabilities for grid lists, row cell alignments,
 * and high-fidelity string/substring matching highlight routines.
 */
export class ScrollingListCellHelper {
  
  /**
   * Splits and styles a string to apply a custom highlight (bold accent) on substring index matches.
   * Case-insensitive match, but preserves the original visual character casing of the substring.
   */
  public static highlightMatch(
    text: string,
    query: string,
    paintNormal: (t: string) => string,
    paintHighlight: (t: string) => string
  ): string {
    if (!query || !query.trim() || !text) {
      return paintNormal(text);
    }
    
    const queryLower = query.toLowerCase().trim();
    const textLower = text.toLowerCase();
    let painted = "";
    let lastIndex = 0;
    
    while (true) {
      const idx = textLower.indexOf(queryLower, lastIndex);
      if (idx === -1) {
        if (lastIndex < text.length) {
          painted += paintNormal(text.slice(lastIndex));
        }
        break;
      }
      
      if (idx > lastIndex) {
        painted += paintNormal(text.slice(lastIndex, idx));
      }
      
      const matchText = text.slice(idx, idx + queryLower.length);
      painted += paintHighlight(matchText);
      lastIndex = idx + queryLower.length;
    }
    
    return painted;
  }

  /**
   * Renders a multi-column row with bounds padding, alignment, custom highlights,
   * search match highlighting, and active selection background overrides.
   */
  public static renderRow(
    columns: HighlightableCellColumn[],
    totalWidth: number,
    isSelected: boolean,
    searchQuery: string,
    theme: any,
    colSeparator = " │ "
  ): string {
    const sepWidth = visibleWidth(colSeparator);
    const totalSepsWidth = sepWidth * (columns.length - 1);
    const usableWidth = Math.max(0, totalWidth - totalSepsWidth);

    // Resolve column widths
    const resolvedWidths: number[] = [];
    let fixedSum = 0;
    let remainingColsCount = 0;

    for (const col of columns) {
      if (typeof col.width === "number") {
        resolvedWidths.push(col.width);
        fixedSum += col.width;
      } else {
        resolvedWidths.push(-1); 
        remainingColsCount++;
      }
    }

    const totalLeftover = Math.max(0, usableWidth - fixedSum);
    const leftoverShare = remainingColsCount > 0 ? Math.floor(totalLeftover / remainingColsCount) : 0;
    let extraPixel = remainingColsCount > 0 ? totalLeftover - (leftoverShare * remainingColsCount) : 0;

    for (let i = 0; i < columns.length; i++) {
      if (resolvedWidths[i] === -1) {
        resolvedWidths[i] = leftoverShare + (extraPixel > 0 ? 1 : 0);
        if (extraPixel > 0) extraPixel--;
      }
    }

    // Render individual columns
    const paintedCols: string[] = [];

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const width = resolvedWidths[i];
      if (width <= 0) continue;

      let colText = col.text || "";
      const isRight = col.align === "right";

      const normalStyleKey = col.normalStyle || "dim";
      const selectedStyleKey = col.selectedStyle || (isSelected ? "text" : "dim");

      const paintNorm = (txt: string) => {
        return theme.fg(isSelected ? selectedStyleKey : normalStyleKey, txt);
      };

      const paintHigh = (txt: string) => {
        return theme.fg("accent", theme.bold(txt));
      };

      // Apply match highlights if enabled and query is non-empty
      let formattedText = "";
      if (col.highlightMatches && searchQuery) {
        formattedText = this.highlightMatch(colText, searchQuery, paintNorm, paintHigh);
      } else {
        formattedText = paintNorm(colText);
      }

      const textLen = visibleWidth(formattedText);
      
      let finalColStr = "";
      if (textLen === width) {
        finalColStr = formattedText;
      } else if (textLen > width) {
        finalColStr = truncateToWidth(formattedText, width, "..");
      } else {
        const padding = " ".repeat(width - textLen);
        if (isRight) {
          finalColStr = padding + formattedText;
        } else {
          finalColStr = formattedText + padding;
        }
      }

      paintedCols.push(finalColStr);
    }

    const rowContent = paintedCols.join(theme.fg("borderAccent", colSeparator));

    if (isSelected) {
      return theme.fg("bgPink", rowContent);
    }
    return rowContent;
  }
}

// ============================================================================
// 3. SCROLLMATH & VIEWPAGING BOUNDS (ScrollBoundsHelper)
// ============================================================================

/**
 * ScrollBoundsHelper
 *
 * Encapsulates standard boundary clamp logic, circular wrapping toggles,
 * page up/down sizing math, and scrollbar ASCII track index coordinates.
 */
export class ScrollBoundsHelper {
  private selectedIndex = 0;
  private scrollOffset = 0;
  private totalCount = 0;
  private viewportHeight = 8;

  constructor(viewportHeight = 8) {
    this.viewportHeight = viewportHeight;
  }

  public updateDimensions(totalCount: number, viewportHeight: number): void {
    this.totalCount = totalCount;
    this.viewportHeight = viewportHeight;
    this.clampState();
  }

  public getSelectedIndex(): number {
    return this.selectedIndex;
  }

  public getScrollOffset(): number {
    return this.scrollOffset;
  }

  public setSelectedIndex(idx: number): void {
    this.selectedIndex = idx;
    this.clampState();
    this.alignViewport();
  }

  public moveUp(wrap = true): void {
    if (this.totalCount === 0) return;
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
    } else if (wrap) {
      this.selectedIndex = this.totalCount - 1;
    }
    this.alignViewport();
  }

  public moveDown(wrap = true): void {
    if (this.totalCount === 0) return;
    if (this.selectedIndex < this.totalCount - 1) {
      this.selectedIndex++;
    } else if (wrap) {
      this.selectedIndex = 0;
    }
    this.alignViewport();
  }

  public movePageUp(): void {
    if (this.totalCount === 0) return;
    this.selectedIndex = Math.max(0, this.selectedIndex - this.viewportHeight);
    this.alignViewport();
  }

  public movePageDown(): void {
    if (this.totalCount === 0) return;
    this.selectedIndex = Math.min(this.totalCount - 1, this.selectedIndex + this.viewportHeight);
    this.alignViewport();
  }

  public moveHome(): void {
    if (this.totalCount === 0) return;
    this.selectedIndex = 0;
    this.alignViewport();
  }

  public moveEnd(): void {
    if (this.totalCount === 0) return;
    this.selectedIndex = this.totalCount - 1;
    this.alignViewport();
  }

  private clampState(): void {
    if (this.selectedIndex >= this.totalCount && this.totalCount > 0) {
      this.selectedIndex = this.totalCount - 1;
    }
    if (this.selectedIndex < 0) {
      this.selectedIndex = 0;
    }
  }

  private alignViewport(): void {
    if (this.totalCount === 0) {
      this.scrollOffset = 0;
      return;
    }

    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + this.viewportHeight) {
      this.scrollOffset = this.selectedIndex - this.viewportHeight + 1;
    }

    const maxOffset = Math.max(0, this.totalCount - this.viewportHeight);
    if (this.scrollOffset > maxOffset) {
      this.scrollOffset = maxOffset;
    }
    if (this.scrollOffset < 0) {
      this.scrollOffset = 0;
    }
  }

  /**
   * Generates a single scrollbar track tick (character) for the current row offset.
   */
  public getScrollbarChar(rowIndex: number, theme: any): string {
    if (this.totalCount <= this.viewportHeight) {
      return theme.fg("dim", "░"); // full track is empty since everything fits
    }

    const barHeight = Math.max(1, Math.floor((this.viewportHeight / this.totalCount) * this.viewportHeight));
    const maxScrollIdx = this.totalCount - this.viewportHeight;
    const scrollPercent = this.scrollOffset / maxScrollIdx;
    const trackRemaining = this.viewportHeight - barHeight;
    const barStartOffset = Math.round(scrollPercent * trackRemaining);

    const isWithinThumb = rowIndex >= barStartOffset && rowIndex < barStartOffset + barHeight;
    if (isWithinThumb) {
      return theme.fg("borderAccent", "█");
    }
    return theme.fg("dim", "░");
  }
}

// ============================================================================
// 4. INTERACTIVE WIDGET COMPONENT (CustomScrollingListDemoComponent)
// ============================================================================

/**
 * CustomScrollingListDemoComponent
 *
 * Spawns a multi-pane grid console layout showing real-time list filtering,
 * automatic scroll alignment, beautiful multi-segment row painting, and
 * visual ASCII progress trackers.
 */
export class CustomScrollingListDemoComponent implements Component {
  private allEntries: ListEntry[] = [];
  private filteredEntries: ListEntry[] = [];
  private title: string;
  private maxHeight: number;
  private theme: any;

  // Search filter flags
  private searchQuery = "";
  public isSearching = false;

  // Helpers
  private scroller: ScrollBoundsHelper;

  private onSelectCallback?: (entry: ListEntry) => void;
  private onCancelCallback?: () => void;

  constructor(
    entries: ListEntry[],
    title = " π PIPELINE TASK MONITOR ",
    maxHeight = 15,
    theme: any,
    onSelect?: (entry: ListEntry) => void,
    onCancel?: () => void
  ) {
    this.allEntries = entries;
    this.filteredEntries = [...entries];
    this.title = title;
    this.maxHeight = maxHeight;
    this.theme = theme;
    this.onSelectCallback = onSelect;
    this.onCancelCallback = onCancel;

    // Viewport will sit under a header (3 lines) and above a status bar (1 line)
    const bodyHeight = maxHeight - 4;
    this.scroller = new ScrollBoundsHelper(bodyHeight);
    this.scroller.updateDimensions(this.filteredEntries.length, bodyHeight);
  }

  private filterItems(): void {
    const query = this.searchQuery.toLowerCase().trim();
    if (!query) {
      this.filteredEntries = [...this.allEntries];
    } else {
      this.filteredEntries = this.allEntries.filter(
        item =>
          item.name.toLowerCase().includes(query) ||
          item.category.toLowerCase().includes(query) ||
          item.id.toLowerCase().includes(query)
      );
    }
    // Update scroller total lines
    this.scroller.updateDimensions(this.filteredEntries.length, this.maxHeight - 4);
    // Reset selection to top during a new filter sweep
    this.scroller.setSelectedIndex(0);
  }

  public invalidate(): void {
    // Stateless cleanup if needed
  }

  private renderProgressBar(percent: number): string {
    const width = 8;
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return "[" + "█".repeat(filled) + "░".repeat(empty) + "] " + percent + "%";
  }

  private padText(text: string, width: number): string {
    const curLen = visibleWidth(text);
    if (curLen === width) return text;
    if (curLen > width) return truncateToWidth(text, width, "...");
    return text + " ".repeat(width - curLen);
  }

  /**
   * Constructs the structured columns list representing a single item in the pipeline list.
   * Maps each item field to a HighlightableCellColumn configuration.
   */
  private getColumnsForEntry(entry: ListEntry, isSelected: boolean): HighlightableCellColumn[] {
    const statusStyle =
      entry.status === "success" ? "success" :
      entry.status === "warning" ? "warning" :
      entry.status === "error" ? "error" : "accent";

    const isHigh = entry.priority === "HIGH";
    const isMedium = entry.priority === "MEDIUM";
    const priorityStyle = isHigh ? "error" : isMedium ? "warning" : "muted";

    return [
      {
        text: "● " + entry.status.toUpperCase(),
        width: 11,
        normalStyle: statusStyle,
        selectedStyle: isSelected ? "text" : statusStyle,
        highlightMatches: false,
      },
      {
        text: "[" + entry.category + "]",
        width: 14,
        normalStyle: "dim",
        selectedStyle: "text",
        highlightMatches: true,
      },
      {
        text: entry.name,
        width: "remaining",
        normalStyle: isSelected ? "text" : "muted",
        selectedStyle: "text",
        highlightMatches: true,
      },
      {
        text: "[" + entry.priority + "]",
        width: 8,
        normalStyle: priorityStyle,
        selectedStyle: "text",
        highlightMatches: false,
      },
      {
        text: this.renderProgressBar(entry.progress),
        width: 15,
        normalStyle: entry.progress === 100 ? "success" : "muted",
        selectedStyle: "text",
        highlightMatches: false,
      },
      {
        text: entry.elapsed,
        width: 7,
        align: "right",
        normalStyle: "dim",
        selectedStyle: "text",
        highlightMatches: false,
      }
    ];
  }

  /**
   * Main render method for the Split Grid Widget.
   */
  public render(width: number): string[] {
    const lines: string[] = [];
    const bodyHeight = this.maxHeight - 4;

    this.scroller.updateDimensions(this.filteredEntries.length, bodyHeight);

    // Grid Columns Partition: Left list pane takes ~72% space, Right preview panel takes remainder
    const leftPaneWidth = Math.max(55, Math.floor(width * 0.70));
    const rightPaneWidth = Math.max(15, width - leftPaneWidth - 3);

    const paintBorder = (char: string) => this.theme.fg("borderAccent", char);
    const paintMuted = (text: string) => this.theme.fg("muted", text);
    const paintDim = (text: string) => this.theme.fg("dim", text);

    // ────────────────────────────────────────────────────────────────────────
    // 1. DRAW BORDER HEADER ROW
    // ────────────────────────────────────────────────────────────────────────
    const headerTitleLeft = " " + this.title.toUpperCase() + " ";
    const hBarLeftLen = Math.max(2, leftPaneWidth - visibleWidth(headerTitleLeft) - 4);
    const leftBars = "─".repeat(2) + headerTitleLeft + "─".repeat(hBarLeftLen);
    const rightBars = "─".repeat(rightPaneWidth);
    
    const borderHeader = paintBorder("┌") + 
                         paintBorder(leftBars) + 
                         paintBorder("┬") + 
                         paintBorder(rightBars) + 
                         paintBorder("┐");
    lines.push(borderHeader);

    // ────────────────────────────────────────────────────────────────────────
    // 2. DRAW SEARCH FIELD BAR
    // ────────────────────────────────────────────────────────────────────────
    const searchLabel = this.isSearching
      ? " 🔎 Search Query: " + this.searchQuery + "_"
      : this.searchQuery
        ? " 🔎 Search matches: " + this.searchQuery
        : " (Press \"/\" or \"f\" to search/filter lists) ";

    const leftSearchPart = this.isSearching
      ? this.theme.fg("accent", this.padText(searchLabel, leftPaneWidth))
      : paintMuted(this.padText(searchLabel, leftPaneWidth));

    const rightPreviewLabel = paintDim(this.padText("  TASK ANALYSIS CONSOLE", rightPaneWidth));

    const searchRow = paintBorder("│") + 
                      leftSearchPart + 
                      paintBorder("│") + 
                      rightPreviewLabel + 
                      paintBorder("│");
    lines.push(searchRow);

    // Divider line
    const middleDivider = paintBorder("├") + 
                          paintBorder("─".repeat(leftPaneWidth)) + 
                          paintBorder("┼") + 
                          paintBorder("─".repeat(rightPaneWidth)) + 
                          paintBorder("┤");
    lines.push(middleDivider);

    // ────────────────────────────────────────────────────────────────────────
    // 3. DRAW VIEWPORT ROWS (LIST vs PREVIEW SPLIT)
    // ────────────────────────────────────────────────────────────────────────
    const totalFiltered = this.filteredEntries.length;
    const currentSelIndex = this.scroller.getSelectedIndex();
    const currentOffset = this.scroller.getScrollOffset();
    const selectedEntry = totalFiltered > 0 ? this.filteredEntries[currentSelIndex] : null;

    // Compile text blocks representing details to be shown on right pane
    const detailsLines: string[] = [];
    if (selectedEntry) {
      detailsLines.push(this.theme.fg("accent", " 🎯 Identity: ") + selectedEntry.id);
      detailsLines.push(paintMuted(" 📁 Category: ") + selectedEntry.category);
      detailsLines.push(paintMuted(" 🔔 Priority: ") + selectedEntry.priority);
      detailsLines.push(paintMuted(" ⏱️ Latency : ") + selectedEntry.elapsed);
      detailsLines.push(paintMuted(" 📈 Progress: ") + selectedEntry.progress + "%");
      detailsLines.push(paintBorder("─".repeat(rightPaneWidth)));
      
      const rawLines = (selectedEntry.details || "").split("\n");
      for (const line of rawLines) {
        if (visibleWidth(line) <= rightPaneWidth - 2) {
          detailsLines.push("  " + line);
        } else {
          let chunk = line;
          while (chunk.length > 0) {
            const size = rightPaneWidth - 4;
            detailsLines.push("  " + chunk.slice(0, size));
            chunk = chunk.slice(size);
          }
        }
      }
    } else {
      detailsLines.push(paintMuted("  Empty set match."));
    }

    // Render body row loop
    for (let i = 0; i < bodyHeight; i++) {
      const entryIdx = currentOffset + i;
      let leftPaneStr = "";

      if (entryIdx < totalFiltered) {
        const item = this.filteredEntries[entryIdx];
        const isCurrent = entryIdx === currentSelIndex;
        
        // Calculate dimensions allowing for vertical scrollbar track
        const scrollBarTrackWidth = 1;
        const mainContentWidth = leftPaneWidth - scrollBarTrackWidth;

        // Obtain structured styled columns for current cell item
        const itemCols = this.getColumnsForEntry(item, isCurrent);
        
        // Invoke render helper routine to style columns
        const cellString = ScrollingListCellHelper.renderRow(itemCols, mainContentWidth, isCurrent, this.searchQuery, this.theme);
        
        // Render scrollbar char indicator
        const barChar = this.scroller.getScrollbarChar(i, this.theme);
        
        leftPaneStr = cellString + barChar;
      } else {
        // Empty row filler
        leftPaneStr = this.padText("", leftPaneWidth);
      }

      // Populate right pane details line
      let rightPaneStr = "";
      if (i < detailsLines.length) {
        rightPaneStr = this.padText(detailsLines[i], rightPaneWidth);
      } else {
        rightPaneStr = this.padText("", rightPaneWidth);
      }

      const completedRow = paintBorder("│") + 
                           leftPaneStr + 
                           paintBorder("│") + 
                           rightPaneStr + 
                           paintBorder("│");
      lines.push(completedRow);
    }

    // ────────────────────────────────────────────────────────────────────────
    // 4. DRAW FOOTER BORDER STATUS LINE
    // ────────────────────────────────────────────────────────────────────────
    const statusIdxStr = totalFiltered > 0
      ? " [Active: " + (currentSelIndex + 1) + "/" + totalFiltered + " matched] "
      : " [No matches] ";

    const bBarLeftLen = Math.max(2, leftPaneWidth - visibleWidth(statusIdxStr) - 4);
    const bottomBarsLeft = "─".repeat(2) + paintDim(statusIdxStr) + paintBorder("─".repeat(bBarLeftLen));
    const bottomBarsRight = "─".repeat(rightPaneWidth);
    
    const borderBottom = paintBorder("└") + 
                         bottomBarsLeft + 
                         paintBorder("┴") + 
                         paintBorder(bottomBarsRight) + 
                         paintBorder("┘");
    lines.push(borderBottom);

    return lines;
  }

  /**
   * Listen and handle keystroke navigation and query inputs.
   */
  public handleInput(keyData: string): void {
    const kb = getKeybindings();

    // 1. Search Query Typing Capture
    if (this.isSearching) {
      if (keyData === "\r" || keyData === "\n" || kb.matches(keyData, "tui.select.confirm")) {
        this.isSearching = false;
        return;
      }
      
      if (keyData === "\u001b" || kb.matches(keyData, "tui.select.cancel")) {
        this.isSearching = false;
        this.searchQuery = "";
        this.filterItems();
        return;
      }

      if (keyData === "\x7f" || keyData === "\b") {
        if (this.searchQuery.length > 0) {
          this.searchQuery = this.searchQuery.slice(0, -1);
          this.filterItems();
        }
        return;
      }

      // Appends printable characters
      if (keyData.length === 1 && keyData.charCodeAt(0) >= 32 && keyData.charCodeAt(0) < 127) {
        this.searchQuery += keyData;
        this.filterItems();
        return;
      }
      return;
    }

    // 2. Main List Navigation Control
    const totalLines = this.filteredEntries.length;

    if (kb.matches(keyData, "tui.select.up") || keyData === "k" || keyData === "\u001b[A") {
      this.scroller.moveUp();
    } 
    else if (kb.matches(keyData, "tui.select.down") || keyData === "j" || keyData === "\u001b[B") {
      this.scroller.moveDown();
    } 
    else if (kb.matches(keyData, "tui.select.pageUp") || keyData === "\u001b[5~") {
      this.scroller.movePageUp();
    } 
    else if (kb.matches(keyData, "tui.select.pageDown") || keyData === "\u001b[6~") {
      this.scroller.movePageDown();
    }
    else if (keyData === "g" || keyData === "H") {
      this.scroller.moveHome();
    }
    else if (keyData === "G" || keyData === "L") {
      this.scroller.moveEnd();
    }
    else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\r" || keyData === "\n" || keyData === " ") {
      const selected = this.filteredEntries[this.scroller.getSelectedIndex()];
      if (selected && this.onSelectCallback) {
        this.onSelectCallback(selected);
      }
    } 
    else if (kb.matches(keyData, "tui.select.cancel") || keyData === "\u001b" || keyData === "q") {
      if (this.onCancelCallback) {
        this.onCancelCallback();
      }
    } 
    else if (keyData === "/" || keyData === "f") {
      this.isSearching = true;
    }
  }

  public getSelectedEntry(): ListEntry | null {
    const selIdx = this.scroller.getSelectedIndex();
    if (selIdx >= 0 && selIdx < this.filteredEntries.length) {
      return this.filteredEntries[selIdx];
    }
    return null;
  }
}

// ============================================================================
// 5. MOCK DATASETS & EXPERT REGISTRATION PACKS
// ============================================================================

const MOCK_TELEMETRY_PIPELINE: ListEntry[] = [
  {
    id: "task-102",
    name: "Scan workspace directory tree",
    status: "success",
    priority: "MEDIUM",
    progress: 100,
    elapsed: "1.4s",
    category: "Scanner",
    details: "Workspace scanning process executed successfully.\nDiscovered total of 42 TS files, 3 JSON maps, and 1 package manifest.\nAverage disk-seek seek delay: 0.2ms."
  },
  {
    id: "task-103",
    name: "Fuzzy test sub-agent outputs",
    status: "warning",
    priority: "HIGH",
    progress: 80,
    elapsed: "14.2s",
    category: "Fuzzer",
    details: "Fuzzing LLM prompt injection test structures on tui-expert-spec.\nWarning: Completion response token limits hit on test #42.\nRetrying with adaptive sliding window offsets."
  },
  {
    id: "task-104",
    name: "Install registered modules",
    status: "success",
    priority: "LOW",
    progress: 100,
    elapsed: "5.1s",
    category: "Installer",
    details: "Resolved peer dependencies for @earendil-works/pi-tui successfully.\nCreated cache symlinks for next hot-module replacements."
  },
  {
    id: "task-105",
    name: "Synthesize Rose Pine theme palette",
    status: "success",
    priority: "LOW",
    progress: 100,
    elapsed: "0.4s",
    category: "Themes",
    details: "Mapped winter rose tones, gold, foam color badges to memory store.\nBorder frames set to deep mute accents successfully."
  },
  {
    id: "task-106",
    name: "Validate JSON AST schemas",
    status: "info",
    priority: "MEDIUM",
    progress: 55,
    elapsed: "4.8s",
    category: "Validator",
    details: "Parsing schema templates recursively via Sinclair TypeBox.\nActive schema queue: 15 modules remaining."
  },
  {
    id: "task-107",
    name: "Execute bash telemetry probes",
    status: "error",
    priority: "HIGH",
    progress: 90,
    elapsed: "18.3s",
    category: "Prober",
    details: "Error: Subprocess timeout while fetching active docker container streams.\nExit Code: 124 (SIGALRM exceeded 15.0 seconds runtime parameter)."
  },
  {
    id: "task-108",
    name: "Aggregate token parameters",
    status: "success",
    priority: "MEDIUM",
    progress: 100,
    elapsed: "1.2s",
    category: "Telemetry",
    details: "Model parameters gathered.\nAggregate prompt tokens used: 84,200 tokens.\nEstimated session transaction expense: $0.14."
  },
  {
    id: "task-109",
    name: "Compile TypeScript sources",
    status: "neutral",
    priority: "LOW",
    progress: 0,
    elapsed: "0.0s",
    category: "Compiler",
    details: "Queued task pending runner loop authorization.\nCompiles directory extensions with optimization levels."
  },
  {
    id: "task-110",
    name: "Clean duplicate build artifacts",
    status: "neutral",
    priority: "LOW",
    progress: 0,
    elapsed: "0.0s",
    category: "Compiler",
    details: "Queued task pending compile operations finish."
  }
];

// Sinclair TypeBox Validation Schema
export const RunListWithHighlightsSchema = Type.Object({
  title: Type.Optional(Type.String({
    description: "Header title displayed atop the interactive grid window panel",
    default: "Pi Pipeline Task Telemetry Monitor",
    examples: ["Parallel Agent Pipeline", "Operational Status Dashboard"],
  })),
  searchTerm: Type.Optional(Type.String({
    description: "Initial substring filter query to apply on search highlight",
    examples: ["task", "compile", "theme"],
  })),
  maxHeight: Type.Optional(Type.Integer({
    description: "Maximum line count of the spawned selection window grid",
    default: 15,
    minimum: 10,
    maximum: 30,
  })),
  items: Type.Optional(Type.Array(
    Type.Object({
      id: Type.String({ description: "Unique task code trace code" }),
      name: Type.String({ description: "Clean descriptive text printed in the search list row" }),
      status: Type.String({ description: "Task status bullet state (success, warning, error, info, neutral)" }),
      priority: Type.Union([Type.Literal("HIGH"), Type.Literal("MEDIUM"), Type.Literal("LOW")]),
      progress: Type.Integer({ description: "Calculated execution progress percentage", minimum: 0, maximum: 100 }),
      elapsed: Type.String({ description: "Time notation of task residence duration" }),
      category: Type.String({ description: "Classifier group contextual badge" }),
      details: Type.String({ description: "Raw multi-line textual telemetry data shown on preview" }),
    }),
    { description: "Array of simulated custom tasks to build into the scrolling monitor layout" }
  )),
}, {
  $id: "RunListWithHighlightsSchema",
  title: "render_scrolling_list_with_highlights",
  description: "Launches an interactive custom highlighted terminal workspace list for tracking data cells.",
});

export type RunListWithHighlightsParams = Static<typeof RunListWithHighlightsSchema>;

// ============================================================================
// 6. MODULE DEFAULT EXPORT & LIFECYCLE REGISTER HOOKS
// ============================================================================

export default function (pi: ExtensionAPI) {

  // --- 1. Register interactive selection tool with schema ---
  pi.registerTool({
    name: "render_scrolling_list_with_highlights",
    label: "Render Scrolling Highlight List",
    description: "Deploys an interactive split-pane multi-column grid selection list with custom inline highlighted cells, scroll view limits, status badges, progress bars, and dynamic keyword substring filtering.",
    parameters: RunListWithHighlightsSchema,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const toolParams = params as RunListWithHighlightsParams;
      const title = toolParams.title || " Pi Pipeline Task Telemetry Monitor ";
      const initialSearch = toolParams.searchTerm || "";
      const maxHeight = toolParams.maxHeight || 15;
      const items = toolParams.items || MOCK_TELEMETRY_PIPELINE;

      if (!ctx.ui || !ctx.hasUI) {
        return {
          content: [{ type: "text", text: "❌ Interactive TUI mode required to display highlighting scrolling list helper." }],
          details: { status: "no_ui_error" }
        };
      }

      ctx.ui.notify("Initializing Custom Highlight Scroll Cell Component...", "info");

      const selection = await ctx.ui.custom<ListEntry | null>(
        (tui: any, theme: any, keybindings: any, done: (result: ListEntry | null) => void) => {
          
          const component = new CustomScrollingListDemoComponent(
            items,
            title,
            maxHeight,
            theme,
            (selected) => {
              ctx.ui.notify("Comitted Selection Code: " + selected.id, "info");
              done(selected);
            },
            () => {
              ctx.ui.notify("Highlight scroll controller dismissed.", "warning");
              done(null);
            }
          );

          if (initialSearch) {
            component.handleInput("/");
            for (const char of initialSearch) {
              component.handleInput(char);
            }
            component.handleInput("\r");
          }

          return component;
        },
        {
          overlay: true,
          overlayOptions: {
            width: "90%",
            maxHeight: maxHeight,
            anchor: "center"
          }
        }
      );

      if (!selection) {
        return {
          content: [{ type: "text", text: "⚠️ Interactive highlighted scroll grid session terminated with no selection finalized." }],
          details: { status: "cancelled" }
        };
      }

      return {
        content: [{ type: "text", text: "✅ Telemetry Selection Complete! Committed Cell ID: **" + selection.id + "**\n\n- **Target Name:** " + selection.name + "\n- **Status Flag:** " + selection.status.toUpperCase() + "\n- **Category Class:** " + selection.category + "\n- **Duration Elapsed:** " + selection.elapsed + "\n- **Detail Logs:** " + selection.details.replace(/\n/g, "\n  ") }],
        details: { status: "success", selection }
      };
    },

    renderCall(args, theme) {
      const params = args as RunListWithHighlightsParams;
      return new Text(
        theme.fg("toolTitle", theme.bold("render_scrolling_list_with_highlights ")) +
        theme.fg("accent", "[cells: " + (params.items?.length || 9) + "]") +
        theme.fg("dim", " — ") +
        theme.fg("muted", params.title || "Custom Inline Highlights Grid"),
        0, 0
      );
    },

    renderResult(result, options, theme) {
      const details = result.details as any;
      if (!details || details.status !== "success") {
        const firstBlock = result.content[0];
        const errorText = (firstBlock && "text" in firstBlock) ? firstBlock.text : "Highlighted list session wound down.";
        return new Text(theme.fg("warning", errorText), 0, 0);
      }
      const entry = details.selection as ListEntry;
      return new Text(
        theme.fg("success", "✓ Interactive List Selection Finalized") + "\n" +
        theme.fg("dim", "├─ Cell Identifier : ") + theme.fg("accent", entry.id) + "\n" +
        theme.fg("dim", "├─ Operational Name: ") + theme.bold(entry.name) + "\n" +
        theme.fg("dim", "├─ Progress Ratio  : ") + theme.fg("success", entry.progress + "% completed") + "\n" +
        theme.fg("dim", "└─ Category / Time : ") + theme.fg("muted", entry.category + " (" + entry.elapsed + " total runtime)"),
        0, 0
      );
    }
  });

  // --- 2. Register custom slash command simulation ---
  pi.registerCommand("scrolling-cells", {
    description: "Launches the high-fidelity multi-segment highlighted scrolling cells demo terminal screen.",
    handler: async (args, ctx) => {
      if (!ctx.ui) {
        ctx.shutdown();
        return;
      }

      ctx.ui.notify("Activating Scrolling Cell layout workspace simulation...", "info");

      const chosen = await ctx.ui.custom<ListEntry | null>(
        (tui: any, theme: any, keybindings: any, done: (result: ListEntry | null) => void) => {
          ctx.ui.notify("Interactive Console Active. Press '/' to filter matches immediately.", "info");

          return new CustomScrollingListDemoComponent(
            MOCK_TELEMETRY_PIPELINE,
            " Rose Pine Telemetry Console ",
            16,
            theme,
            (selected) => done(selected),
            () => done(null)
          );
        },
        {
          overlay: true,
          overlayOptions: {
            width: "90%",
            maxHeight: 16,
            anchor: "center"
          }
        }
      );

      if (chosen) {
        ctx.ui.notify("Perfect! Interactive telemetry item committed: " + chosen.name, "info");
      } else {
        ctx.ui.notify("Interactive simulation screen exited with no selection.", "warning");
      }
    }
  });

  // --- 3. Dynamic Footer hook injection for helpful clues on startup ---
  pi.on("session_start", async (event, ctx) => {
    applyExtensionDefaults(import.meta.url, ctx);
    ctx.ui.notify("π Scrolling Highlight Cell Extension online. Use `/scrolling-cells` to launch interactive simulation!", "info");

    ctx.ui.setFooter((tui: any, theme: any, footerData: any) => ({
      dispose: () => {},
      invalidate() {},
      render(width: number): string[] {
        const leftNotes = theme.fg("accent", " π Highlight Scroller ") + theme.fg("dim", " │ ");
        const hotkeys = theme.bold("↑↓") + theme.fg("dim", " Navigate ") +
                        theme.bold(" g/G ") + theme.fg("dim", " Top/Bottom ") +
                        theme.bold(" / ") + theme.fg("dim", " Search/Highlights ") +
                        theme.bold(" Enter ") + theme.fg("dim", " Select ") +
                        theme.bold(" Esc ") + theme.fg("dim", " Exit ");
        
        const usage = ctx.getContextUsage?.();
        const costStr = usage ? `[Usage: ${Math.round(usage.percent)}% Used]` : "";
        const rightNotes = theme.fg("muted", costStr);

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
