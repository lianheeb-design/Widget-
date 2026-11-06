# Installiert alles Nötige, baut Dynamic Island (deutsche Version) und startet den Installer.
# Wird von INSTALLIEREN.bat aufgerufen.

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'installieren-log.txt'
try { Start-Transcript -Path $log -Force | Out-Null } catch {}

function Schritt([string]$text) {
    Write-Host ''
    Write-Host "==> $text" -ForegroundColor Cyan
}

function Info([string]$text) {
    Write-Host "    $text" -ForegroundColor Gray
}

function Abbruch([string]$text) {
    Write-Host ''
    Write-Host "FEHLER: $text" -ForegroundColor Red
    Write-Host ''
    Write-Host "Ein Protokoll liegt hier: $log" -ForegroundColor Yellow
    Write-Host 'Kopiere die Fehlermeldung (oder die Protokolldatei) in den Chat mit Claude, dann geht es weiter.' -ForegroundColor Yellow
    try { Stop-Transcript | Out-Null } catch {}
    Read-Host 'Enter drücken zum Schliessen'
    exit 1
}

function Pfad-Auffrischen {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user;$env:USERPROFILE\.cargo\bin;$env:USERPROFILE\.bun\bin"
}

function Hat-Befehl([string]$name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Winget-Installieren([string]$id, [string[]]$extra = @()) {
    $arguments = @('install', '--id', $id, '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements') + $extra
    & winget @arguments
    # winget meldet auch "schon installiert" als Fehlercode; geprüft wird danach selbst.
}

Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  Dynamic Island für Windows – deutsche Version'              -ForegroundColor Cyan
Write-Host '  Installation mit Wetter, Timer und neuen Farben'            -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Das dauert beim ersten Mal etwa 30 bis 60 Minuten und lädt einige'
Write-Host 'Gigabyte herunter. Lass das Fenster offen, bis "Fertig" erscheint.'
Write-Host 'Windows fragt zwischendurch nach Administrator-Rechten: mit "Ja" bestätigen.'

# --- 0. Voraussetzungen ---------------------------------------------------
Schritt 'Voraussetzungen prüfen'
if (-not (Test-Path (Join-Path $root 'package.json'))) {
    Abbruch 'Projektdateien nicht gefunden. Entpacke die ZIP-Datei zuerst ganz (Rechtsklick > Alle extrahieren) und starte INSTALLIEREN.bat im entpackten Ordner.'
}
if ($root -match 'OneDrive' -or ($env:OneDrive -and $root.StartsWith($env:OneDrive, [StringComparison]::OrdinalIgnoreCase))) {
    Abbruch ("Der Ordner liegt in OneDrive:`r`n    $root`r`n`r`nOneDrive synchronisiert beim Bauen tausende Dateien und bringt das Bauen durcheinander. " +
        "Entpacke die ZIP-Datei neu nach C:\Projekte (Ordner anlegen, falls nötig) und starte INSTALLIEREN.bat dort.")
}
if (-not [Environment]::Is64BitOperatingSystem) {
    Abbruch 'Dieses Windows ist 32-Bit. Die App braucht ein 64-Bit-Windows 10 oder 11.'
}
if (-not (Hat-Befehl 'winget')) {
    Abbruch 'Der Windows-Paketmanager "winget" fehlt. Installiere im Microsoft Store den "App-Installer" und starte danach INSTALLIEREN.bat nochmals.'
}
Info 'OK'

# --- 1. C++-Werkzeuge von Microsoft (für Rust nötig) ----------------------
Schritt '1/5  C++-Werkzeuge von Microsoft (Visual Studio Build Tools)'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
function Hat-VC {
    if (-not (Test-Path $vswhere)) { return $false }
    $found = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    return [bool]$found
}
if (Hat-VC) {
    Info 'Schon installiert.'
} else {
    Info 'Wird installiert (ca. 2-5 GB, das dauert eine Weile)...'
    Winget-Installieren 'Microsoft.VisualStudio.2022.BuildTools' @('--override', '--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended')
    if (-not (Hat-VC)) {
        Abbruch 'Die C++-Werkzeuge konnten nicht installiert werden. Starte den PC neu und führe INSTALLIEREN.bat nochmals aus.'
    }
    Info 'Installiert.'
}

# --- 2. Rust --------------------------------------------------------------
Schritt '2/5  Rust'
Pfad-Auffrischen
if (-not (Hat-Befehl 'rustup')) {
    Info 'Wird installiert...'
    Winget-Installieren 'Rustlang.Rustup'
    Pfad-Auffrischen
}
if (-not (Hat-Befehl 'rustup')) {
    Abbruch 'Rust konnte nicht installiert werden. Installiere es von https://rustup.rs und starte INSTALLIEREN.bat nochmals.'
}
$toolchainFile = Join-Path $root 'src-tauri\rust-toolchain.toml'
$channel = 'stable'
if (Test-Path $toolchainFile) {
    $match = Select-String -Path $toolchainFile -Pattern 'channel\s*=\s*"([^"]+)"' | Select-Object -First 1
    if ($match) { $channel = $match.Matches[0].Groups[1].Value }
}
Info "Rust-Version $channel wird eingerichtet..."
& rustup toolchain install $channel --profile minimal --component rustfmt --component clippy
if ($LASTEXITCODE -ne 0) { Abbruch "Rust $channel konnte nicht eingerichtet werden." }
& rustup default $channel | Out-Null
Info 'OK'

# --- 3. Bun ---------------------------------------------------------------
Schritt '3/5  Bun'
Pfad-Auffrischen
if (-not (Hat-Befehl 'bun')) {
    Info 'Wird installiert...'
    Winget-Installieren 'Oven-sh.Bun'
    Pfad-Auffrischen
}
if (-not (Hat-Befehl 'bun')) {
    Info 'Zweiter Versuch über bun.sh...'
    try { Invoke-RestMethod 'https://bun.sh/install.ps1' | Invoke-Expression } catch {}
    Pfad-Auffrischen
}
if (-not (Hat-Befehl 'bun')) {
    Abbruch 'Bun konnte nicht installiert werden. Installiere es von https://bun.sh und starte INSTALLIEREN.bat nochmals.'
}
Info 'OK'

# --- 4. App bauen ---------------------------------------------------------
Schritt '4/5  App bauen (beim ersten Mal 10-20 Minuten)'
Set-Location $root
# Zwischenstände eines früheren Builds (auch von einem anderen PC) verwerfen.
Get-ChildItem -Path $root -Filter '*.tsbuildinfo' -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
# Kopien statt Verknüpfungen in den Zwischenspeicher: robuster bei Virenschutz.
& bun install --backend=copyfile
if ($LASTEXITCODE -ne 0) { Abbruch 'bun install ist fehlgeschlagen (Internetverbindung prüfen).' }

# Die Werkzeuge direkt über ihre Dateien starten statt über die Kurzbefehle in
# node_modules\.bin: Auf manchen PCs fehlen diese (Virenschutz, Firmen-Richtlinien).
$nodeModules = Join-Path $root 'node_modules'
$tsc = Join-Path $root 'node_modules\typescript\bin\tsc'
$vite = Join-Path $root 'node_modules\vite\bin\vite.js'
$tauri = Join-Path $root 'node_modules\@tauri-apps\cli\tauri.js'
$native = Join-Path $root 'node_modules\@tauri-apps\cli-win32-x64-msvc'
function Werkzeuge-Da { (Test-Path $tsc) -and (Test-Path $vite) -and (Test-Path $tauri) -and (Test-Path $native) }

# Findet Pakete, denen Dateien fehlen (abgebrochener Download, Virenschutz).
function Defekte-Pakete([string]$nodeModules) {
    $broken = New-Object System.Collections.Generic.List[string]
    $dirs = Get-ChildItem -Path $nodeModules -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne '.bin' -and $_.Name -ne '.cache' }
    $packages = foreach ($d in $dirs) {
        if ($d.Name.StartsWith('@')) { Get-ChildItem -Path $d.FullName -Directory -ErrorAction SilentlyContinue } else { $d }
    }
    foreach ($p in $packages) {
        $manifest = Join-Path $p.FullName 'package.json'
        if (-not (Test-Path $manifest)) { $broken.Add($p.Name); continue }
        try { $json = Get-Content $manifest -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $broken.Add($p.Name); continue }
        $paths = @()
        foreach ($field in 'main', 'module', 'types', 'typings') {
            $value = $json.$field
            if ($value -is [string] -and $value) { $paths += $value }
        }
        # Every concrete file "exports" points at (patterns with * skipped).
        $stack = New-Object System.Collections.Stack
        if ($null -ne $json.exports) { $stack.Push($json.exports) }
        while ($stack.Count -gt 0) {
            $node = $stack.Pop()
            if ($node -is [string]) {
                if ($node.StartsWith('./') -and -not $node.Contains('*')) { $paths += $node }
            } elseif ($node -is [System.Management.Automation.PSCustomObject]) {
                foreach ($prop in $node.PSObject.Properties) { $stack.Push($prop.Value) }
            } elseif ($node -is [array]) {
                foreach ($item in $node) { $stack.Push($item) }
            }
        }
        # Build folders the package says it ships.
        foreach ($entry in @($json.files)) {
            if ($entry -is [string] -and @('dist', 'lib', 'bin', 'build') -contains ($entry.Trim('/').TrimStart('.').TrimStart('/'))) { $paths += $entry }
        }
        if ($json.bin -is [string]) { $paths += $json.bin }
        elseif ($json.bin) { $paths += $json.bin.PSObject.Properties | ForEach-Object { $_.Value } }
        foreach ($rel in $paths) {
            $clean = ($rel -replace '^\./', '') -replace '/', [IO.Path]::DirectorySeparatorChar
            $full = Join-Path $p.FullName $clean
            # "main": "index" without extension is allowed.
            if (-not (Test-Path $full) -and -not (Test-Path "$full.js") -and -not (Test-Path (Join-Path $full 'index.js'))) {
                $broken.Add("$($p.Name) ($rel)"); break
            }
        }
    }
    return ,$broken
}

