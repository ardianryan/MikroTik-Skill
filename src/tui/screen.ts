import readline from 'node:readline';
import chalk from 'chalk';
import { stringWidth, truncate, padRight } from './utils.js';

export interface ScreenDimensions {
  rows: number;
  cols: number;
}

export type KeyPressHandler = (key: { name: string; ctrl: boolean; shift: boolean; meta: boolean; sequence: string }) => void;

/**
 * Low-level ANSI Terminal Screen and Lifecycle Controller.
 */
export class TerminalScreen {
  private isAltScreen = false;
  private keyHandler: KeyPressHandler | null = null;
  private resizeHandlers: Array<(dim: ScreenDimensions) => void> = [];

  constructor() {
    this.handleCleanup = this.handleCleanup.bind(this);
  }

  /**
   * Enter full-screen alternate buffer and set up raw mode.
   */
  public enter(): void {
    if (this.isAltScreen) return;
    this.isAltScreen = true;

    // Enter alternate screen buffer & hide cursor
    process.stdout.write('\x1b[?1049h\x1b[?25l');

    // Register process termination hooks to restore terminal
    process.on('SIGINT', this.handleCleanup);
    process.on('SIGTERM', this.handleCleanup);
    process.on('exit', this.handleCleanup);

    // Track window resize
    process.stdout.on('resize', () => {
      const dim = this.getDimensions();
      for (const handler of this.resizeHandlers) {
        handler(dim);
      }
    });

    // Configure readline raw mode for responsive keypress capture
    if (process.stdin.isTTY) {
      readline.emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);
      process.stdin.resume();

      process.stdin.on('keypress', (ch, key) => {
        const rawKey = key || {};
        const normalizedKey = {
          name: rawKey.name || ch || rawKey.sequence || '',
          ctrl: Boolean(rawKey.ctrl),
          shift: Boolean(rawKey.shift),
          meta: Boolean(rawKey.meta),
          sequence: rawKey.sequence || ch || '',
        };

        // Global interrupt check (Ctrl+C)
        if (normalizedKey.ctrl && normalizedKey.name === 'c') {
          this.leave();
          process.exit(0);
        }

        if (this.keyHandler) {
          this.keyHandler(normalizedKey);
        }
      });
    }
  }

  /**
   * Restore standard screen buffer, show cursor, and disable raw mode.
   */
  public leave(): void {
    if (!this.isAltScreen) return;
    this.isAltScreen = false;

    // Show cursor & exit alternate buffer
    process.stdout.write('\x1b[?25h\x1b[?1049l');

    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }

    process.removeListener('SIGINT', this.handleCleanup);
    process.removeListener('SIGTERM', this.handleCleanup);
    process.removeListener('exit', this.handleCleanup);
  }

  private handleCleanup(): void {
    this.leave();
  }

  public onKey(handler: KeyPressHandler): void {
    this.keyHandler = handler;
  }

  public onResize(handler: (dim: ScreenDimensions) => void): void {
    this.resizeHandlers.push(handler);
  }

  public getDimensions(): ScreenDimensions {
    return {
      rows: process.stdout.rows || 24,
      cols: process.stdout.columns || 80,
    };
  }

  /**
   * Clear screen and move cursor to top-left.
   */
  public clear(): void {
    process.stdout.write('\x1b[2J\x1b[H');
  }

  /**
   * Move cursor to 1-indexed (row, col).
   */
  public moveTo(row: number, col: number): void {
    process.stdout.write(`\x1b[${Math.max(1, Math.round(row))};${Math.max(1, Math.round(col))}H`);
  }

  /**
   * Render complete string buffer atomically to minimize flicker.
   */
  public write(content: string): void {
    process.stdout.write(content);
  }

  /**
   * Draw a styled box with title, borders, and content.
   */
  public drawBox(
    startRow: number,
    startCol: number,
    height: number,
    width: number,
    options: {
      title?: string;
      titleColor?: (s: string) => string;
      borderColor?: (s: string) => string;
      lines?: string[];
      focused?: boolean;
    } = {}
  ): void {
    const borderColor = options.borderColor || (options.focused ? chalk.cyan : chalk.gray);
    const titleColor = options.titleColor || (options.focused ? chalk.cyan.bold : chalk.white.bold);

    // Top border
    this.moveTo(startRow, startCol);
    let topBorder = '╭─';
    if (options.title) {
      const formattedTitle = ` ${options.title} `;
      topBorder += titleColor(formattedTitle) + '─'.repeat(Math.max(0, width - 4 - stringWidth(formattedTitle)));
    } else {
      topBorder += '─'.repeat(Math.max(0, width - 3));
    }
    topBorder += '╮';
    this.write(borderColor(topBorder));

    // Middle content lines
    const contentHeight = Math.max(0, height - 2);
    for (let i = 0; i < contentHeight; i++) {
      this.moveTo(startRow + 1 + i, startCol);
      const rawLine = (options.lines && options.lines[i]) ? options.lines[i]! : '';
      const truncated = truncate(rawLine, width - 4);
      const padded = padRight(truncated, width - 4);
      this.write(`${borderColor('│')} ${padded} ${borderColor('│')}`);
    }

    // Bottom border
    this.moveTo(startRow + height - 1, startCol);
    this.write(borderColor(`╰${'─'.repeat(Math.max(0, width - 2))}╯`));
  }
}
