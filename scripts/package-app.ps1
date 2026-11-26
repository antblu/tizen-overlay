param(
    [Parameter(Mandatory = $false)]
    [ValidateSet("test-app", "overlay-app")]
    [string]$App = "test-app",

    [Parameter(Mandatory = $false)]
    [string]$ProfileName = "",

    [Parameter(Mandatory = $false)]
    [string]$TargetIp = "",

    [Parameter(Mandatory = $false)]
    [string]$DeviceName = "",

    [Parameter(Mandatory = $false)]
    [switch]$AllowDefaultProfile,

    [Parameter(Mandatory = $false)]
    [string]$TizenStudioPath = "C:\tizen-studio",

    [Parameter(Mandatory = $false)]
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$AppDir = Join-Path $RepoRoot $App
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $RepoRoot "dist"
}

$TizenBat = Join-Path $TizenStudioPath "tools\ide\bin\tizen.bat"
$SdbExe = Join-Path $TizenStudioPath "tools\sdb.exe"

if (-not (Test-Path $AppDir)) {
    throw "App directory not found: $AppDir"
}
if (-not (Test-Path $TizenBat)) {
    throw "tizen.bat not found at $TizenBat"
}

$AppId = if ($App -eq "overlay-app") { "tznOvly002.G65BOverlay" } else { "tznOvly001.G65BDpTest" }

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

# tizen.bat invokes cmd.exe, which rejects UNC working directories (\\wsl.localhost\...).
# Stage into a local Windows temp directory when needed, then copy the .wgt back to OutputDir.
$StageRoot = Join-Path $env:TEMP ("tizen-overlay-stage-" + [Guid]::NewGuid().ToString("N"))
$StageAppDir = Join-Path $StageRoot $App
$StageOutDir = Join-Path $StageRoot "out"

try {
    New-Item -ItemType Directory -Force -Path $StageAppDir, $StageOutDir | Out-Null
    Copy-Item -Recurse -Force (Join-Path $AppDir "*") $StageAppDir

    $PackageArgs = @("package", "-t", "wgt", "-o", $StageOutDir)
    if (-not [string]::IsNullOrWhiteSpace($ProfileName)) {
        $PackageArgs += @("-s", $ProfileName)
    }
    $PackageArgs += @("--", $StageAppDir)

    Write-Host "Running: $TizenBat $($PackageArgs -join ' ')" -ForegroundColor Cyan
    Push-Location $StageRoot
    try {
        & $TizenBat @PackageArgs
        if ($LASTEXITCODE -ne 0) {
            throw "tizen package failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }

    $StagedWgt = Get-ChildItem -Path $StageOutDir -Filter "*.wgt" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $StagedWgt) {
        throw "No .wgt file produced in $StageOutDir"
    }

    # Samsung TV installer rejects .wgt filenames containing spaces.
    $SafeWgtName = $StagedWgt.Name -replace "\s+", ""
    if ($SafeWgtName -ne $StagedWgt.Name) {
        $RenamedPath = Join-Path $StageOutDir $SafeWgtName
        Move-Item -Force $StagedWgt.FullName $RenamedPath
        $StagedWgt = Get-Item $RenamedPath
    }

    $FinalWgtPath = Join-Path $OutputDir $StagedWgt.Name
    Copy-Item -Force $StagedWgt.FullName $FinalWgtPath
    Write-Host "Built package: $FinalWgtPath" -ForegroundColor Green

    if (-not [string]::IsNullOrWhiteSpace($TargetIp) -or -not [string]::IsNullOrWhiteSpace($DeviceName)) {
        if (-not (Test-Path $SdbExe)) {
            throw "sdb.exe not found at $SdbExe"
        }

        if (-not [string]::IsNullOrWhiteSpace($TargetIp)) {
            $TargetAddr = if ($TargetIp -match ":\d+$") { $TargetIp } else { "${TargetIp}:26101" }
            Write-Host "Connecting SDB to $TargetAddr..." -ForegroundColor Cyan
            & $SdbExe connect $TargetAddr
        }

        $DevicesOut = & $SdbExe devices
        $DevicesOut | ForEach-Object { Write-Host $_ }

        if ([string]::IsNullOrWhiteSpace($DeviceName)) {
            $Pattern = if (-not [string]::IsNullOrWhiteSpace($TargetIp)) {
                "^\s*" + [Regex]::Escape($TargetAddr) + "\s+device\s+(\S+)"
            } else {
                "^\s*\S+\s+device\s+(\S+)"
            }
            $Match = $DevicesOut | Select-String -Pattern $Pattern | Select-Object -First 1
            if ($Match) {
                $DeviceName = $Match.Matches[0].Groups[1].Value
            }
        }

        if ([string]::IsNullOrWhiteSpace($DeviceName)) {
            throw "Could not determine SDB device name. Pass -DeviceName (e.g. LS27BG652ENXGO)."
        }

        if ([string]::IsNullOrWhiteSpace($ProfileName) -and -not $AllowDefaultProfile) {
            $Duid = (& $SdbExe -s $DeviceName shell 0 getduid 2>$null | Out-String).Trim()
            throw "Installing on a physical Samsung monitor ($DeviceName, DUID=$Duid) requires -ProfileName with a Samsung certificate profile. Pass -AllowDefaultProfile to override."
        }

        Write-Host "Installing $($StagedWgt.Name) to device '$DeviceName'..." -ForegroundColor Cyan
        Push-Location $StageOutDir
        try {
            & $TizenBat install -n $StagedWgt.Name -t $DeviceName -- $StageOutDir
            if ($LASTEXITCODE -ne 0) {
                throw "tizen install failed with exit code $LASTEXITCODE"
            }

            Write-Host "Launching $AppId on device '$DeviceName'..." -ForegroundColor Cyan
            & $TizenBat run -p $AppId -t $DeviceName
        } finally {
            Pop-Location
        }
    }
} finally {
    if (Test-Path $StageRoot) {
        Remove-Item -Recurse -Force $StageRoot -ErrorAction SilentlyContinue
    }
}
