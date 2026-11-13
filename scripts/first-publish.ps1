<#
.SYNOPSIS
  Publishes the first version of the engine to crates.io and npm, by hand.

.DESCRIPTION
  crates.io and npm set up trusted publishing only for a package that already
  exists, so the first version of the crate (verticopolis-engine) and of the
  npm package (@verticopolis/engine) goes up from the owner's machine, once.
  Every later version is published by .github/workflows/engine-publish.yml
  (CONTRIBUTING.md "The registries").

  The script publishes an engine release that already exists
  (engine-v<Version> on GitHub, with its npm tarball attached):

  1. It checks out the release tag in a temporary worktree, with LF line
     endings, so the crate it sends is the tagged source byte for byte.
  2. It runs `cargo publish --dry-run`, then asks before `cargo publish`.
  3. It downloads the release's npm tarball, checks its SHA-256, runs
     `npm publish --dry-run`, then asks before `npm publish`.
  4. It prints the trusted-publisher settings to add on each site.

  Needs git, Rust (the rust-version in engine-rs/Cargo.toml or later) and
  Node.js with npm. Run it from anywhere inside a checkout of the repository:

    .\scripts\first-publish.ps1 -Version 1.29.1

  A registry that already holds the version is skipped, so running it again
  after a failure only does what is left.

.PARAMETER Version
  The engine version to publish (x.y.z), with a published engine-v<Version>
  release.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+$')]
  [string]$Version
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Repo = 'maniator/verticopolis'
$Crate = 'verticopolis-engine'
$Package = '@verticopolis/engine'
$Tag = "engine-v$Version"
$Tarball = "verticopolis-engine-$Version.tgz"
$Workflow = 'engine-publish.yml'
$Environment = 'registry'

function Invoke-Checked {
  param([string]$File, [string[]]$Arguments)
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$File $($Arguments -join ' ') failed (exit $LASTEXITCODE)." }
}

# A command whose failure is an answer (not logged in, not published yet).
# Windows PowerShell turns a native command's stderr into an error under
# ErrorActionPreference Stop, so this runs it with Continue and no stderr.
function Invoke-Quiet {
  param([string]$File, [string[]]$Arguments)
  $saved = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = & $File @Arguments 2>$null
    return [pscustomobject]@{ Code = $LASTEXITCODE; Out = (@($out) -join "`n").Trim() }
  } finally {
    $ErrorActionPreference = $saved
  }
}

function Confirm-Step {
  param([string]$Question)
  $answer = Read-Host "$Question [y/N]"
  return $answer -match '^(y|yes)$'
}

function Test-Url {
  param([string]$Url)
  try {
    Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -UserAgent 'verticopolis-first-publish' | Out-Null
    return $true
  } catch {
    $property = $_.Exception.PSObject.Properties['Response']
    if ($null -ne $property -and $null -ne $property.Value -and [int]$property.Value.StatusCode -eq 404) { return $false }
    throw
  }
}

foreach ($tool in 'git', 'cargo', 'npm') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH." }
}

$top = Invoke-Quiet git @('rev-parse', '--show-toplevel')
if ($top.Code -ne 0) { throw 'Run this from inside a checkout of the repository.' }
$root = $top.Out

Write-Host "Fetching $Tag..."
Invoke-Checked git @('-C', $root, 'fetch', '--quiet', 'origin', "refs/tags/${Tag}:refs/tags/$Tag")

$work = Join-Path ([IO.Path]::GetTempPath()) "vc-first-publish-$Version"
if (Test-Path $work) {
  Invoke-Quiet git @('-C', $root, 'worktree', 'remove', '--force', $work) | Out-Null
  if (Test-Path $work) { Remove-Item -Recurse -Force $work }
}
Invoke-Quiet git @('-C', $root, 'worktree', 'prune') | Out-Null
# LF endings, whatever this machine's core.autocrlf says, so the published
# crate holds the tagged bytes.
Invoke-Checked git @('-C', $root, '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'worktree', 'add', '--quiet', '--detach', $work, $Tag)

try {
  # The crate.
  $crateUrl = "https://crates.io/api/v1/crates/$Crate/$Version"
  if (Test-Url $crateUrl) {
    Write-Host "$Crate $Version is already on crates.io; skipping the crate."
  } else {
    Push-Location (Join-Path $work 'engine-rs')
    try {
      Write-Host "`nDry run: cargo publish --dry-run --locked"
      Invoke-Checked cargo @('publish', '--dry-run', '--locked')
      Write-Host @"

To publish, cargo needs a crates.io token. Make one at
  https://crates.io/settings/tokens/new
with the scope "publish-new", limited to the crate $Crate, and a short
expiry. Then run 'cargo login' in another window and paste it there.
"@
      if (Confirm-Step "Publish $Crate $Version to crates.io now?") {
        Invoke-Checked cargo @('publish', '--locked')
        Write-Host "Published $Crate $Version. Revoke the token at https://crates.io/settings/tokens and run 'cargo logout'."
      } else {
        Write-Host 'Skipped the crate.'
      }
    } finally {
      Pop-Location
    }
  }

  # The npm package.
  $have = Invoke-Quiet npm @('view', "$Package@$Version", 'version')
  if ($have.Code -eq 0 -and $have.Out -eq $Version) {
    Write-Host "$Package@$Version is already on npm; skipping the npm package."
  } else {
    $download = "https://github.com/$Repo/releases/download/$Tag"
    $tgz = Join-Path $work $Tarball
    Invoke-WebRequest -Uri "$download/$Tarball" -OutFile $tgz -UseBasicParsing -UserAgent 'verticopolis-first-publish'
    $sums = (Invoke-WebRequest -Uri "$download/$Tarball.sha256" -UseBasicParsing -UserAgent 'verticopolis-first-publish').Content
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
    $expected = ($sums.Trim() -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 $tgz).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "$Tarball has SHA-256 $actual, but the release says $expected." }
    Write-Host "`n$Tarball matches its SHA-256."

    # Provenance needs a CI run; the workflow adds it from the next version on.
    Write-Host "`nDry run: npm publish --dry-run"
    Invoke-Checked npm @('publish', $tgz, '--access', 'public', '--provenance=false', '--dry-run')
    if ((Invoke-Quiet npm @('whoami')).Code -ne 0) {
      Write-Host "`nnpm is not logged in; opening npm login."
      Invoke-Checked npm @('login')
    }
    if (Confirm-Step "Publish $Package@$Version to npm now?") {
      Invoke-Checked npm @('publish', $tgz, '--access', 'public', '--provenance=false')
      Write-Host "Published $Package@$Version."
    } else {
      Write-Host 'Skipped the npm package.'
    }
  }
} finally {
  Invoke-Checked git @('-C', $root, 'worktree', 'remove', '--force', $work)
}

Write-Host @"

Last step, once per site: let the release workflow publish from now on.

crates.io: https://crates.io/crates/$Crate/settings
  Trusted Publishing > Add > GitHub
  Repository owner: maniator    Repository name: verticopolis
  Workflow filename: $Workflow    Environment: $Environment

npm: https://www.npmjs.com/package/$Package/access
  Trusted Publisher > GitHub Actions
  Organization or user: maniator    Repository: verticopolis
  Workflow filename: $Workflow    Environment name: $Environment
  Then, under Publishing access, choose to require two-factor
  authentication and disallow tokens.
"@
