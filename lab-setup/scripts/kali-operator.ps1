param(
  [Parameter(Position = 0)]
  [ValidateSet("status", "start", "stop", "restart", "ip", "run", "quickcheck", "tools", "gui", "labs-start", "labs-stop")]
  [string]$Action = "status",

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemoteCommand,

  [int]$TimeoutSeconds = 45,
  [int]$OutputLimit = 12000
)

$ErrorActionPreference = "Continue"

$VmName = "kali-linux-2026.1-hyperv-amd64"
$VmUser = "kali"
$KnownIp = "172.28.232.172"
$Key = Join-Path $env:USERPROFILE ".ssh\kali_lab_ed25519"
$LabRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$IpCache = Join-Path $LabRoot ".kali-vm-ip"

function Limit-Text {
  param([string]$Text, [int]$Limit = $OutputLimit)
  if ($null -eq $Text) { return "" }
  if ($Text.Length -le $Limit) { return $Text }
  return $Text.Substring(0, $Limit) + "`n...[truncated]"
}

function Send-Json {
  param([hashtable]$Data)
  $Data.timestamp = (Get-Date).ToUniversalTime().ToString("o")
  $Data.vm_name = $VmName
  $Data | ConvertTo-Json -Depth 8 -Compress
}

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-ProcessCaptured {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [int]$Timeout = $TimeoutSeconds
  )

  $stdout = [IO.Path]::GetTempFileName()
  $stderr = [IO.Path]::GetTempFileName()
  try {
    $process = Start-Process -FilePath $FilePath `
      -ArgumentList $Arguments `
      -NoNewWindow `
      -PassThru `
      -RedirectStandardOutput $stdout `
      -RedirectStandardError $stderr

    $completed = $process.WaitForExit([Math]::Max(1, $Timeout) * 1000)
    if (-not $completed) {
      try { $process.Kill() } catch {}
      return @{
        exit_code = 124
        timed_out = $true
        stdout = Limit-Text (Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue)
        stderr = Limit-Text ((Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue) + "`nTimed out after $Timeout seconds.")
      }
    }

    $process.Refresh()
    return @{
      exit_code = [int]$process.ExitCode
      timed_out = $false
      stdout = Limit-Text (Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue)
      stderr = Limit-Text (Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue)
    }
  } finally {
    Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
  }
}

function Test-KaliSsh {
  param([string]$Ip)
  if (-not (Test-Path -LiteralPath $Key)) { return $false }
  $result = & ssh -i $Key `
    -o BatchMode=yes `
    -o StrictHostKeyChecking=no `
    -o ConnectTimeout=3 `
    "$VmUser@$Ip" "printf ok" 2>$null

  return ($LASTEXITCODE -eq 0 -and $result -eq "ok")
}

function Save-KaliIp {
  param([string]$Ip)
  if (-not $Ip) { return }
  Set-Content -LiteralPath $IpCache -Value $Ip -Encoding ASCII -ErrorAction SilentlyContinue
}

function Get-ArpCandidateIps {
  try {
    arp -a |
      Select-String -Pattern "\d+\.\d+\.\d+\.\d+.*00-15-5d" |
      ForEach-Object { [regex]::Match($_.Line, "\d+\.\d+\.\d+\.\d+").Value } |
      Where-Object { $_ } |
      Sort-Object -Unique
  } catch {
    @()
  }
}

function Get-HyperVState {
  try {
    Import-Module Hyper-V -ErrorAction Stop
    $vm = Get-VM -Name $VmName -ErrorAction Stop
    $adapter = Get-VMNetworkAdapter -VMName $VmName -ErrorAction SilentlyContinue
    return @{
      available = $true
      state = [string]$vm.State
      uptime = [string]$vm.Uptime
      cpu_usage = $vm.CPUUsage
      memory_assigned_mb = [math]::Round($vm.MemoryAssigned / 1MB)
      ip_addresses = @($adapter.IPAddresses | Where-Object { $_ -match "^\d+\.\d+\.\d+\.\d+$" })
      error = ""
    }
  } catch {
    return @{
      available = $false
      state = "unknown"
      uptime = ""
      cpu_usage = $null
      memory_assigned_mb = $null
      ip_addresses = @()
      error = $_.Exception.Message
    }
  }
}

function Resolve-KaliIp {
  $candidates = New-Object System.Collections.Generic.List[string]
  if (Test-Path -LiteralPath $IpCache) {
    $cached = (Get-Content -LiteralPath $IpCache -Raw -ErrorAction SilentlyContinue).Trim()
    if ($cached -and -not $candidates.Contains($cached)) { $candidates.Add($cached) }
  }
  $hyperv = Get-HyperVState
  foreach ($candidate in @($hyperv.ip_addresses)) {
    if ($candidate -and -not $candidates.Contains($candidate)) { $candidates.Add($candidate) }
  }
  foreach ($candidate in @($KnownIp)) {
    if ($candidate -and -not $candidates.Contains($candidate)) { $candidates.Add($candidate) }
  }
  foreach ($candidate in Get-ArpCandidateIps) {
    if ($candidate -and -not $candidates.Contains($candidate)) { $candidates.Add($candidate) }
  }
  foreach ($candidate in $candidates) {
    if (Test-KaliSsh -Ip $candidate) {
      Save-KaliIp -Ip $candidate
      return $candidate
    }
  }
  return ""
}

function Get-KaliStatus {
  $hyperv = Get-HyperVState
  $ip = Resolve-KaliIp
  return @{
    ok = $true
    action = "status"
    is_admin = Test-IsAdmin
    ssh_key_exists = (Test-Path -LiteralPath $Key)
    ssh_ip = $ip
    ssh_ok = [bool]$ip
    hyperv = $hyperv
  }
}

