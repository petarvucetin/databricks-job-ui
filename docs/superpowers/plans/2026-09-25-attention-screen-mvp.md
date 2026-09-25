# Attention Screen MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the prototype's Attention screen as real React components in the `jobs-console` AppKit app. The screen is served from a deterministic mock runs API.

**Architecture:**
- **Server:** the AppKit server exposes `GET /api/runs` through a `RunSource` interface. The only source in this plan is a mock generator ported from the prototype.
- **Client:** a React client fetches the runs once. All filtering, timeline bucketing and row text are pure functions in `client/src/model/`, unit-tested in node. Components render those results and dispatch actions into one pure state reducer.
- **Shared:** `jobs-console/shared/domain/` holds the types and formatting used by both sides.

**Tech Stack:** AppKit 0.57.0 (Express server, Vite + React 19 client), TypeScript 5.9, vitest 4, @testing-library/react + jsdom, plain CSS with custom properties, self-hosted IBM Plex fonts.

**Spec:** `docs/superpowers/specs/2026-09-25-attention-screen-mvp.md`. Design references: `docs/design/01-landing-attention.md` (Row v2 and Running sections) and `prototype/drawer.html` (the behaviour being ported).

## Global Constraints

- **Location:** all app code lives in `jobs-console/`. Run every command from `D:/ai/projects/databricks-UI/jobs-console` unless a step says otherwise.
- **Windows host:** npm scripts run through Git Bash via `jobs-console/.npmrc` (`script-shell`). Do not change it.
- **Version pins:**
  - Never change the `@databricks/appkit` or `@databricks/appkit-ui` versions (0.57.0).
  - Install new devDependencies with `--save-exact`.
- **Lint:** no `as unknown as T` double assertions, because `appkit lint` fails the build on them. A single `as CSSProperties` on a style object is allowed.
- **Imports:**
  - Client code imports shared code by relative path without a file extension, e.g. `../../../shared/domain/types`.
  - Type-only imports use `import type`, because the client uses `verbatimModuleSyntax`.
- **Component files export only components:** this keeps `react-refresh/only-export-components` happy. Hooks and pure functions live in their own files.
- **Time:** epoch milliseconds everywhere. Day boundaries are local midnight, computed with `new Date(y, m, d + n)`. Tests run with `TZ=UTC`.
- **Mock "now":** `asOf` is 22 Sep 2026 08:00 local. The timeline ends at the following midnight (23 Sep 00:00).
- **Visual identity:** the warm paper palette and IBM Plex Sans/Mono from the prototype. Do not use appkit-ui's look for the screen itself.
- **Copy:**
  - Status titles: Failed, Retrying, Slow, Running, Queued, Snoozed, Succeeded.
  - Toggle label: "Running now".
  - App name: "Jobs console".
  - Data badge: "mock data".
- **Commits:** end every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01EWiaTMzxtZXmt6avfLzrYQ
  ```

## Review Focus

1. **Unaligned windows:** in the 90d week view, a window that doesn't sit on week boundaries (e.g. "last 2 days") must still highlight a sensible column, and dragging must snap it to week edges without leaving the domain. Tested in Task 7 (`dragHandle` on an unaligned window).
2. **Filters that match nothing:** the list shows "Nothing matches these filters." instead of a blank area, the tiles show 0, and the reference block disappears. Tested in Task 12.
3. **The runs API fails or is unreachable:** the page shows an error line with a Retry button, not a blank page or an endless spinner. Tested in Task 9 (`useRuns`) and Task 12.
4. **Messy search text:** upper case, leading/trailing spaces and double spaces still match on every token. Tested in Task 6.
5. **A live run passing its average while you watch:** the progress edge switches from filling to striped "over" without a reload. Tested in Task 5 (`progress` with the elapsed time passed in).

---

### Task 1: Test tooling, fonts, design tokens, app shell

**Files:**
- Modify: `jobs-console/vitest.config.ts`
- Modify: `jobs-console/tsconfig.client.json` (include `shared/domain`)
- Modify: `jobs-console/client/src/index.css` (replace)
- Modify: `jobs-console/client/src/App.tsx` (replace)
- Create: `jobs-console/client/src/styles/tokens.css`
- Create: `jobs-console/client/src/components/Shell.tsx`
- Create: `jobs-console/client/src/components/shell.css`
- Create: `jobs-console/client/public/fonts/` (copy 5 woff2 files)
- Test: `jobs-console/client/src/components/Shell.test.tsx`

**Interfaces:**
- Produces: the `Shell` component, `({ source, children }: { source?: 'mock' | 'live'; children: ReactNode }) => JSX.Element`. It renders the header "Jobs console" and a badge reading "mock data" or "live data" when `source` is set.

- [ ] **Step 1: Install test dependencies**

Run: `npm install --save-dev --save-exact jsdom @testing-library/react @testing-library/dom`
Expected: exits 0; `package.json` devDependencies gain the three packages, each with an exact version.

- [ ] **Step 2: Configure vitest for UTC and jsdom-capable tests**

Replace `jobs-console/vitest.config.ts` with:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    passWithNoTests: true,
    globals: true,
    environment: 'node',
    env: { TZ: 'UTC' },
    exclude: ['**/node_modules/**', '**/dist/**', '**/.databricks/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
    },
  },
});
```

In `jobs-console/tsconfig.client.json`, change the `include` line to:

```json
  "include": ["client/src", "shared/appkit-types", "shared/domain"]
```

- [ ] **Step 3: Copy fonts**

Run (Git Bash): `mkdir -p client/public/fonts && cp ../prototype/*.woff2 client/public/fonts/ && ls client/public/fonts`
Expected: five files: `IBMPlexMono-400.woff2 IBMPlexMono-500.woff2 IBMPlexSans-400.woff2 IBMPlexSans-500.woff2 IBMPlexSans-600.woff2`.

- [ ] **Step 4: Write the failing test**

`jobs-console/client/src/components/Shell.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Shell } from './Shell';

afterEach(cleanup);

describe('Shell', () => {
  it('shows the app name and the data-mode badge', () => {
    render(<Shell source="mock"><p>body</p></Shell>);
    expect(screen.getByRole('heading', { name: 'Jobs console' })).toBeTruthy();
    expect(screen.getByText('mock data')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('hides the badge until the source is known', () => {
    render(<Shell><p>body</p></Shell>);
    expect(screen.queryByText(/data$/)).toBeNull();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run client/src/components/Shell.test.tsx`
Expected: FAIL, "Failed to resolve import ./Shell".

- [ ] **Step 6: Implement tokens, shell, and entry styles**

`jobs-console/client/src/styles/tokens.css`:

```css
@font-face { font-family: "IBM Plex Sans"; font-weight: 400; font-display: swap; src: url("/fonts/IBMPlexSans-400.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Sans"; font-weight: 500; font-display: swap; src: url("/fonts/IBMPlexSans-500.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Sans"; font-weight: 600; font-display: swap; src: url("/fonts/IBMPlexSans-600.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Mono"; font-weight: 400; font-display: swap; src: url("/fonts/IBMPlexMono-400.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Mono"; font-weight: 500; font-display: swap; src: url("/fonts/IBMPlexMono-500.woff2") format("woff2"); }

:root {
  --paper: #f6f0e7; --sheet: #fffdf9; --ink: #27211c; --ink-2: #5b524a; --ink-3: #948a80; --rule: #e6ddd2;
  --red: #d6452f; --amber: #d98a12; --green: #2c8c6a; --blue: #2f6fb3; --purple: #6a4fb0; --label: #6b3fd6;
  --wash-red: #fbe7e1; --wash-amber: #fdf0d8; --wash-green: #e3f2ea; --wash-sand: #f4ece1; --wash-blue: #e3ecf7; --wash-purple: #eee8f8;
  --amber-ink: #9a5f05;
  --sans: "IBM Plex Sans", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, Consolas, monospace;
}

html, body { margin: 0; background: var(--sheet); color: var(--ink); font-family: var(--sans); font-size: 13.5px; line-height: 1.45; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
@keyframes blink { 50% { opacity: .25; } }
```

Replace `jobs-console/client/src/index.css` with:

```css
@import "@databricks/appkit-ui/styles.css";
@import "./styles/tokens.css";
```

`jobs-console/client/src/components/shell.css`:

```css
.shell-top { display: flex; align-items: center; gap: 12px; padding: 10px 24px; background: var(--paper); border-bottom: 1px solid var(--rule); }
.shell-top h1 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: .01em; }
.shell-badge { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); background: var(--wash-sand); border: 1px solid #e3d7c6; border-radius: 4px; padding: 1px 7px; }
.shell-body { min-height: calc(100vh - 44px); }
```

`jobs-console/client/src/components/Shell.tsx`:

```tsx
import type { ReactNode } from 'react';
import './shell.css';

export function Shell({ source, children }: { source?: 'mock' | 'live'; children: ReactNode }) {
  return (
    <div className="shell">
      <header className="shell-top">
        <h1>Jobs console</h1>
        {source && <span className="shell-badge">{source === 'mock' ? 'mock data' : 'live data'}</span>}
      </header>
      <main className="shell-body">{children}</main>
    </div>
  );
}
```

Replace `jobs-console/client/src/App.tsx` with (the Attention page replaces the placeholder in Task 12):

```tsx
import { Shell } from './components/Shell';

export default function App() {
  return (
    <Shell>
      <p style={{ padding: 24 }}>Loading…</p>
    </Shell>
  );
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run client/src/components/Shell.test.tsx && npm run typecheck`
Expected: 2 tests PASS; typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add -A jobs-console
git commit -m "Set up test tooling, design tokens, fonts and app shell"
```

---

### Task 2: Shared domain types and formatting

**Files:**
- Create: `jobs-console/shared/domain/types.ts`
- Create: `jobs-console/shared/domain/format.ts`
- Test: `jobs-console/shared/domain/format.test.ts`

**Interfaces:**
- Produces: `RUN_KINDS`, `RunKind`, `RunType`, `Cause`, `FailedTask`, `Run`, `RunsResponse` (see the code below), plus:
  - `pad(n: number): string`
  - `dur(sec: number): string`
  - `durLive(sec: number): string`
  - `dayLabel(ms: number): { num: number; mon: string; dow: string; full: string }`
  - `fmtStart(ms: number): string`
  - `fmtEdge(ms: number): string`

- [ ] **Step 1: Write the types (no test; they are declarations)**

`jobs-console/shared/domain/types.ts`:

```ts
export const RUN_KINDS = ['failed', 'retrying', 'slow', 'running', 'queued', 'snoozed', 'succeeded'] as const;
export type RunKind = (typeof RUN_KINDS)[number];
export type RunType = 'job' | 'pipeline';

export interface Cause {
  label: string;
  code: string;
  detail: string;
}

export interface FailedTask {
  name: string;
  cause: Cause;
  secs: number;
}

export interface Run {
  id: number;
  runId: string;
  type: RunType;
  /** Full job or pipeline name, including the bundle target prefix such as "[prod] ". */
  name: string;
  kind: RunKind;
  cause: Cause;
  /** Epoch milliseconds. */
  startTime: number;
  /** Elapsed so far for live runs, total otherwise; 0 while queued. */
  durationSec: number;
  /** Average duration of this job. */
  usualSec: number;
  ntasks: number;
  failed: FailedTask[];
  runAs: string;
  mine: boolean;
  /** Still going at `asOf`. */
  live: boolean;
  /** Continuous pipeline. */
  continuous: boolean;
}

export interface RunsResponse {
  /** Epoch ms the data describes ("now" for the data set). */
  asOf: number;
  source: 'mock' | 'live';
  /** Newest first. */
  runs: Run[];
}
```

- [ ] **Step 2: Write the failing test**

`jobs-console/shared/domain/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dur, durLive, fmtStart, fmtEdge, dayLabel, pad } from './format';