$broken = Defekte-Pakete $nodeModules
if ($broken.Count -gt 0 -or -not (Werkzeuge-Da)) {
    Info "Unvollständige Pakete gefunden: $($broken -join ', ')"
    Info 'Der Paket-Zwischenspeicher wird geleert und alles frisch geladen...'
    & bun pm cache rm
    Remove-Item -Path $nodeModules -Recurse -Force -ErrorAction SilentlyContinue
    & bun install --force --backend=copyfile
    $broken = Defekte-Pakete $nodeModules
}
if ($broken.Count -gt 0 -or -not (Werkzeuge-Da)) {
    Abbruch ("Diesen Paketen fehlen nach dem Herunterladen immer noch Dateien: $($broken -join ', ').`r`n" +
        "Vermutlich löscht oder blockiert ein Virenschutz Dateien im Ordner node_modules. " +
        "Falls du darfst, nimm den Ordner C:\Projekte im Virenschutz aus, sonst frag die Person, die den PC betreut.")
}
Info 'Alle Pakete vollständig.'

Info 'Oberfläche wird gebaut...'
& bun $tsc -b
if ($LASTEXITCODE -ne 0) { Abbruch 'Die Prüfung der Oberfläche (TypeScript) ist fehlgeschlagen.' }
& bun $vite build
if ($LASTEXITCODE -ne 0) { Abbruch 'Das Bauen der Oberfläche (Vite) ist fehlgeschlagen.' }

