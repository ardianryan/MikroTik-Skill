import type { ConnectionManager } from '../client/connection-manager.js';
import { randomUUID } from 'node:crypto';

export interface WatchdogSession {
  schedulerName: string;
  timeoutSeconds: number;
  armedAt: number;
  disarmed: boolean;
}

export function schedulerStart(date: string, time: string): { 'start-date': string; 'start-time': string } {
  const legacy = date.match(/^([a-z]{3})\/(\d{1,2})\/(\d{4})$/i);
  if (legacy) {
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(legacy[1]!.toLowerCase()) + 1;
    date = `${legacy[3]}-${String(month).padStart(2, '0')}-${legacy[2]!.padStart(2, '0')}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) throw new Error('Router clock cannot be used to schedule rollback');
  const deadline = new Date(`${date}T${time}Z`);
  if (!Number.isFinite(deadline.getTime())) throw new Error('Invalid router clock');
  deadline.setUTCSeconds(deadline.getUTCSeconds() + 30);
  return { 'start-date': deadline.toISOString().slice(0, 10), 'start-time': deadline.toISOString().slice(11, 19) };
}

export class SafeModeWatchdog {
  private conn: ConnectionManager;
  private currentSession: WatchdogSession | null = null;

  constructor(conn: ConnectionManager) {
    this.conn = conn;
  }

  async arm(rollbackCommand: string, timeoutSeconds: number = 30): Promise<WatchdogSession> {
    if (timeoutSeconds !== 30) throw new Error('The mutation watchdog must use a 30-second deadline');
    const schedulerName = `mtik_watchdog_${randomUUID().replaceAll('-', '')}`;
    const intervalStr = `${timeoutSeconds}s`;

    // Script removes itself after executing rollback command
    const scriptBody = `${rollbackCommand}; /system/scheduler/remove [find name="${schedulerName}"]`;

    await this.conn.addScheduler(schedulerName, intervalStr, scriptBody);
    try {
      const scheduler = (await this.conn.getSchedulers()).find((entry) => entry.name === schedulerName);
      if (!scheduler || scheduler['on-event'] !== scriptBody || scheduler.disabled === true || scheduler.disabled === 'true' || scheduler.disabled === 'yes') {
        throw new Error('Watchdog creation could not be verified; mutation blocked');
      }
    } catch {
      try {
        await this.conn.removeScheduler(schedulerName);
        if ((await this.conn.getSchedulers()).some((entry) => entry.name === schedulerName)) throw new Error('Scheduler remains active');
      } catch { throw new Error('Watchdog creation could not be verified and cleanup failed; rollback may still execute'); }
      throw new Error('Watchdog creation could not be verified; mutation blocked and scheduler removed');
    }

    this.currentSession = {
      schedulerName,
      timeoutSeconds,
      armedAt: Date.now(),
      disarmed: false,
    };

    return this.currentSession;
  }

  async disarm(): Promise<boolean> {
    if (!this.currentSession || this.currentSession.disarmed) {
      return false;
    }

    try {
      await this.conn.removeScheduler(this.currentSession.schedulerName);
      if ((await this.conn.getSchedulers()).some((entry) => entry.name === this.currentSession!.schedulerName)) return false;
      this.currentSession.disarmed = true;
      return true;
    } catch {
      return false;
    }
  }

  getSession(): WatchdogSession | null {
    return this.currentSession;
  }
}
