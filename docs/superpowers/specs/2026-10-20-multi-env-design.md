# Three environments: dev, stg, prod

Status: draft for approval, 2026-10-20. Approved in chat so far: the laptop gets a switch, each workspace gets its own deployed app, a switch opens the env fresh ("refresh"), and the look is variant A from the mockup (`docs/design/mockups/env-switch.html`, served at http://127.0.0.1:8765/ during design).

## Intent

The user runs jobs and pipelines in three AWS GovCloud workspaces: dev, stg and prod. None of them can be reached from the dev machine. They want two things:

1. **On the laptop:** one console that switches between the three workspaces.
2. **In each workspace:** its own deployed jobs-console app that shows only that workspace.

The console only reads; it never runs, cancels or edits anything. The risk worth designing against is **confusing environments**: looking at prod while thinking it is dev, or seeing one env's data under another env's label.

## Goals

1. Laptop: `run-local.ps1` starts one server that serves dev, stg and prod. A switch in the header changes env with one click.
2. Deployed: bundle targets `dev`, `stg` and `prod`. Each app shows a fixed env label and no switch.
3. The current env is unmistakable everywhere: header, tab title and URL.
4. Every existing way to run keeps working unchanged: `run-local.ps1 -Profile x`, `npm run dev`, mock, replay, the `default` target, and the Marketplace installer. The `gov` target is replaced by `dev`, `stg` and `prod` (E12).
5. It all runs in the client's environment. The workspaces belong to the client, and the setup and deploy steps are carried out on site, where this machine can't reach. Nothing client-specific (workspace URLs, warehouse ids) is committed. The steps have to work whatever is already there.

## Non-goals

- A deployed app reaching another workspace. That would need a service-principal secret per workspace; the user chose laptop-only switching.
- Comparing envs side by side, or any cross-env view.
- A confirm step or a read-only warning for prod. The console is read-only already.

## Anti-goals (failures even if it technically works)

- Data from one env shown under another env's label, including a late response from the env you just left.
- A busy header. The env piece is one small control; dev looks like today's console.
- A deploy that breaks because an env has no SQL warehouse configured.
- A deploy that puts the `prod` label on the dev workspace's app without anyone noticing.

## Decisions

| # | Decision |
|---|----------|
| E1 | **Env names are fixed: `dev`, `stg`, `prod`, in that order.** On the laptop any subset can be configured. The switch shows only the configured ones. |
| E2 | **Laptop config.** `run-local.ps1 -Envs 'dev,stg,prod'`. A bare name uses the CLI profile of the same name; `name=profile` maps to another one (`-Envs 'dev=gov-dev,stg=gov-stg,prod=gov-prod'`). `-Warehouse` accepts the same form per env (`-Warehouse 'dev=abc123,prod=def456'`); an env without one uses the API for history. `-Envs` and `-Profile` can't be combined. `-Profile x` keeps working exactly as today: one workspace, no switch, no label. The script passes the config to the server as `JOBS_CONSOLE_ENVS` (and a per-env warehouse value), which `.env` can also set for `npm run dev`. |
| E3 | **One server, one data source per env.** Each configured env gets its own data source: a client built from that env's CLI profile, plus its own state (run cache, incremental-refresh base, items, system-tables history, probe, workspace id, identity). Nothing is shared between envs. Each is built lazily on its first request. Today every cache is keyed by `userKey`/`readKey` only (`'dev'` or `'app'` locally), so envs **must not** share one `LiveState`. A per-env provider is the intended shape. |
| E4 | **Every request names its env.** The client sends `env` on every API call (a query param, `?env=prod`). The server routes it to that env's data source. A missing `env` with more than one configured is a 400. An unknown env is a 400 that names the configured ones. With one env (single-profile, deployed, mock, replay), `env` is optional and ignored. |
| E5 | **The switch is a page load.** Clicking an env navigates to `?env=<new>&tab=<current tab>`. Filters, search, the time window, selection, the open drawer and every client cache (including the module-level item-detail cache) start fresh, and no in-flight response from the old env can land. The current tab (Jobs & ETL or Runs) is kept. UI preferences in localStorage (refresh interval, sort, labels) stay global. |
| E6 | **URL.** `?env=` sits alongside `?tab=` and `?compare=`. The code that rewrites the query string (tab changes, the compare page, "open compare in a new tab") must keep `env`. No `env` in the URL on the laptop means the first configured env, and the URL is rewritten to show it. An unknown env in the URL falls back the same way. |
| E7 | **Look: variant A.** dev: no color, and the selected switch button is ink (today's palette). stg: a 3 px amber edge along the top of the header, with an amber selected button or label. prod: a 3 px red edge and a red selected button or label. The switch sits right after the "Jobs console" title. The deployed label is in the same place, styled the same way. Colors come from `--amber` and `--red` in `tokens.css`. The mockup is the reference. |
| E8 | **Tab title.** `PROD · Jobs console` (likewise `DEV`, `STG`) whenever an env is known, on every page, the compare page included. With no env (single profile, mock without envs), it stays as today. |
| E9 | **`/api/mode` per env.** `DataMode` gains `env?: string` (current env) and `envs?: string[]` (configured, laptop only; its presence means show a switch). Workspace host, CLI profile, user, read-as and history describe the requested env. |
| E10 | **One env failing doesn't take the others down.** An expired login or unreachable workspace shows an error for that env only, naming the fix: `databricks auth login --profile <profile>`. Switching to another env works. |
| E11 | **Deployed label from the bundle target.** Each target sets `JOBS_CONSOLE_ENV=<name>` through the app resource's `config.env` in `databricks.yml`. The CLI writes that config into the app's `app.yaml` at deploy time, and its env entries override the ones in `app.yaml` ([bundle resources: app.config](https://docs.databricks.com/aws/en/dev-tools/bundles/resources); [CLI `apps.go`](https://github.com/databricks/cli/blob/main/bundle/config/resources/apps.go)). So `deploy/` stays one prebuilt folder for every target. Without `JOBS_CONSOLE_ENV` (the `default` and `gov` targets, Marketplace), there's no label, as today. **To verify on the first deploy:** whether `config` replaces `app.yaml` entirely (then the target's `config` must repeat `command` and the existing env entries) or merges with it. Either way, the target's `config` should spell out the full `command` + `env`, so the result doesn't depend on which it does. |
| E12 | **Bundle targets.** `dev`, `stg` and `prod` targets, all GovCloud, alongside `default`. They **replace `gov`**: two targets managing one app would let a `-t gov` deploy quietly strip the env label. The README notes that the old `gov` target maps to whichever env that workspace is. Like `gov`, they have no host in the file (the CLI doesn't substitute variables in `workspace.host`), so the host comes from the profile: `databricks bundle deploy -t prod --profile prod`, then `databricks bundle run app -t prod --profile prod`. The app name stays `jobs-console` in every workspace. |
| E13 | **Wrong-profile guard.** With no host pinned, `-t prod --profile dev` would deploy a "prod"-labeled app into dev. The workspace URLs belong to the client and stay out of the repo, so the guard is in the deploy script (E18): it always uses the profile of the same name as the env, and it shows the workspace host and asks for a typed confirmation before deploying. |
| E18 | **One deploy script for on-site use: `deploy.ps1 -Env dev\|stg\|prod`.** It runs on any Windows machine with the Databricks CLI, with no Node needed (`deploy/` is prebuilt). It: (1) checks the login for profile `<env>` and shows the workspace host, then asks to type the env name to continue; (2) checks whether an app named `jobs-console` already exists there (`databricks apps get`). If it does and this target doesn't manage it yet, it adopts it with `databricks bundle deployment bind app jobs-console -t <env>`, keeping its service principal, grants and URL. (3) Runs `bundle deploy` + `bundle run app` for that target. (4) Prints the app URL and the service principal that needs CAN_VIEW on the jobs and pipelines. A `-Warehouse <id>` option turns on system-tables history for that target (E14) without committing the id. Plain CLI commands stay documented in the README as the fallback. |
| E14 | **SQL warehouse per target.** Each target can turn on system-tables history by itself. The target adds the `sql-warehouse` app resource with its warehouse id **and** the `DATABRICKS_WAREHOUSE_ID` (`value_from: sql-warehouse`) entry in its `config.env`. The id is the client's, so it isn't committed. `deploy.ps1 -Warehouse <id>` supplies both pieces at deploy time. The mechanism is left to the builder; one option is a gitignored `*.local.yml` that the bundle `include`s. Check that the bundle still validates when the file is missing. A deploy without `-Warehouse` keeps working on API history. Never add the `value_from` entry without the resource (that breaks the deploy). |
| E15 | **Capture and replay.** A capture records its env and CLI profile in `workspace` (beside `host`), and the file name includes the env. A capture taken from the laptop covers the env it was downloaded from (the capture menu acts on the current env). Replay shows the captured env's label and color, no switch. |
| E16 | **Mock data gets three envs** so the switch can be built and checked on the dev machine: `JOBS_CONSOLE_DATA=mock` with `JOBS_CONSOLE_ENVS=dev,stg,prod` serves visibly different mock data per env (a different seed per env). Without `JOBS_CONSOLE_ENVS`, mock is unchanged. |
| E17 | **Ship the laptop build.** Like every UI change: `npm run package`, commit `deploy/`, push, so `git pull` + `run-local.ps1` on the laptop gets it. The README gets a "Three environments" section: laptop setup (three `databricks auth login` commands, `run-local.ps1 -Envs`), the deploy commands per target, and the warehouse opt-in per target. |

## What exists today (for the builder)

- One provider is built at startup (`server/server.ts:16`, `selectRunSource(process.env)`), and routes reach it through `provider.forRequest(req, session)`.
- SDK clients come from the default chain (`new WorkspaceClient({})` in `server/data/live/api.ts:48`; `resolveDefaultHost()` at `:38`), so they read `DATABRICKS_CONFIG_PROFILE` from the process. A per-env client needs the profile passed in explicitly. The same goes for `resolveDefaultHost`, the identity lookup (`selfName`, `server.ts:81`), the workspace memo (`server.ts:71`) and diagnostics' `hostOf` (`server/api/diag.ts:44`).
- The history config reads `DATABRICKS_WAREHOUSE_ID` and `DATABRICKS_WORKSPACE_ID` from the process (`server/data/systables/config.ts:10`). It has to come per env.
- Client fetches are bare `fetch` calls spread over `client/src/hooks/*`, `CaptureMenu.tsx` (including an `href` to `/api/diag/capture`) and `lib/reportError.ts`. One small helper that adds `env` is the obvious way to cover them all.
- `App.tsx:27` and `ComparePage.tsx:24` rewrite the whole query string, and `AttentionView.tsx:55` opens compare without `env` (see E6).
- `scripts/package.ts` copies `app.yaml` to `deploy/app.yaml` and only injects `NODE_ENV` and the command; no change is needed there.

## Left to the builder

- How the env reaches the server (`JOBS_CONSOLE_ENVS` format, where the per-env warehouse goes), as long as the `run-local.ps1` interface in E2 holds.
- Whether the per-env data source is a provider map or one provider with env-scoped state, as long as nothing is shared (E3).
- Tests, following the repo's existing vitest patterns. At least: routing by env and the 400s (E4); state isolation between two envs; URL rewrites keeping `env` (E6); title and header per env (E7, E8); single-profile behavior unchanged.
- Verification: mock with three envs in a real browser at 127.0.0.1, switching between all three, plus `bundle validate --strict` for each new target.

## Settled during review (author's calls)

- `/api/mode` doesn't require `env`. Without it, the response names the configured envs, so the first page load can pick one (E4, E6).
- One capture store per env (E15).
- Per-env clients use only their CLI profile and ignore a `DATABRICKS_HOST` set in `.env`.
- On single-env and deployed apps, a stray `?env=` is removed from the URL.
- `-Envs` with a bare `-Warehouse <id>` (no `name=`) is an error that shows the per-env form.
- The compare window's name includes the env, so compare windows from different envs never reuse each other.
- **An app that already exists in a workspace.** Bundle state is kept per target, so the first `bundle deploy -t <env>` into a workspace that already has a `jobs-console` app (from the `gov` target or the Marketplace installer) would try to create it again. That app is adopted with `databricks bundle deployment bind app <app name> -t <env> --profile <env>`, which keeps its service principal and grants. The README deploy steps include this.

## Open

None. Workspace URLs and warehouse ids are the client's and are supplied on site (E13, E14, E18).
