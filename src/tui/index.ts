export { TuiDashboard, type TuiDashboardOptions } from './dashboard.js';
export { TerminalScreen } from './screen.js';
export * from './utils.js';

import { TuiDashboard, type TuiDashboardOptions } from './dashboard.js';

/**
 * Entry point to launch the interactive MikroTik NetDevOps Terminal UI (TUI).
 */
export async function runTui(options: TuiDashboardOptions = {}): Promise<void> {
  const dashboard = new TuiDashboard(options);
  await dashboard.start();
}
