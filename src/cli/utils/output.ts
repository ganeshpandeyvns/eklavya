/**
 * CLI Output Utilities
 * Pretty printing, colors, and formatting for terminal output
 */

// ANSI color codes
export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Backgrounds
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

export function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}

export function bold(text: string): string {
  return `${colors.bold}${text}${colors.reset}`;
}

export function dim(text: string): string {
  return `${colors.dim}${text}${colors.reset}`;
}

export function success(text: string): string {
  return colorize(`✓ ${text}`, 'green');
}

export function error(text: string): string {
  return colorize(`✗ ${text}`, 'red');
}

export function warning(text: string): string {
  return colorize(`⚠ ${text}`, 'yellow');
}

export function info(text: string): string {
  return colorize(`ℹ ${text}`, 'blue');
}

export function header(text: string): void {
  const line = '═'.repeat(text.length + 4);
  console.log(colorize(`╔${line}╗`, 'cyan'));
  console.log(colorize(`║  ${text}  ║`, 'cyan'));
  console.log(colorize(`╚${line}╝`, 'cyan'));
}

export function subheader(text: string): void {
  console.log(`\n${colorize(bold(text), 'white')}`);
  console.log(colorize('─'.repeat(text.length + 2), 'gray'));
}

export function table(rows: string[][], headers?: string[]): void {
  if (rows.length === 0) {
    console.log(dim('  (no data)'));
    return;
  }

  // Calculate column widths
  const allRows = headers ? [headers, ...rows] : rows;
  const colWidths = allRows[0].map((_, colIndex) =>
    Math.max(...allRows.map(row => (row[colIndex] || '').length))
  );

  // Print headers
  if (headers) {
    const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join('  ');
    console.log(bold(headerRow));
    console.log(dim('─'.repeat(headerRow.length)));
  }

  // Print rows
  for (const row of rows) {
    const formattedRow = row.map((cell, i) => (cell || '').padEnd(colWidths[i])).join('  ');
    console.log(formattedRow);
  }
}

export function keyValue(data: Record<string, string | number | boolean | undefined>): void {
  const maxKeyLength = Math.max(...Object.keys(data).map(k => k.length));
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      console.log(`  ${dim(key.padEnd(maxKeyLength))}  ${value}`);
    }
  }
}

export function progressBar(current: number, total: number, width = 30): string {
  const percentage = total > 0 ? current / total : 0;
  const filled = Math.round(width * percentage);
  const empty = width - filled;
  const bar = colorize('█'.repeat(filled), 'green') + colorize('░'.repeat(empty), 'gray');
  const pct = (percentage * 100).toFixed(1).padStart(5);
  return `${bar} ${pct}%`;
}

export function statusBadge(status: string): string {
  const statusColors: Record<string, keyof typeof colors> = {
    // Project statuses
    active: 'green',
    completed: 'cyan',
    paused: 'yellow',
    failed: 'red',

    // Agent statuses
    working: 'green',
    idle: 'gray',
    blocked: 'yellow',
    terminated: 'red',

    // Task statuses
    pending: 'gray',
    in_progress: 'blue',

    // Demo statuses
    draft: 'gray',
    building: 'blue',
    ready: 'green',
    approved: 'cyan',
  };

  const color = statusColors[status.toLowerCase()] || 'white';
  return colorize(`[${status}]`, color);
}

export function cost(amount: number): string {
  return colorize(`$${amount.toFixed(2)}`, amount > 50 ? 'red' : amount > 20 ? 'yellow' : 'green');
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

export function timestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return dim(d.toLocaleString());
}

export function newline(): void {
  console.log('');
}

export function divider(): void {
  console.log(dim('─'.repeat(50)));
}
