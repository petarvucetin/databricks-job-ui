import type { sql } from '@databricks/sdk-experimental';
import type { LiveApi } from '../live/api';
import { TIMEOUT, type Deadline } from '../live/collect';

export type SqlRow = Record<string, string | null>;

const POLL_MS = 1000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A statement that ended FAILED / CANCELED / CLOSED: its message, with the Statement API's error code on `.code`. */
function statementError(s: sql.StatementResponse): Error & { code: string } {
  const e = s.status?.error;
  return Object.assign(new Error(e?.message || `statement ${s.status?.state ?? 'failed'}`), { code: e?.error_code ?? '' });
}

/**
 * Runs one SQL statement on a warehouse and answers its rows as objects keyed by column name (values as the API's
 * JSON_ARRAY strings). Polls every second while the statement is PENDING or RUNNING and pages through result chunks,
 * all within `dl`: TIMEOUT when the budget runs out. HTTP errors from the API pass through unchanged.
 */
export async function runSql(api: LiveApi, warehouseId: string, statement: string, params: Record<string, string>, dl: Deadline): Promise<SqlRow[] | typeof TIMEOUT> {
  let s = await dl.call(() =>
    api.executeStatement({
      warehouse_id: warehouseId,
      statement,
      parameters: Object.entries(params).map(([name, value]) => ({ name, value })),
      wait_timeout: '30s',
      on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    })
  );
  if (s === TIMEOUT) return TIMEOUT;
  while (s.status?.state === 'PENDING' || s.status?.state === 'RUNNING') {
    if ((await dl.call(() => sleep(POLL_MS))) === TIMEOUT) return TIMEOUT;
    const id: string = s.statement_id ?? '';
    const polled: sql.StatementResponse | typeof TIMEOUT = await dl.call(() => api.getStatement({ statement_id: id }));
    if (polled === TIMEOUT) return TIMEOUT;
    s = polled;
  }
  if (s.status?.state !== 'SUCCEEDED') throw statementError(s);

  const names = (s.manifest?.schema?.columns ?? []).map((c, i) => c.name ?? `col${i}`);
  const data: (string | null)[][] = [...(s.result?.data_array ?? [])];
  let next = s.result?.next_chunk_index;
  const id = s.statement_id ?? '';
  while (next !== undefined) {
    const at = next;
    const chunk = await dl.call(() => api.getStatementChunk({ statement_id: id, chunk_index: at }));
    if (chunk === TIMEOUT) return TIMEOUT;
    data.push(...(chunk.data_array ?? []));
    next = chunk.next_chunk_index;
  }
  return data.map((row) => Object.fromEntries(names.map((n, i) => [n, row[i] ?? null])));
}
