# Deploys the prebuilt app in deploy/ to one env's workspace as the Databricks App "jobs-console", labeled with the
# env. Needs only the Databricks CLI (no Node, no npm) and a login for the profile named like the env.
# Usage:  .\deploy.ps1 -Env prod            (asks you to type the env name after showing the workspace host)
# With system-tables run history:  .\deploy.ps1 -Env prod -Warehouse <sql warehouse id>
# Later deploys without -Warehouse keep the running app's warehouse; -NoWarehouse removes it.
# -Yes skips the typed confirmation; -WhatIf shows the bind / deploy / run commands without running them.
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)][ValidateSet('dev', 'stg', 'prod')][string]$Env,
  # SQL warehouse id: adds the sql-warehouse app resource and DATABRICKS_WAREHOUSE_ID.
  [string]$Warehouse = '',
  # Deploy without a warehouse even if the running app has one (run history from the API).
  [switch]$NoWarehouse,
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$Env = $Env.ToLowerInvariant()   # ValidateSet ignores case; target and profile names don't
if ($Warehouse -and $NoWarehouse) { throw 'Give -Warehouse <id> or -NoWarehouse, not both.' }
$app = 'jobs-console'
$profileArgs = @('--profile', $Env)
$overrides = Join-Path $PSScriptRoot ".databricks\bundle\$Env\variable-overrides.json"
if (-not (Get-Command databricks -ErrorAction SilentlyContinue)) { throw 'The Databricks CLI is not on PATH.' }
if (-not (Test-Path (Join-Path $PSScriptRoot 'deploy\server.mjs'))) { throw "No deploy\server.mjs: run 'git pull'." }

function Stop-Deploy([string]$message) {
  Write-Host $message -ForegroundColor Red
  exit 1
}

# Runs the CLI and captures its output: stdout text, stderr text, exit code. (Continue: in Windows PowerShell 5.1,
# Stop turns the first stderr line of a native command into a terminating error.)
function Invoke-Cli([string[]]$cliArgs) {
  $ErrorActionPreference = 'Continue'
  $all = & databricks @cliArgs 2>&1
  $code = $LASTEXITCODE
  $out = @($all | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] } | ForEach-Object { "$_" }) -join "`n"
  $err = @($all | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } | ForEach-Object { "$_" }) -join "`n"
  [pscustomobject]@{ Code = $code; Out = $out; Err = $err }
}

# Runs a CLI command that changes the workspace, streaming its output; -WhatIf only prints it.
function Invoke-Change([string[]]$cliArgs) {
  $line = "databricks $($cliArgs -join ' ')"
  if (-not $PSCmdlet.ShouldProcess($line, 'Run')) { return }
  Write-Host "> $line"
  $ErrorActionPreference = 'Continue'
  & databricks @cliArgs
  if ($LASTEXITCODE -ne 0) { Stop-Deploy "Failed: $line (exit $LASTEXITCODE). Nothing after it was run." }
}

# The warehouse for this deploy: -Warehouse <id>; else the running app's sql-warehouse, so a redeploy keeps run
# history on; none with -NoWarehouse. $running is the `apps get` JSON, $null when there is no app yet.
function Resolve-Warehouse($running, [string]$warehouse, [bool]$noWarehouse) {
  $kept = ''
  if ($running) {
    $res = @($running.resources | Where-Object { $_.name -eq 'sql-warehouse' -and $_.sql_warehouse.id })
    if ($res.Count -gt 0) { $kept = "$($res[0].sql_warehouse.id)" }
  }
  if ($warehouse) { return [pscustomobject]@{ Id = $warehouse; Line = "Warehouse: $warehouse (system-tables run history)" } }
  if ($kept -and $noWarehouse) {
    return [pscustomobject]@{ Id = ''; Line = "Warehouse: none $([char]0x2014) removing the running app's warehouse (run history from the API)" }
  }
  if ($kept) { return [pscustomobject]@{ Id = $kept; Line = "Warehouse: $kept (kept from the running app)" } }
  [pscustomobject]@{ Id = ''; Line = 'Warehouse: none (run history from the API)' }
}

