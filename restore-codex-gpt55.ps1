$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSCommandPath
$config = Join-Path $env:USERPROFILE ".codex\config.toml"
$workspacePathForToml = $root.ToLowerInvariant().Replace("'", "''")
$workspaceKey = "projects.'$workspacePathForToml'"

if (-not (Test-Path -LiteralPath $config)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $config) | Out-Null
  Set-Content -LiteralPath $config -Value "" -Encoding UTF8
}

$text = Get-Content -LiteralPath $config -Raw

function Set-TopLevelTomlValue {
  param(
    [string]$Text,
    [string]$Key,
    [string]$Value
  )

  $line = "$Key = `"$Value`""
  $escapedKey = [regex]::Escape($Key)
  $firstSection = [regex]::Match($Text, "(?m)^\[")
  $topLevelText = if ($firstSection.Success) { $Text.Substring(0, $firstSection.Index) } else { $Text }

  if ($topLevelText -match "(?m)^$escapedKey\s*=") {
    return [regex]::Replace($Text, "(?m)^$escapedKey\s*=.*$", $line, 1)
  }

  if ($firstSection.Success) {
    return $Text.Insert($firstSection.Index, $line + [Environment]::NewLine)
  }

  return $line + [Environment]::NewLine + $Text
}

$text = Set-TopLevelTomlValue -Text $text -Key "model" -Value "gpt-5.5"
$text = Set-TopLevelTomlValue -Text $text -Key "model_reasoning_effort" -Value "xhigh"
$text = [regex]::Replace($text, '(?m)^model_provider\s*=.*\r?\n?', '')
$text = [regex]::Replace($text, '(?m)^openai_base_url\s*=.*\r?\n?', '')
$text = [regex]::Replace($text, '(?m)^forced_login_method\s*=.*\r?\n?', '')

if ($text -notmatch '(?m)^\[windows\]') {
  $text = $text.TrimEnd() + [Environment]::NewLine + [Environment]::NewLine + "[windows]" + [Environment]::NewLine
}
if ($text -notmatch '(?m)^sandbox\s*=\s*"elevated"') {
  $text = [regex]::Replace($text, '(?ms)(^\[windows\]\r?\n)', "`$1sandbox = `"elevated`"" + [Environment]::NewLine, 1)
}
if ($text -notmatch [regex]::Escape("[$workspaceKey]")) {
  $text = $text.TrimEnd() + @"

[$workspaceKey]
trust_level = "trusted"
"@
}

Set-Content -LiteralPath $config -Value ($text.TrimEnd() + [Environment]::NewLine) -Encoding UTF8

Write-Host "Codex default restaurado a GPT-5.5:"
Get-Content -LiteralPath $config | Select-Object -First 10
