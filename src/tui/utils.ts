/**
 * Terminal UI text formatting & ANSI string utilities.
 */

// Regular expression to match ANSI escape codes (SGR and OSC 8 hyperlinks) for accurate visual length calculation
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

/**
 * Format a string with an OSC 8 terminal hyperlink.
 * Modern terminal emulators render `text` clickable pointing to `url`.
 */
export function terminalLink(text: string, url: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

/**
 * Calculate the visual length of a string ignoring ANSI escape sequences.
 */
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function cellWidth(segment: string): number {
  if (/^[\p{Mark}\p{Control}\p{Format}]+$/u.test(segment)) return 0;
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(segment)) return 2;
  const point = segment.codePointAt(0) || 0;
  return point >= 0x1100 && (point <= 0x115f || point === 0x2329 || point === 0x232a ||
    (point >= 0x2e80 && point <= 0xa4cf) || (point >= 0xac00 && point <= 0xd7a3) ||
    (point >= 0xf900 && point <= 0xfaff) || (point >= 0xfe10 && point <= 0xfe6f) ||
    (point >= 0xff00 && point <= 0xff60) || (point >= 0xffe0 && point <= 0xffe6) ||
    (point >= 0x20000 && point <= 0x3fffd)) ? 2 : 1;
}

export function stringWidth(str: string): number {
  let width = 0;
  for (const { segment } of graphemes.segment(str.replace(ANSI_REGEX, ''))) width += cellWidth(segment);
  return width;
}

export function truncate(str: string, maxWidth: number, ellipsis = '…'): string {
  maxWidth = Number.isFinite(maxWidth) ? Math.max(0, Math.floor(maxWidth)) : 0;
  if (maxWidth === 0) return '';
  if (stringWidth(str) <= maxWidth) return str;
  const target = Math.max(0, maxWidth - stringWidth(ellipsis));
  let visible = 0;
  let result = '';
  const tokens = str.match(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)|[^\x1b]+|\x1b/g) || [];
  outer: for (const token of tokens) {
    if (token.startsWith('\x1b')) { result += token; continue; }
    for (const { segment } of graphemes.segment(token)) {
      const width = cellWidth(segment);
      if (visible + width > target) break outer;
      result += segment; visible += width;
    }
  }
  const close = str.includes('\x1b') ? '\x1b]8;;\x07\x1b[0m' : '';
  return result + close + (stringWidth(ellipsis) <= maxWidth ? ellipsis : '');
}

/**
 * Pad a string to a visual width on the right.
 */
export function padRight(str: string, width: number): string {
  const current = stringWidth(str);
  if (current >= width) return str;
  return str + ' '.repeat(width - current);
}

/**
 * Pad a string to a visual width on the left.
 */
export function padLeft(str: string, width: number): string {
  const current = stringWidth(str);
  if (current >= width) return str;
  return ' '.repeat(width - current) + str;
}

/**
 * Center a string within a visual width.
 */
export function center(str: string, width: number): string {
  const current = stringWidth(str);
  if (current >= width) return str;
  const leftPad = Math.floor((width - current) / 2);
  const rightPad = width - current - leftPad;
  return ' '.repeat(leftPad) + str + ' '.repeat(rightPad);
}

/**
 * Format bytes into human-readable units (KB, MB, GB).
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(k))));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Generate a visual percentage bar (e.g. [████████░░░░] 65%).
 */
export function renderGauge(percent: number, width = 15): string {
  width = Number.isFinite(width) ? Math.max(0, Math.min(200, Math.floor(width))) : 15;
  const clamped = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}
