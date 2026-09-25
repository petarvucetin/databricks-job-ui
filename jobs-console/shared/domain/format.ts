const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function pad(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

/** "1h 05m", "4m 09s", "42s". */
export function dur(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  if (h) return `${h}h ${pad(m)}m`;
  if (m) return `${m}m ${pad(x)}s`;
  return `${x}s`;
}

/** Ticking form: "1h 05m 09s", "4m 09s", "0m 07s". */
export function durLive(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return h ? `${h}h ${pad(m)}m ${pad(x)}s` : `${m}m ${pad(x)}s`;
}

export function dayLabel(ms: number): { num: number; mon: string; dow: string; full: string } {
  const d = new Date(ms);
  const mon = MON[d.getMonth()] ?? '';
  return { num: d.getDate(), mon, dow: DOW[d.getDay()] ?? '', full: `${d.getDate()} ${mon}` };
}

/** "22 Sep 02:41". */
export function fmtStart(ms: number): string {
  const d = new Date(ms);
  return `${dayLabel(ms).full} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Window edge: "23 Sep" at midnight, "22 Sep 14:00" otherwise. */
export function fmtEdge(ms: number): string {
  const d = new Date(ms);
  return d.getHours() || d.getMinutes() ? fmtStart(ms) : dayLabel(ms).full;
}
