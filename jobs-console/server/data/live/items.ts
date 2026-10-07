import type { jobs, pipelines } from '@databricks/sdk-experimental';
import type { Item, ItemDetail, ItemsResponse, TriggerKind } from '../../../shared/domain/types';
import type { LiveApi } from './api';
import { toSourceError } from './apiError';
import { Deadline, TIMEOUT, pool } from './collect';
import type { LiveLimits } from './limits';
import { jobUrl, pipelineUrl } from './links';
import type { LiveState } from './liveRunSource';
import { SourceError } from '../sourceError';

const ITEMS_TTL = 5 * 60_000;
const isSp = (s?: string) => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export function jobItem(j: jobs.BaseJob | jobs.Job, me: string, host: string): Item {
  const s = j.settings ?? {};
  const id = String(j.job_id ?? '');
  const runAs = s.run_as?.service_principal_name ?? s.run_as?.user_name ?? ('run_as_user_name' in j ? j.run_as_user_name : undefined) ?? j.creator_user_name;
  let trigger: TriggerKind = 'manual';
  let paused = false;
  if (s.continuous) {
    trigger = 'continuous';
    paused = s.continuous.pause_status === 'PAUSED';
  } else if (s.schedule) {
    trigger = 'schedule';
    paused = s.schedule.pause_status === 'PAUSED';
  } else if (s.trigger?.periodic) trigger = 'periodic';
  else if (s.trigger?.file_arrival) trigger = 'file_arrival';
  else if (s.trigger?.table_update) trigger = 'table_update';
  if (s.trigger && trigger !== 'manual' && trigger !== 'continuous' && trigger !== 'schedule') paused = s.trigger.pause_status === 'PAUSED';
  return {
    type: 'job', id, name: s.name ?? `job ${id}`,
    ...(s.description ? { description: s.description } : {}),
    ...(j.creator_user_name ? { creator: j.creator_user_name } : {}),
    ...(runAs ? { runAs } : {}),
    deployed: !!s.run_as?.service_principal_name || isSp(runAs),
    mine: !!me && (j.creator_user_name === me || runAs === me),
    tags: s.tags ?? {},
    trigger,
    ...(trigger === 'schedule' && s.schedule ? { schedule: { cron: s.schedule.quartz_cron_expression, tz: s.schedule.timezone_id, paused } } : {}),
    ...(trigger === 'periodic' && s.trigger?.periodic ? { periodic: { interval: s.trigger.periodic.interval, unit: s.trigger.periodic.unit } } : {}),
    paused,
    bundle: s.deployment?.kind === 'BUNDLE',
    ...(host ? { url: jobUrl(host, id) } : {}),
  };
}

export function pipelineItem(p: pipelines.PipelineStateInfo, spec: pipelines.GetPipelineResponse | undefined, me: string, host: string): Item {
  const id = p.pipeline_id ?? '';
  const runAs = p.run_as_user_name ?? spec?.run_as_user_name ?? p.creator_user_name;
  const continuous = !!spec?.spec?.continuous;
  return {
    type: 'pipeline', id, name: p.name ?? spec?.name ?? `pipeline ${id}`,
    ...(p.creator_user_name ? { creator: p.creator_user_name } : {}),
    ...(runAs ? { runAs } : {}),
    deployed: isSp(runAs),
    mine: !!me && (p.creator_user_name === me || runAs === me),
    tags: (spec?.spec as { tags?: Record<string, string> } | undefined)?.tags ?? {},
    trigger: continuous ? 'continuous' : 'manual',
    paused: false,
    bundle: spec?.spec?.deployment?.kind === 'BUNDLE',
    ...(host ? { url: pipelineUrl(host, id) } : {}),
  };
}

const TASK_TYPES: [keyof jobs.Task, string][] = [
  ['notebook_task', 'Notebook'], ['spark_python_task', 'Python script'], ['python_wheel_task', 'Python wheel'], ['sql_task', 'SQL'],
  ['pipeline_task', 'Pipeline'], ['run_job_task', 'Run job'], ['dbt_task', 'dbt'], ['spark_jar_task', 'JAR'], ['spark_submit_task', 'Spark submit'],
  ['condition_task', 'Condition'], ['for_each_task', 'For each'], ['clean_rooms_notebook_task', 'Clean room notebook'],
];

