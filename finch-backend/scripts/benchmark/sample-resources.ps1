# Diagnostic resource sampler for the Finch latency benchmark.
# Samples system + per-process counters at a fixed interval into a CSV.
# Read-only: touches no Finch production files or configuration.
param(
  [Parameter(Mandatory = $true)][string]$OutFile,
  [int[]]$TrackPids = @(),
  [int]$IntervalMs = 1000
)

$ErrorActionPreference = 'SilentlyContinue'

# Processes of interest by name (matched every tick so late children such as
# whisper-cli, the ollama model runner (llama-server) or piper are picked up).
$namePattern = '^(ollama.*|llama-server|whisper-cli|piper|node.*)$'

$header = 'ts,kind,name,pid,cpu_pct,ws_mb,priv_mb,pf_per_sec,sys_cpu_pct,avail_mb,pagefile_mb,page_in_ps,page_out_ps,max_freq_pct,commit_pct'
Set-Content -Path $OutFile -Value $header -Encoding ascii

$first = $true
while ($true) {
  $ts = (Get-Date).ToString('o')

  # --- system counters ---
  $sysCpu = ''; $avail = ''; $pf = ''; $pin = ''; $pout = ''; $pfu = ''; $freq = ''; $commit = ''
  try {
    $cpuObj = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"
    if ($cpuObj) { $sysCpu = [math]::Round($cpuObj.PercentProcessorTime, 1) }
  } catch {}
  try {
    # Thermal/scheduler headroom: % of maximum non-Turbo frequency.
    $freqSample = (Get-Counter '\Processor Information(_Total)\% of Maximum Frequency' -ErrorAction Stop).CounterSamples | Select-Object -First 1
    if ($freqSample) { $freq = [math]::Round($freqSample.CookedValue, 1) }
  } catch {}
  try {
    $commitSample = (Get-Counter '\Memory\% Committed Bytes In Use' -ErrorAction Stop).CounterSamples | Select-Object -First 1
    if ($commitSample) { $commit = [math]::Round($commitSample.CookedValue, 1) }
  } catch {}
  try {
    $memObj = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
    if ($memObj) {
      if ($memObj.AvailableMBytes -ne $null) { $avail = [math]::Round($memObj.AvailableMBytes, 0) }
      if ($memObj.PagesInputPerSec -ne $null) { $pin = [math]::Round($memObj.PagesInputPerSec, 1) }
      if ($memObj.PagesOutputPerSec -ne $null) { $pout = [math]::Round($memObj.PagesOutputPerSec, 1) }
      if ($memObj.PageFaultsPerSec -ne $null) { $pf = [math]::Round($memObj.PageFaultsPerSec, 0) }
    }
  } catch {}
  try {
    $pfuObj = Get-CimInstance Win32_PageFileUsage | Select-Object -First 1
    if ($pfuObj) { $pfu = $pfuObj.CurrentUsage }
  } catch {}

  Add-Content -Path $OutFile -Value "$ts,sys,,,$sysCpu,,,$pf,$sysCpu,$avail,$pfu,$pin,$pout,$freq,$commit" -Encoding ascii

  # --- process counters ---
  try {
    $procs = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process
    foreach ($p in $procs) {
      # The perf class exposes the pid as IDProcess (ProcessId is not set).
      $procId = 0
      if ($p.IDProcess) { $procId = [int]$p.IDProcess }
      elseif ($p.ProcessId) { $procId = [int]$p.ProcessId }
      if ($procId -eq 0) { continue }
      $tracked = $TrackPids -contains $procId
      $named = $p.Name -match $namePattern
      if (-not ($tracked -or $named)) { continue }
      $cpu = ''; $ws = ''; $priv = ''; $pfr = ''
      if ($p.PercentProcessorTime -ne $null) { $cpu = [math]::Round($p.PercentProcessorTime, 1) }
      if ($p.WorkingSet -ne $null) { $ws = [math]::Round($p.WorkingSet / 1MB, 1) }
      if ($p.PrivateBytes -ne $null) { $priv = [math]::Round($p.PrivateBytes / 1MB, 1) }
      if ($p.PageFaultsPerSec -ne $null) { $pfr = [math]::Round($p.PageFaultsPerSec, 0) }
      $safeName = ($p.Name -replace ',', '_')
      Add-Content -Path $OutFile -Value "$ts,proc,$safeName,$procId,$cpu,$ws,$priv,$pfr,,,,,,," -Encoding ascii
    }
  } catch {}

  $first = $false
  Start-Sleep -Milliseconds $IntervalMs
}