Info 'Windows-App wird gebaut (das dauert am längsten)...'
& bun $tauri build --config src-tauri/tauri.installer.conf.json
if ($LASTEXITCODE -ne 0) { Abbruch 'Das Bauen der App ist fehlgeschlagen.' }

$bundle = Join-Path $root 'src-tauri\target\release\bundle\nsis'
$setup = Get-ChildItem -Path $bundle -Filter '*-setup.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { Abbruch "Kein Installer gefunden in $bundle." }

# Für später auch neben INSTALLIEREN.bat ablegen.
$copy = Join-Path $root 'Dynamic-Island-Deutsch-Setup.exe'
Copy-Item $setup.FullName $copy -Force
Info "Installer erstellt: $copy"

# --- 5. Installieren ------------------------------------------------------
Schritt '5/5  Installieren'
Get-Process -Name 'Dynamic Island', 'dynamic-island' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Info 'Der Installer startet jetzt. Folge den Schritten im neuen Fenster.'
# Nur auf den Installer selbst warten: -Wait würde auch auf die App warten, die er am Ende startet.
$installer = Start-Process -FilePath $copy -PassThru
$installer.WaitForExit()

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host '  Fertig! Die Insel sitzt jetzt oben am Bildschirm.'          -ForegroundColor Green
Write-Host '  Einstellungen: Rechtsklick auf das Symbol unten rechts.'     -ForegroundColor Green
Write-Host ''
Write-Host '  Für einen anderen PC brauchst du nur noch die Datei'         -ForegroundColor Green
Write-Host '  Dynamic-Island-Deutsch-Setup.exe aus diesem Ordner.'         -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
try { Stop-Transcript | Out-Null } catch {}
Read-Host 'Enter drücken zum Schliessen'
