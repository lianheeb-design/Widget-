# Gemeinsame Helfer für UPDATES-EINRICHTEN.bat und UPDATE-VEROEFFENTLICHEN.bat.

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

function Schritt([string]$text) {
    Write-Host ''
    Write-Host "==> $text" -ForegroundColor Cyan
}

function Info([string]$text) {
    Write-Host "    $text" -ForegroundColor Gray
}

function Wichtig([string]$text) {
    Write-Host "    $text" -ForegroundColor Yellow
}

function Abbruch([string]$text) {
    Write-Host ''
    Write-Host "FEHLER: $text" -ForegroundColor Red
    Write-Host ''
    if ($script:log) { Write-Host "Ein Protokoll liegt hier: $script:log" -ForegroundColor Yellow }
    Write-Host 'Kopiere die Fehlermeldung (oder die Protokolldatei) in den Chat mit Claude, dann geht es weiter.' -ForegroundColor Yellow
    try { Stop-Transcript | Out-Null } catch {}
    Read-Host 'Enter drücken zum Schliessen'
    exit 1
}

function Pfad-Auffrischen {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user;$env:USERPROFILE\.cargo\bin;$env:USERPROFILE\.bun\bin;$env:ProgramFiles\Git\cmd"
}

function Hat-Befehl([string]$name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Nicht-In-OneDrive([string]$root) {
    if ($root -match 'OneDrive' -or ($env:OneDrive -and $root.StartsWith($env:OneDrive, [StringComparison]::OrdinalIgnoreCase))) {
        Abbruch "Der Ordner liegt in OneDrive ($root). Verschiebe das Projekt nach C:\Projekte und starte die Datei dort."
    }
}

function Git-Bereit {
    Pfad-Auffrischen
    if (-not (Hat-Befehl 'git')) {
        Info 'Git wird installiert...'
        & winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
        Pfad-Auffrischen
    }
    if (-not (Hat-Befehl 'git')) {
        Abbruch 'Git fehlt. Installiere "Git for Windows" von https://git-scm.com und starte die Datei nochmals.'
    }
}

function Bun-Bereit {
    Pfad-Auffrischen
    if (-not (Hat-Befehl 'bun')) {
        Abbruch 'Bun fehlt. Führe zuerst INSTALLIEREN.bat einmal aus.'
    }
}

# Git meldet Fortschritt auf stderr; nur der Exit-Code zählt.
function Git-Lauf([string[]]$arguments) {
    & git @arguments | Out-Host
    return $LASTEXITCODE -eq 0
}

function Git-Name-Pruefen {
    $name = (& git config --global user.name) 2>$null
    $mail = (& git config --global user.email) 2>$null
    if (-not $name -or -not $mail) {
        Info 'Git braucht einmalig deinen Namen und deine E-Mail (stehen in jedem Commit).'
        $name = Read-Host '    Dein Name'
        $mail = Read-Host '    Deine E-Mail (die von GitHub)'
        & git config --global user.name $name
        & git config --global user.email $mail
    }
}

function Json-Version([string]$root) {
    return (Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
}

function Origin-Url {
    $url = (& git remote get-url origin) 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return "$url".Trim()
}
