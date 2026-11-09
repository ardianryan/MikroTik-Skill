import chalk from 'chalk';
import { TerminalScreen } from './screen.js';
import { padRight, terminalLink, stringWidth, center } from './utils.js';
import { getFleetStore, removeFleetDevice, type FleetStore } from '../config/fleet.js';

export interface AddRouterForm {
  name: string;
  host: string;
  port: string;
  user: string;
  password: string;
  model: string;
  preferBinary: boolean;
}

export interface GatewayRenderContext {
  gatewayMode: 'select' | 'add';
  fleetStore: FleetStore;
  selectedFleetIndex: number;
  isConnecting: boolean;
  connectingTargetName: string;
  gatewayError: string | null;
  addRouterForm: AddRouterForm;
  addRouterField: number;
}

export interface GatewayKeyHandlerState {
  gatewayMode: 'select' | 'add';
  fleetStore: FleetStore;
  selectedFleetIndex: number;
  gatewayError: string | null;
  addRouterField: number;
  addRouterForm: AddRouterForm;
  isConnecting: boolean;
  stop: () => void;
  render: () => void;
  runAction: (action: () => void | Promise<void>) => void;
  attemptConnectDevice: (dev: { name: string; host: string; port: number; user: string; model?: string; preferBinary?: boolean }) => Promise<void>;
  submitAddRouterForm: () => Promise<void>;
}

export function handleGatewayKey(
  state: GatewayKeyHandlerState,
  key: { name: string; sequence: string; ctrl?: boolean; shift?: boolean }
): void {
  if (key.ctrl && key.name === 'q') {
    state.stop();
    return;
  }
  if (state.isConnecting) return;

  const keyName = key.name || '';
  const devices = state.fleetStore.devices;

  if (state.gatewayMode === 'select') {
    if (keyName === 'q') {
      state.stop();
      return;
    }

    if (keyName === 'up' || keyName === 'k') {
      if (devices.length > 0) {
        state.selectedFleetIndex = (state.selectedFleetIndex - 1 + devices.length) % devices.length;
        state.gatewayError = null;
        state.render();
      }
      return;
    }

    if (keyName === 'down' || keyName === 'j') {
      if (devices.length > 0) {
        state.selectedFleetIndex = (state.selectedFleetIndex + 1) % devices.length;
        state.gatewayError = null;
        state.render();
      }
      return;
    }

    if (keyName === 'return' || keyName === 'enter' || keyName === 'space') {
      const targetDev = devices[state.selectedFleetIndex];
      if (targetDev) {
        state.runAction(() => state.attemptConnectDevice(targetDev));
      }
      return;
    }

    if (keyName === 'a' || keyName === 'n' || keyName === '2') {
      state.gatewayMode = 'add';
      state.gatewayError = null;
      state.addRouterField = 0;
      state.addRouterForm = {
        name: `router-${(devices.length + 1).toString()}`,
        host: '192.168.88.1',
        port: '443',
        user: 'admin',
        password: '',
        model: 'E60iUGS',
        preferBinary: false,
      };
      state.render();
      return;
    }

    if (keyName === 'd') {
      const targetDev = devices[state.selectedFleetIndex];
      if (targetDev && devices.length > 0) {
        removeFleetDevice(targetDev.name);
        state.fleetStore = getFleetStore();
        state.selectedFleetIndex = Math.max(0, state.selectedFleetIndex - 1);
        if (state.fleetStore.devices.length === 0) {
          state.gatewayMode = 'add';
        }
        state.render();
      }
      return;
    }
  } else if (state.gatewayMode === 'add') {
    if (keyName === 'escape') {
      if (devices.length === 0) {
        state.stop();
        return;
      }
      if (devices.length > 0) {
        state.gatewayMode = 'select';
        state.gatewayError = null;
        state.render();
      }
      return;
    }

    if (keyName === '1' && (state.addRouterField === 0 || key.ctrl)) {
      if (devices.length > 0) {
        state.gatewayMode = 'select';
        state.gatewayError = null;
        state.render();
        return;
      }
    }

    const fieldKeys: Array<keyof AddRouterForm> = [
      'name',
      'host',
      'preferBinary',
      'port',
      'user',
      'password',
      'model',
    ];
    const currentKey = fieldKeys[state.addRouterField] || 'name';

    if (currentKey === 'preferBinary') {
      if (keyName === 'space' || keyName === 'left' || keyName === 'right') {
        state.addRouterForm.preferBinary = !state.addRouterForm.preferBinary;
        state.addRouterForm.port = state.addRouterForm.preferBinary ? '8729' : '443';
        state.render();
        return;
      }
    }

    if (keyName === 'return' || keyName === 'enter') {
      if (state.addRouterField < fieldKeys.length - 1) {
        state.addRouterField++;
        state.render();
      } else {
        state.runAction(() => state.submitAddRouterForm());
      }
      return;
    }

    if (keyName === 'up' && state.addRouterField > 0) {
      state.addRouterField--;
      state.render();
      return;
    }

    if (keyName === 'down' && state.addRouterField < fieldKeys.length - 1) {
      state.addRouterField++;
      state.render();
      return;
    }

    if (keyName === 'tab') {
      if (key.shift || key.sequence === '\x1b[Z') {
        state.addRouterField = (state.addRouterField - 1 + fieldKeys.length) % fieldKeys.length;
      } else {
        state.addRouterField = (state.addRouterField + 1) % fieldKeys.length;
      }
      state.render();
      return;
    }

    if (keyName === 'backspace' && currentKey !== 'preferBinary') {
      const val = state.addRouterForm[currentKey];
      state.addRouterForm[currentKey] = [...val].slice(0, -1).join('');
      state.render();
      return;
    }

    if (
      currentKey !== 'preferBinary' &&
      key.sequence &&
      key.sequence.length === 1 &&
      keyName !== 'tab' &&
      keyName !== 'enter' &&
      keyName !== 'return' &&
      keyName !== 'escape'
    ) {
      if (!key.ctrl && !/[\x00-\x1f\x7f-\x9f]/.test(key.sequence) && state.addRouterForm[currentKey].length < 256) {
        state.addRouterForm[currentKey] += key.sequence;
        state.render();
      }
    }
  }
}