Push-Location $PSScriptRoot   # bundle commands read databricks.yml from the current folder
try {
  # A leftover override (an interrupted -Warehouse run) would quietly deploy a warehouse: always start clean.
  if (Test-Path $overrides) { Remove-Item $overrides -WhatIf:$false }

  # 1. Login, the running app, and the typed confirmation (nothing is written before it): no host is pinned in
  # databricks.yml, so the profile decides the workspace.
  $r = Invoke-Cli (@('auth', 'describe', '-o', 'json') + $profileArgs)
  $auth = $null
  if ($r.Code -eq 0) { try { $auth = $r.Out | ConvertFrom-Json } catch { } }
  if (-not $auth -or $auth.status -ne 'success') {
    # The JSON form carries no message on failure (and exits 0); the text form's first line has it.
    $text = Invoke-Cli (@('auth', 'describe') + $profileArgs)
    $why = @("$($text.Out)`n$($text.Err)" -split "`n" | Where-Object { $_.Trim() })[0]
    Stop-Deploy "No working login for profile '$Env': $why`nRun:  databricks auth login --host <workspace url> --profile $Env"
  }
  $wsHost = $auth.details.host

  $running = $null
  $r = Invoke-Cli (@('apps', 'get', $app, '-o', 'json') + $profileArgs)
  if ($r.Code -eq 0) { $running = $r.Out | ConvertFrom-Json }
  elseif ("$($r.Err)" -notmatch 'does not exist') { Stop-Deploy "databricks apps get $app failed: $($r.Err)" }
  $wh = Resolve-Warehouse $running $Warehouse $NoWarehouse.IsPresent

  Write-Host "Workspace: $wsHost  (profile $Env)"
  Write-Host "Identity:  $($auth.username)"
  if ($running) { Write-Host "App:       $app exists (updated in place)" } else { Write-Host "App:       no $app yet (the deploy creates it)" }
  Write-Host $wh.Line
  if (-not $Yes) {
    $answer = $null
    try { $answer = Read-Host "Type `"$Env`" to deploy to $wsHost" } catch { }
    if ("$answer".Trim() -cne $Env) { Stop-Deploy 'Not confirmed: nothing was deployed.' }
  }

  # 2. An existing jobs-console app that this target doesn't manage yet is adopted (bind), keeping its service
  # principal, grants and URL. A missing app is created by the deploy.
  if ($running) {
    $s = Invoke-Cli (@('bundle', 'summary', '-t', $Env, '-o', 'json') + $profileArgs)
    if ($s.Code -ne 0) { Stop-Deploy "databricks bundle summary failed: $($s.Err)" }
    $bound = ($s.Out | ConvertFrom-Json).resources.apps.app
    if (-not $bound.id -or $bound.modified_status -eq 'created') {
      Write-Host "App '$app' exists in $wsHost but target '$Env' doesn't manage it yet: binding it."
      Invoke-Change (@('bundle', 'deployment', 'bind', 'app', $app, '-t', $Env) + $profileArgs + @('--auto-approve'))
    } else {
      Write-Host "App '$app' is already managed by target '$Env'."
    }
  }

  # The warehouse goes in through a per-run override of the target's app_config and app_resources variables (removed
  # again at the end, so no id is kept on disk), adding the sql-warehouse resource and the DATABRICKS_WAREHOUSE_ID
  # entry together: one without the other breaks the app. The config is the target's own (from validate) plus that
  # entry, so it can't drift from databricks.yml.
  if ($wh.Id) {
    $v = Invoke-Cli (@('bundle', 'validate', '-t', $Env, '-o', 'json') + $profileArgs)
    if ($v.Code -ne 0) { Stop-Deploy "databricks bundle validate failed: $($v.Err)" }
    $config = ($v.Out | ConvertFrom-Json).resources.apps.app.config
    $envList = @($config.env | Where-Object { $_.name -ne 'DATABRICKS_WAREHOUSE_ID' })
    $envList += [pscustomobject]@{ name = 'DATABRICKS_WAREHOUSE_ID'; value_from = 'sql-warehouse' }
    $json = [ordered]@{
      app_config    = [ordered]@{ command = @($config.command); env = $envList }
      app_resources = @([ordered]@{ name = 'sql-warehouse'; sql_warehouse = [ordered]@{ id = $wh.Id; permission = 'CAN_USE' } })
    } | ConvertTo-Json -Depth 10
    if ($PSCmdlet.ShouldProcess($overrides, 'Write warehouse override')) {
      $null = New-Item -ItemType Directory -Force (Split-Path $overrides)
      # No BOM: the CLI's JSON reader rejects it (Windows PowerShell's -Encoding UTF8 writes one).
      [IO.File]::WriteAllText($overrides, $json, (New-Object Text.UTF8Encoding $false))
    } else {
      Write-Host $json
    }
  }

  # 3. Deploy the prebuilt deploy/ folder with this target's config, then start the new deployment.
  Invoke-Change (@('bundle', 'deploy', '-t', $Env) + $profileArgs)
  Invoke-Change (@('bundle', 'run', 'app', '-t', $Env) + $profileArgs)

  # 4. Where it is, and who needs access.
  if ($WhatIfPreference) { Write-Host 'What if: then print the app URL and its service principal.'; return }
  $r = Invoke-Cli (@('apps', 'get', $app, '-o', 'json') + $profileArgs)
  if ($r.Code -ne 0) { Stop-Deploy "databricks apps get $app failed: $($r.Err)" }
  $info = $r.Out | ConvertFrom-Json
  $sp = $info.service_principal_name
  if (-not $sp) { $sp = $info.service_principal_client_id }
  Write-Host "URL: $($info.url)"
  Write-Host "Grant CAN_VIEW on the jobs and pipelines to show to: $sp"
} finally {
  if (Test-Path $overrides) { Remove-Item $overrides -WhatIf:$false }
  Pop-Location
}
