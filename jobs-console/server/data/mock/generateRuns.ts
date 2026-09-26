import type { Cause, FailedTask, Run, RunKind, RunResult, RunType, RunsResponse } from '../../../shared/domain/types';
import { lcg } from './random';

interface CauseSpec extends Cause {
  kind: RunKind;
  w: number;
}

const CAUSES: CauseSpec[] = [
  { kind: 'failed', label: 'Table not found', code: 'CLIENT_ERROR', detail: 'finance.gl_staging', w: 92 },
  { kind: 'failed', label: 'Cluster error', code: 'CLOUD_FAILURE', detail: 'spot instances reclaimed', w: 31 },
  { kind: 'failed', label: 'Timed out', code: 'TIMEDOUT', detail: 'limit 1h', w: 9 },
  { kind: 'failed', label: 'Permission denied', code: 'CLIENT_ERROR', detail: 'SELECT on finance.raw_bkpf', w: 5 },
  { kind: 'retrying', label: 'Retrying', code: 'CLOUD_FAILURE', detail: 'attempt 2 of 4', w: 12 },
  { kind: 'slow', label: 'Slow', code: '', detail: '', w: 41 },
  { kind: 'queued', label: 'Queued', code: 'MAX_CONCURRENT_RUNS_REACHED', detail: 'concurrency limit', w: 63 },
  { kind: 'snoozed', label: 'Snoozed', code: '', detail: 'until 15:00', w: 38 },
  { kind: 'succeeded', label: 'Succeeded', code: '', detail: '', w: 1620 },
];
const SUCCEEDED = CAUSES[8];
const RUNNING_CAUSE: CauseSpec = { kind: 'running', label: 'Running', code: '', detail: '', w: 0 };

const PREFIXES = [
  '[prod] aiges_ingest_sap_backfill_sys_bic_ngc_dwh_edw_',
  '[prod] aiges_ingest_sap_sap_erp1_edw_core_tables_',
  '[prod] aiges_ingest_sap_backfill_sys_bic_ngc_dwh_project_databricks_',
  '[prod] finance_gl_',
];
const SUFFIX_A = ['ca', 'mfg', 'sc', 'hr', 'fin', 'md', 'pp', 'sd', 'mm', 'co', 'fi', 'wm'];
const SUFFIX_B = [
  'cvg_ct_ecc_stxl_stxh', 'cvg_ct_ecc_td_afvc', 'cvg_ct_ecc_td_afvv', 'cvg_ct_ecc_td_jcds', 'cvg_ct_ecc_td_equz', 'cvg_ct_ecc_td_stas',
  'cds_zvcatslbraccum', 'core_tables_ca0', 'core_tables_fin0', 'core_tables_hr0', 'core_tables_jsto', 'core_tables_md0',
  'core_tables_mfg_op', 'core_tables_mfg0', 'core_tables_mfg1', 'gl_accounts_v3', 'gl_balances_v3', 'gl_journals_v3',
  'cost_centers_v3', 'profit_centers_v3', 'vendors_v3', 'customers_v3',
];
const TASK_NAMES = ['setup', 'extract_bkpf', 'extract_bseg', 'extract_gl', 'transform', 'dq_checks', 'load_gl', 'load_gl_history', 'load_cost_centers', 'load_profit_centers', 'load_vendors', 'publish', 'notify'];
const RUN_AS = ['sp-finance', 'sp-ingest', 'sp-analytics'];
const PIPE_PREFIX = '[prod] raw_bronze_sap_sap_erp1_edw_core_tables_';
const PIPE_SUFFIX = ['mfg_op', 'md0', 'ca0', 'sc0', 'fin0', 'hr0', 'jsto', 'mfg1', 'pp0', 'sd0', 'mm0', 'co0'];
const FLOWS = ['bronze_bkpf', 'bronze_bseg', 'silver_bkpf', 'silver_bseg', 'silver_gl_accounts', 'gold_gl_balances', 'gold_cost_centers', 'gold_vendors'];

/** Minute 0 is 24 Aug 2026 00:00 local; the data set's "now" is minute 42240, 22 Sep 08:00. */
export const NOW_MIN = 42240;

const DEFAULT_TZ_OFFSET_MIN = new Date(2026, 8, 22).getTimezoneOffset();

export function minuteToMs(min: number, tzOffsetMin: number = DEFAULT_TZ_OFFSET_MIN): number {
  const day = Math.floor(min / 1440);
  return Date.UTC(2026, 7, 24 + day, 0, min - day * 1440) + tzOffsetMin * 60000;
}

interface Draft {
  id: number;
  kind: RunKind;
  cause: CauseSpec;
  name: string;
  suffix: string;
  startMin: number;
  total: number;
  usual: number;
  ntasks: number;
  failed: { name: string; cause: CauseSpec; secs: number }[];
  runId: string;
  runAs: string;
  mine: boolean;
  old: boolean;
  type: RunType;
  continuous: boolean;
}

/**
 * Final outcome of a finished run; null while it is still going or waiting.
 * Failed and snoozed runs failed; a sprinkling of otherwise-successful runs were cancelled or only partially succeeded.
 */