export function jobDetail(j: jobs.Job, me: string, host: string): ItemDetail {
  const tasks = (j.settings?.tasks ?? []).map((t) => ({
    key: t.task_key,
    type: TASK_TYPES.find(([k]) => t[k] !== undefined)?.[1] ?? 'Task',
    dependsOn: (t.depends_on ?? []).map((d) => d.task_key),
  }));
  return { item: jobItem(j, me, host), tasks };
}

export function pipelineDetail(spec: pipelines.GetPipelineResponse, me: string, host: string): ItemDetail {
  const s = spec.spec ?? {};
  const target = s.catalog && (s.schema ?? s.target) ? `${s.catalog}.${s.schema ?? s.target}` : (s.schema ?? s.target);
  return {
    item: pipelineItem({ pipeline_id: spec.pipeline_id, name: spec.name, creator_user_name: spec.creator_user_name, run_as_user_name: spec.run_as_user_name }, spec, me, host),
    pipeline: { kind: s.ingestion_definition ? 'Ingestion' : 'ETL', continuous: !!s.continuous, ...(target ? { target } : {}), serverless: !!s.serverless, ...(s.channel ? { channel: s.channel } : {}) },
  };
}

export interface LiveItemsOptions {
  api: LiveApi;
  user: () => Promise<string>;
  userKey: string;
  state: LiveState;
  limits: LiveLimits;
  clock?: () => number;
  timer?: () => number;
  source?: 'live' | 'replay';
}

export function createLiveItems(o: LiveItemsOptions): { listItems: () => Promise<ItemsResponse>; getItem: (type: 'job' | 'pipeline', id: string) => Promise<ItemDetail> } {
  const clock = o.clock ?? Date.now;
  const timer = o.timer ?? clock;
  return {
    async listItems() {
      const now = clock();
      const hit = o.state.items.get(o.userKey);
      if (hit && now - hit.at < ITEMS_TTL) return hit.data;
      const dl = new Deadline(timer() + o.limits.itemsTimeoutMs, timer);
      try {
        const [host, me] = await Promise.all([o.api.host(), o.user().catch(() => '')]);
        const items: Item[] = [];
        let partial: string | undefined;
        let token: string | undefined;
        do {
          const page = await dl.call(() => o.api.listJobs({ limit: 100, page_token: token }));
          if (page === TIMEOUT) {
            partial = `read ${items.length} jobs before the ${o.limits.itemsTimeoutMs / 1000}s limit`;
            break;
          }
          for (const j of page.jobs ?? []) items.push(jobItem(j, me, host));
          token = page.next_page_token;
        } while (token);
        const statuses: pipelines.PipelineStateInfo[] = [];
        if (!partial) {
          let pt: string | undefined;
          do {
            const page = await dl.call(() => o.api.listPipelines({ max_results: 100, page_token: pt }));
            if (page === TIMEOUT) {
              partial = 'pipelines list cut by the time limit';
              break;
            }
            statuses.push(...(page.statuses ?? []));
            pt = page.next_page_token;
          } while (pt);
        }
        const specs = new Map<string, pipelines.GetPipelineResponse>();
        let cut = 0;
        await pool(statuses.filter((p) => p.pipeline_id), o.limits.concurrency, async (p) => {
          const r = await dl.call(() => o.api.getPipeline({ pipeline_id: p.pipeline_id! }).catch(() => undefined));
          if (r === TIMEOUT) cut++;
          else if (r) specs.set(p.pipeline_id!, r);
        });
        if (cut && !partial) partial = `${cut} pipeline details cut by the time limit`;
        for (const p of statuses) items.push(pipelineItem(p, specs.get(p.pipeline_id ?? ''), me, host));
        const data: ItemsResponse = { asOf: now, source: o.source ?? 'live', items, ...(partial ? { partial: { reason: partial } } : {}) };
        if (!partial) o.state.items.set(o.userKey, { at: now, data });
        return data;
      } catch (e) {
        throw toSourceError(e);
      }
    },
    async getItem(type, id) {
      const [host, me] = await Promise.all([o.api.host(), o.user().catch(() => '')]);
      try {
        if (type === 'job') {
          if (!/^\d+$/.test(id)) throw new SourceError(404, `no job ${id}`);
          return jobDetail(await o.api.getJob({ job_id: Number(id) }), me, host);
        }
        return pipelineDetail(await o.api.getPipeline({ pipeline_id: id }), me, host);
      } catch (e) {
        throw toSourceError(e, true);
      }
    },
  };
}
