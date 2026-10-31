import { ConfigSanitizer } from './sanitizer.js';
import chalk from 'chalk';

export interface DiffEntry {
  type: 'ADD' | 'DELETE' | 'MODIFY' | 'MOVE';
  target: string;
  details: Record<string, unknown>;
  previous?: Record<string, unknown>;
}

export function formatRuleDiff(diff: DiffEntry): string {
  const lines: string[] = [];

  switch (diff.type) {
    case 'ADD':
      lines.push(chalk.green(`+ ADD [${diff.target}]`));
      for (const [key, val] of Object.entries(diff.details)) {
        lines.push(chalk.green(`  + ${key}: ${val}`));
      }
      break;

    case 'DELETE':
      lines.push(chalk.red(`- DELETE [${diff.target}]`));
      for (const [key, val] of Object.entries(diff.details)) {
        lines.push(chalk.red(`  - ${key}: ${val}`));
      }
      break;

    case 'MODIFY':
      lines.push(chalk.yellow(`~ MODIFY [${diff.target}]`));
      if (diff.previous) {
        for (const [key, prevVal] of Object.entries(diff.previous)) {
          const newVal = diff.details[key];
          if (newVal !== undefined && newVal !== prevVal) {
            lines.push(chalk.red(`  - ${key}: ${prevVal}`));
            lines.push(chalk.green(`  + ${key}: ${newVal}`));
          }
        }
      }
      break;

    case 'MOVE':
      lines.push(chalk.cyan(`> MOVE [${diff.target}]`));
      for (const [key, val] of Object.entries(diff.details)) {
        lines.push(chalk.cyan(`  > ${key}: ${val}`));
      }
      break;
  }

  return ConfigSanitizer.sanitizeText(lines.join('\n'));
}

export function formatBatchDiff(diffs: DiffEntry[]): string {
  if (diffs.length === 0) {
    return chalk.gray('No changes detected (identical state).');
  }

  const border = chalk.gray('--------------------------------------------------');
  return [border, ...diffs.map(formatRuleDiff), border].join('\n');
}
