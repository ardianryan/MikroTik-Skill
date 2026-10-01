/**
 * Terminal UI text formatting & ANSI string utilities.
 */

// Regular expression to match ANSI escape codes for accurate visual length calculation
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * Calculate the visual length of a string ignoring ANSI escape sequences.
 */
export function stringWidth(str: string): number {
  return str.replace(ANSI_REGEX, '').length;
}

/**
 * Truncate a string to a given visual width, accounting for ANSI codes.
 */
export function truncate(str: string, maxWidth: number, ellipsis = '…'): number extends never ? never : string {
  if (maxWidth <= 0) return '';
  const plain = str.replace(ANSI_REGEX, '');
  if (plain.length <= maxWidth) return str;

  // Simple clean slice for plain strings
  if (!str.includes('\x1b')) {
    return plain.slice(0, Math.max(0, maxWidth - ellipsis.length)) + ellipsis;
  }

  // ANSI-aware slice
  let visibleCount = 0;
  let result = '';
  let i = 0;
  const target = Math.max(0, maxWidth - ellipsis.length);

  while (i < str.length && visibleCount < target) {
    if (str[i] === '\x1b' && str[i + 1] === '[') {
      const match = str.slice(i).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
      if (match) {
        result += match[0];
        i += match[0].length;
        continue;
      }
    }
    result += str[i];
    visibleCount++;
    i++;
  }

  return result + '\x1b[0m' + ellipsis;
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
  if (isNaN(bytes) || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Generate a visual percentage bar (e.g. [████████░░░░] 65%).
 */
export function renderGauge(percent: number, width = 15): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}