function Start-KaliVm {
  try {
    Import-Module Hyper-V -ErrorAction Stop
    $vm = Get-VM -Name $VmName -ErrorAction Stop
    if ($vm.State -ne "Running") {
      Start-VM -Name $VmName -ErrorAction Stop
      Start-Sleep -Seconds 8
    }
    return @{ ok = $true; error = "" }
  } catch {
    return @{ ok = $false; error = $_.Exception.Message }
  }
}

function Stop-KaliVm {
  try {
    Import-Module Hyper-V -ErrorAction Stop
    $vm = Get-VM -Name $VmName -ErrorAction Stop
    if ($vm.State -eq "Running") {
      Stop-VM -Name $VmName -Shutdown -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 5
      $vm = Get-VM -Name $VmName -ErrorAction Stop
      if ($vm.State -eq "Running") {
        Stop-VM -Name $VmName -TurnOff -Force -ErrorAction Stop
      }
    }
    return @{ ok = $true; error = "" }
  } catch {
    return @{ ok = $false; error = $_.Exception.Message }
  }
}

function Quote-BashSingle {
  param([string]$Text)
  return "'" + ($Text -replace "'", "'\''") + "'"
}

function Invoke-KaliRun {
  param([string]$Command)
  if (-not $Command.Trim()) {
    return @{
      ok = $false
      action = "run"
      error = "missing command"
    }
  }

  $start = Start-KaliVm
  $ip = Resolve-KaliIp
  if (-not $ip) {
    return @{
      ok = $false
      action = "run"
      start = $start
      error = "Kali SSH is not reachable. Start the VM, confirm SSH, or run .\kali-ollama.cmd status."
    }
  }

  $remote = "timeout --preserve-status $TimeoutSeconds bash -lc " + (Quote-BashSingle -Text $Command)
  $result = Invoke-ProcessCaptured -FilePath "ssh.exe" -Arguments @(
    "-i", $Key,
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=no",
    "-o", "ConnectTimeout=5",
    "$VmUser@$ip",
    $remote
  ) -Timeout ([Math]::Max($TimeoutSeconds + 10, 20))

  return @{
    ok = ($result.exit_code -eq 0)
    action = "run"
    ssh_target = "$VmUser@$ip"
    command = $Command
    exit_code = $result.exit_code
    timed_out = $result.timed_out
    stdout = $result.stdout
    stderr = $result.stderr
  }
}

function Open-KaliGui {
  $start = Start-KaliVm
  if (-not $start.ok) {
    return @{ ok = $false; action = "gui"; start = $start; error = $start.error }
  }
  $vmconnect = Join-Path $env:WINDIR "System32\vmconnect.exe"
  Start-Process -FilePath $vmconnect -ArgumentList @("localhost", $VmName) | Out-Null
  return @{ ok = $true; action = "gui"; message = "vmconnect launched" }
}

$startedAt = Get-Date
try {
  switch ($Action) {
    "status" {
      $data = Get-KaliStatus
    }
    "ip" {
      $ip = Resolve-KaliIp
      $data = @{ ok = [bool]$ip; action = "ip"; ip = $ip }
    }
    "start" {
      $start = Start-KaliVm
      $data = Get-KaliStatus
      $data.action = "start"
      $data.start = $start
      $data.ok = [bool]$start.ok
    }
    "stop" {
      $stop = Stop-KaliVm
      $data = Get-KaliStatus
      $data.action = "stop"
      $data.stop = $stop
      $data.ok = [bool]$stop.ok
    }
    "restart" {
      [void](Stop-KaliVm)
      $start = Start-KaliVm
      $data = Get-KaliStatus
      $data.action = "restart"
      $data.start = $start
      $data.ok = [bool]$start.ok
    }
    "run" {
      $command = [string]::Join(" ", $RemoteCommand)
      $data = Invoke-KaliRun -Command $command
    }
    "quickcheck" {
      $data = Invoke-KaliRun -Command "printf 'user='; whoami; printf 'kernel='; uname -r; printf 'ip='; hostname -I; printf 'disk='; df -h / | tail -n 1; printf 'tools='; command -v nmap >/dev/null && printf nmap || true; printf ' '; command -v msfconsole >/dev/null && printf metasploit || true; printf ' '; command -v python3 >/dev/null && printf python3 || true; printf '\n'"
      $data.action = "quickcheck"
    }
    "tools" {
      $toolNames = if ($RemoteCommand -and $RemoteCommand.Count -gt 0) { [string]::Join(" ", $RemoteCommand) } else { "nmap masscan rustscan ffuf feroxbuster gobuster nikto nuclei sqlmap hydra john hashcat msfconsole python3 pipx curl wget git" }
      $script = "for t in $toolNames; do if command -v `$t >/dev/null 2>&1; then printf '%s=present\n' `$t; else printf '%s=missing\n' `$t; fi; done"
      $data = Invoke-KaliRun -Command $script
      $data.action = "tools"
    }
    "gui" {
      $data = Open-KaliGui
    }
    "labs-start" {
      $result = Invoke-ProcessCaptured -FilePath "powershell.exe" -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "start-web-labs.ps1")) -Timeout $TimeoutSeconds
      $data = @{ ok = ($result.exit_code -eq 0); action = "labs-start"; result = $result }
    }
    "labs-stop" {
      $result = Invoke-ProcessCaptured -FilePath "powershell.exe" -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "stop-web-labs.ps1")) -Timeout $TimeoutSeconds
      $data = @{ ok = ($result.exit_code -eq 0); action = "labs-stop"; result = $result }
    }
  }
} catch {
  $data = @{
    ok = $false
    action = $Action
    error = $_.Exception.Message
  }
}

$data.duration_ms = [int](((Get-Date) - $startedAt).TotalMilliseconds)
Send-Json -Data $data
