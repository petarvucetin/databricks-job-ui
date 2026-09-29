import type { CaptureFile } from './captureFile';

const utc = (ms: number | undefined) => (ms === undefined ? '-' : new Date(ms).toISOString().replace('T', ' ').slice(0, 19));
const counts = (o: Record<string, number> | undefined) =>
  o
    ? Object.entries(o)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([k, n]) => `${k} ${n}`)
        .join(', ')
    : '-';
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

function table(rows: string[][]): string[] {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  return rows.map((r) => '  ' + r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join('  ').trimEnd());
}

/** The first thing to read when a capture comes back: sessions, top diagnostics, errors, client errors. */
export function summarize(file: CaptureFile, topDiagnostics = 15): string {
  const out: string[] = [];
  out.push(`${file.format} v${file.version}, created ${file.createdAt}`);
  out.push(`app ${file.app.version}${file.app.gitSha ? ` (${file.app.gitSha})` : ''}, node ${file.app.node}; host ${file.workspace.host ?? '-'}; user ${file.workspace.user ?? '-'}; auth ${file.config.authMode ?? '-'}`);
  const cfg = Object.entries(file.config).filter(([k]) => k !== 'authMode' && k !== 'DATABRICKS_HOST');
  out.push(`config: ${cfg.map(([k, v]) => `${k}=${v}`).join(' ') || '(defaults)'}`);

  out.push('', `Sessions (${file.sessions.length}, oldest first)`);
  if (file.sessions.length) {
    out.push(
      ...table([
        ['id', 'route', 'started (UTC)', 'ms', 'status', 'calls', 'runs', 'by kind', 'by type'],
        ...file.sessions.map((s) => [
          s.id, s.route, utc(s.startedAt), String(s.ms), String(s.responseSummary?.status ?? '-'), String(s.calls.length),
          String(s.responseSummary?.runCount ?? '-'), counts(s.responseSummary?.byKind), counts(s.responseSummary?.byType),
        ]),
      ])
    );
  }

  const diags = new Map<string, { level: string; n: number; example: string }>();
  for (const s of file.sessions) {
    for (const d of s.diagnostics) {
      const e = diags.get(d.code) ?? { level: d.level, n: 0, example: `${d.ref ? d.ref + ': ' : ''}${d.message}` };
      e.n++;
      diags.set(d.code, e);
    }
  }
  const top = [...diags].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).slice(0, topDiagnostics);
  out.push('', `Diagnostics by code (${diags.size} codes${diags.size > top.length ? `, top ${top.length}` : ''})`);
  if (top.length) out.push(...table(top.map(([code, d]) => [String(d.n), d.level, code, cut(oneLine(d.example), 110)])));

  const errors = new Map<string, { n: number; example: string }>();
  const bump = (key: string, example: string) => {
    const e = errors.get(key) ?? { n: 0, example };
    e.n++;
    errors.set(key, e);
  };
  for (const s of file.sessions) {
    for (const c of s.calls) if (!c.ok && c.error) bump(`api ${c.method} ${c.error.statusCode ?? '-'} ${c.error.errorCode || c.error.name}`, c.error.message);
    if (s.error) bump(`session ${s.route} ${s.responseSummary?.status ?? '-'}`, s.error.message);
  }
  for (const p of file.process) bump(`process ${p.kind}${p.route ? ' ' + p.route : ''}`, p.message);
  out.push('', `Errors (${[...errors.values()].reduce((a, e) => a + e.n, 0)})`);
  const errRows = [...errors].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
  if (errRows.length) out.push(...table(errRows.map(([k, e]) => [String(e.n), k, cut(oneLine(e.example), 110)])));

  out.push('', `Client errors (${file.clientErrors.length})`);
  if (file.clientErrors.length) out.push(...table(file.clientErrors.map((c) => [c.at, cut(oneLine(c.message), 90), c.url])));
  return out.join('\n') + '\n';
}
