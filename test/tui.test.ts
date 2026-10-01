import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import chalk from 'chalk';
import {
  stringWidth,
  truncate,
  padRight,
  padLeft,
  center,
  formatBytes,
  renderGauge,
  terminalLink,
} from '../src/tui/utils.js';
import { TuiDashboard } from '../src/tui/dashboard.js';

describe('Terminal UI (TUI) Engine', () => {
  it('correctly calculates stringWidth ignoring ANSI escape sequences and OSC 8 hyperlinks', () => {
    const plain = 'Hello MikroTik';
    const colored = chalk.cyan.bold('Hello MikroTik');
    const linked = terminalLink('Ardian Ryan', 'https://github.com/ardianryan');

    assert.equal(stringWidth(plain), 14);
    assert.equal(stringWidth(colored), 14);
    assert.equal(stringWidth(linked), 11);
  });

  it('truncates strings to specified visible width without breaking', () => {
    const text = 'MikroTik RouterOS v7 NetDevOps Suite';
    const truncated = truncate(text, 15);

    assert.ok(stringWidth(truncated) <= 15);
    assert.ok(truncated.endsWith('…'));
  });

  it('accurately pads and centers strings', () => {
    const text = 'E60iUGS';
    const paddedR = padRight(text, 10);
    const paddedL = padLeft(text, 10);
    const centered = center(text, 11);

    assert.equal(stringWidth(paddedR), 10);
    assert.equal(stringWidth(paddedL), 10);
    assert.equal(stringWidth(centered), 11);
    assert.equal(paddedR, 'E60iUGS   ');
    assert.equal(paddedL, '   E60iUGS');
    assert.equal(centered, '  E60iUGS  ');
  });

  it('formats bytes into human-readable strings', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(1024), '1 KB');
    assert.equal(formatBytes(1024 * 1024 * 512), '512 MB');
    assert.equal(formatBytes(1024 * 1024 * 1024 * 2), '2 GB');
  });

  it('generates visual percentage gauge bars', () => {
    const gauge50 = renderGauge(50, 10);
    assert.equal(gauge50, '█████░░░░░');

    const gauge100 = renderGauge(100, 10);
    assert.equal(gauge100, '██████████');

    const gauge0 = renderGauge(0, 10);
    assert.equal(gauge0, '░░░░░░░░░░');
  });

  it('instantiates TuiDashboard without runtime exceptions', () => {
    const dashboard = new TuiDashboard();
    assert.ok(dashboard instanceof TuiDashboard);
  });
});