function resultOf(d: { id: number; kind: RunKind }, live: boolean): RunResult | null {
  if (live || d.kind === 'queued' || d.kind === 'running' || d.kind === 'retrying') return null;
  if (d.kind === 'failed' || d.kind === 'snoozed') return 'failed';
  if (d.id % 13 === 0) return 'cancelled';
  if (d.id % 11 === 0) return 'partial';
  return 'succeeded';
}

const isLive = (d: Draft): boolean => d.kind === 'running' || d.kind === 'retrying' || d.continuous || (d.kind === 'slow' && d.startMin + d.total / 60 >= NOW_MIN);

const toCause = (c: CauseSpec): Cause => ({ label: c.label, code: c.code, detail: c.detail });

export function generateRuns(tzOffsetMin: number = DEFAULT_TZ_OFFSET_MIN): RunsResponse {
  const drafts: Draft[] = [];
  let id = 0;

  // Last 30 days (seed 7). Keep the exact order of random draws from the prototype.
  const rnd = lcg(7);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  for (const c of CAUSES) {
    for (let i = 0; i < c.w; i++) {
      let ntasks = 2 + Math.floor(rnd() * 19);
      const startMin = c.kind === 'retrying' || c.kind === 'queued' ? 41760 + Math.floor(rnd() * 480) : Math.floor(rnd() * 42240);
      const usual = 600 + Math.floor(rnd() * 6000);
      const total = c.kind === 'slow' ? Math.floor(usual * (1.6 + rnd() * 2)) : c.kind === 'queued' ? 0 : Math.floor(usual * (0.9 + rnd() * 0.3));
      if (c.kind === 'succeeded') ntasks = 2 + Math.floor(rnd() * 19);
      const nfail = c.kind === 'failed' ? Math.min(ntasks - 1, rnd() < 0.7 ? 1 : 2 + Math.floor(rnd() * 8)) : 0;
      const pool = TASK_NAMES.slice(1);
      const failed: Draft['failed'] = [];
      for (let f = 0; f < nfail; f++) {
        const name = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
        const cause = f === 0 || rnd() < 0.75 ? c : pick(CAUSES.slice(0, 4));
        failed.push({ name, cause, secs: 2 + Math.floor(rnd() * 5) });
      }
      const mine = rnd() < 0.055;
      const name = pick(PREFIXES);
      const suffix = pick(SUFFIX_A) + '_' + pick(SUFFIX_B);
      rnd(); // prototype drew "last run" duration here; kept so later draws line up
      const runId = String(630000000000000 + Math.floor(rnd() * 999999999));
      const runAs = pick(RUN_AS);
      drafts.push({ id: ++id, kind: c.kind, cause: c, name, suffix, startMin, total, usual, ntasks, failed, runId, runAs, mine, old: false, type: 'job', continuous: false });
    }
  }

  // Older history for the wider scales, days -61..-1 (seed 11), then 26 on-track running runs.
  const rnd2 = lcg(11);
  const pick2 = <T>(a: readonly T[]): T => a[Math.floor(rnd2() * a.length)];
  for (let od = -61; od < 0; od++) {
    const plan: CauseSpec[] = [];
    const nOk = 48 + Math.floor(rnd2() * 14);
    const nF = Math.floor(rnd2() * 7);
    const nS = Math.floor(rnd2() * 3);
    for (let q = 0; q < nOk; q++) plan.push(SUCCEEDED);
    for (let q = 0; q < nF; q++) plan.push(CAUSES[Math.floor(rnd2() * 4)]);
    for (let q = 0; q < nS; q++) plan.push(CAUSES[5]);
    for (const c of plan) {
      const m = Math.floor(rnd2() * 1440);
      const usual = 600 + Math.floor(rnd2() * 6000);
      const total = c.kind === 'slow' ? Math.floor(usual * (1.6 + rnd2() * 2)) : Math.floor(usual * (0.9 + rnd2() * 0.3));
      const failed: Draft['failed'] = c.kind === 'failed' ? [{ name: pick2(TASK_NAMES.slice(1)), cause: c, secs: 3 }] : [];
      const mine = rnd2() < 0.055;
      const name = pick2(PREFIXES);
      const suffix = pick2(SUFFIX_A) + '_' + pick2(SUFFIX_B);
      const ntasks = 2 + Math.floor(rnd2() * 19);
      const runId = String(630000000000000 + Math.floor(rnd2() * 999999999));
      const runAs = pick2(RUN_AS);
      drafts.push({ id: ++id, kind: c.kind, cause: c, name, suffix, startMin: od * 1440 + m, total, usual, ntasks, failed, runId, runAs, mine, old: true, type: 'job', continuous: false });
    }
  }
  for (let rr = 0; rr < 26; rr++) {
    const usual = 900 + Math.floor(rnd2() * 5400);
    const total = Math.floor(usual * (0.15 + rnd2() * 0.7));
    const mine = rnd2() < 0.08;
    const name = pick2(PREFIXES);
    const suffix = pick2(SUFFIX_A) + '_' + pick2(SUFFIX_B);
    const ntasks = 4 + Math.floor(rnd2() * 12);
    const runId = String(630000000000000 + Math.floor(rnd2() * 999999999));
    const runAs = pick2(RUN_AS);
    drafts.push({ id: ++id, kind: 'running', cause: RUNNING_CAUSE, name, suffix, startMin: NOW_MIN - Math.ceil(total / 60), total, usual, ntasks, failed: [], runId, runAs, mine, old: false, type: 'job', continuous: false });
  }

  // Every third-ish run is a pipeline. Continuous pipelines start early enough to still be going at now.
  for (const d of drafts) {
    d.type = d.id % 10 < 3 ? 'pipeline' : 'job';
    if (d.type !== 'pipeline') continue;
    d.name = PIPE_PREFIX;
    d.suffix = PIPE_SUFFIX[d.id % PIPE_SUFFIX.length] + '_dev';
    d.continuous = d.kind === 'slow' && d.id % 2 === 0 && !d.old;
    if (d.continuous) d.startMin = NOW_MIN - Math.ceil(d.total / 60);
    d.failed.forEach((f, i) => {
      f.name = FLOWS[(d.id + i * 3) % FLOWS.length];
    });
    d.runId = 'upd ' + ((d.id * 2654435761) % 4294967296).toString(16).slice(0, 8);
  }

  // A few slow jobs are still going at now, well past their average, so Slow is not only continuous pipelines.
  for (const d of drafts) {
    if (d.type === 'job' && d.kind === 'slow' && !d.old && d.id % 4 === 1) d.startMin = NOW_MIN - Math.floor(d.total / 60);
  }

  // Quiet days: 10-15 Sep and 21 Sep, every run completed with no errors.
  for (const d of drafts) {
    const wall = new Date(minuteToMs(d.startMin, tzOffsetMin) - tzOffsetMin * 60000);
    const quiet = wall.getUTCMonth() === 8 && ((wall.getUTCDate() >= 10 && wall.getUTCDate() <= 15) || wall.getUTCDate() === 21);
    if (!quiet || d.kind === 'succeeded' || d.kind === 'running') continue;
    d.kind = 'succeeded';
    d.cause = SUCCEEDED;
    d.failed = [];
    d.continuous = false;
    d.total = Math.floor(d.usual * (0.9 + (d.id % 20) / 100));
  }

  // Earlier today (seed 23): each job still going at now gets 1-6 finished runs back to back before the current one, so its run history has something to show.
  const rnd3 = lcg(23);
  const dayStart = NOW_MIN - 480;
  for (const d of drafts.filter(isLive)) {
    const want = 1 + Math.floor(rnd3() * 6);
    let before = d.startMin;
    for (let k = 0; k < want; k++) {
      let gap = 5 + Math.floor(rnd3() * 25);
      let total = Math.floor(d.usual * (0.85 + rnd3() * 0.3));
      if (total / 60 > before - gap - dayStart) {
        if (k > 0) break;
        // at least one run today: tighten the gap, and shorten the run if it still does not fit
        gap = 2;
        total = Math.min(total, Math.floor((before - gap - dayStart) * 60 * 0.9));
        if (total < 120) break;
      }
      const fail = rnd3() < 0.15;
      const cause = fail ? CAUSES[Math.floor(rnd3() * 4)] : SUCCEEDED;
      const startMin = before - gap - Math.ceil(total / 60);
      const failed: Draft['failed'] = fail ? [{ name: d.type === 'pipeline' ? FLOWS[(id + 1) % FLOWS.length] : TASK_NAMES[1 + ((id + 1) % (TASK_NAMES.length - 1))], cause, secs: 3 }] : [];
      const runId = d.type === 'pipeline' ? 'upd ' + (((id + 1) * 2654435761) % 4294967296).toString(16).slice(0, 8) : String(630000000000000 + Math.floor(rnd3() * 999999999));
      drafts.push({ ...d, id: ++id, kind: cause.kind, cause, startMin, total, failed, runId, old: false, continuous: false });
      before = startMin;
    }
  }

  const runs: Run[] = drafts.map((d) => {
    const failed: FailedTask[] = d.failed.map((f) => ({ name: f.name, cause: toCause(f.cause), secs: f.secs }));
    const live = isLive(d);
    return {
      result: resultOf(d, live),
      id: d.id,
      runId: d.runId,
      type: d.type,
      name: d.name + d.suffix,
      kind: d.kind,
      cause: toCause(d.cause),
      startTime: minuteToMs(d.startMin, tzOffsetMin),
      durationSec: d.total,
      usualSec: d.usual,
      ntasks: d.ntasks,
      failed,
      runAs: d.runAs,
      mine: d.mine,
      live,
      continuous: d.continuous,
    };
  });
  runs.sort((a, b) => b.startTime - a.startTime || b.id - a.id);
  return { asOf: minuteToMs(NOW_MIN, tzOffsetMin), source: 'mock', runs };
}