describe('format', () => {
  it('pads to two digits', () => {
    expect(pad(3)).toBe('03');
    expect(pad(12)).toBe('12');
  });

  it('formats durations like the prototype', () => {
    expect(dur(0)).toBe('0s');
    expect(dur(59)).toBe('59s');
    expect(dur(249)).toBe('4m 09s');
    expect(dur(3900)).toBe('1h 05m');
    expect(dur(-5)).toBe('0s');
  });

  it('formats ticking durations with seconds always shown', () => {
    expect(durLive(249)).toBe('4m 09s');
    expect(durLive(3909)).toBe('1h 05m 09s');
    expect(durLive(7)).toBe('0m 07s');
  });

  it('formats start times and window edges in local time', () => {
    expect(fmtStart(new Date(2026, 8, 22, 2, 41).getTime())).toBe('22 Sep 02:41');
    expect(fmtEdge(new Date(2026, 8, 23).getTime())).toBe('23 Sep');
    expect(fmtEdge(new Date(2026, 8, 22, 14, 0).getTime())).toBe('22 Sep 14:00');
  });

  it('labels days', () => {
    expect(dayLabel(new Date(2026, 8, 22).getTime())).toEqual({ num: 22, mon: 'Sep', dow: 'Tue', full: '22 Sep' });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run shared/domain/format.test.ts`
Expected: FAIL, "Failed to resolve import ./format".

- [ ] **Step 4: Implement**

`jobs-console/shared/domain/format.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run shared/domain/format.test.ts && npm run typecheck`
Expected: 5 tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A jobs-console/shared
git commit -m "Add shared run types and formatting helpers"
```

---

### Task 3: Deterministic mock run generator

This is a faithful port of the prototype's generator (`prototype/drawer.html`, "deterministic synthetic data"). The random draws must run in the same order as the prototype, so the data matches.

**Files:**
- Create: `jobs-console/server/data/mock/random.ts`
- Create: `jobs-console/server/data/mock/generateRuns.ts`
- Test: `jobs-console/server/data/mock/generateRuns.test.ts`

**Interfaces:**
- Consumes: `Run`, `RunsResponse`, `Cause`, `FailedTask`, `RunKind`, `RunType` from `shared/domain/types`.
- Produces:
  - `lcg(seed: number): () => number`
  - `NOW_MIN = 42240`
  - `minuteToMs(min: number): number` (minute 0 = 24 Aug 2026 00:00 local)
  - `generateRuns(): RunsResponse` (runs newest first, `source: 'mock'`)

- [ ] **Step 1: Write the failing test**

`jobs-console/server/data/mock/generateRuns.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateRuns, minuteToMs, NOW_MIN } from './generateRuns';

const data = generateRuns();
const onDay = (ms: number, month: number, day: number) => {
  const d = new Date(ms);
  return d.getMonth() === month && d.getDate() === day;
};

describe('generateRuns', () => {
  it('is deterministic', () => {
    expect(generateRuns()).toEqual(data);
  });

  it('pins "now" to 22 Sep 2026 08:00 local', () => {
    expect(data.asOf).toBe(new Date(2026, 8, 22, 8, 0).getTime());
    expect(minuteToMs(NOW_MIN)).toBe(data.asOf);
    expect(data.source).toBe('mock');
  });

  it('never starts a run after now, and covers 91 days back to 24 Jun', () => {
    for (const r of data.runs) expect(r.startTime).toBeLessThanOrEqual(data.asOf);
    const oldest = Math.min(...data.runs.map((r) => r.startTime));
    expect(oldest).toBeGreaterThanOrEqual(new Date(2026, 5, 24).getTime());
    expect(oldest).toBeLessThan(new Date(2026, 5, 25).getTime());
  });

  it('keeps 10-15 Sep and 21 Sep all succeeded', () => {
    const quiet = data.runs.filter((r) => [10, 11, 12, 13, 14, 15, 21].some((d) => onDay(r.startTime, 8, d)));
    expect(quiet.length).toBeGreaterThan(300);
    for (const r of quiet) expect(r.kind).toBe('succeeded');
  });

  it('has 26 on-track running runs and only in-progress kinds are live', () => {
    expect(data.runs.filter((r) => r.kind === 'running')).toHaveLength(26);
    for (const r of data.runs.filter((x) => x.live)) expect(['running', 'retrying', 'slow']).toContain(r.kind);
    for (const r of data.runs.filter((x) => x.continuous)) expect(r.live).toBe(true);
  });

  it('gives pipelines update ids and full names', () => {
    const pipes = data.runs.filter((r) => r.type === 'pipeline');
    expect(pipes.length).toBeGreaterThan(0);
    for (const r of pipes) {
      expect(r.runId).toMatch(/^upd [0-9a-f]{1,8}$/);
      expect(r.name.startsWith('[prod] raw_bronze_sap_sap_erp1_edw_core_tables_')).toBe(true);
      expect(r.name.endsWith('_dev')).toBe(true);
    }
  });

  it('sorts newest first with unique ids', () => {
    for (let i = 1; i < data.runs.length; i++) expect(data.runs[i - 1].startTime).toBeGreaterThanOrEqual(data.runs[i].startTime);
    expect(new Set(data.runs.map((r) => r.id)).size).toBe(data.runs.length);
  });

  it('gives failed runs at least one failed task', () => {
    for (const r of data.runs.filter((x) => x.kind === 'failed')) expect(r.failed.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/data/mock/generateRuns.test.ts`
Expected: FAIL, "Failed to resolve import ./generateRuns".

- [ ] **Step 3: Implement**

`jobs-console/server/data/mock/random.ts`:

```ts
/** The prototype's linear congruential generator. Same seed, same sequence. */
export function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
```

`jobs-console/server/data/mock/generateRuns.ts`:

```ts
import type { Cause, FailedTask, Run, RunKind, RunType, RunsResponse } from '../../../shared/domain/types';
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

export function minuteToMs(min: number): number {
  const day = Math.floor(min / 1440);
  return new Date(2026, 7, 24 + day, 0, min - day * 1440).getTime();
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

const toCause = (c: CauseSpec): Cause => ({ label: c.label, code: c.code, detail: c.detail });

export function generateRuns(): RunsResponse {
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

  // Quiet days: 10-15 Sep and 21 Sep, every run completed with no errors.
  for (const d of drafts) {
    const day = new Date(minuteToMs(d.startMin));
    const quiet = day.getMonth() === 8 && ((day.getDate() >= 10 && day.getDate() <= 15) || day.getDate() === 21);
    if (!quiet || d.kind === 'succeeded' || d.kind === 'running') continue;
    d.kind = 'succeeded';
    d.cause = SUCCEEDED;
    d.failed = [];
    d.continuous = false;
    d.total = Math.floor(d.usual * (0.9 + (d.id % 20) / 100));
  }

  const runs: Run[] = drafts.map((d) => {
    const failed: FailedTask[] = d.failed.map((f) => ({ name: f.name, cause: toCause(f.cause), secs: f.secs }));
    const live = d.kind === 'running' || d.kind === 'retrying' || d.continuous || (d.kind === 'slow' && d.startMin + d.total / 60 >= NOW_MIN);
    return {
      id: d.id,
      runId: d.runId,
      type: d.type,
      name: d.name + d.suffix,
      kind: d.kind,
      cause: toCause(d.cause),
      startTime: minuteToMs(d.startMin),
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
  return { asOf: minuteToMs(NOW_MIN), source: 'mock', runs };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server/data/mock/generateRuns.test.ts && npm run typecheck`
Expected: 8 tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A jobs-console/server
git commit -m "Port the prototype's deterministic mock run generator"
```

---

### Task 4: RunSource, the /api/runs route, server wiring

**Files:**
- Create: `jobs-console/server/data/runSource.ts`
- Create: `jobs-console/server/data/mock/mockRunSource.ts`
- Create: `jobs-console/server/api/listRuns.ts`
- Modify: `jobs-console/server/server.ts` (replace)
- Test: `jobs-console/server/api/listRuns.test.ts`

**Interfaces:**
- Consumes: `generateRuns()` from Task 3; `RunsResponse` from Task 2.
- Produces:
  - `interface RunSource { readonly kind: 'mock' | 'live'; listRuns(since?: number): Promise<RunsResponse> }`
  - `createMockRunSource(): RunSource`
  - `selectRunSource(env: Record<string, string | undefined>): RunSource`
  - `listRuns(source: RunSource, query: Record<string, unknown>): Promise<{ status: number; body: unknown }>`
  - HTTP: `GET /api/runs[?since=<ms>]` returns a `RunsResponse`.

- [ ] **Step 1: Write the failing test**

`jobs-console/server/api/listRuns.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { listRuns } from './listRuns';
import { createMockRunSource } from '../data/mock/mockRunSource';
import { selectRunSource } from '../data/runSource';
import type { RunsResponse } from '../../shared/domain/types';

const source = createMockRunSource();

describe('GET /api/runs handler', () => {
  it('returns every run when since is missing', async () => {
    const res = await listRuns(source, {});
    expect(res.status).toBe(200);
    const body = res.body as RunsResponse;
    expect(body.source).toBe('mock');
    expect(body.runs.length).toBeGreaterThan(4000);
  });

  it('filters by since (epoch ms)', async () => {
    const all = (await listRuns(source, {})).body as RunsResponse;
    const since = all.asOf - 2 * 86400000;
    const res = await listRuns(source, { since: String(since) });
    const body = res.body as RunsResponse;
    expect(body.runs.length).toBeGreaterThan(0);
    expect(body.runs.length).toBeLessThan(all.runs.length);
    for (const r of body.runs) expect(r.startTime).toBeGreaterThanOrEqual(since);
  });

  it('rejects a non-numeric since with 400', async () => {
    for (const bad of ['yesterday', '12abc', '', ['1', '2']]) {
      const res = await listRuns(source, { since: bad });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'since must be epoch milliseconds' });
    }
  });
});

describe('selectRunSource', () => {
  it('defaults to mock', () => {
    expect(selectRunSource({}).kind).toBe('mock');
    expect(selectRunSource({ JOBS_CONSOLE_DATA: 'mock' }).kind).toBe('mock');
  });

  it('refuses live until the live source exists', () => {
    expect(() => selectRunSource({ JOBS_CONSOLE_DATA: 'live' })).toThrow('JOBS_CONSOLE_DATA=live is not available yet');
    expect(() => selectRunSource({ JOBS_CONSOLE_DATA: 'banana' })).toThrow('Unknown JOBS_CONSOLE_DATA "banana"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/api/listRuns.test.ts`
Expected: FAIL, "Failed to resolve import ./listRuns".

- [ ] **Step 3: Implement**

`jobs-console/server/data/runSource.ts`:

```ts
import type { RunsResponse } from '../../shared/domain/types';
import { createMockRunSource } from './mock/mockRunSource';

/** Where runs come from. The mock source ships now; a live one (Jobs + Pipelines APIs as the signed-in user) comes later. */
export interface RunSource {
  readonly kind: 'mock' | 'live';
  /** Runs with startTime >= since (all runs when since is undefined), newest first. */
  listRuns(since?: number): Promise<RunsResponse>;
}

export function selectRunSource(env: Record<string, string | undefined>): RunSource {
  const mode = env.JOBS_CONSOLE_DATA ?? 'mock';
  if (mode === 'mock') return createMockRunSource();
  if (mode === 'live') throw new Error('JOBS_CONSOLE_DATA=live is not available yet');
  throw new Error(`Unknown JOBS_CONSOLE_DATA "${mode}"`);
}
```

`jobs-console/server/data/mock/mockRunSource.ts`:

```ts
import type { RunSource } from '../runSource';
import { generateRuns } from './generateRuns';

export function createMockRunSource(): RunSource {
  const data = generateRuns();
  return {
    kind: 'mock',
    listRuns(since) {
      return Promise.resolve({ ...data, runs: since === undefined ? data.runs : data.runs.filter((r) => r.startTime >= since) });
    },
  };
}
```

`jobs-console/server/api/listRuns.ts`:

```ts
import type { RunSource } from '../data/runSource';

export interface HandlerResult {
  status: number;
  body: unknown;
}

export async function listRuns(source: RunSource, query: Record<string, unknown>): Promise<HandlerResult> {
  const raw = query.since;
  let since: number | undefined;
  if (raw !== undefined) {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return { status: 400, body: { error: 'since must be epoch milliseconds' } };
    since = Number(raw);
  }
  return { status: 200, body: await source.listRuns(since) };
}
```

Replace `jobs-console/server/server.ts` with:

```ts
import { createApp, server } from '@databricks/appkit';
import { selectRunSource } from './data/runSource';
import { listRuns } from './api/listRuns';

const source = selectRunSource(process.env);

createApp({
  plugins: [server()],
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      app.get('/api/runs', (req, res, next) => {
        listRuns(source, req.query)
          .then((result) => {
            res.status(result.status).json(result.body);
          })
          .catch(next);
      });
    });
  },
}).catch(console.error);
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server && npm run typecheck`
Expected: all server tests PASS; typecheck exits 0.

- [ ] **Step 5: Verify the route over HTTP**

Start the server in the background: `npm run dev`. Wait until the log shows `Server running on http://localhost:8000`, then run:
`curl -s "http://localhost:8000/api/runs?since=1790000000000" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.source,j.runs.length,j.asOf)})"`
Expected: `mock <n> <asOf>`, where `<n>` is a positive count and `<asOf>` is the epoch ms of 22 Sep 2026 08:00 in the machine's timezone.
Also run: `curl -s -o /dev/null -w "%{http_code}" "http://localhost:8000/api/runs?since=abc"`. Expected: `400`.
Then stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add -A jobs-console/server
git commit -m "Serve runs from a mock RunSource at GET /api/runs"
```

---

### Task 5: Row view model

Pure functions that turn a `Run` into the row's words, states and numbers. They are ported from the prototype's `problemText`, `taskText`, `hist`, `schedule` (chain part), `chainHtml`, `msgHtml` and `cardHtml`.

**Files:**
- Create: `jobs-console/client/src/model/rowView.ts`
- Test: `jobs-console/client/src/model/rowView.test.ts`
- Create: `jobs-console/client/src/test/fixtures.ts`

**Interfaces:**
- Consumes: `Run` (Task 2), and `dur`, `durLive`, `fmtStart` (Task 2).
- Produces:
  - `makeRun(over?: Partial<Run>): Run` (test fixture)
  - `type TaskState = 'ok' | 'f' | 's' | 'r' | 'p'`
  - `type HistMark = '' | 'f' | 'a' | 'n'`
  - `problemText(r: Run): string`
  - `taskText(r: Run): string`
  - `historyMarks(r: Run): HistMark[]` (length 12)
  - `runningIndex(r: Run): number`
  - `taskStates(r: Run): TaskState[]`
  - `chainSummary(r: Run): string`
  - `liveMessage(r: Run): { lead: string; dim: string; red: boolean }`
  - `whenText(r: Run): string`
  - `borderTone(r: Run): '' | 'red' | 'amber' | 'blue'`
  - `elapsedSec(r: Run, nowMs: number, loadedAt: number): number`
  - `progress(r: Run, elapsed: number): { p: number; over: boolean }`
  - `statBlock(r: Run, elapsed: number, asOf: number): { label: 'now' | 'took' | 'waiting'; value: string; big: boolean; average: string }`
  - `splitName(name: string): { prefix: string; rest: string }`
  - `TASK_NAMES: readonly string[]`

- [ ] **Step 1: Write the fixture**

`jobs-console/client/src/test/fixtures.ts`:

```ts
import type { Run } from '../../../shared/domain/types';

const T0 = new Date(2026, 8, 22, 2, 41).getTime();

export function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: 1,
    runId: '630000000123456',
    type: 'job',
    name: '[prod] finance_gl_co_gl_journals_v3',
    kind: 'failed',
    cause: { label: 'Cluster error', code: 'CLOUD_FAILURE', detail: 'spot instances reclaimed' },
    startTime: T0,
    durationSec: 1404,
    usualSec: 1552,
    ntasks: 10,
    failed: [{ name: 'load_gl', cause: { label: 'Cluster error', code: 'CLOUD_FAILURE', detail: 'spot instances reclaimed' }, secs: 3 }],
    runAs: 'sp-finance',
    mine: false,
    live: false,
    continuous: false,
    ...over,
  };
}
```

- [ ] **Step 2: Write the failing test**

`jobs-console/client/src/model/rowView.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeRun } from '../test/fixtures';
import {
  problemText, taskText, historyMarks, taskStates, runningIndex, chainSummary, liveMessage,
  whenText, borderTone, elapsedSec, progress, statBlock, splitName,
} from './rowView';

const ok = { label: 'Succeeded', code: '', detail: '' };
const running = makeRun({ id: 40, kind: 'running', cause: { label: 'Running', code: '', detail: '' }, failed: [], live: true, ntasks: 10, durationSec: 600, usualSec: 1200 });

describe('rowView', () => {
  it('describes problems like the prototype', () => {
    expect(problemText(makeRun())).toBe('Cluster error');
    expect(problemText(makeRun({ failed: [makeRun().failed[0], { name: 'publish', cause: ok, secs: 2 }] }))).toBe('Cluster error, 2 tasks');
    expect(problemText(makeRun({ kind: 'slow', failed: [], durationSec: 4000, usualSec: 1000 }))).toBe('+50m 00s over usual');
    expect(problemText(running)).toBe('running, on track');
    expect(problemText(makeRun({ type: 'pipeline', kind: 'queued', failed: [] }))).toBe('waiting for resources');
  });

  it('names the failing task', () => {
    expect(taskText(makeRun())).toBe('load_gl');
    expect(taskText(makeRun({ kind: 'retrying', failed: [] }))).toBe('extract_bseg');
    expect(taskText(makeRun({ kind: 'succeeded', failed: [] }))).toBe('');
  });

  it('draws a 12-run history ending with the current state', () => {
    const h = historyMarks(makeRun());
    expect(h).toHaveLength(12);
    expect(h[11]).toBe('f');
    expect(historyMarks(makeRun({ kind: 'slow', failed: [] }))[11]).toBe('a');
    expect(historyMarks(makeRun({ id: 7 }))).toEqual(historyMarks(makeRun({ id: 7 })));
  });

  it('builds the task chain for failed, retrying and running runs', () => {
    const f = taskStates(makeRun({ ntasks: 10 }));
    expect(f).toHaveLength(10);
    expect(f.filter((s) => s === 'f')).toHaveLength(1);
    expect(taskStates(makeRun({ kind: 'retrying', failed: [], ntasks: 9 }))[4]).toBe('r');
    expect(runningIndex(running)).toBe(5);
    const r = taskStates(running);
    expect(r.slice(0, 5).every((s) => s === 'ok')).toBe(true);
    expect(r[5]).toBe('r');
    expect(r.slice(6).every((s) => s === 'p')).toBe(true);
    expect(chainSummary(running)).toBe('5 ok, 1 running, 4 to go');
  });

  it('writes the live message', () => {
    expect(liveMessage(running)).toEqual({ lead: 'load_gl running', dim: '5 of 10 tasks done, 50% of the average time', red: false });
    expect(liveMessage(makeRun({ kind: 'retrying', failed: [] })).lead).toBe('attempt 2 of 4');
  });

  it('says when, and picks the border tone', () => {
    expect(whenText(makeRun())).toBe('failed 22 Sep 02:41');
    expect(whenText(makeRun({ kind: 'queued' }))).toBe('queued since 22 Sep 02:41');
    expect(borderTone(makeRun())).toBe('red');
    expect(borderTone(running)).toBe('blue');
    expect(borderTone(makeRun({ kind: 'slow' }))).toBe('amber');
    expect(borderTone(makeRun({ kind: 'succeeded' }))).toBe('');
  });

  it('ticks elapsed time for live runs only', () => {
    expect(elapsedSec(running, 10_000 + 7_000, 10_000)).toBe(607);
    expect(elapsedSec(makeRun(), 10_000 + 7_000, 10_000)).toBe(1404);
  });

  it('switches the progress edge to "over" once elapsed passes the average', () => {
    expect(progress(running, 600)).toEqual({ p: 0.5, over: false });
    expect(progress(running, 1200)).toEqual({ p: 1, over: false });
    expect(progress(running, 1201).over).toBe(true);
  });

  it('fills the stats block', () => {
    expect(statBlock(running, 3909, 0)).toEqual({ label: 'now', value: '1h 05m 09s', big: true, average: '20m 00s' });
    expect(statBlock(makeRun(), 1404, 0)).toEqual({ label: 'took', value: '23m 24s', big: false, average: '25m 52s' });
    const q = makeRun({ kind: 'queued', durationSec: 0, startTime: 0 });
    expect(statBlock(q, 0, 49 * 60_000)).toEqual({ label: 'waiting', value: '49m 00s', big: false, average: '25m 52s' });
  });

  it('splits the bundle target prefix off the name', () => {
    expect(splitName('[prod] finance_gl_x')).toEqual({ prefix: '[prod] ', rest: 'finance_gl_x' });
    expect(splitName('plain_name')).toEqual({ prefix: '', rest: 'plain_name' });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run client/src/model/rowView.test.ts`
Expected: FAIL, "Failed to resolve import ./rowView".

- [ ] **Step 4: Implement**

`jobs-console/client/src/model/rowView.ts`:

```ts
import type { Run } from '../../../shared/domain/types';
import { dur, durLive, fmtStart } from '../../../shared/domain/format';

export type TaskState = 'ok' | 'f' | 's' | 'r' | 'p';
export type HistMark = '' | 'f' | 'a' | 'n';

export const TASK_NAMES = ['setup', 'extract_bkpf', 'extract_bseg', 'extract_gl', 'transform', 'dq_checks', 'load_gl', 'load_gl_history', 'load_cost_centers', 'load_profit_centers', 'load_vendors', 'publish', 'notify'] as const;

export function problemText(r: Run): string {
  if (r.type === 'pipeline') {
    if (r.kind === 'failed') return r.failed.length > 1 ? `${r.cause.label}, ${r.failed.length} flows` : r.cause.label;
    if (r.kind === 'slow' && r.continuous) return 'lagging, backlog rising';
    if (r.kind === 'queued') return 'waiting for resources';
    if (r.kind === 'retrying') return 'retry on failure, update 2';
  }
  switch (r.kind) {
    case 'failed':
      return r.failed.length > 1 ? `${r.cause.label}, ${r.failed.length} tasks` : r.cause.label;
    case 'slow':
      return `+${dur(r.durationSec - r.usualSec)} over usual`;
    case 'queued':
      return 'queued, concurrency limit';
    case 'retrying':
      return 'attempt 2 of 4';
    case 'running':
      return 'running, on track';
    case 'succeeded':
      return 'succeeded';
    case 'snoozed':
      return 'snoozed until 15:00';
  }
}

export function taskText(r: Run): string {
  if (r.type === 'pipeline' && !r.failed.length) return r.continuous ? 'bronze_bkpf' : '';
  if (r.failed.length) return r.failed.length > 1 ? `${r.failed[0].name} +${r.failed.length - 1}` : r.failed[0].name;
  return r.kind === 'retrying' ? 'extract_bseg' : '';
}

export function historyMarks(r: Run): HistMark[] {
  const out: HistMark[] = [];
  let x = r.id * 7919;
  for (let i = 0; i < 12; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const v = x / 2147483648;
    if (i === 11) out.push(r.kind === 'failed' ? 'f' : r.kind === 'slow' || r.kind === 'retrying' ? 'a' : '');
    else out.push(v < 0.08 ? 'f' : v < 0.14 ? 'a' : r.kind === 'queued' && v < 0.4 ? 'n' : '');
  }
  return out;
}

/** Index of the task running now, estimated from elapsed vs average. */
export function runningIndex(r: Run): number {
  return Math.min(r.ntasks - 1, Math.floor((r.ntasks * r.durationSec) / Math.max(1, r.usualSec)));
}

export function taskStates(r: Run): TaskState[] {
  const n = r.ntasks;
  const step = Math.floor(n / (r.failed.length + 1));
  const failAt = new Set(r.failed.map((_, i) => step * (i + 1)));
  const firstFail = r.failed.length ? step : Infinity;
  const k = runningIndex(r);
  const out: TaskState[] = [];
  for (let i = 0; i < n; i++) {
    if (failAt.has(i)) out.push('f');
    else if (i > firstFail && i % 5 !== 0) out.push('s');
    else if (r.kind === 'retrying' && i === Math.floor(n / 2)) out.push('r');
    else if (r.kind === 'running' && i === k) out.push('r');
    else if ((r.kind === 'running' && i > k) || r.kind === 'queued') out.push('p');
    else out.push('ok');
  }
  return out;
}

export function chainSummary(r: Run): string {
  const s = taskStates(r);
  const okc = s.filter((x) => x === 'ok').length;
  const sk = s.filter((x) => x === 's').length;
  if (r.kind === 'running') {
    const k = runningIndex(r);
    return `${k} ok, 1 running, ${r.ntasks - k - 1} to go`;
  }
  if (r.kind === 'succeeded') return 'all ok';
  if (r.kind === 'queued') return 'waiting to start';
  if (r.failed.length) return `${okc} ok, ${r.failed.length} failed${sk ? `, ${sk} skipped` : ''}`;
  if (r.kind === 'retrying') return r.type === 'pipeline' ? 'whole update retrying' : 'one task retrying';
  return r.continuous ? 'all flows running' : 'all running';
}

export function liveMessage(r: Run): { lead: string; dim: string; red: boolean } {
  if (r.type === 'pipeline') {
    if (r.kind === 'slow' && r.continuous) return { lead: 'backlog 48,210 files, rising for 35m', dim: 'Auto Loader source raw_bkpf', red: false };
    if (r.kind === 'retrying') return { lead: 'RETRY_ON_FAILURE', dim: 'update 1 lost its cluster after 48m, a new update started', red: false };
  }
  if (r.kind === 'running') {
    const k = runningIndex(r);
    return { lead: `${TASK_NAMES[1 + (k % (TASK_NAMES.length - 1))]} running`, dim: `${k} of ${r.ntasks} tasks done, ${Math.round((100 * r.durationSec) / Math.max(1, r.usualSec))}% of the average time`, red: false };
  }
  if (r.kind === 'retrying') return { lead: 'attempt 2 of 4', dim: 'attempt 1 lost its cluster after 48m, resuming from checkpoint', red: false };
  return { lead: `${dur(r.durationSec - r.usualSec)} over usual`, dim: 'same parameters, code and cluster as last run', red: false };
}

export function whenText(r: Run): string {
  const verb = r.kind === 'failed' ? 'failed' : r.kind === 'queued' ? 'queued since' : r.kind === 'succeeded' ? 'finished' : r.kind === 'snoozed' ? 'snoozed, last' : 'started';
  return `${verb} ${fmtStart(r.startTime)}`;
}

export function borderTone(r: Run): '' | 'red' | 'amber' | 'blue' {
  if (r.kind === 'failed') return 'red';
  if (r.kind === 'running') return 'blue';
  if (r.kind === 'slow' || r.kind === 'retrying') return 'amber';
  return '';
}

/** Live runs keep counting from when the data was loaded. */
export function elapsedSec(r: Run, nowMs: number, loadedAt: number): number {
  return r.live ? r.durationSec + Math.max(0, Math.floor((nowMs - loadedAt) / 1000)) : r.durationSec;
}

export function progress(r: Run, elapsed: number): { p: number; over: boolean } {
  const p = elapsed / Math.max(1, r.usualSec);
  return { p: Math.round(p * 1000) / 1000, over: elapsed > r.usualSec };
}

export function statBlock(r: Run, elapsed: number, asOf: number): { label: 'now' | 'took' | 'waiting'; value: string; big: boolean; average: string } {
  const average = dur(r.usualSec);
  if (r.live) return { label: 'now', value: durLive(elapsed), big: true, average };
  if (r.kind === 'queued') return { label: 'waiting', value: dur(Math.max(0, (asOf - r.startTime) / 1000)), big: false, average };
  return { label: 'took', value: dur(elapsed), big: false, average };
}

export function splitName(name: string): { prefix: string; rest: string } {
  const m = /^\[[^\]]+\] /.exec(name);
  const prefix = m ? m[0] : '';
  return { prefix, rest: name.slice(prefix.length) };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run client/src/model/rowView.test.ts && npm run typecheck`
Expected: all rowView tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A jobs-console/client/src
git commit -m "Add the run row view model"
```

---

### Task 6: Filter model

**Files:**
- Create: `jobs-console/client/src/model/filters.ts`
- Test: `jobs-console/client/src/model/filters.test.ts`

**Interfaces:**
- Consumes: `Run`, `RunKind`, `RUN_KINDS` (Task 2); `problemText`, `taskText` (Task 5); `fmtStart`, `dur` (Task 2).
- Produces:
  - `type Scope = 'mine' | 'all'`
  - `interface TimeWindow { from: number; to: number }`
  - `interface Filters { scope: Scope; types: string[]; runAs: string[]; codes: string[]; statuses: RunKind[]; live: boolean; query: string; window: TimeWindow }`
  - `codeOf(r: Run): string`
  - `passesExceptStatus(r: Run, f: Filters): boolean` (ignores query)
  - `matchesQuery(r: Run, q: string): boolean`
  - `passes(r: Run, f: Filters): boolean` (including query)
  - `autoStatuses(runs: Run[], f: Filters): RunKind[]`
  - `sortRuns(runs: Run[]): Run[]`
  - `scopeCounts(runs: Run[], end: number): { mine: number; all: number }`
  - `menuCounts(runs: Run[], key: 'types' | 'runAs' | 'codes'): Record<string, number>`
  - `liveCount(runs: Run[], scope: Scope): number`
  - `tileCounts(runs: Run[], f: Filters): Record<RunKind, Run[]>`
  - `tileSubtitle(kind: RunKind, runs: Run[], asOf: number): string`
  - `KIND_TITLES: Record<RunKind, string>`

- [ ] **Step 1: Write the failing test**

`jobs-console/client/src/model/filters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeRun } from '../test/fixtures';
import type { Filters } from './filters';
import { passes, passesExceptStatus, matchesQuery, autoStatuses, sortRuns, scopeCounts, menuCounts, liveCount, tileCounts, tileSubtitle, codeOf } from './filters';

const day = 86400000;
const end = new Date(2026, 8, 23).getTime();
const base: Filters = { scope: 'all', types: [], runAs: [], codes: [], statuses: [], live: false, query: '', window: { from: end - 2 * day, to: end } };
const t = new Date(2026, 8, 22, 5).getTime();
const failed = makeRun({ id: 1, startTime: t });
const ok = makeRun({ id: 2, kind: 'succeeded', failed: [], cause: { label: 'Succeeded', code: '', detail: '' }, startTime: t - 1000 });
const live = makeRun({ id: 3, kind: 'running', failed: [], live: true, cause: { label: 'Running', code: '', detail: '' }, startTime: t - 2000, mine: true });
const old = makeRun({ id: 4, startTime: end - 40 * day });

describe('filters', () => {
  it('hides succeeded runs when no status is selected', () => {
    expect(passes(failed, base)).toBe(true);
    expect(passes(ok, base)).toBe(false);
    expect(passes(ok, { ...base, statuses: ['succeeded'] })).toBe(true);
  });

  it('applies scope, window, live, type, run-as and code', () => {
    expect(passes(failed, { ...base, scope: 'mine' })).toBe(false);
    expect(passes(live, { ...base, scope: 'mine' })).toBe(true);
    expect(passes(old, base)).toBe(false);
    expect(passes(failed, { ...base, live: true })).toBe(false);
    expect(passes(live, { ...base, live: true })).toBe(true);
    expect(passes(failed, { ...base, types: ['pipeline'] })).toBe(false);
    expect(passes(failed, { ...base, runAs: ['sp-ingest'] })).toBe(false);
    expect(passes(failed, { ...base, codes: ['CLOUD_FAILURE'] })).toBe(true);
    expect(codeOf(ok)).toBe('none');
    expect(passesExceptStatus(ok, base)).toBe(true);
  });

  it('matches every search token regardless of case and spacing', () => {
    expect(matchesQuery(failed, '  CLUSTER   load_gl ')).toBe(true);
    expect(matchesQuery(failed, 'cluster permission')).toBe(false);
    expect(matchesQuery(failed, '')).toBe(true);
    expect(matchesQuery(failed, '630000000123456')).toBe(true);
    expect(passes(failed, { ...base, query: 'nope' })).toBe(false);
  });

  it('turns on exactly the statuses present in the window, in tile order', () => {
    expect(autoStatuses([ok, failed, live, old], base)).toEqual(['failed', 'running', 'succeeded']);
    expect(autoStatuses([ok, failed, live], { ...base, live: true })).toEqual(['running']);
  });

  it('sorts by status then newest first', () => {
    const a = makeRun({ id: 10, startTime: 1 });
    const b = makeRun({ id: 11, startTime: 2 });
    expect(sortRuns([ok, live, a, b]).map((r) => r.id)).toEqual([11, 10, 3, 2]);
  });

  it('counts scope, menus, live and tiles', () => {
    expect(scopeCounts([failed, ok, live, old], end)).toEqual({ mine: 1, all: 2 });
    expect(menuCounts([failed, ok, live], 'codes')).toEqual({ CLOUD_FAILURE: 1, none: 2 });
    expect(liveCount([failed, live], 'all')).toBe(1);
    expect(liveCount([failed, live], 'mine')).toBe(1);
    const tiles = tileCounts([failed, ok, live, old], base);
    expect(tiles.failed.map((r) => r.id)).toEqual([1]);
    expect(tiles.succeeded.map((r) => r.id)).toEqual([2]);
  });

  it('writes tile subtitles', () => {
    expect(tileSubtitle('failed', [failed, failed, makeRun({ cause: { label: 'Timed out', code: 'TIMEDOUT', detail: '' } })], 0)).toBe('2 cluster error');
    expect(tileSubtitle('running', [live], 0)).toBe('on track');
    expect(tileSubtitle('queued', [makeRun({ kind: 'queued', startTime: 0 })], 49 * 60_000)).toBe('longest 49m 00s');
    expect(tileSubtitle('failed', [], 0)).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run client/src/model/filters.test.ts`
Expected: FAIL, "Failed to resolve import ./filters".

- [ ] **Step 3: Implement**

`jobs-console/client/src/model/filters.ts`:

```ts
import { RUN_KINDS, type Run, type RunKind } from '../../../shared/domain/types';
import { dur, fmtStart } from '../../../shared/domain/format';
import { problemText, taskText } from './rowView';

export type Scope = 'mine' | 'all';

export interface TimeWindow {
  /** Inclusive, epoch ms. */
  from: number;
  /** Exclusive, epoch ms. */
  to: number;
}

export interface Filters {
  scope: Scope;
  /** Empty means no restriction. */
  types: string[];
  runAs: string[];
  /** Error codes; 'none' = runs without a code. */
  codes: string[];
  /** Empty means "everything except succeeded". */
  statuses: RunKind[];
  live: boolean;
  query: string;
  window: TimeWindow;
}

export const KIND_TITLES: Record<RunKind, string> = {
  failed: 'Failed', retrying: 'Retrying', slow: 'Slow', running: 'Running', queued: 'Queued', snoozed: 'Snoozed', succeeded: 'Succeeded',
};

const ERRWORDS: Record<string, string> = {
  'Table not found': 'analysisexception table_or_view_not_found finance.gl_staging missing table',
  'Cluster error': 'cloud_provider_shutdown spot reclaimed executor lost cluster terminated',
  'Timed out': 'timedout timeout cancelled partitions',
  'Permission denied': 'insufficient_permissions select grant unauthorized',
};

export function codeOf(r: Run): string {
  return r.cause.code || 'none';
}

/** Everything except status and search. The status tiles and auto-selection build on this. */
export function passesExceptStatus(r: Run, f: Filters): boolean {
  if (f.scope === 'mine' && !r.mine) return false;
  if (f.live && !r.live) return false;
  if (r.startTime < f.window.from || r.startTime >= f.window.to) return false;
  if (f.runAs.length && !f.runAs.includes(r.runAs)) return false;
  if (f.types.length && !f.types.includes(r.type)) return false;
  if (f.codes.length && !f.codes.includes(codeOf(r))) return false;
  return true;
}

const searchCache = new WeakMap<Run, string>();
function searchText(r: Run): string {
  const hit = searchCache.get(r);
  if (hit) return hit;
  const parts = [
    r.type === 'pipeline' ? 'pipeline etl update' + (r.continuous ? ' continuous lagging' : '') : 'job',
    r.name, r.runId, r.runAs, r.kind, r.cause.label, r.cause.code, r.cause.detail, ERRWORDS[r.cause.label] ?? '',
    problemText(r), fmtStart(r.startTime), r.mine ? 'mine me' : 'service principal deployed',
    ...r.failed.flatMap((x) => [x.name, x.cause.label]),
    r.failed.length ? '' : taskText(r),
  ];
  const s = parts.join(' ').toLowerCase();
  searchCache.set(r, s);
  return s;
}

export function matchesQuery(r: Run, q: string): boolean {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = searchText(r);
  return tokens.every((tok) => hay.includes(tok));
}

export function passes(r: Run, f: Filters): boolean {
  if (!passesExceptStatus(r, f) || !matchesQuery(r, f.query)) return false;
  return f.statuses.length ? f.statuses.includes(r.kind) : r.kind !== 'succeeded';
}

export function autoStatuses(runs: Run[], f: Filters): RunKind[] {
  const present = new Set<RunKind>();
  for (const r of runs) if (passesExceptStatus(r, f)) present.add(r.kind);
  return RUN_KINDS.filter((k) => present.has(k));
}

export function sortRuns(runs: Run[]): Run[] {
  const order = (k: RunKind) => RUN_KINDS.indexOf(k);
  return [...runs].sort((a, b) => order(a.kind) - order(b.kind) || b.startTime - a.startTime);
}

/** Runs needing attention over the last 30 days (not succeeded). */
export function scopeCounts(runs: Run[], end: number): { mine: number; all: number } {
  const since = new Date(new Date(end).getFullYear(), new Date(end).getMonth(), new Date(end).getDate() - 30).getTime();
  const att = runs.filter((r) => r.kind !== 'succeeded' && r.startTime >= since);
  return { mine: att.filter((r) => r.mine).length, all: att.length };
}

export function menuCounts(runs: Run[], key: 'types' | 'runAs' | 'codes'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of runs) {
    const k = key === 'types' ? r.type : key === 'runAs' ? r.runAs : codeOf(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function liveCount(runs: Run[], scope: Scope): number {
  return runs.filter((r) => r.live && (scope === 'all' || r.mine)).length;
}

/** Runs per status for the tiles: all filters except status, including search. */
export function tileCounts(runs: Run[], f: Filters): Record<RunKind, Run[]> {
  const out = Object.fromEntries(RUN_KINDS.map((k) => [k, [] as Run[]])) as Record<RunKind, Run[]>;
  for (const r of runs) if (passesExceptStatus(r, f) && matchesQuery(r, f.query)) out[r.kind].push(r);
  return out;
}

export function tileSubtitle(kind: RunKind, runs: Run[], asOf: number): string {
  if (!runs.length) return '';
  switch (kind) {
    case 'failed': {
      const c: Record<string, number> = {};
      for (const r of runs) c[r.cause.label] = (c[r.cause.label] ?? 0) + 1;
      const top = Object.keys(c).sort((a, b) => (c[b] ?? 0) - (c[a] ?? 0))[0];
      return `${c[top]} ${top.toLowerCase()}`;
    }
    case 'retrying':
      return 'attempt 2 of 4';
    case 'slow':
      return `worst +${dur(Math.max(...runs.map((r) => r.durationSec - r.usualSec)))}`;
    case 'running':
      return 'on track';
    case 'queued':
      return `longest ${dur(Math.max(...runs.map((r) => (asOf - r.startTime) / 1000)))}`;
    case 'snoozed':
      return 'until 15:00';
    case 'succeeded': {
      const slower = runs.filter((r) => r.durationSec > r.usualSec * 1.1).length;
      return slower ? `${slower} slower than usual` : '';
    }
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run client/src/model && npm run typecheck`
Expected: rowView and filters tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A jobs-console/client/src/model
git commit -m "Add the filter model: scope, window, status auto-selection, search, counts"
```

---

### Task 7: Timeline model

**Files:**
- Create: `jobs-console/client/src/model/timeline.ts`
- Test: `jobs-console/client/src/model/timeline.test.ts`

**Interfaces:**
- Consumes: `TimeWindow` (Task 6); `Run`, `RunKind` (Task 2); `dayLabel`, `pad` (Task 2).
- Produces:
  - `type ScaleId = '24h' | '7d' | '14d' | '30d' | '90d'`
  - `SCALE_ORDER: ScaleId[]`
  - `SCALES: Record<ScaleId, { days: number; unit: 'hour' | 'day' | 'week' }>`
  - `type Preset = 'all' | 'last7' | 'last2' | 'today'`
  - `interface Bucket { start: number; end: number }`
  - `addDays(ms: number, n: number): number`
  - `timelineEnd(asOf: number): number`
  - `buckets(scale: ScaleId, end: number): Bucket[]`
  - `domainStart(scale: ScaleId, end: number): number`
  - `fitScale(scale: ScaleId, w: TimeWindow, end: number): ScaleId`
  - `clampWindow(scale: ScaleId, w: TimeWindow, end: number): TimeWindow`
  - `presetWindow(p: Preset, scale: ScaleId, end: number): TimeWindow`
  - `sameWindow(a: TimeWindow, b: TimeWindow): boolean`
  - `countByBucket(runs: Run[], bks: Bucket[]): Array<Partial<Record<RunKind, number>> & { n: number }>`
  - `columnLabel(scale: ScaleId, b: Bucket, i: number, prev: Bucket | undefined): { num: string; small: string; month: boolean; title: string }`
  - `spanText(ms: number): string`
  - `edgeIndex(bks: Bucket[], t: number): number` (nearest edge, 0..n)
  - `edgeAt(bks: Bucket[], i: number): number`
  - `dragHandle(bks: Bucket[], w: TimeWindow, which: 'from' | 'to', idx: number): TimeWindow`
  - `shiftWindow(bks: Bucket[], w: TimeWindow, deltaCols: number): TimeWindow`

- [ ] **Step 1: Write the failing test**

`jobs-console/client/src/model/timeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeRun } from '../test/fixtures';
import {
  buckets, domainStart, fitScale, clampWindow, presetWindow, sameWindow, countByBucket, columnLabel,
  spanText, edgeIndex, edgeAt, dragHandle, shiftWindow, timelineEnd, addDays,
} from './timeline';

const asOf = new Date(2026, 8, 22, 8, 0).getTime();
const end = timelineEnd(asOf);

describe('timeline', () => {
  it('ends at the midnight after now', () => {
    expect(end).toBe(new Date(2026, 8, 23).getTime());
    expect(addDays(end, -2)).toBe(new Date(2026, 8, 21).getTime());
  });

  it('builds hour, day and week columns', () => {
    expect(buckets('24h', end)).toHaveLength(24);
    expect(buckets('24h', end)[0].start).toBe(new Date(2026, 8, 22).getTime());
    expect(buckets('7d', end)).toHaveLength(7);
    expect(buckets('30d', end)).toHaveLength(30);
    expect(buckets('30d', end)[0].start).toBe(new Date(2026, 7, 24).getTime());
    const w = buckets('90d', end);
    expect(w).toHaveLength(13);
    expect(w[0].start).toBe(new Date(2026, 5, 24).getTime());
    expect(w[12].end).toBe(end);
    expect(domainStart('90d', end)).toBe(new Date(2026, 5, 24).getTime());
  });

  it('widens the scale when the window does not fit, and trims when narrowing', () => {
    const last7 = presetWindow('last7', '24h', end);
    expect(fitScale('24h', last7, end)).toBe('7d');
    expect(fitScale('30d', presetWindow('last2', '30d', end), end)).toBe('30d');
    expect(clampWindow('24h', presetWindow('last2', '30d', end), end)).toEqual({ from: new Date(2026, 8, 22).getTime(), to: end });
    expect(clampWindow('24h', { from: 0, to: 5 }, end)).toEqual({ from: new Date(2026, 8, 22).getTime(), to: end });
  });

  it('computes presets', () => {
    expect(presetWindow('all', '90d', end)).toEqual({ from: domainStart('90d', end), to: end });
    expect(presetWindow('today', '30d', end)).toEqual({ from: new Date(2026, 8, 22).getTime(), to: end });
    expect(sameWindow(presetWindow('last2', '30d', end), { from: new Date(2026, 8, 21).getTime(), to: end })).toBe(true);
  });

  it('counts runs per column and state', () => {
    const bks = buckets('7d', end);
    const c = countByBucket([
      makeRun({ startTime: new Date(2026, 8, 22, 1).getTime() }),
      makeRun({ startTime: new Date(2026, 8, 22, 3).getTime(), kind: 'succeeded' }),
      makeRun({ startTime: new Date(2026, 7, 1).getTime() }),
    ], bks);
    expect(c[6]).toEqual({ n: 2, failed: 1, succeeded: 1 });
    expect(c[0]).toEqual({ n: 0 });
  });

  it('labels columns', () => {
    const d = buckets('30d', end);
    expect(columnLabel('30d', d[0], 0, undefined)).toEqual({ num: '24', small: 'Aug', month: true, title: 'Mon 24 Aug' });
    expect(columnLabel('30d', d[1], 1, d[0])).toEqual({ num: '25', small: 'Tue', month: false, title: 'Tue 25 Aug' });
    const h = buckets('24h', end);
    expect(columnLabel('24h', h[14], 14, h[13])).toEqual({ num: '14', small: '', month: false, title: '22 Sep 14:00' });
    const w = buckets('90d', end);
    expect(columnLabel('90d', w[1], 1, w[0])).toEqual({ num: '1', small: 'Jul', month: true, title: 'week of 1 Jul' });
    expect(columnLabel('90d', w[2], 2, w[1])).toEqual({ num: '8', small: 'wk', month: false, title: 'week of 8 Jul' });
  });

  it('describes spans', () => {
    expect(spanText(2 * 86400000)).toBe('2 days');
    expect(spanText(86400000)).toBe('1 day');
    expect(spanText(3 * 3600000)).toBe('3 hours');
    expect(spanText(91 * 86400000)).toBe('13 weeks');
    expect(spanText(14 * 86400000)).toBe('14 days');
  });

  it('drags handles and the bar, snapping to column edges and staying in the domain', () => {
    const bks = buckets('30d', end);
    const w = presetWindow('last2', '30d', end);
    expect(edgeIndex(bks, w.from)).toBe(28);
    expect(dragHandle(bks, w, 'from', 25)).toEqual({ from: edgeAt(bks, 25), to: end });
    expect(dragHandle(bks, w, 'from', 30)).toEqual({ from: edgeAt(bks, 29), to: end });
    expect(dragHandle(bks, w, 'to', 10)).toEqual({ from: w.from, to: edgeAt(bks, 29) });
    expect(shiftWindow(bks, w, -5)).toEqual({ from: edgeAt(bks, 23), to: edgeAt(bks, 25) });
    expect(shiftWindow(bks, w, 5)).toEqual(w);
  });

  it('snaps an unaligned window onto week edges when dragged in the 90d view', () => {
    const bks = buckets('90d', end);
    const w = presetWindow('last2', '90d', end);
    const moved = dragHandle(bks, w, 'from', 11);
    expect(moved).toEqual({ from: edgeAt(bks, 11), to: end });
    expect(moved.from).toBeGreaterThanOrEqual(domainStart('90d', end));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run client/src/model/timeline.test.ts`
Expected: FAIL, "Failed to resolve import ./timeline".

- [ ] **Step 3: Implement**

`jobs-console/client/src/model/timeline.ts`:

```ts
import type { Run, RunKind } from '../../../shared/domain/types';
import { dayLabel, pad } from '../../../shared/domain/format';
import type { TimeWindow } from './filters';

export type ScaleId = '24h' | '7d' | '14d' | '30d' | '90d';
export const SCALE_ORDER: ScaleId[] = ['24h', '7d', '14d', '30d', '90d'];
export const SCALES: Record<ScaleId, { days: number; unit: 'hour' | 'day' | 'week' }> = {
  '24h': { days: 1, unit: 'hour' },
  '7d': { days: 7, unit: 'day' },
  '14d': { days: 14, unit: 'day' },
  '30d': { days: 30, unit: 'day' },
  '90d': { days: 91, unit: 'week' },
};
export type Preset = 'all' | 'last7' | 'last2' | 'today';

export interface Bucket {
  start: number;
  end: number;
}

/** Calendar-day arithmetic in local time (safe across DST). */
export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()).getTime();
}

export function timelineEnd(asOf: number): number {
  const d = new Date(asOf);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

export function buckets(scale: ScaleId, end: number): Bucket[] {
  const s = SCALES[scale];
  const out: Bucket[] = [];
  if (s.unit === 'hour') {
    const d0 = addDays(end, -1);
    for (let i = 0; i < 24; i++) out.push({ start: d0 + i * 3600000, end: i === 23 ? end : d0 + (i + 1) * 3600000 });
  } else {
    const step = s.unit === 'week' ? 7 : 1;
    for (let i = 0; i < s.days / step; i++) out.push({ start: addDays(end, -s.days + i * step), end: addDays(end, -s.days + (i + 1) * step) });
  }
  return out;
}

export function domainStart(scale: ScaleId, end: number): number {
  return scale === '24h' ? addDays(end, -1) : addDays(end, -SCALES[scale].days);
}

export function fitScale(scale: ScaleId, w: TimeWindow, end: number): ScaleId {
  let i = SCALE_ORDER.indexOf(scale);
  while (w.from < domainStart(SCALE_ORDER[i], end) && i < SCALE_ORDER.length - 1) i++;
  return SCALE_ORDER[i];
}

export function clampWindow(scale: ScaleId, w: TimeWindow, end: number): TimeWindow {
  const d0 = domainStart(scale, end);
  const from = Math.max(w.from, d0);
  return w.to <= from ? { from: d0, to: end } : { from, to: w.to };
}

export function presetWindow(p: Preset, scale: ScaleId, end: number): TimeWindow {
  if (p === 'all') return { from: domainStart(scale, end), to: end };
  return { from: addDays(end, p === 'last7' ? -7 : p === 'last2' ? -2 : -1), to: end };
}

export function sameWindow(a: TimeWindow, b: TimeWindow): boolean {
  return a.from === b.from && a.to === b.to;
}

export function countByBucket(runs: Run[], bks: Bucket[]): Array<Partial<Record<RunKind, number>> & { n: number }> {
  const out: Array<Partial<Record<RunKind, number>> & { n: number }> = bks.map(() => ({ n: 0 }));
  const first = bks[0]?.start ?? 0;
  const last = bks[bks.length - 1]?.end ?? 0;
  for (const r of runs) {
    if (r.startTime < first || r.startTime >= last) continue;
    const i = bks.findIndex((b) => r.startTime >= b.start && r.startTime < b.end);
    const c = out[i];
    c[r.kind] = (c[r.kind] ?? 0) + 1;
    c.n++;
  }
  return out;
}

export function columnLabel(scale: ScaleId, b: Bucket, i: number, prev: Bucket | undefined): { num: string; small: string; month: boolean; title: string } {
  const L = dayLabel(b.start);
  const unit = SCALES[scale].unit;
  if (unit === 'hour') {
    const h = new Date(b.start).getHours();
    return { num: pad(h), small: i === 0 ? L.full : '', month: i === 0, title: `${L.full} ${pad(h)}:00` };
  }
  if (unit === 'week') {
    const newMonth = !prev || dayLabel(prev.start).mon !== L.mon;
    return { num: String(L.num), small: newMonth ? L.mon : 'wk', month: newMonth, title: `week of ${L.full}` };
  }
  const month = i === 0 || L.num === 1;
  return { num: String(L.num), small: month ? L.mon : L.dow, month, title: `${L.dow} ${L.full}` };
}

export function spanText(ms: number): string {
  const hours = Math.round(ms / 3600000);
  const days = Math.round(hours / 24);
  if (hours >= 23 && Math.abs(hours - days * 24) <= 1) {
    if (days % 7 === 0 && days > 14) return `${days / 7} weeks`;
    return days === 1 ? '1 day' : `${days} days`;
  }
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

export function edgeAt(bks: Bucket[], i: number): number {
  return i >= bks.length ? bks[bks.length - 1].end : bks[Math.max(0, i)].start;
}

export function edgeIndex(bks: Bucket[], t: number): number {
  let best = 0;
  for (let i = 1; i <= bks.length; i++) if (Math.abs(edgeAt(bks, i) - t) < Math.abs(edgeAt(bks, best) - t)) best = i;
  return best;
}

export function dragHandle(bks: Bucket[], w: TimeWindow, which: 'from' | 'to', idx: number): TimeWindow {
  const n = bks.length;
  const i = Math.max(0, Math.min(n, idx));
  if (which === 'from') {
    const toIdx = edgeIndex(bks, w.to);
    return { from: edgeAt(bks, Math.min(i, toIdx - 1)), to: w.to };
  }
  const fromIdx = edgeIndex(bks, w.from);
  return { from: w.from, to: edgeAt(bks, Math.max(i, fromIdx + 1)) };
}

export function shiftWindow(bks: Bucket[], w: TimeWindow, deltaCols: number): TimeWindow {
  const f = edgeIndex(bks, w.from);
  const t = edgeIndex(bks, w.to);
  const span = Math.max(1, t - f);
  const nf = Math.max(0, Math.min(bks.length - span, f + deltaCols));
  if (nf === f) return w;
  return { from: edgeAt(bks, nf), to: edgeAt(bks, nf + span) };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run client/src/model && npm run typecheck`
Expected: all model tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A jobs-console/client/src/model
git commit -m "Add the timeline model: scales, columns, presets, drag snapping"
```

---

### Task 8: View state reducer

A single pure function applies every user action to the view state. It reproduces the prototype's rules: status auto-selection, cube toggling, scale fitting and clearing.

**Files:**
- Create: `jobs-console/client/src/model/viewState.ts`
- Test: `jobs-console/client/src/model/viewState.test.ts`

**Interfaces:**
- Consumes: `Filters`, `autoStatuses` (Task 6); `ScaleId`, `Preset`, `buckets`, `presetWindow`, `fitScale`, `clampWindow`, `domainStart`, `sameWindow` (Task 7).
- Produces:
  - `interface ViewCtx { runs: Run[]; end: number }`
  - `interface ViewState { filters: Filters; scale: ScaleId; cube: { col: number; kind: RunKind } | null; cap: number }`
  - `type Action` (union below)
  - `initialState(ctx: ViewCtx): ViewState`
  - `applyAction(s: ViewState, a: Action, ctx: ViewCtx): ViewState`
  - `PAGE = 120`

- [ ] **Step 1: Write the failing test**

`jobs-console/client/src/model/viewState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeRun } from '../test/fixtures';
import { initialState, applyAction, PAGE, type ViewCtx } from './viewState';
import { buckets, presetWindow, domainStart } from './timeline';

const end = new Date(2026, 8, 23).getTime();
const runs = [
  makeRun({ id: 1, startTime: new Date(2026, 8, 22, 5).getTime() }),
  makeRun({ id: 2, kind: 'succeeded', failed: [], startTime: new Date(2026, 8, 21, 5).getTime() }),
  makeRun({ id: 3, kind: 'running', failed: [], live: true, startTime: new Date(2026, 8, 22, 7).getTime() }),
  makeRun({ id: 4, kind: 'succeeded', failed: [], startTime: new Date(2026, 8, 10, 5).getTime() }),
];
const ctx: ViewCtx = { runs, end };

describe('viewState', () => {
  it('starts on 30d, last 2 days, with the statuses present switched on', () => {
    const s = initialState(ctx);
    expect(s.scale).toBe('30d');
    expect(s.filters.window).toEqual(presetWindow('last2', '30d', end));
    expect(s.filters.statuses).toEqual(['failed', 'running', 'succeeded']);
    expect(s.cap).toBe(PAGE);
  });

  it('clicking a day selects it; clicking again selects the whole scale', () => {
    const s0 = initialState(ctx);
    const col = buckets('30d', end).findIndex((b) => b.start === new Date(2026, 8, 10).getTime());
    const s1 = applyAction(s0, { type: 'column', col }, ctx);
    expect(s1.filters.window).toEqual({ from: new Date(2026, 8, 10).getTime(), to: new Date(2026, 8, 11).getTime() });
    expect(s1.filters.statuses).toEqual(['succeeded']);
    const s2 = applyAction(s1, { type: 'column', col }, ctx);
    expect(s2.filters.window).toEqual({ from: domainStart('30d', end), to: end });
  });

  it('clicking a count filters to that column and status, and toggles back', () => {
    const s0 = initialState(ctx);
    const s1 = applyAction(s0, { type: 'cube', col: 29, kind: 'failed' }, ctx);
    expect(s1.cube).toEqual({ col: 29, kind: 'failed' });
    expect(s1.filters.statuses).toEqual(['failed']);
    const s2 = applyAction(s1, { type: 'cube', col: 29, kind: 'failed' }, ctx);
    expect(s2.cube).toBeNull();
    expect(s2.filters.window).toEqual({ from: domainStart('30d', end), to: end });
  });

  it('Running now keeps only live statuses; toggling off restores', () => {
    const s1 = applyAction(initialState(ctx), { type: 'toggleLive' }, ctx);
    expect(s1.filters.live).toBe(true);
    expect(s1.filters.statuses).toEqual(['running']);
    const s2 = applyAction(s1, { type: 'toggleLive' }, ctx);
    expect(s2.filters.statuses).toEqual(['failed', 'running', 'succeeded']);
  });

  it('changing scale trims the window; presets widen the scale', () => {
    const s1 = applyAction(initialState(ctx), { type: 'scale', scale: '24h' }, ctx);
    expect(s1.filters.window).toEqual({ from: new Date(2026, 8, 22).getTime(), to: end });
    const s2 = applyAction(s1, { type: 'preset', preset: 'last7' }, ctx);
    expect(s2.scale).toBe('7d');
    const s3 = applyAction(s2, { type: 'preset', preset: 'all' }, ctx);
    expect(s3.filters.window).toEqual({ from: domainStart('7d', end), to: end });
  });

  it('dragging sets the window and fits the scale', () => {
    const s = applyAction(initialState(ctx), { type: 'window', window: { from: new Date(2026, 6, 1).getTime(), to: end } }, ctx);
    expect(s.scale).toBe('90d');
  });

  it('toggles tiles, menus, scope, search; pages and clears', () => {
    let s = initialState(ctx);
    s = applyAction(s, { type: 'toggleStatus', kind: 'failed' }, ctx);
    expect(s.filters.statuses).toEqual(['running', 'succeeded']);
    s = applyAction(s, { type: 'toggleMenu', key: 'runAs', value: 'sp-ingest' }, ctx);
    expect(s.filters.runAs).toEqual(['sp-ingest']);
    s = applyAction(s, { type: 'toggleMenu', key: 'runAs', value: 'sp-ingest' }, ctx);
    expect(s.filters.runAs).toEqual([]);
    s = applyAction(s, { type: 'toggleMenu', key: 'codes', value: 'none' }, ctx);
    s = applyAction(s, { type: 'clearMenu', key: 'codes' }, ctx);
    expect(s.filters.codes).toEqual([]);
    s = applyAction(s, { type: 'scope', scope: 'mine' }, ctx);
    s = applyAction(s, { type: 'query', query: 'gl' }, ctx);
    s = applyAction(s, { type: 'more' }, ctx);
    expect(s.cap).toBe(2 * PAGE);
    s = applyAction(s, { type: 'clear' }, ctx);
    expect(s.filters.scope).toBe('mine');
    expect(s.filters.query).toBe('');
    expect(s.filters.window).toEqual(presetWindow('last2', '30d', end));
    expect(s.cap).toBe(PAGE);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run client/src/model/viewState.test.ts`
Expected: FAIL, "Failed to resolve import ./viewState".

- [ ] **Step 3: Implement**

`jobs-console/client/src/model/viewState.ts`:

```ts
import type { Run, RunKind } from '../../../shared/domain/types';
import { autoStatuses, type Filters, type Scope, type TimeWindow } from './filters';
import { buckets, clampWindow, domainStart, fitScale, presetWindow, sameWindow, type Preset, type ScaleId } from './timeline';

export const PAGE = 120;

export interface ViewCtx {
  runs: Run[];
  end: number;
}

export interface ViewState {
  filters: Filters;
  scale: ScaleId;
  cube: { col: number; kind: RunKind } | null;
  cap: number;
}

export type MenuKey = 'types' | 'runAs' | 'codes';

export type Action =
  | { type: 'scope'; scope: Scope }
  | { type: 'toggleMenu'; key: MenuKey; value: string }
  | { type: 'clearMenu'; key: MenuKey }
  | { type: 'query'; query: string }
  | { type: 'toggleLive' }
  | { type: 'toggleStatus'; kind: RunKind }
  | { type: 'scale'; scale: ScaleId }
  | { type: 'preset'; preset: Preset }
  | { type: 'column'; col: number }
  | { type: 'cube'; col: number; kind: RunKind }
  | { type: 'window'; window: TimeWindow }
  | { type: 'clear' }
  | { type: 'more' };

function withAuto(s: ViewState, ctx: ViewCtx): ViewState {
  return { ...s, filters: { ...s.filters, statuses: autoStatuses(ctx.runs, s.filters) } };
}

function setWindow(s: ViewState, window: TimeWindow, ctx: ViewCtx): ViewState {
  const filters = { ...s.filters, window };
  return withAuto({ ...s, filters, scale: fitScale(s.scale, window, ctx.end), cube: null }, ctx);
}

export function initialState(ctx: ViewCtx): ViewState {
  const filters: Filters = { scope: 'all', types: [], runAs: [], codes: [], statuses: [], live: false, query: '', window: presetWindow('last2', '30d', ctx.end) };
  return withAuto({ filters, scale: '30d', cube: null, cap: PAGE }, ctx);
}

export function applyAction(s: ViewState, a: Action, ctx: ViewCtx): ViewState {
  const f = s.filters;
  switch (a.type) {
    case 'scope':
      return { ...s, filters: { ...f, scope: a.scope }, cube: null };
    case 'toggleMenu': {
      const cur = f[a.key];
      const next = cur.includes(a.value) ? cur.filter((v) => v !== a.value) : [...cur, a.value];
      return { ...s, filters: { ...f, [a.key]: next } };
    }
    case 'clearMenu':
      return { ...s, filters: { ...f, [a.key]: [] } };
    case 'query':
      return { ...s, filters: { ...f, query: a.query } };
    case 'toggleLive':
      return withAuto({ ...s, filters: { ...f, live: !f.live }, cube: null }, ctx);
    case 'toggleStatus': {
      const statuses = f.statuses.includes(a.kind) ? f.statuses.filter((k) => k !== a.kind) : [...f.statuses, a.kind];
      return { ...s, filters: { ...f, statuses }, cube: null };
    }
    case 'scale': {
      const window = clampWindow(a.scale, f.window, ctx.end);
      return withAuto({ ...s, scale: a.scale, filters: { ...f, window }, cube: null }, ctx);
    }
    case 'preset':
      return setWindow(s, presetWindow(a.preset, s.scale, ctx.end), ctx);
    case 'window':
      return setWindow(s, a.window, ctx);
    case 'column': {
      const b = buckets(s.scale, ctx.end)[a.col];
      if (!b) return s;
      const one = { from: b.start, to: b.end };
      const all = { from: domainStart(s.scale, ctx.end), to: ctx.end };
      return setWindow(s, sameWindow(f.window, one) && !s.cube ? all : one, ctx);
    }
    case 'cube': {
      const b = buckets(s.scale, ctx.end)[a.col];
      if (!b) return s;
      if (s.cube && s.cube.col === a.col && s.cube.kind === a.kind) {
        return setWindow(s, { from: domainStart(s.scale, ctx.end), to: ctx.end }, ctx);
      }
      return { ...s, cube: { col: a.col, kind: a.kind }, filters: { ...f, window: { from: b.start, to: b.end }, statuses: [a.kind] } };
    }
    case 'clear': {
      const filters: Filters = { scope: f.scope, types: [], runAs: [], codes: [], statuses: [], live: false, query: '', window: presetWindow('last2', '30d', ctx.end) };
      return withAuto({ filters, scale: fitScale(s.scale, filters.window, ctx.end), cube: null, cap: PAGE }, ctx);
    }
    case 'more':
      return { ...s, cap: s.cap + PAGE };
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run client/src/model && npm run typecheck`
Expected: all model tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A jobs-console/client/src/model
git commit -m "Add the view state reducer"
```

---

### Task 9: Data and clock hooks, RunRow component

**Files:**
- Create: `jobs-console/client/src/hooks/useRuns.ts`
- Create: `jobs-console/client/src/hooks/useNow.ts`
- Create: `jobs-console/client/src/components/RunRow.tsx`
- Create: `jobs-console/client/src/components/runrow.css`
- Test: `jobs-console/client/src/hooks/useRuns.test.tsx`
- Test: `jobs-console/client/src/components/RunRow.test.tsx`

**Interfaces:**
- Consumes: all of `rowView` (Task 5); `RunsResponse` (Task 2).
- Produces:
  - `useRuns(): { state: 'loading' } | { state: 'error'; message: string; retry: () => void } | { state: 'ready'; data: RunsResponse; loadedAt: number }`
  - `useNow(intervalMs?: number): number`
  - `RunRow` component: `({ run, nowMs, loadedAt, asOf, selected?, onSelect? }) => JSX.Element`. The root element has class `rr` plus `b-red|b-amber|b-blue`, `live`, `over`, `on`, and `data-id`. Every labelled part carries `data-c="<n>"` using the Row v2 numbering: 2 type, 3 name, 4 cause, 5 task, 6 chain, 7 chain summary, 8 live message, 9 now/took, 10 when, 11 stats, 12 history, 13 run as.

- [ ] **Step 1: Write the failing tests**

`jobs-console/client/src/hooks/useRuns.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRuns } from './useRuns';

afterEach(() => vi.unstubAllGlobals());

describe('useRuns', () => {
  it('loads runs', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ asOf: 5, source: 'mock', runs: [] }), { status: 200 }))));
    const { result } = renderHook(() => useRuns());
    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('ready'));
    if (result.current.state === 'ready') expect(result.current.data.asOf).toBe(5);
  });

  it('reports an error and retries', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ asOf: 1, source: 'mock', runs: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.state).toBe('error'));
    if (result.current.state === 'error') {
      expect(result.current.message).toBe('Could not load runs: Failed to fetch');
      const retry = result.current.retry;
      act(() => retry());
    }
    await waitFor(() => expect(result.current.state).toBe('ready'));
  });

  it('treats a non-200 answer as an error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"error":"boom"}', { status: 500 }))));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.state).toBe('error'));
    if (result.current.state === 'error') expect(result.current.message).toBe('Could not load runs: HTTP 500');
  });
});
```

`jobs-console/client/src/components/RunRow.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { RunRow } from './RunRow';
import { makeRun } from '../test/fixtures';

