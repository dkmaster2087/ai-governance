# Probaline: list the MCP servers configured on this Windows PC, for the AI usage assessment.
#
# Read-only. Reads the MCP settings of Claude Desktop, Claude Code, Cursor, VS Code and Windsurf and prints one
# JSON line per server: which app, the server's name, whether it runs a local program or calls a URL, the
# program's name and package, or the URL's host. It never prints environment values, headers, arguments other
# than a package name, or anything after a URL's host. Nothing is sent anywhere; collect the output with your
# device-management tool (Intune) and give the files to the Probaline collector.
#
# Usage: mcp-scan.ps1 [-HomeDir C:\Users\jdoe] [-Out file]
#   Run as SYSTEM (device management), it scans every profile in C:\Users; otherwise the current one.
# Beta: written to match mcp-scan.sh (macOS, tested); not yet run on Windows in Probaline's tests.
param([string]$HomeDir = "", [string]$Out = "")
$ErrorActionPreference = "SilentlyContinue"

$Configs = @(
  @{ Client = "claude_desktop"; Path = "AppData\Roaming\Claude\claude_desktop_config.json"; Keys = @("mcpServers") },
  @{ Client = "claude_code"; Path = ".claude.json"; Keys = @("mcpServers"); Projects = $true },
  @{ Client = "cursor"; Path = ".cursor\mcp.json"; Keys = @("mcpServers") },
  @{ Client = "vscode"; Path = "AppData\Roaming\Code\User\mcp.json"; Keys = @("servers") },
  @{ Client = "vscode"; Path = "AppData\Roaming\Code\User\settings.json"; Keys = @("mcp", "servers") },
  @{ Client = "windsurf"; Path = ".codeium\windsurf\mcp_config.json"; Keys = @("mcpServers") }
)
$Runners = @("npx", "uvx", "bunx", "pnpx", "pipx", "docker", "podman", "deno")
$ValueFlags = @("-e", "--env", "--env-file", "-v", "--volume", "--mount", "--name", "-p", "--publish", "--network", "-w", "--workdir", "-u", "--user", "--token", "--api-key", "--key", "--secret", "--password", "--from")
$Package = '^(@[a-z0-9._-]+/)?[a-z0-9][a-z0-9._-]*(@[A-Za-z0-9._^~-]+)?$'
$Image = '^[a-z0-9][a-z0-9._/-]*(:[A-Za-z0-9._-]+)?$'

function Test-Secretish([string]$a) {
  ($a -cmatch '^(gh[pousr]_|github_pat_|sk-|sk_|xox[abpr]-|AKIA|ASIA|eyJ|glpat-|AIza)') -or
  ($a.Length -ge 24 -and $a -match '\d' -and $a -match '[A-Za-z]' -and $a -notmatch '[/@.:-]')
}

function Read-Json([string]$file) {
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  $text = Get-Content -LiteralPath $file -Raw
  try { return $text | ConvertFrom-Json } catch {}
  # VS Code settings allow comments and trailing commas.
  $text = [regex]::Replace($text, '(?m)^\s*//.*$', '')
  $text = [regex]::Replace($text, '/\*[\s\S]*?\*/', '')
  $text = [regex]::Replace($text, ',(\s*[}\]])', '$1')
  try { return $text | ConvertFrom-Json } catch { return $null }
}

function Describe($name, $cfg) {
  $o = [ordered]@{ name = ([string]$name).Substring(0, [Math]::Min(100, ([string]$name).Length)) }
  $url = @($cfg.url, $cfg.serverUrl, $cfg.httpUrl) | Where-Object { $_ -is [string] } | Select-Object -First 1
  if ($url) {
    $o.transport = if ($cfg.type -eq "sse" -or $url -match '/sse/?([?#]|$)') { "sse" } else { "http" }
    if ($url -match '^[a-z][a-z0-9+.-]*://(?:[^/@?#]*@)?(\[[^\]]+\]|[^/:?#]+)') { $o.urlHost = $Matches[1].ToLower() }
  } else {
    $o.transport = "stdio"
    if ($cfg.command -is [string]) {
      $command = Split-Path -Leaf $cfg.command
      $o.command = $command
      $args2 = @($cfg.args | Where-Object { $_ -is [string] })
      if ($Runners -contains ($command -replace '\.(exe|cmd)$', '')) {
        $isDocker = $command -match '^(docker|podman)'
        for ($i = 0; $i -lt $args2.Count; $i++) {
          $a = $args2[$i]
          if ($a.StartsWith("-") -or ($i -gt 0 -and $ValueFlags -contains $args2[$i - 1]) -or @("run", "dlx", "x", "exec", "tool") -contains $a) { continue }
          $pattern = if ($isDocker) { $Image } else { $Package }
          if ($a -cmatch $pattern -and $a -notmatch '=' -and -not (Test-Secretish $a)) { $o.package = $a; break }
        }
      }
    }
  }
  $envCount = if ($cfg.env) { @($cfg.env.PSObject.Properties).Count } else { 0 }
  $hdrCount = if ($cfg.headers) { @($cfg.headers.PSObject.Properties).Count } else { 0 }
  $o.credentials = ($envCount + $hdrCount) -gt 0
  return $o
}

if ($HomeDir) { $homes = @($HomeDir) }
elseif ([Security.Principal.WindowsIdentity]::GetCurrent().IsSystem) {
  $homes = Get-ChildItem C:\Users -Directory | Where-Object { $_.Name -notin @("Public", "Default", "Default User", "All Users") } | ForEach-Object { $_.FullName }
} else { $homes = @($env:USERPROFILE) }

$device = $env:COMPUTERNAME
$time = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$lines = @()
foreach ($h in $homes) {
  $user = Split-Path -Leaf $h
  $found = @()
  foreach ($c in $Configs) {
    $doc = Read-Json (Join-Path $h $c.Path)
    if (-not $doc) { continue }
    $found += $c.Client
    $blocks = @()
    $v = $doc; foreach ($k in $c.Keys) { if ($v) { $v = $v.$k } }; $blocks += ,$v
    if ($c.Projects -and $doc.projects) { foreach ($p in $doc.projects.PSObject.Properties) { $blocks += ,$p.Value.mcpServers } }
    $seen = @{}
    foreach ($b in $blocks) {
      if (-not $b) { continue }
      foreach ($s in $b.PSObject.Properties) {
        $d = Describe $s.Name $s.Value
        $key = ($d | ConvertTo-Json -Compress)
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        $rec = [ordered]@{ schema = "probaline.endpoint_mcp/1"; time = $time; device = $device; user = $user; client = $c.Client; config = "~\" + $c.Path }
        foreach ($k in $d.Keys) { $rec[$k] = $d[$k] }
        $lines += ($rec | ConvertTo-Json -Compress)
      }
    }
  }
  $lines += ([ordered]@{ schema = "probaline.endpoint_mcp/1"; kind = "scan"; time = $time; device = $device; user = $user; clients = @($found | Select-Object -Unique) } | ConvertTo-Json -Compress)
}
if ($Out) { $lines | Add-Content -LiteralPath $Out -Encoding UTF8 } else { $lines | Write-Output }
