# Runs the prebuilt app in deploy/ on this machine against a Databricks workspace: no npm install, only Node 22+
# and a Databricks CLI login. Usage:  .\run-local.ps1 -Profile gov   (then open http://127.0.0.1:8000)
# Or one console for several workspaces:  .\run-local.ps1 -Envs 'dev,stg=gov-stg,prod' -Warehouse 'dev=abc,prod=def'
# (-Envs is dev / stg / prod, each optionally =cli-profile; a bare name uses the profile of the same name.)
[CmdletBinding(DefaultParameterSetName = 'Profile')]
param(
  [Parameter(Mandatory = $true, ParameterSetName = 'Profile')][string]$Profile,
  [Parameter(Mandatory = $true, ParameterSetName = 'Envs')][string]$Envs,
  [int]$Port = 8000,
  [ValidateSet('live', 'mock')][string]$Data = 'live',
  # SQL warehouse id for run history from system tables; without it history falls back to the API.
  # With -Profile a bare id; with -Envs per env: 'dev=<id>,prod=<id>'.
  [string]$Warehouse = ''
)
$ErrorActionPreference = 'Stop'
$deploy = Join-Path $PSScriptRoot 'deploy'
if (-not (Test-Path (Join-Path $deploy 'server.mjs'))) { throw "No deploy\server.mjs: run 'git pull' (or 'npm run package' on a dev machine)." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is not on PATH (need v22 or later).' }

$banner = ''
if ($PSCmdlet.ParameterSetName -eq 'Envs') {
  if ($Warehouse -and $Warehouse -notmatch '=') { throw "With -Envs, give warehouses per env: -Warehouse 'dev=<id>,prod=<id>'" }
  # Parse "dev,stg=gov-stg,prod" in dev, stg, prod order (the server validates names and rejects bad input).
  $order = @('dev', 'stg', 'prod')
  $list = @()
  foreach ($part in ($Envs -split ',')) {
    $part = $part.Trim()
    if (-not $part) { continue }
    $name, $prof = $part -split '=', 2
    $name = $name.Trim()
    if ($null -eq $prof) { $prof = $name }
    $list += [pscustomobject]@{ Name = $name; Profile = $prof.Trim(); Rank = [array]::IndexOf($order, $name) }
  }
  if ($list.Count -eq 0) { throw "-Envs is empty: give e.g. -Envs 'dev,stg=gov-stg,prod'" }
  $list = @($list | Sort-Object { if ($_.Rank -lt 0) { 99 } else { $_.Rank } })

  # AppKit signs in with the default login (DATABRICKS_CONFIG_PROFILE) at startup; each env's client uses its own
  # profile. Use the first env whose login works for that startup sign-in, and warn about the rest.
  $databricks = Get-Command databricks -ErrorAction SilentlyContinue
  if (-not $databricks) { throw 'The Databricks CLI is not on PATH.' }
  $startup = ''
  foreach ($e in $list) {
    $ok = $false
    $p = $null
    try {
      # No temp files: the token goes to a pipe that is read and dropped. Bounded to 30 s.
      $psi = New-Object Diagnostics.ProcessStartInfo
      $psi.FileName = $databricks.Source
      $psi.Arguments = "auth token --profile `"$($e.Profile)`""
      $psi.UseShellExecute = $false
      $psi.CreateNoWindow = $true
      $psi.RedirectStandardOutput = $true
      $psi.RedirectStandardError = $true
      $p = [Diagnostics.Process]::Start($psi)
      $null = $p.StandardOutput.ReadToEndAsync()
      $null = $p.StandardError.ReadToEndAsync()
      if ($p.WaitForExit(30000)) { $ok = ($p.ExitCode -eq 0) } else { try { $p.Kill() } catch { } }
    } catch { $ok = $false } finally { if ($p) { $p.Dispose() } }
    if ($ok) { if (-not $startup) { $startup = $e.Profile } }
    else {
      Write-Warning "Login for '$($e.Name)' (profile $($e.Profile)) failed: run  databricks auth login --profile $($e.Profile)"
    }
  }
  if (-not $startup) {
    $cmds = ($list | ForEach-Object { "databricks auth login --profile $($_.Profile)" }) -join '; '
    Write-Host "No working login among the envs. Run: $cmds"
    exit 1
  }

  $env:JOBS_CONSOLE_ENVS = $Envs
  $env:JOBS_CONSOLE_WAREHOUSES = $Warehouse
  $env:DATABRICKS_CONFIG_PROFILE = $startup
  Remove-Item Env:DATABRICKS_HOST -ErrorAction SilentlyContinue
  Remove-Item Env:DATABRICKS_WAREHOUSE_ID -ErrorAction SilentlyContinue
  $names = ($list | ForEach-Object { "$($_.Name) (profile $($_.Profile))" }) -join ', '
  $banner = "jobs-console: $Data data, envs $names, http://127.0.0.1:$Port  (Ctrl+C to stop) $([char]183) startup login: $startup"
} else {
  $env:DATABRICKS_CONFIG_PROFILE = $Profile
  if ($Warehouse) { $env:DATABRICKS_WAREHOUSE_ID = $Warehouse }
  $banner = "jobs-console: $Data data, profile '$Profile', http://127.0.0.1:$Port  (Ctrl+C to stop)"
}

$env:NODE_ENV = 'production'
$env:JOBS_CONSOLE_DATA = $Data
# Locally "app" means: read as the CLI profile's identity (you), not a forwarded Apps user token.
$env:JOBS_CONSOLE_AUTH = 'app'
$env:DATABRICKS_APP_PORT = "$Port"
# Listen on this machine only. The default, 0.0.0.0, is not browsable (corporate web filters block it) and exposes the app on the network.
$env:FLASK_RUN_HOST = '127.0.0.1'

Write-Host $banner
Push-Location $deploy   # the server serves the page from public\ under the current folder
try { node server.mjs } finally { Pop-Location }