export function renderAttributionFooter(screen: TerminalScreen, rows: number, cols: number): void {
  screen.moveTo(rows, 1);
  const brand = chalk.gray(' MikroTik NetDevOps Suite v1.3.0');
  const authorLink = terminalLink('Ardian Ryan', 'https://github.com/ardianryan');
  const authorFull = `${chalk.gray('Engineered by ')}${chalk.cyan.bold(authorLink)}${chalk.gray(' (https://github.com/ardianryan) ')}`;
  const authorCompact = `${chalk.gray('Engineered by ')}${chalk.cyan.bold(authorLink)} `;

  const authorText = cols >= 88 ? authorFull : authorCompact;
  const authorLen = stringWidth(authorText);
  const brandLen = stringWidth(brand);

  if (cols >= 68) {
    const spaceLen = Math.max(1, cols - brandLen - authorLen);
    const fullLine = `${brand}${' '.repeat(spaceLen)}${authorText}`;
    screen.write(fullLine);
  } else {
    const compactLine = center(authorCompact, cols);
    screen.write(compactLine);
  }
}

export function renderGatewayView(
  screen: TerminalScreen,
  ctx: GatewayRenderContext,
  rows: number,
  cols: number
): void {
  const boxWidth = Math.min(84, Math.max(50, cols - 4));
  const boxHeight = Math.min(24, Math.max(16, rows - 2));
  const startRow = Math.max(2, Math.floor((rows - boxHeight) / 2));
  const startCol = Math.max(2, Math.floor((cols - boxWidth) / 2));

  const lines: string[] = [];

  const bannerTitle = ' MIKROTIK NETDEVOPS SUITE • ROUTER GATEWAY & LOGIN ';
  lines.push(chalk.bold.cyan(bannerTitle));
  lines.push(chalk.gray('[Ctrl+O] Offline linter & generators (no router needed)'));

  const isSelect = ctx.gatewayMode === 'select';
  const tab1 = isSelect
    ? chalk.bgCyan.black.bold(' [1] SELECT SAVED ROUTER ')
    : chalk.white(' [1] Select Saved Router ');
  const tab2 = !isSelect
    ? chalk.bgCyan.black.bold(' [2] + ADD NEW ROUTER ')
    : chalk.white(' [2] + Add New Router ');
  lines.push(`${tab1}   ${tab2}`);
  lines.push('');

  if (ctx.gatewayMode === 'select') {
    lines.push(chalk.bold.white('REGISTERED FLEET ROUTERS:'));
    lines.push(chalk.gray('Select a router and press [Enter] to authenticate and open the dashboard.'));
    lines.push('');

    const devices = ctx.fleetStore.devices;
    if (devices.length === 0) {
      lines.push(chalk.yellow('  (No routers stored yet. Press [A] or [2] to add a new router)'));
      lines.push('');
    } else {
      devices.forEach((dev, idx) => {
        const isSelected = idx === ctx.selectedFleetIndex;
        const arrow = isSelected ? chalk.cyan.bold(' ▶ ') : '   ';
        const namePart = padRight(dev.name, 16);
        const hostPart = padRight(`${dev.host}:${dev.port}`, 18);
        const userPart = padRight(dev.user, 10);
        const typePart = padRight(dev.preferBinary ? 'API (8728)' : 'REST (443/80)', 14);
        const modelPart = chalk.gray(`[${dev.model || 'MikroTik'}]`);

        const lineContent = `${arrow}${namePart} ${hostPart} ${userPart} ${typePart} ${modelPart}`;
        if (isSelected) {
          lines.push(chalk.bgCyan.black(padRight(lineContent, boxWidth - 6)));
        } else {
          lines.push(chalk.white(lineContent));
        }
      });
    }

    lines.push('');
    if (ctx.isConnecting) {
      lines.push(chalk.bgYellow.black(` ⏳ Connecting & authenticating to ${ctx.connectingTargetName}... Please wait. `));
    } else if (ctx.gatewayError) {
      lines.push(chalk.bgRed.white(` ${ctx.gatewayError} `));
    } else {
      lines.push('');
    }

    lines.push('');
    lines.push(chalk.gray('─'.repeat(boxWidth - 4)));
    lines.push(
      chalk.gray(
        `${chalk.cyan('[↑/↓]')} Select  ${chalk.green('[Enter]')} Login & Launch Dashboard  ${chalk.yellow('[A]')} Add  ${chalk.red('[D]')} Delete  ${chalk.magenta('[Ctrl+Q]')} Quit`
      )
    );
  } else {
    lines.push(chalk.bold.white('ONBOARDING: ENTER ROUTER CREDENTIALS:'));
    lines.push(chalk.gray('Fill in router details. Press [Enter] to proceed to the next field or submit.'));
    lines.push('');

    const fields: Array<{ label: string; value: string; hint?: string }> = [
      { label: 'Router Name', value: ctx.addRouterForm.name || chalk.gray('(e.g. core-router)') },
      { label: 'Host / IP', value: ctx.addRouterForm.host || chalk.gray('(e.g. 192.168.88.1)') },
      {
        label: 'Protocol / Mode',
        value: ctx.addRouterForm.preferBinary
          ? chalk.cyan.bold('Binary API Port 8728 (Native, No SSL)')
          : chalk.cyan.bold('REST API Port 443/80 (HTTPS/HTTP)'),
        hint: chalk.yellow('[Space to toggle]'),
      },
      { label: 'Port', value: ctx.addRouterForm.port },
      { label: 'Username', value: ctx.addRouterForm.user },
      {
        label: 'Password',
        value: ctx.addRouterForm.password
          ? '•'.repeat(ctx.addRouterForm.password.length)
          : chalk.gray('(leave empty if no password)'),
      },
      { label: 'Hardware Model', value: ctx.addRouterForm.model },
    ];

    fields.forEach((f, idx) => {
      const isCurrent = idx === ctx.addRouterField;
      const pointer = isCurrent ? chalk.cyan.bold(' ▶ ') : '   ';
      const labelStr = padRight(`${f.label}:`, 18);
      const valBox = `[ ${f.value} ]`;
      const hintStr = f.hint ? ` ${f.hint}` : '';
      const lineStr = `${pointer}${chalk.bold(labelStr)} ${valBox}${hintStr}`;

      if (isCurrent) {
        lines.push(chalk.bgCyan.black(padRight(lineStr, boxWidth - 6)));
      } else {
        lines.push(chalk.white(lineStr));
      }
    });

    lines.push('');
    if (ctx.isConnecting) {
      lines.push(chalk.bgYellow.black(` ⏳ Testing connection & saving router... Please wait. `));
    } else if (ctx.gatewayError) {
      lines.push(chalk.bgRed.white(` ${ctx.gatewayError} `));
    } else {
      lines.push('');
    }

    lines.push(chalk.gray('─'.repeat(boxWidth - 4)));
    lines.push(
      chalk.gray(
        `${chalk.cyan('[Tab/↑/↓]')} Move Field  ${chalk.green('[Enter]')} Save & Connect  ${chalk.yellow('[Esc]')} Cancel  ${chalk.magenta('[Ctrl+Q]')} Quit`
      )
    );
  }

  screen.drawBox(startRow, startCol, boxHeight, boxWidth, {
    title: 'ROUTER ONBOARDING & LOGIN GATEWAY',
    borderColor: chalk.cyan,
    focused: true,
    lines,
  });

  renderAttributionFooter(screen, rows, cols);
}
