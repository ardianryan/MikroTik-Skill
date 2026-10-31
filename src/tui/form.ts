import { stringWidth, truncate } from './utils.js';

export interface FormField { key: string; label: string; value: string; }
export interface FormKey { name: string; sequence: string; ctrl?: boolean; shift?: boolean; }

export class TextForm {
  index = 0;
  constructor(readonly title: string, readonly fields: FormField[]) {}

  values(): Record<string, string> {
    return Object.fromEntries(this.fields.map((field) => [field.key, field.value.trim()]));
  }

  handle(key: FormKey): 'edit' | 'submit' | 'cancel' {
    if (key.name === 'escape') return 'cancel';
    if ((key.ctrl && key.name === 's') || key.name === 'return' || key.name === 'enter') return 'submit';
    if (key.name === 'up' || (key.name === 'tab' && key.shift)) this.index = (this.index - 1 + this.fields.length) % this.fields.length;
    else if (key.name === 'tab' || key.name === 'down') this.index = (this.index + 1) % this.fields.length;
    else {
      const field = this.fields[this.index];
      if (field) {
        if (key.ctrl && key.name === 'u') field.value = '';
        else if (key.name === 'backspace') field.value = Array.from(field.value).slice(0, -1).join('');
        else if (!key.ctrl && key.sequence && !/[\x00-\x1f\x7f-\x9f]/.test(key.sequence) && field.value.length + key.sequence.length <= 2048) field.value += key.sequence;
      }
    }
    return 'edit';
  }

  lines(maxFields: number, width = 120): string[] {
    const start = Math.max(0, this.index - Math.max(1, maxFields) + 1);
    return [this.title, 'Tab/↑/↓: field  Enter: run  Esc: cancel', 'Ctrl+U: clear field  Ctrl+Q: quit', ...this.fields.slice(start, start + Math.max(1, maxFields)).map((field, offset) => {
      const focused = start + offset === this.index;
      const prefix = `${focused ? '>' : ' '} ${truncate(field.label, Math.max(4, Math.floor(width / 2)))}: `;
      const cells = Math.max(1, width - stringWidth(prefix) - 1);
      const characters = Array.from(field.value);
      if (focused) while (characters.length && stringWidth(characters.join('')) > cells) characters.shift();
      return `${prefix}${focused ? characters.join('') + '█' : truncate(field.value, cells)}`;
    })];
  }
}