afterEach(cleanup);

const live = makeRun({ id: 40, kind: 'running', failed: [], live: true, ntasks: 10, durationSec: 600, usualSec: 1200, cause: { label: 'Running', code: '', detail: '' } });

describe('RunRow', () => {
  it('renders a finished failed run: full name, run as, took + average, red border, no running parts', () => {
    const { container } = render(<RunRow run={makeRun()} nowMs={0} loadedAt={0} asOf={0} />);
    const row = container.querySelector('.rr')!;
    expect(row.className).toContain('b-red');
    expect(row.className).not.toContain('live');
    expect(container.querySelector('[data-c="3"]')!.textContent).toBe('[prod] finance_gl_co_gl_journals_v3');
    expect(container.querySelector('[data-c="13"]')!.textContent).toBe('run as: sp-finance');
    expect(container.querySelector('[data-c="9"]')!.textContent).toBe('23m 24s');
    expect(container.textContent).toContain('took');
    expect(container.textContent).toContain('25m 52s');
    expect(container.querySelector('[data-c="6"]')).toBeNull();
    expect(container.querySelector('[data-c="4"]')!.textContent).toBe('Cluster error');
    expect(container.querySelectorAll('.rr-hist i')).toHaveLength(12);
  });

  it('renders a running run: ticking big NOW, chain, live message, progress edge', () => {
    const { container } = render(<RunRow run={live} nowMs={5000} loadedAt={0} asOf={0} />);
    const row = container.querySelector<HTMLElement>('.rr')!;
    expect(row.className).toContain('b-blue');
    expect(row.className).toContain('live');
    expect(row.style.getPropertyValue('--p')).toBe('0.504');
    expect(container.querySelector('[data-c="9"]')!.textContent).toBe('10m 05s');
    expect(container.querySelector('.rr-now')).not.toBeNull();
    expect(container.querySelectorAll('[data-c="6"] i')).toHaveLength(10);
    expect(container.querySelector('[data-c="7"]')!.textContent).toBe('5 ok, 1 running, 4 to go');
    expect(container.querySelector('[data-c="8"]')!.textContent).toContain('load_gl running');
    expect(container.querySelector('.rr-bar')).not.toBeNull();
    expect(container.querySelector('.rr-avg')).toBeNull();
  });

  it('marks an over-average live run with stripes and the average tick', () => {
    const { container } = render(<RunRow run={live} nowMs={700_000} loadedAt={0} asOf={0} />);
    expect(container.querySelector('.rr')!.className).toContain('over');
    expect(container.querySelector('.rr-avg')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/src/hooks client/src/components/RunRow.test.tsx`
Expected: FAIL, "Failed to resolve import ./useRuns" and "./RunRow".

- [ ] **Step 3: Implement the hooks**

`jobs-console/client/src/hooks/useRuns.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import type { RunsResponse } from '../../../shared/domain/types';

export type RunsState =
  | { state: 'loading' }
  | { state: 'error'; message: string; retry: () => void }
  | { state: 'ready'; data: RunsResponse; loadedAt: number };

export function useRuns(): RunsState {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; value: RunsState } | null>(null);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    fetch('/api/runs')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as RunsResponse;
        if (alive) setResult({ attempt, value: { state: 'ready', data, loadedAt: Date.now() } });
      })
      .catch((err: unknown) => {
        const message = `Could not load runs: ${err instanceof Error ? err.message : String(err)}`;
        if (alive) setResult({ attempt, value: { state: 'error', message, retry } });
      });
    return () => {
      alive = false;
    };
  }, [attempt, retry]);

  return result && result.attempt === attempt ? result.value : { state: 'loading' };
}
```

`jobs-console/client/src/hooks/useNow.ts`:

```ts
import { useEffect, useState } from 'react';

