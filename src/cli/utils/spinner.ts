/**
 * CLI Spinner
 * Animated loading indicator for long-running operations
 */

const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
  private interval: NodeJS.Timeout | null = null;
  private frameIndex = 0;
  private text: string;
  private stream = process.stderr;

  constructor(text: string = 'Loading...') {
    this.text = text;
  }

  start(text?: string): this {
    if (text) this.text = text;

    // Hide cursor
    this.stream.write('\x1b[?25l');

    this.interval = setInterval(() => {
      const frame = frames[this.frameIndex];
      this.stream.write(`\r\x1b[36m${frame}\x1b[0m ${this.text}`);
      this.frameIndex = (this.frameIndex + 1) % frames.length;
    }, 80);

    return this;
  }

  update(text: string): this {
    this.text = text;
    return this;
  }

  succeed(text?: string): void {
    this.stop();
    console.log(`\r\x1b[32m✓\x1b[0m ${text || this.text}`);
  }

  fail(text?: string): void {
    this.stop();
    console.log(`\r\x1b[31m✗\x1b[0m ${text || this.text}`);
  }

  warn(text?: string): void {
    this.stop();
    console.log(`\r\x1b[33m⚠\x1b[0m ${text || this.text}`);
  }

  info(text?: string): void {
    this.stop();
    console.log(`\r\x1b[34mℹ\x1b[0m ${text || this.text}`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    // Show cursor and clear line
    this.stream.write('\x1b[?25h\r\x1b[K');
  }
}

export function createSpinner(text?: string): Spinner {
  return new Spinner(text);
}
