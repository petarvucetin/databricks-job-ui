import { describe, it, expect } from 'vitest';
import type { pipelines } from '@databricks/sdk-experimental';
import { indexEvents, pipelineNumber, updateDraft, type PipelineInfo } from './pipelines';

const NOW = 1_800_000_000_000;
const t0 = NOW - 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const UPD = '5f3c9a2e-1b7d-4c8e-9f01-23456789abcd';

const info: PipelineInfo = { pipelineId: 'p-1', name: '[dev mchen] raw_bronze_sap', continuous: false, runAs: 'sp-ingest' };
const update = (over: Partial<pipelines.UpdateInfo> = {}): pipelines.UpdateInfo => ({ update_id: UPD, pipeline_id: 'p-1', creation_time: t0, state: 'COMPLETED', cause: 'API_CALL', ...over });
const ev = (over: Partial<pipelines.PipelineEvent>): pipelines.PipelineEvent => ({ level: 'INFO', origin: { update_id: UPD, pipeline_id: 'p-1' }, ...over });

describe('pipelineNumber', () => {
  it('is stable, a safe integer, and differs across updates', () => {
    const a = pipelineNumber(UPD);
    expect(pipelineNumber(UPD)).toBe(a);
    expect(Number.isSafeInteger(a)).toBe(true);
    expect(a).toBeGreaterThan(0);
    expect(pipelineNumber('00000000-0000-0000-0000-000000000001')).not.toBe(a);
    const many = new Set(Array.from({ length: 2000 }, (_, i) => pipelineNumber(`upd-${i}`)));
    expect(many.size).toBe(2000);
  });
});

describe('indexEvents', () => {
  it('takes the end time from the last update_progress event and keeps errors oldest first', () => {
    const idx = indexEvents([
      ev({ event_type: 'update_progress', timestamp: iso(t0 + 900_000), message: `Update ${UPD.slice(0, 6)} is COMPLETED.` }),
      ev({ event_type: 'flow_progress', timestamp: iso(t0 + 800_000) }),
      ev({ event_type: 'update_progress', timestamp: iso(t0 + 1000), message: 'is RUNNING' }),
      ev({ level: 'ERROR', event_type: 'flow_progress', timestamp: iso(t0 + 700_000), message: 'Flow b failed', origin: { update_id: UPD, flow_name: 'silver_b' }, error: { exceptions: [{ message: 'second' }] } }),
      ev({ level: 'ERROR', event_type: 'flow_progress', timestamp: iso(t0 + 600_000), message: 'Flow a failed', origin: { update_id: UPD, flow_name: 'bronze_a' }, error: { exceptions: [{ class_name: 'org.apache.spark.sql.AnalysisException', message: '[TABLE_OR_VIEW_NOT_FOUND] The table or view `x` cannot be found.' }] } }),
      ev({ level: 'ERROR', timestamp: iso(t0), origin: { update_id: 'other' } }),
    ]);
    const u = idx.get(UPD)!;
    expect(u.endTime).toBe(t0 + 900_000);
    expect(u.errors.map((e) => e.message)).toEqual(['Flow a failed', 'Flow b failed']);
    expect(idx.get('other')!.endTime).toBeUndefined();
  });
});

describe('updateDraft', () => {
  it('maps a completed update with an end time from events', () => {
    const d = updateDraft(update(), info, { endTime: t0 + 900_000, errors: [] }, NOW);
    expect(d).toMatchObject({
      id: pipelineNumber(UPD), runId: 'upd 5f3c9a2e', type: 'pipeline', name: info.name, key: 'p:p-1', startTime: t0,
      durationSec: 900, live: false, queued: false, result: 'succeeded', ntasks: 1, failed: [], runAs: 'sp-ingest', continuous: false, params: {}, cause: null,
    });
  });

  it('maps every update state', () => {
    const at = (state: pipelines.UpdateInfoState) => updateDraft(update({ state }), info, undefined, NOW);
    for (const s of ['QUEUED', 'CREATED', 'WAITING_FOR_RESOURCES'] as const) expect(at(s)).toMatchObject({ queued: true, live: false, result: null, durationSec: 0 });
    for (const s of ['INITIALIZING', 'RESETTING', 'SETTING_UP_TABLES', 'RUNNING', 'STOPPING'] as const) expect(at(s)).toMatchObject({ queued: false, live: true, result: null, durationSec: 3600 });
    expect(at('COMPLETED').result).toBe('succeeded');
    expect(at('FAILED').result).toBe('failed');
    expect(at('CANCELED').result).toBe('cancelled');
  });

  it('finished updates without an end time get duration 0', () => {
    expect(updateDraft(update(), info, undefined, NOW).durationSec).toBe(0);
  });

  it('a live retry-on-failure update counts as retrying; continuous follows the spec', () => {
    const d = updateDraft(update({ state: 'RUNNING', cause: 'RETRY_ON_FAILURE' }), { ...info, continuous: true }, undefined, NOW);
    expect(d).toMatchObject({ retryAttempt: 1, continuous: true });
  });

  it('failed updates: cause from the first ERROR event exception, failed entry named after the flow', () => {
    const idx = indexEvents([
      ev({ event_type: 'update_progress', timestamp: iso(t0 + 120_000) }),
      ev({ level: 'ERROR', timestamp: iso(t0 + 60_000), message: 'Update is FAILED', origin: { update_id: UPD, flow_name: 'bronze_a' }, error: { exceptions: [{ class_name: 'org.apache.spark.sql.AnalysisException', message: '[TABLE_OR_VIEW_NOT_FOUND] The table or view `x` cannot be found.' }] } }),
    ]);
    const d = updateDraft(update({ state: 'FAILED' }), info, idx.get(UPD), NOW);
    expect(d.cause).toEqual({ label: 'Table not found', code: 'TABLE_OR_VIEW_NOT_FOUND', detail: '[TABLE_OR_VIEW_NOT_FOUND] The table or view `x` cannot be found.' });
    expect(d.failed).toEqual([{ name: 'bronze_a', cause: d.cause, secs: 120 }]);
  });

  it('failed updates without error events use the pipeline name and a plain cause', () => {
    const d = updateDraft(update({ state: 'FAILED' }), info, undefined, NOW);
    expect(d.cause).toEqual({ label: 'Failed', code: 'FAILED', detail: '' });
    expect(d.failed).toEqual([{ name: info.name, cause: d.cause, secs: 0 }]);
  });
});
