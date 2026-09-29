import type { Cause, Run } from '../../../shared/domain/types';
import { FAILED, QUEUED, RUNNING, SLOW, SUCCEEDED } from './causes';

/** A mapped job run or pipeline update before the cross-run rules (usualSec, kind, mine) are applied. */
export interface Draft extends Omit<Run, 'kind' | 'cause' | 'usualSec' | 'mine'> {
  /** Groups runs of the same job or pipeline for usualSec. */
  key: string;
  queued: boolean;
  /** Highest retry attempt seen while live (0 = none). */
  retryAttempt: number;
  /** Queue reason for queued runs, failure cause for failed ones. */
  cause: Cause | null;
}

/** What usualSec is averaged over: the finished, succeeded runs of each key. */
export type UsualInput = Pick<Draft, 'key' | 'live' | 'queued' | 'result' | 'durationSec'>;

/** Average duration (s) of each key's succeeded runs. */
export function usualByKey(drafts: UsualInput[]): Map<string, number> {
  const sums = new Map<string, { n: number; total: number }>();
  for (const d of drafts) {
    if (d.live || d.queued || d.result !== 'succeeded') continue;
    const s = sums.get(d.key) ?? { n: 0, total: 0 };
    s.n++;
    s.total += d.durationSec;
    sums.set(d.key, s);
  }
  return new Map([...sums].map(([k, s]) => [k, Math.round(s.total / s.n)]));
}

/**
 * Kind rules, first match wins: queued, retrying, slow (live, >1.2x usual), running, failed, slow (finished, >1.5x usual), succeeded.
 * `usual` defaults to the averages over `drafts` themselves; a single refreshed run passes the averages of its list.
 */
export function finalize(drafts: Draft[], me: string | undefined, usual: Map<string, number> = usualByKey(drafts)): Run[] {
  const self = me?.toLowerCase();
  return drafts.map(({ key, queued, retryAttempt, cause, ...d }) => {
    const usualSec = usual.get(key) ?? d.durationSec;
    const over = (f: number) => usualSec > 0 && d.durationSec > usualSec * f;
    let kind: Run['kind'];
    let c: Cause;
    if (queued) [kind, c] = ['queued', cause ?? QUEUED];
    else if (d.live && retryAttempt > 0) [kind, c] = ['retrying', { label: 'Retrying', code: '', detail: `attempt ${retryAttempt + 1}` }];
    else if (d.live && over(1.2)) [kind, c] = ['slow', SLOW];
    else if (d.live) [kind, c] = ['running', RUNNING];
    else if (d.result === 'failed' || d.result === 'partial') [kind, c] = ['failed', cause ?? FAILED];
    else if (d.result === 'succeeded' && over(1.5)) [kind, c] = ['slow', SLOW];
    else [kind, c] = ['succeeded', SUCCEEDED];
    return { ...d, kind, cause: c, usualSec, mine: !!self && d.runAs.toLowerCase() === self };
  });
}

/** The usualSec key of a run already mapped (the Draft key it was grouped by). */
export const runKey = (r: Pick<Run, 'type' | 'jobId' | 'pipelineId' | 'name'>): string =>
  r.type === 'pipeline' ? `p:${r.pipelineId ?? ''}` : r.jobId !== undefined ? `j:${r.jobId}` : `r:${r.name}`;
