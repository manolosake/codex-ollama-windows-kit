param(
  [Parameter(Mandatory = $true)][string]$Model,
  [string]$CopyRoot = "",
  [string]$ElectronUserData = "",
  [int]$ProxyPort = 11435,
  [string]$LogDir = "",
  [int]$StartupGraceSeconds = 45,
  [int]$IdleSeconds = 12,
  [switch]$StopProxy
)

$ErrorActionPreference = "Continue"

if (-not $LogDir) {
  $LogDir = Join-Path $env:TEMP "codex-ollama-logs"
}
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$log = Join-Path $LogDir ("codex-ollama-close-watch-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
Start-Transcript -Path $log -Force | Out-Null

function Get-CodexOllamaProcesses {
  $copyNeedle = if ($CopyRoot) { [System.IO.Path]::GetFullPath($CopyRoot) } else { "" }
  $dataNeedle = if ($ElectronUserData) { [System.IO.Path]::GetFullPath($ElectronUserData) } else { "" }

  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -in @("Codex.exe", "codex.exe") -and (
        ($_.CommandLine -like "*Codex-Ollama-App*") -or
        ($_.CommandLine -like "*Codex-Ollama*") -or
        ($copyNeedle -and $_.CommandLine -like "*$copyNeedle*") -or
        ($dataNeedle -and $_.CommandLine -like "*$dataNeedle*")
      )
    }
}

function Stop-OllamaModel {
  try {
    $ollama = Get-Command "ollama.exe" -ErrorAction SilentlyContinue
    if (-not $ollama) {
      $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"),
        (Join-Path $env:ProgramFiles "Ollama\ollama.exe")
      )
      foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
          $ollama = [pscustomobject]@{ Source = $candidate }
          break
        }
      }
    }

    if (-not $ollama) {
      Write-Host "ollama.exe not found; model was not stopped."
      return
    }

    Write-Host "Stopping Ollama model: $Model"
    & $ollama.Source stop $Model
  } catch {
    Write-Host "Failed to stop model: $($_.Exception.Message)"
  }
}

function Stop-OllamaProxy {
  if (-not $StopProxy) {
    return
  }

  Get-CimInstance Win32_Process -Filter "name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -like "*ollama-openai-fast-proxy.js*" -and
      $_.CommandLine -like "*$ProxyPort*"
    } |
    ForEach-Object {
      try {
        Write-Host "Stopping Ollama proxy pid=$($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      } catch {}
    }
}

try {
  Write-Host "Watching Codex Ollama close. Model: $Model"
  $deadline = (Get-Date).AddSeconds($StartupGraceSeconds)
  $seenApp = $false
  $idleSince = $null

  while ($true) {
    $processes = @(Get-CodexOllamaProcesses)

    if ($processes.Count -gt 0) {
      $seenApp = $true
      $idleSince = $null
      Start-Sleep -Seconds 5
      continue
    }

    if (-not $seenApp -and (Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 2
      continue
    }

    if ($null -eq $idleSince) {
      $idleSince = Get-Date
      Start-Sleep -Seconds 2
      continue
    }

    if (((Get-Date) - $idleSince).TotalSeconds -ge $IdleSeconds) {
      break
    }

    Start-Sleep -Seconds 2
  }

  if (@(Get-CodexOllamaProcesses).Count -eq 0) {
    Stop-OllamaModel
    Stop-OllamaProxy
  } else {
    Write-Host "Codex Ollama reopened; skipping shutdown."
  }
} finally {
  try { Stop-Transcript | Out-Null } catch {}
}