/** Current time, refreshed every intervalMs. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
```

- [ ] **Step 4: Implement RunRow**

`jobs-console/client/src/components/RunRow.tsx`:

```tsx
import type { CSSProperties } from 'react';
import type { Run } from '../../../shared/domain/types';
import {
  borderTone, chainSummary, elapsedSec, historyMarks, liveMessage, problemText, progress, splitName, statBlock, taskStates, taskText, whenText,
} from '../model/rowView';
import './runrow.css';

const CHAIN_CLASS = { ok: '', f: 'f', s: 's', r: 'r', p: 'q' } as const;

export function RunRow({ run, nowMs, loadedAt, asOf, selected, onSelect }: {
  run: Run;
  nowMs: number;
  loadedAt: number;
  asOf: number;
  selected?: boolean;
  onSelect?: (id: number) => void;
}) {
  const elapsed = elapsedSec(run, nowMs, loadedAt);
  const { p, over } = progress(run, elapsed);
  const tone = borderTone(run);
  const stat = statBlock(run, elapsed, asOf);
  const { prefix, rest } = splitName(run.name);
  const msg = run.live ? liveMessage(run) : null;
  const task = taskText(run);
  const cls = ['rr', tone && `b-${tone}`, run.live && 'live', run.live && over && 'over', selected && 'on'].filter(Boolean).join(' ');
  const style = run.live ? ({ '--p': String(p) } as CSSProperties) : undefined;

  return (
    <div className={cls} style={style} data-id={run.id} onClick={onSelect ? () => onSelect(run.id) : undefined}>
      <div className="rr-lft">
        <div className="rr-l1">
          <span className={`rr-tag ${run.type}`} data-c="2">{run.type === 'pipeline' ? 'Pipeline' : 'Job'}</span>
          <span className="rr-name" data-c="3"><i>{prefix}</i>{rest}</span>
        </div>
        <div className="rr-l2">
          <span className="rr-ra" data-c="13">run as: <b>{run.runAs}</b></span>
          <span className="rr-hist" data-c="12">{historyMarks(run).map((m, i) => <i key={i} className={m} />)}</span>
        </div>
      </div>
      <div className="rr-mid">
        {run.live && (
          <>
            <div className="rr-chain" data-c="6">
              {taskStates(run).map((s, i) => <i key={i} className={CHAIN_CLASS[s]} />)}
              <em data-c="7">{chainSummary(run)}</em>
            </div>
            {msg && <div className={`rr-msg${msg.red ? ' red' : ''}`} data-c="8">{msg.lead} <span className="dim">{msg.dim}</span></div>}
          </>
        )}
        <div className="rr-park">
          <span className="pk">parked</span>
          <span className="rr-cause" data-c="4">{problemText(run)}</span>
          {task && <span className="rr-task" data-c="5">{task}</span>}
        </div>
      </div>
      <div className="rr-rgt">
        <span className="rr-when" data-c="10">{whenText(run)}</span>
        <div className="rr-st" data-c="11">
          <div className={stat.big ? 'rr-now' : undefined}>
            <span>{stat.label}</span>
            {stat.big ? <b data-c="9">{stat.value}</b> : <em data-c="9">{stat.value}</em>}
          </div>
          <div>
            <span>average</span>
            <em>{stat.average}</em>
          </div>
        </div>
      </div>
      {run.live && (
        <>
          <span className="rr-trk" />
          <span className="rr-bar" />
          {over && <span className="rr-avg" />}
        </>
      )}
    </div>
  );
}
```

`jobs-console/client/src/components/runrow.css`:

```css
.rr { position: relative; display: grid; grid-template-columns: minmax(460px, 1.35fr) minmax(320px, 1fr) 230px; gap: 0 24px; align-items: start; padding: 10px 16px; margin-bottom: 8px; background: var(--sheet); border: 1px solid var(--rule); border-radius: 8px; cursor: pointer; }
.rr:hover { background: #fffcf6; }
.rr.b-red { border-color: var(--red); }
.rr.b-amber { border-color: var(--amber); }
.rr.b-blue { border-color: var(--blue); }
.rr.on { box-shadow: inset 0 0 0 1px var(--amber); background: #fffaf0; }

.rr-lft { min-width: 0; }
.rr-l1 { display: flex; align-items: baseline; gap: 10px; }
.rr-tag { flex: none; display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; line-height: 1.5; position: relative; top: -1px; }
.rr-tag.job { background: var(--wash-sand); color: var(--ink-2); border: 1px solid #e3d7c6; }
.rr-tag.pipeline { background: var(--wash-purple); color: var(--purple); border: 1px solid #d6cbee; }
.rr-name { font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere; line-height: 1.4; }
.rr-name i { font-style: normal; color: var(--ink-3); }
.rr-l2 { display: flex; align-items: center; gap: 14px; margin-top: 6px; }
.rr-ra { font-size: 12.5px; color: var(--ink-3); }
.rr-ra b { color: var(--ink-2); font-weight: 500; }
.rr-hist { display: inline-flex; gap: 2px; align-items: center; }
.rr-hist i { width: 6px; height: 12px; border-radius: 1px; background: #bfe0cf; }
.rr-hist i.f { background: var(--red); } .rr-hist i.a { background: #f0d9a6; } .rr-hist i.n { background: #e9e2d8; }

.rr-mid { min-width: 0; }
.rr-chain { display: flex; align-items: center; gap: 3px; margin-top: 3px; flex-wrap: wrap; }
.rr-chain i { width: 14px; height: 14px; border-radius: 3px; background: #bfe0cf; border: 1px solid #9fd1b8; }
.rr-chain i.f { background: var(--wash-red); border-color: var(--red); }
.rr-chain i.s { background: transparent; border: 1px dashed #d6ccbf; }
.rr-chain i.r { background: var(--wash-blue); border-color: var(--blue); }
.rr-chain i.q { background: transparent; border: 1px solid #d6ccbf; }
.rr-chain em { font-style: normal; color: var(--ink-3); font-size: 11.5px; margin-left: 6px; }
.rr-msg { margin-top: 7px; font-family: var(--mono); font-size: 11.5px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rr-msg.red { color: var(--red); }
.rr-msg .dim { color: var(--ink-3); }
.rr-park { margin-top: 6px; display: inline-flex; align-items: center; gap: 8px; padding: 3px 8px; border: 1px dashed #d6ccbf; border-radius: 6px; opacity: .7; }
.rr.live .rr-park { margin-top: 8px; }
.rr-park .pk { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); }
.rr-cause { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: 12px; white-space: nowrap; background: var(--wash-sand); border: 1px solid #eadfcf; color: var(--ink-2); }
.rr-task { font-family: var(--mono); font-size: 12.5px; color: var(--ink-2); white-space: nowrap; }

.rr-rgt { text-align: right; font-variant-numeric: tabular-nums; }
.rr-when { font-size: 12.5px; color: var(--ink-3); white-space: nowrap; display: block; }
.rr-st { margin-top: 6px; display: inline-grid; grid-auto-flow: column; border: 1px solid var(--rule); border-radius: 6px; background: #fdfaf5; text-align: left; }
.rr-st > div { padding: 4px 12px 5px 12px; }
.rr-st > div + div { border-left: 1px solid var(--rule); }
.rr-st span { display: block; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); }
.rr-st em { font-style: normal; font-size: 13px; font-weight: 500; color: var(--ink); white-space: nowrap; }
.rr-now { background: var(--wash-amber); border-radius: 5px 0 0 5px; }
.rr-now b { display: block; font-size: 24px; line-height: 1.1; font-weight: 600; color: var(--amber-ink); white-space: nowrap; }
.rr.b-blue .rr-now { background: var(--wash-blue); }
.rr.b-blue .rr-now b { color: var(--blue); }

/* Running indicator, option C: bottom edge fills toward the average; past it, moving amber stripes and a tick at the average. */
.rr.live { overflow: hidden; padding-bottom: 14px; --c: var(--amber); --c2: #f0d9a6; }
.rr.live.b-blue { --c: var(--blue); --c2: #b9cfea; }
.rr-trk { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: var(--c2); opacity: .5; }
.rr-bar { position: absolute; left: 0; bottom: 0; height: 4px; width: calc(min(var(--p), 1) * 100%); background: var(--c); }
.rr-bar::after { content: ""; position: absolute; right: 0; top: 0; bottom: 0; width: 40px; background: linear-gradient(90deg, transparent, rgba(255,255,255,.9), transparent); animation: rr-shimmer 1.6s ease-in-out infinite; }
.rr.over .rr-bar { width: 100%; background: repeating-linear-gradient(135deg, var(--amber) 0 8px, #e9a93f 8px 16px); background-size: 22.6px 22.6px; animation: rr-slide 1s linear infinite; }
.rr.over .rr-bar::after { display: none; }
.rr-avg { position: absolute; bottom: 0; width: 2px; height: 10px; background: var(--ink); left: calc(100% / var(--p)); }
@keyframes rr-shimmer { 0% { transform: translateX(-60px); opacity: 0; } 50% { opacity: 1; } 100% { transform: translateX(0); opacity: 0; } }
@keyframes rr-slide { to { background-position: 22.6px 0; } }
@media (prefers-reduced-motion: reduce) { .rr-bar, .rr-bar::after { animation: none; } }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run client/src && npm run typecheck && npm run lint`
Expected: all tests PASS; typecheck and lint exit 0. The `--p` value is `0.504` because elapsed = 600 + 5 = 605, and 605 / 1200 = 0.504.

- [ ] **Step 6: Commit**

```bash
git add -A jobs-console/client/src
git commit -m "Add data and clock hooks and the RunRow component with the running indicator"
```

---

### Task 10: Filter bar

**Files:**
- Create: `jobs-console/client/src/components/FilterMenu.tsx`
- Create: `jobs-console/client/src/components/FilterBar.tsx`
- Create: `jobs-console/client/src/components/filterbar.css`
- Test: `jobs-console/client/src/components/FilterBar.test.tsx`

**Interfaces:**
- Consumes: `Filters` (Task 6); `Action`, `MenuKey` (Task 8).
- Produces:
  - `FilterMenu`: `({ label, options: { value: string; label: string; count: number }[], selected: string[], onToggle(value), onClear() })`
  - `FilterBar`: `({ filters: Filters; scopeCounts: { mine: number; all: number }; menus: Record<MenuKey, { value: string; label: string; count: number }[]>; liveCount: number; updatedText: string; dispatch: (a: Action) => void })`

- [ ] **Step 1: Write the failing test**

`jobs-console/client/src/components/FilterBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FilterBar } from './FilterBar';
import type { Filters } from '../model/filters';

afterEach(cleanup);

const filters: Filters = { scope: 'all', types: [], runAs: ['sp-ingest'], codes: [], statuses: [], live: false, query: '', window: { from: 0, to: 1 } };
const menus = {
  types: [{ value: 'job', label: 'Job', count: 70 }, { value: 'pipeline', label: 'Pipeline', count: 30 }],
  runAs: [{ value: 'sp-finance', label: 'sp-finance', count: 40 }, { value: 'sp-ingest', label: 'sp-ingest', count: 60 }],
  codes: [{ value: 'none', label: 'no error code', count: 5 }],
};

function setup(over: Partial<Filters> = {}) {
  const dispatch = vi.fn();
  render(<FilterBar filters={{ ...filters, ...over }} scopeCounts={{ mine: 10, all: 251 }} menus={menus} liveCount={47} updatedText="updated 3s ago" dispatch={dispatch} />);
  return dispatch;
}

describe('FilterBar', () => {
  it('shows scope counts, the running toggle count and the update note', () => {
    setup();
    expect(screen.getByRole('button', { name: /All I can see\s*251/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Running now\s*47/ })).toBeTruthy();
    expect(screen.getByText('updated 3s ago')).toBeTruthy();
  });

  it('dispatches scope, running, search and clear', () => {
    const dispatch = setup();
    fireEvent.click(screen.getByRole('button', { name: /Mine\s*10/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'scope', scope: 'mine' });
    fireEvent.click(screen.getByRole('button', { name: /Running now/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleLive' });
    fireEvent.change(screen.getByPlaceholderText('search job, task, run id, cause, error'), { target: { value: 'gl' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'query', query: 'gl' });
    fireEvent.click(screen.getByRole('button', { name: 'clear filters' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'clear' });
  });

  it('opens a menu, toggles an option, and clears a menu', () => {
    const dispatch = setup();
    const runAs = screen.getByRole('button', { name: /^sp-ingest/ });
    fireEvent.click(runAs);
    fireEvent.click(screen.getByRole('checkbox', { name: /sp-finance/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleMenu', key: 'runAs', value: 'sp-finance' });
    fireEvent.click(screen.getByRole('button', { name: 'clear Run as' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'clearMenu', key: 'runAs' });
  });

  it('marks the running toggle when on', () => {
    setup({ live: true });
    expect(screen.getByRole('button', { name: /Running now/ }).getAttribute('aria-pressed')).toBe('true');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run client/src/components/FilterBar.test.tsx`
Expected: FAIL, "Failed to resolve import ./FilterBar".

- [ ] **Step 3: Implement**

`jobs-console/client/src/components/FilterMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';

export function FilterMenu({ label, options, selected, onToggle, onClear }: {
  label: string;
  options: { value: string; label: string; count: number }[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  const one = selected.length === 1 ? options.find((o) => o.value === selected[0]) : undefined;
  const text = selected.length === 0 ? label : one ? one.label : `${label} · ${selected.length}`;

  return (
    <div className={`fm${open ? ' open' : ''}`} ref={ref}>
      <button type="button" className={`fm-btn${selected.length ? ' on' : ''}`} onClick={() => setOpen((o) => !o)}>
        {text} <span className="chev">▾</span>
      </button>
      {selected.length > 0 && (
        <button type="button" className="fm-x" aria-label={`clear ${label}`} onClick={onClear}>×</button>
      )}
      {open && (
        <div className="fm-menu">
          {options.map((o) => (
            <label key={o.value}>
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onToggle(o.value)} /> {o.label}
              <span className="n">{o.count}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
```

`jobs-console/client/src/components/FilterBar.tsx`:

```tsx
import type { Filters } from '../model/filters';
import type { Action, MenuKey } from '../model/viewState';
import { FilterMenu } from './FilterMenu';
import './filterbar.css';

type Option = { value: string; label: string; count: number };
const MENU_LABELS: Record<MenuKey, string> = { types: 'Type', runAs: 'Run as', codes: 'Error code' };

export function FilterBar({ filters, scopeCounts, menus, liveCount, updatedText, dispatch }: {
  filters: Filters;
  scopeCounts: { mine: number; all: number };
  menus: Record<MenuKey, Option[]>;
  liveCount: number;
  updatedText: string;
  dispatch: (a: Action) => void;
}) {
  return (
    <div className="fbar">
      <span className="fbar-t">Showing</span>
      <span className="seg">
        <button type="button" className={filters.scope === 'mine' ? 'on' : ''} onClick={() => dispatch({ type: 'scope', scope: 'mine' })}>
          Mine<i>{scopeCounts.mine}</i>
        </button>
        <button type="button" className={filters.scope === 'all' ? 'on' : ''} onClick={() => dispatch({ type: 'scope', scope: 'all' })}>
          All I can see<i>{scopeCounts.all}</i>
        </button>
      </span>
      <span className="vr" />
      {(Object.keys(MENU_LABELS) as MenuKey[]).map((key) => (
        <FilterMenu
          key={key}
          label={MENU_LABELS[key]}
          options={menus[key]}
          selected={filters[key]}
          onToggle={(value) => dispatch({ type: 'toggleMenu', key, value })}
          onClear={() => dispatch({ type: 'clearMenu', key })}
        />
      ))}
      <button type="button" className={`tgl${filters.live ? ' on' : ''}`} aria-pressed={filters.live} onClick={() => dispatch({ type: 'toggleLive' })}>
        <i />Running now<em>{liveCount}</em>
      </button>
      <span className="search">
        <span aria-hidden="true">⌕</span>
        <input value={filters.query} placeholder="search job, task, run id, cause, error" onChange={(e) => dispatch({ type: 'query', query: e.target.value })} />
      </span>
      <button type="button" className="clear" onClick={() => dispatch({ type: 'clear' })}>clear filters</button>
      <span className="meta">{updatedText}</span>
    </div>
  );
}
```

`jobs-console/client/src/components/filterbar.css`:

```css
.fbar { margin: 12px 24px 8px 24px; padding: 9px 14px; background: var(--sheet); border: 1px solid var(--rule); border-radius: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fbar-t { font-size: 12.5px; font-weight: 500; margin-right: 4px; }
.fbar .vr { width: 1px; height: 20px; background: var(--rule); margin: 0 6px; }
.fbar .seg { display: inline-flex; border: 1px solid var(--rule); border-radius: 999px; overflow: hidden; }
.fbar .seg button { padding: 5px 12px; border: 0; background: var(--sheet); color: var(--ink-2); cursor: pointer; }
.fbar .seg button + button { border-left: 1px solid var(--rule); }
.fbar .seg button.on { background: var(--wash-amber); color: var(--ink); font-weight: 500; }
.fbar .seg i { font-style: normal; color: var(--ink-3); margin-left: 8px; font-variant-numeric: tabular-nums; }
.fbar .seg button.on i { color: var(--amber-ink); }
.fm { position: relative; display: inline-flex; align-items: center; }
.fm-btn { display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px; border: 1px solid var(--rule); border-radius: 999px; background: var(--sheet); color: var(--ink-2); cursor: pointer; white-space: nowrap; }
.fm-btn.on { border-color: #e8c98a; background: var(--wash-amber); color: var(--ink); padding-right: 26px; }
.fm-btn .chev { color: var(--ink-3); font-size: 10px; }
.fm-x { position: absolute; right: 8px; border: 0; background: none; color: var(--ink-3); cursor: pointer; padding: 0; }
.fm-x:hover { color: var(--ink); }
.fm-menu { position: absolute; top: 34px; left: 0; z-index: 6; min-width: 220px; background: var(--sheet); border: 1px solid var(--rule); border-radius: 8px; box-shadow: 0 10px 28px rgba(60,40,20,.14); padding: 6px 0; }
.fm-menu label { display: flex; align-items: center; gap: 10px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.fm-menu label:hover { background: #faf5ec; }
.fm-menu label .n { margin-left: auto; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.fm-menu input { accent-color: var(--amber); }
.tgl { display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px; border: 1px solid var(--rule); border-radius: 999px; background: var(--sheet); color: var(--ink-2); cursor: pointer; white-space: nowrap; }
.tgl i { width: 7px; height: 7px; border-radius: 50%; background: var(--blue); }
.tgl em { font-style: normal; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.tgl.on { border-color: #b9cfea; background: var(--wash-blue); color: var(--ink); }
.tgl.on i { animation: blink 1.2s ease-in-out infinite; }
.tgl.on em { color: var(--blue); }
.search { display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px; border: 1px solid var(--rule); border-radius: 999px; color: var(--ink-3); }
.search input { border: 0; outline: 0; background: transparent; font: inherit; font-size: 13px; color: var(--ink); width: 330px; }
.search input::placeholder { color: var(--ink-3); }
.fbar .clear { margin-left: auto; border: 0; background: none; color: var(--ink-3); cursor: pointer; font-size: 13px; }
.fbar .clear:hover { color: var(--ink); }
.fbar .meta { color: var(--ink-3); font-size: 12.5px; padding-left: 12px; border-left: 1px solid var(--rule); }
@media (prefers-reduced-motion: reduce) { .tgl.on i { animation: none; } }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run client/src/components && npm run typecheck && npm run lint`
Expected: all component tests PASS; typecheck and lint exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A jobs-console/client/src/components
git commit -m "Add the filter bar with scope, menus, Running now, search and clear"
```

---

### Task 11: Timeline component

**Files:**
- Create: `jobs-console/client/src/components/Timeline.tsx`
- Create: `jobs-console/client/src/components/timeline.css`
- Test: `jobs-console/client/src/components/Timeline.test.tsx`

**Interfaces:**
- Consumes: from Task 7, `SCALES`, `SCALE_ORDER`, `buckets`, `countByBucket`, `columnLabel`, `spanText`, `presetWindow`, `sameWindow`, `domainStart`, `dragHandle`, `shiftWindow`, `Preset`, `ScaleId`; `RUN_KINDS`, `Run` (Task 2); `fmtEdge` (Task 2); `Action` (Task 8).
- Produces: `Timeline`: `({ runs: Run[]; end: number; scale: ScaleId; window: TimeWindow; cube: { col: number; kind: RunKind } | null; dispatch: (a: Action) => void })`.

- [ ] **Step 1: Write the failing test**

`jobs-console/client/src/components/Timeline.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Timeline } from './Timeline';
import { makeRun } from '../test/fixtures';
import { presetWindow } from '../model/timeline';

afterEach(cleanup);

const end = new Date(2026, 8, 23).getTime();
const runs = [
  makeRun({ id: 1, startTime: new Date(2026, 8, 22, 5).getTime() }),
  makeRun({ id: 2, kind: 'succeeded', failed: [], startTime: new Date(2026, 8, 22, 6).getTime() }),
];

function setup(scale: '24h' | '30d' | '90d' = '30d') {
  const dispatch = vi.fn();
  const { container } = render(<Timeline runs={runs} end={end} scale={scale} window={presetWindow('last2', '30d', end)} cube={null} dispatch={dispatch} />);
  return { dispatch, container };
}

describe('Timeline', () => {
  it('draws one column per day at 30d, with the window label and span', () => {
    const { container } = setup();
    expect(container.querySelectorAll('.tl-col')).toHaveLength(30);
    expect(screen.getByText('Runs by day')).toBeTruthy();
    expect(screen.getByText('21 Sep to 23 Sep, 2 days')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'last 2 days' }).className).toContain('on');
  });

  it('draws hour columns at 24h and week columns at 90d', () => {
    expect(setup('24h').container.querySelectorAll('.tl-col')).toHaveLength(24);
    cleanup();
    expect(setup('90d').container.querySelectorAll('.tl-col')).toHaveLength(13);
  });

  it('dispatches scale, preset, column and count clicks', () => {
    const { dispatch, container } = setup();
    fireEvent.click(screen.getByRole('button', { name: '24h' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'scale', scale: '24h' });
    fireEvent.click(screen.getByRole('button', { name: 'today' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'preset', preset: 'today' });
    fireEvent.click(container.querySelectorAll('.tl-head')[29]);
    expect(dispatch).toHaveBeenCalledWith({ type: 'column', col: 29 });
    fireEvent.click(screen.getByTitle('Tue 22 Sep: 1 failed'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'cube', col: 29, kind: 'failed' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run client/src/components/Timeline.test.tsx`
Expected: FAIL, "Failed to resolve import ./Timeline".

- [ ] **Step 3: Implement**

`jobs-console/client/src/components/Timeline.tsx`:

```tsx
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { RUN_KINDS, type Run, type RunKind } from '../../../shared/domain/types';
import { fmtEdge } from '../../../shared/domain/format';
import type { TimeWindow } from '../model/filters';
import type { Action } from '../model/viewState';
import {
  SCALES, SCALE_ORDER, buckets, columnLabel, countByBucket, domainStart, dragHandle, presetWindow, sameWindow, shiftWindow, spanText,
  type Preset, type ScaleId,
} from '../model/timeline';
import './timeline.css';

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'all', label: 'all' },
  { id: 'last7', label: 'last 7 days' },
  { id: 'last2', label: 'last 2 days' },
  { id: 'today', label: 'today' },
];

export function Timeline({ runs, end, scale, window, cube, dispatch }: {
  runs: Run[];
  end: number;
  scale: ScaleId;
  window: TimeWindow;
  cube: { col: number; kind: RunKind } | null;
  dispatch: (a: Action) => void;
}) {
  const bks = buckets(scale, end);
  const counts = countByBucket(runs, bks);
  const used = RUN_KINDS.filter((k) => counts.some((c) => c[k]));
  const inside = bks.map((b) => b.end > window.from && b.start < window.to);
  const first = inside.indexOf(true);
  const last = inside.lastIndexOf(true);
  const d0 = domainStart(scale, end);
  const span = end - d0;
  const a = Math.max(0, (window.from - d0) / span);
  const b = Math.min(1, (window.to - d0) / span);
  const lineRef = useRef<HTMLDivElement>(null);

  const colFromPointer = (clientX: number) => {
    const r = lineRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * bks.length);
  };

  const startHandleDrag = (which: 'from' | 'to') => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let current = window;
    const move = (ev: PointerEvent) => {
      const next = dragHandle(bks, current, which, colFromPointer(ev.clientX));
      if (!sameWindow(next, current)) {
        current = next;
        dispatch({ type: 'window', window: next });
      }
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const startBarDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (sameWindow(window, { from: d0, to: end })) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const colWidth = (lineRef.current?.getBoundingClientRect().width ?? 1) / bks.length;
    const start = window;
    let current = window;
    const move = (ev: PointerEvent) => {
      const next = shiftWindow(bks, start, Math.round((ev.clientX - x0) / colWidth));
      if (!sameWindow(next, current)) {
        current = next;
        dispatch({ type: 'window', window: next });
      }
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <section className="tl">
      <div className="tl-head-row">
        <span className="tl-t">Runs by {SCALES[scale].unit}</span>
        <span className="tl-scale">
          {SCALE_ORDER.map((s) => (
            <button key={s} type="button" className={s === scale ? 'on' : ''} onClick={() => dispatch({ type: 'scale', scale: s })}>{s}</button>
          ))}
        </span>
        <span className="tl-span">{`${fmtEdge(window.from)} to ${fmtEdge(window.to)}, ${spanText(window.to - window.from)}`}</span>
        <span className="tl-presets">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className={!cube && sameWindow(window, presetWindow(p.id, scale, end)) ? 'on' : ''} onClick={() => dispatch({ type: 'preset', preset: p.id })}>{p.label}</button>
          ))}
        </span>
      </div>
      <div className="tl-grid" style={{ gridTemplateColumns: `repeat(${bks.length}, 1fr)` }}>
        {first >= 0 && (
          <div className="tl-win" style={{ gridColumn: `${first + 1} / ${last + 2}`, gridRow: 1 }}>
            {last > first && <span className="tl-win-n">{spanText(window.to - window.from)}</span>}
          </div>
        )}
        {bks.map((bk, i) => {
          const L = columnLabel(scale, bk, i, bks[i - 1]);
          const c = counts[i];
          const on = sameWindow(window, { from: bk.start, to: bk.end });
          return (
            <div key={bk.start} className={`tl-col${on ? ' on' : ''}${inside[i] ? '' : ' dim'}`} style={{ gridColumn: i + 1, gridRow: 1 }} title={`${L.title}, ${c.n} runs`}>
              <button type="button" className="tl-head" onClick={() => dispatch({ type: 'column', col: i })}>
                {L.num}
                <small className={L.month ? 'mon' : undefined}>{L.small || ' '}</small>
              </button>
              <div className="tl-cubes">
                {used.map((k) => {
                  const n = c[k];
                  if (!n) return <span key={k} className="tl-empty" />;
                  const sel = cube !== null && cube.col === i && cube.kind === k;
                  return (
                    <button key={k} type="button" className={`cube ${k}${sel ? ' sel' : ''}`} title={`${L.title}: ${n} ${k}`} onClick={() => dispatch({ type: 'cube', col: i, kind: k })}>
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="tl-line" ref={lineRef}>
        <div className="tl-sel" style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%` }} onPointerDown={startBarDrag} />
        <div className="tl-handle" style={{ left: `${a * 100}%` }} onPointerDown={startHandleDrag('from')} aria-label="window start" role="slider" aria-valuenow={window.from} />
        <div className="tl-handle" style={{ left: `${b * 100}%` }} onPointerDown={startHandleDrag('to')} aria-label="window end" role="slider" aria-valuenow={window.to} />
        {(b - a) * 100 > 8 && <span className="tl-lab" style={{ left: `${a * 100}%`, transform: a === 0 ? 'none' : 'translateX(-50%)' }}>{fmtEdge(window.from)}</span>}
        <span className="tl-lab" style={{ left: `${b * 100}%`, transform: b >= 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}>{fmtEdge(window.to)}</span>
      </div>
    </section>
  );
}
```

`jobs-console/client/src/components/timeline.css`:

```css
.tl { margin: 10px 24px 6px 24px; padding: 10px 14px 14px 14px; background: var(--sheet); border: 1px solid var(--rule); border-radius: 8px; }
.tl-head-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.tl-t { font-size: 12.5px; font-weight: 500; }
.tl-scale { display: inline-flex; border: 1px solid var(--rule); border-radius: 999px; overflow: hidden; }
.tl-scale button { padding: 2px 10px; font-size: 12px; border: 0; background: var(--sheet); color: var(--ink-2); cursor: pointer; }
.tl-scale button + button { border-left: 1px solid var(--rule); }
.tl-scale button.on { background: var(--wash-amber); color: var(--ink); font-weight: 500; }
.tl-span { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.tl-presets { display: flex; gap: 6px; margin-left: auto; }
.tl-presets button { font-size: 12px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--rule); background: var(--sheet); color: var(--ink-2); cursor: pointer; }
.tl-presets button.on { background: var(--wash-amber); border-color: #e8c98a; color: var(--ink); }
.tl-grid { display: grid; gap: 3px; align-items: start; position: relative; isolation: isolate; margin-top: 20px; }
.tl-win { position: relative; z-index: -1; align-self: stretch; border: 1px solid var(--amber); box-shadow: inset 0 0 0 1px var(--amber); border-radius: 6px; background: #fffaf0; margin: 0 -2px; }
.tl-win-n { position: absolute; top: -17px; left: 50%; transform: translateX(-50%); font-size: 11px; line-height: 14px; font-weight: 600; color: #b7791f; background: var(--sheet); padding: 0 6px; white-space: nowrap; }
.tl-col { border: 1px solid transparent; border-radius: 5px; padding: 3px 2px 4px 2px; min-width: 0; }
.tl-col:hover { border-color: var(--rule); background: #fdfaf5; }
.tl-col.dim { opacity: .3; }
.tl-head { display: block; width: 100%; text-align: center; font-size: 11.5px; font-weight: 500; line-height: 1.25; border: 0; background: none; cursor: pointer; padding: 0; }
.tl-head:hover { color: var(--amber); }
.tl-head small { display: block; font-weight: 400; color: var(--ink-3); font-size: 9.5px; letter-spacing: .02em; min-height: 12px; }
.tl-head small.mon { color: var(--amber); }
.tl-cubes { display: flex; flex-direction: column; gap: 2px; margin-top: 3px; }
.tl-empty { height: 15px; }
.cube { display: flex; align-items: center; justify-content: center; width: 100%; max-width: 80px; margin: 0 auto; height: 15px; padding: 0; border-radius: 3px; border: 1px solid; font-size: 10px; font-variant-numeric: tabular-nums; cursor: pointer; }
.cube:hover { box-shadow: 0 0 0 1px currentColor inset; }
.cube.sel { outline: 2px solid var(--ink); outline-offset: 1px; }
.cube.failed { background: var(--wash-red); border-color: var(--red); color: var(--red); }
.cube.retrying { background: var(--wash-amber); border-color: var(--amber); color: var(--amber-ink); }
.cube.slow { background: var(--wash-amber); border-color: var(--amber); border-style: dashed; color: var(--amber-ink); }
.cube.running { background: var(--wash-blue); border-color: var(--blue); color: var(--blue); }
.cube.queued { background: var(--wash-sand); border-color: #c9bfb2; color: var(--ink-2); }
.cube.snoozed { background: var(--wash-sand); border-color: #c9bfb2; border-style: dashed; color: var(--ink-2); }
.cube.succeeded { background: var(--wash-green); border-color: var(--green); color: var(--green); }
.tl-line { position: relative; height: 22px; margin: 5px 0 0 0; user-select: none; touch-action: none; }
.tl-line::before { content: ""; position: absolute; left: 0; right: 0; top: 5px; height: 2px; background: #cfc3b3; }
.tl-sel { position: absolute; top: 0; height: 12px; z-index: 1; cursor: grab; }
.tl-sel::before { content: ""; position: absolute; left: 0; right: 0; top: 4px; height: 4px; background: var(--amber); border-radius: 2px; }
.tl-sel:hover::before { top: 3px; height: 6px; }
.tl-handle { position: absolute; top: 0; width: 10px; height: 12px; margin-left: -5px; border-radius: 3px; background: var(--sheet); border: 1.5px solid var(--amber); cursor: ew-resize; z-index: 2; }
.tl-lab { position: absolute; top: 12px; font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run client/src/components && npm run typecheck && npm run lint`
Expected: all component tests PASS; typecheck and lint exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A jobs-console/client/src/components
git commit -m "Add the timeline with scale switch, presets, counts and draggable window"
```

---

### Task 12: Status tiles, run list, reference labels, Attention page

**Files:**
- Create: `jobs-console/client/src/components/StatusTiles.tsx`
- Create: `jobs-console/client/src/components/tiles.css`
- Create: `jobs-console/client/src/components/RunList.tsx`
- Create: `jobs-console/client/src/components/ReferenceBlock.tsx`
- Create: `jobs-console/client/src/components/reference.css`
- Create: `jobs-console/client/src/hooks/useReferenceLabels.ts`
- Create: `jobs-console/client/src/pages/AttentionView.tsx`
- Create: `jobs-console/client/src/pages/AttentionPage.tsx`
- Create: `jobs-console/client/src/pages/attention.css`
- Modify: `jobs-console/client/src/App.tsx` (replace)
- Test: `jobs-console/client/src/pages/AttentionView.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `StatusTiles({ tiles: Record<RunKind, Run[]>; statuses: RunKind[]; asOf: number; dispatch })`
  - `RunList({ rows: Run[]; cap: number; nowMs; loadedAt; asOf; selected: number | null; onSelect; dispatch })`
  - `ReferenceBlock({ rows: Run[]; nowMs; loadedAt; asOf })`
  - `useReferenceLabels(): boolean` (L key toggles; persisted in `localStorage['jobs-console:labels']`)
  - `AttentionView({ data: RunsResponse; loadedAt: number })`
  - `AttentionPage()` (fetches, then renders the loading, error or view state)

- [ ] **Step 1: Write the failing test**

`jobs-console/client/src/pages/AttentionView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AttentionView } from './AttentionView';
import { AttentionPage } from './AttentionPage';
import { makeRun } from '../test/fixtures';
import type { RunsResponse } from '../../../shared/domain/types';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const asOf = new Date(2026, 8, 22, 8).getTime();
const data: RunsResponse = {
  asOf,
  source: 'mock',
  runs: [
    makeRun({ id: 1, startTime: new Date(2026, 8, 22, 5).getTime() }),
    makeRun({ id: 2, kind: 'succeeded', failed: [], cause: { label: 'Succeeded', code: '', detail: '' }, startTime: new Date(2026, 8, 21, 5).getTime() }),
    makeRun({ id: 3, kind: 'running', failed: [], live: true, cause: { label: 'Running', code: '', detail: '' }, startTime: new Date(2026, 8, 22, 7).getTime(), durationSec: 600, usualSec: 1200 }),
    makeRun({ id: 4, startTime: new Date(2026, 7, 30, 5).getTime() }),
  ],
};

describe('AttentionView', () => {
  it('shows the default view: last 2 days, tiles with counts, rows sorted by status', () => {
    const { container } = render(<AttentionView data={data} loadedAt={Date.now()} />);
    expect(container.querySelectorAll('.tile')).toHaveLength(7);
    expect(screen.getByRole('button', { name: /^1\s*Failed/ })).toBeTruthy();
    expect([...container.querySelectorAll('.rl .rr')].map((r) => r.getAttribute('data-id'))).toEqual(['1', '3', '2']);
  });

  it('filters to running runs with the Running now toggle', () => {
    const { container } = render(<AttentionView data={data} loadedAt={Date.now()} />);
    fireEvent.click(screen.getByRole('button', { name: /Running now/ }));
    expect([...container.querySelectorAll('.rl .rr')].map((r) => r.getAttribute('data-id'))).toEqual(['3']);
  });

  it('says so when nothing matches, and hides the reference block', () => {
    localStorage.setItem('jobs-console:labels', '1');
    const { container } = render(<AttentionView data={data} loadedAt={Date.now()} />);
    expect(container.querySelector('.ref')).not.toBeNull();
    fireEvent.change(screen.getByPlaceholderText('search job, task, run id, cause, error'), { target: { value: 'zzzz-no-match' } });
    expect(screen.getByText('Nothing matches these filters.')).toBeTruthy();
    expect(container.querySelector('.ref')).toBeNull();
  });

  it('toggles reference labels with the L key', () => {
    const { container } = render(<AttentionView data={data} loadedAt={Date.now()} />);
    expect(container.querySelector('.ref')).toBeNull();
    fireEvent.keyDown(document, { key: 'l' });
    expect(container.querySelector('.ref')).not.toBeNull();
    expect(container.querySelectorAll('.ref .rr')).toHaveLength(2);
    expect(localStorage.getItem('jobs-console:labels')).toBe('1');
  });
});

describe('AttentionPage', () => {
  it('shows an error with a retry button when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('x', { status: 503 }))));
    render(<AttentionPage />);
    expect(await screen.findByText('Could not load runs: HTTP 503')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run client/src/pages`
Expected: FAIL, "Failed to resolve import ./AttentionView".

- [ ] **Step 3: Implement the pieces**

`jobs-console/client/src/hooks/useReferenceLabels.ts`:

```ts
import { useEffect, useState } from 'react';

const KEY = 'jobs-console:labels';

/** Reference labels (numbered badges + legend) for design reviews. L toggles; the choice is remembered. */
export function useReferenceLabels(): boolean {
  const [on, setOn] = useState(() => localStorage.getItem(KEY) === '1');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key !== 'l' && e.key !== 'L') return;
      setOn((v) => {
        localStorage.setItem(KEY, v ? '0' : '1');
        return !v;
      });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return on;
}
```

`jobs-console/client/src/components/StatusTiles.tsx`:

```tsx
import { RUN_KINDS, type Run, type RunKind } from '../../../shared/domain/types';
import { KIND_TITLES, tileSubtitle } from '../model/filters';
import type { Action } from '../model/viewState';
import './tiles.css';

const TONE: Record<RunKind, string> = { failed: 'red', retrying: 'amber', slow: 'amber', running: 'blue', queued: '', snoozed: '', succeeded: 'green' };

export function StatusTiles({ tiles, statuses, asOf, dispatch }: {
  tiles: Record<RunKind, Run[]>;
  statuses: RunKind[];
  asOf: number;
  dispatch: (a: Action) => void;
}) {
  return (
    <div className="tiles">
      {RUN_KINDS.map((k) => {
        const on = statuses.includes(k);
        const dim = statuses.length > 0 && !on;
        return (
          <button key={k} type="button" className={`tile ${TONE[k]}${on ? ' on' : ''}${dim ? ' dim' : ''}`} aria-pressed={on} onClick={() => dispatch({ type: 'toggleStatus', kind: k })}>
            <b>{tiles[k].length}</b>
            <span>{KIND_TITLES[k]}</span>
            <span className="sub">{tileSubtitle(k, tiles[k], asOf)}</span>
          </button>
        );
      })}
    </div>
  );
}
```

`jobs-console/client/src/components/tiles.css`:

```css
.tiles { display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px; padding: 6px 24px 4px 24px; }
.tile { position: relative; padding: 8px 14px 8px 16px; background: var(--sheet); border: 1px solid var(--rule); border-radius: 8px; cursor: pointer; display: grid; grid-template-columns: auto 1fr; column-gap: 10px; align-items: baseline; text-align: left; }
.tile:hover { border-color: #d9cdbd; background: #fffcf6; }
.tile b { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.tile span { color: var(--ink-2); }
.tile .sub { grid-column: 1 / span 2; color: var(--ink-3); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 15px; }
.tile::before { content: ""; position: absolute; left: 0; top: 10px; bottom: 10px; width: 3px; border-radius: 0 2px 2px 0; background: #c9bfb2; }
.tile.red::before { background: var(--red); } .tile.amber::before { background: var(--amber); } .tile.blue::before { background: var(--blue); } .tile.green::before { background: var(--green); }
.tile.on { border-color: var(--amber); box-shadow: inset 0 0 0 1px var(--amber); background: #fffaf0; }
.tile.dim { opacity: .45; }
```

`jobs-console/client/src/components/RunList.tsx`:

```tsx
import type { Run } from '../../../shared/domain/types';
import type { Action } from '../model/viewState';
import { PAGE } from '../model/viewState';
import { RunRow } from './RunRow';

export function RunList({ rows, cap, nowMs, loadedAt, asOf, selected, onSelect, dispatch }: {
  rows: Run[];
  cap: number;
  nowMs: number;
  loadedAt: number;
  asOf: number;
  selected: number | null;
  onSelect: (id: number) => void;
  dispatch: (a: Action) => void;
}) {
  if (!rows.length) return <div className="rl"><p className="rl-empty">Nothing matches these filters.</p></div>;
  return (
    <div className="rl">
      {rows.slice(0, cap).map((r) => (
        <RunRow key={r.id} run={r} nowMs={nowMs} loadedAt={loadedAt} asOf={asOf} selected={selected === r.id} onSelect={onSelect} />
      ))}
      {rows.length > cap && (
        <button type="button" className="rl-more" onClick={() => dispatch({ type: 'more' })}>
          {rows.length - cap} more, show next {PAGE}
        </button>
      )}
    </div>
  );
}
```

`jobs-console/client/src/components/ReferenceBlock.tsx`:

```tsx
import type { Run } from '../../../shared/domain/types';
import { RunRow } from './RunRow';
import './reference.css';

const LEGEND: [string, string, string][] = [
  ['2', 'Type tag', 'Job or Pipeline, as a word.'],
  ['8', 'Live message', 'Running only: what the run is doing or waiting on right now.'],
  ['3', 'Name', 'Full job or pipeline name; bundle target prefix dimmed.'],
  ['9', 'Now / took', 'Big elapsed time while running; plain duration once finished.'],
  ['13', 'Run as', 'Identity the run executes as, next to the name.'],
  ['10', 'When', 'Failed, started, finished or queued since, with the timestamp.'],
  ['12', 'Run history', 'Last 12 runs, oldest to newest: red failed, amber slow or retried.'],
  ['11', 'Stats block', 'Now (running) or took, against the average duration.'],
  ['6', 'Task chain', 'Running only: one square per task, green ok, red failed, dashed skipped, blue running.'],
  ['4', 'Cause pill', 'Parked, to be reconsidered.'],
  ['7', 'Chain summary', 'Running only: the chain counted.'],
  ['5', 'Failing task / flow', 'Parked, to be reconsidered.'],
];

export function ReferenceBlock({ rows, nowMs, loadedAt, asOf }: { rows: Run[]; nowMs: number; loadedAt: number; asOf: number }) {
  const finished = rows.find((r) => !r.live);
  const running = rows.find((r) => r.live);
  if (!finished && !running) return null;
  return (
    <section className="ref" aria-label="Reference rows">
      <div className="ref-t">Reference rows</div>
      {finished && <RunRow run={finished} nowMs={nowMs} loadedAt={loadedAt} asOf={asOf} />}
      {running && <RunRow run={running} nowMs={nowMs} loadedAt={loadedAt} asOf={asOf} />}
      <div className="ref-lgd">
        {LEGEND.map(([n, name, text]) => (
          <div key={n}>
            <b>{n}</b>
            <span>{name}</span>
            <span>{text}</span>
          </div>
        ))}
        <span className="ref-k">Border: red failed, amber slow or retrying, blue running on track. Press L to hide.</span>
      </div>
    </section>
  );
}
```

`jobs-console/client/src/components/reference.css`:

```css
.ref { margin: 10px 24px 0 24px; padding: 10px 12px 2px 12px; border: 1px dashed #b9a6ea; border-radius: 10px; }
.ref-t { font-size: 12px; font-weight: 500; color: var(--label); margin: 0 0 8px 2px; }
.ref .rr { cursor: default; }
.ref [data-c]::before, .ref-lgd b { content: attr(data-c); display: inline-block; flex: none; vertical-align: 1px; margin-right: 5px; min-width: 16px; height: 16px; padding: 0 3px; border-radius: 8px; background: var(--label); color: #fff; font: 600 10px/16px var(--sans); font-style: normal; text-align: center; letter-spacing: 0; text-transform: none; }
.ref .rr-st[data-c] { position: relative; }
.ref .rr-st[data-c]::before { position: absolute; left: -24px; top: 4px; margin: 0; }
.ref .rr-now b[data-c]::before { vertical-align: 6px; }
.ref-lgd { margin: 4px 0 10px 0; padding: 4px; font-size: 12.5px; color: var(--ink-2); display: grid; grid-template-columns: 1fr 1fr; gap: 7px 36px; }
.ref-lgd div { display: grid; grid-template-columns: 22px 150px 1fr; align-items: baseline; }
.ref-lgd div > span:first-of-type { color: var(--ink); font-weight: 500; }
.ref-k { grid-column: 1 / -1; color: var(--ink-3); font-size: 11px; text-align: right; }
```

`jobs-console/client/src/pages/attention.css`:

```css
.rl { padding: 6px 24px 24px 24px; }
.rl-empty { color: var(--ink-3); padding: 24px 2px; margin: 0; }
.rl-more { display: block; width: 100%; text-align: center; padding: 12px; color: var(--ink-2); background: none; border: 0; cursor: pointer; }
.att-status { padding: 24px; color: var(--ink-2); }
.att-status button { margin-left: 12px; padding: 3px 12px; border: 1px solid var(--rule); border-radius: 999px; background: var(--sheet); cursor: pointer; }
```

- [ ] **Step 4: Implement the view and page**

`jobs-console/client/src/pages/AttentionView.tsx`:

```tsx
import { useCallback, useMemo, useState } from 'react';
import type { RunsResponse } from '../../../shared/domain/types';
import { liveCount, menuCounts, passes, scopeCounts, sortRuns, tileCounts } from '../model/filters';
import { timelineEnd } from '../model/timeline';
import { applyAction, initialState, type Action, type MenuKey, type ViewCtx } from '../model/viewState';
import { useNow } from '../hooks/useNow';
import { useReferenceLabels } from '../hooks/useReferenceLabels';
import { FilterBar } from '../components/FilterBar';
import { Timeline } from '../components/Timeline';
import { StatusTiles } from '../components/StatusTiles';
import { RunList } from '../components/RunList';
import { ReferenceBlock } from '../components/ReferenceBlock';
import './attention.css';

const CODE_OPTIONS = ['CLIENT_ERROR', 'CLOUD_FAILURE', 'TIMEDOUT', 'MAX_CONCURRENT_RUNS_REACHED', 'none'];

export function AttentionView({ data, loadedAt }: { data: RunsResponse; loadedAt: number }) {
  const ctx: ViewCtx = useMemo(() => ({ runs: data.runs, end: timelineEnd(data.asOf) }), [data]);
  const [state, setState] = useState(() => initialState(ctx));
  const dispatch = useCallback((a: Action) => setState((s) => applyAction(s, a, ctx)), [ctx]);
  const [selected, setSelected] = useState<number | null>(null);
  const nowMs = useNow(1000);
  const labels = useReferenceLabels();
  const f = state.filters;

  const rows = useMemo(() => sortRuns(data.runs.filter((r) => passes(r, f))), [data.runs, f]);
  const tiles = useMemo(() => tileCounts(data.runs, f), [data.runs, f]);
  const menus = useMemo(() => {
    const t = menuCounts(data.runs, 'types');
    const ra = menuCounts(data.runs, 'runAs');
    const co = menuCounts(data.runs, 'codes');
    const out: Record<MenuKey, { value: string; label: string; count: number }[]> = {
      types: [{ value: 'job', label: 'Job', count: t.job ?? 0 }, { value: 'pipeline', label: 'Pipeline', count: t.pipeline ?? 0 }],
      runAs: Object.keys(ra).sort().map((v) => ({ value: v, label: v, count: ra[v] ?? 0 })),
      codes: CODE_OPTIONS.map((v) => ({ value: v, label: v === 'none' ? 'no error code' : v, count: co[v] ?? 0 })),
    };
    return out;
  }, [data.runs]);
  const scope = useMemo(() => scopeCounts(data.runs, ctx.end), [data.runs, ctx.end]);
  const ago = Math.max(0, Math.round((nowMs - loadedAt) / 1000));

  return (
    <div className="att">
      <FilterBar
        filters={f}
        scopeCounts={scope}
        menus={menus}
        liveCount={liveCount(data.runs, f.scope)}
        updatedText={ago < 60 ? `updated ${ago}s ago` : `updated ${Math.floor(ago / 60)}m ago`}
        dispatch={dispatch}
      />
      <Timeline runs={data.runs} end={ctx.end} scale={state.scale} window={f.window} cube={state.cube} dispatch={dispatch} />
      <StatusTiles tiles={tiles} statuses={f.statuses} asOf={data.asOf} dispatch={dispatch} />
      {labels && rows.length > 0 && <ReferenceBlock rows={rows} nowMs={nowMs} loadedAt={loadedAt} asOf={data.asOf} />}
      <RunList rows={rows} cap={state.cap} nowMs={nowMs} loadedAt={loadedAt} asOf={data.asOf} selected={selected} onSelect={setSelected} dispatch={dispatch} />
    </div>
  );
}
```

`jobs-console/client/src/pages/AttentionPage.tsx`:

```tsx
import { useRuns } from '../hooks/useRuns';
import { AttentionView } from './AttentionView';
import './attention.css';

export function AttentionPage() {
  const runs = useRuns();
  if (runs.state === 'loading') return <p className="att-status">Loading runs…</p>;
  if (runs.state === 'error') {
    return (
      <p className="att-status">
        <span>{runs.message}</span>
        <button type="button" onClick={runs.retry}>Retry</button>
      </p>
    );
  }
  return <AttentionView data={runs.data} loadedAt={runs.loadedAt} />;
}
```

Replace `jobs-console/client/src/App.tsx` with:

```tsx
import { Shell } from './components/Shell';
import { AttentionPage } from './pages/AttentionPage';

export default function App() {
  return (
    <Shell source="mock">
      <AttentionPage />
    </Shell>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test && npm run typecheck && npm run lint`
Expected: every test file PASS; typecheck and lint exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A jobs-console/client/src
git commit -m "Assemble the Attention page: tiles, run list, reference labels"
```

---

### Task 13: Browser verification and docs

**Files:**
- Modify: `docs/design/00-decisions.md` (add a line under the stack decision about the real app location and the mock default)
- Modify: `jobs-console/README.md` (replace the template's "Getting started" section)

- [ ] **Step 1: Full checks**

Run: `npm test && npm run typecheck && npm run lint && npm run lint:ast-grep && npm run build`
Expected: each command exits 0. If `lint:ast-grep` reports rule violations, fix them in the files it names and re-run.

- [ ] **Step 2: Run the app and verify in a real browser**

Start `npm run dev` in the background and wait for `Server running on http://localhost:8000`. Open `http://localhost:8000` in Chrome via the claude-in-chrome tools, in a new tab, and check each item:

1. The header reads "Jobs console" and shows a MOCK DATA badge.
2. Timeline: 30 day columns, "last 2 days" highlighted, and the span reads "21 Sep to 23 Sep, 2 days".
3. The tiles show 7 statuses, and Running is non-zero.
4. The first rows are failed, with red borders and full names.
5. Press **Running now**: only live rows remain. The blue on-track rows show the bottom progress edge, and the big NOW ticks between two screenshots taken 3 seconds apart.
6. Click scale `24h`: 24 hour columns. Click `90d`: 13 week columns. Drag the right handle: the window snaps to columns.
7. Click the 10 Sep column (in 30d): only Succeeded is on.
8. Press `L`: the reference block with two labelled rows and the legend appears. Press `L` again: it hides.

Take a screenshot at steps 2, 5 and 8, and save them to disk. Stop the dev server and close the tab.

- [ ] **Step 3: Update docs**

In `docs/design/00-decisions.md`, directly under the table row for decision 3, add:

```markdown
> Implementation: the app lives in `jobs-console/` (AppKit 0.57.0, CLI profile `jobs-console`). `GET /api/runs` serves from a `RunSource`; `JOBS_CONSOLE_DATA=mock` (default) uses the generator ported from the prototype. Attention screen MVP plan: `docs/superpowers/plans/2026-09-25-attention-screen-mvp.md`.
```

Replace the "Getting started" section of `jobs-console/README.md` (keep the rest of the file) with:

```markdown
## Getting started

```powershell
cd jobs-console
npm install
npm run dev        # http://localhost:8000, mock data
npm test           # unit + component tests
```

- Data source: `JOBS_CONSOLE_DATA=mock` (default). Live data is not implemented yet.
- Press `L` in the app to show the numbered reference rows used in design reviews.
- npm scripts run through Git Bash (`.npmrc` `script-shell`), so the POSIX-style scripts work on Windows.
```

- [ ] **Step 4: Commit**

```bash
git add -A docs jobs-console/README.md
git commit -m "Document the jobs-console app and the Attention MVP"
```
