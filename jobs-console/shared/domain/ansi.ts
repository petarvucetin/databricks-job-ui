/**
 * ANSI SGR (colour/style) escapes in Databricks task output, e.g. IPython tracebacks:
 * `\x1b[31mPy4JJavaError\x1b[39m`, `\x1b[38;5;28;01mdel\x1b[39;00m`, `\x1b[43mexec\x1b[49m`.
 * Only SGR (`...m`) is interpreted; every other escape sequence is dropped.
 */

export interface AnsiStyle {
  /** CSS colour. */
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface AnsiSegment extends AnsiStyle {
  text: string;
}

// CSI sequences (ESC [ params letter), OSC sequences (ESC ] ... BEL/ST), and any other two-byte escape.
// eslint-disable-next-line no-control-regex -- matching terminal escape characters is the point of this module
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** Text without any escape sequences (for one-line summaries, search and copy). */
export function stripAnsi(text: string): string {
  return text.replace(ESCAPES, '');
}

export const hasAnsi = (text: string): boolean => text.includes('\x1b');

// The 16 standard colours, tuned for the console's light paper background: terminal "yellow" and "white" are
// unreadable on it, so they map to the app's amber ink and body ink. Order: black, red, green, yellow, blue, magenta, cyan, white.
const FG16 = ['#27211c', '#c43d28', '#2c8c6a', '#9a5f05', '#2f6fb3', '#6a4fb0', '#1f7a8c', '#5b524a'];
const FG16_BRIGHT = ['#5b524a', '#d6452f', '#2f9e76', '#b0700a', '#3b7fc6', '#7d5fc4', '#2a8fa3', '#27211c'];
// Backgrounds become light washes (IPython marks the failing expression with a yellow background).
const BG16 = ['#e6ddd2', '#fbe7e1', '#e3f2ea', '#fdf0d8', '#e3ecf7', '#eee8f8', '#dff1f3', '#f4ece1'];

function xterm256(n: number): [number, number, number] {
  if (n < 16) return hex((n < 8 ? FG16 : FG16_BRIGHT)[n % 8] ?? '#000000');
  if (n < 232) {
    const i = n - 16;
    const step = (v: number) => (v ? 55 + v * 40 : 0);
    return [step(Math.floor(i / 36)), step(Math.floor(i / 6) % 6), step(i % 6)];
  }
  const g = 8 + (n - 232) * 10;
  return [g, g, g];
}

function hex(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

const css = ([r, g, b]: [number, number, number]) => `rgb(${r}, ${g}, ${b})`;

/** Foreground colours too light for the paper background are darkened until readable. */
function readableFg(rgb: [number, number, number]): string {
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  if (lum <= 0.6) return css(rgb);
  const k = 0.6 / lum;
  return css([Math.round(rgb[0] * k), Math.round(rgb[1] * k), Math.round(rgb[2] * k)]);
}

/** Background colours are lightened into washes so text on them stays readable. */
function washBg(rgb: [number, number, number]): string {
  return css([Math.round(rgb[0] * 0.25 + 255 * 0.75), Math.round(rgb[1] * 0.25 + 255 * 0.75), Math.round(rgb[2] * 0.25 + 255 * 0.75)]);
}

/** Reads an extended colour (`5;n` or `2;r;g;b`) starting at params[i]; returns the colour and how many params it used. */
function extended(params: number[], i: number): { rgb?: [number, number, number]; used: number } {
  if (params[i] === 5 && params[i + 1] !== undefined) return { rgb: xterm256(params[i + 1] ?? 0), used: 2 };
  if (params[i] === 2 && params[i + 3] !== undefined) return { rgb: [params[i + 1] ?? 0, params[i + 2] ?? 0, params[i + 3] ?? 0], used: 4 };
  return { used: 0 };
}

function applySgr(style: AnsiStyle, raw: string): AnsiStyle {
  const params = raw === '' ? [0] : raw.split(';').map((p) => (p === '' ? 0 : Number(p)));
  let s: AnsiStyle = { ...style };
  for (let i = 0; i < params.length; i++) {
    const p = params[i] ?? 0;
    if (p === 0) s = {};
    else if (p === 1) s.bold = true;
    else if (p === 3) s.italic = true;
    else if (p === 4) s.underline = true;
    else if (p === 22) s.bold = false;
    else if (p === 23) s.italic = false;
    else if (p === 24) s.underline = false;
    else if (p >= 30 && p <= 37) s.fg = FG16[p - 30];
    else if (p >= 90 && p <= 97) s.fg = FG16_BRIGHT[p - 90];
    else if (p === 39) delete s.fg;
    else if (p >= 40 && p <= 47) s.bg = BG16[p - 40];
    else if (p >= 100 && p <= 107) s.bg = BG16[p - 100];
    else if (p === 49) delete s.bg;
    else if (p === 38 || p === 48) {
      const { rgb, used } = extended(params, i + 1);
      if (rgb) {
        if (p === 38) s.fg = readableFg(rgb);
        else s.bg = washBg(rgb);
      }
      i += used;
    }
  }
  return s;
}

/**
 * Splits text into styled segments. `start` carries the style over from the previous line (IPython resets at line
 * ends, but other tools may not); the returned `end` is the style in force after the text.
 */
export function parseAnsi(text: string, start: AnsiStyle = {}): { segments: AnsiSegment[]; end: AnsiStyle } {
  const segments: AnsiSegment[] = [];
  let style = start;
  let at = 0;
  const push = (t: string) => {
    if (!t) return;
    const last = segments[segments.length - 1];
    if (last && sameStyle(last, style)) last.text += t;
    else segments.push({ text: t, ...style });
  };
  for (const m of text.matchAll(ESCAPES)) {
    push(text.slice(at, m.index));
    // eslint-disable-next-line no-control-regex -- an SGR escape starts with ESC
    const sgr = /^\x1b\[([0-9;]*)m$/.exec(m[0]);
    if (sgr) style = applySgr(style, sgr[1] ?? '');
    at = (m.index ?? 0) + m[0].length;
  }
  push(text.slice(at));
  return { segments, end: style };
}

function sameStyle(a: AnsiStyle, b: AnsiStyle): boolean {
  return a.fg === b.fg && a.bg === b.bg && !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.underline === !!b.underline;
}
