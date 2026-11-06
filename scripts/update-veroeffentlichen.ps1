# Veröffentlicht eine neue Version: GitHub baut sie, und alle installierten
# Apps bieten das Update an. Wird von UPDATE-VEROEFFENTLICHEN.bat aufgerufen.

. (Join-Path $PSScriptRoot 'hilfen.ps1')
$root = Split-Path -Parent $PSScriptRoot
$script:log = Join-Path $root 'update-veroeffentlichen-log.txt'
try { Start-Transcript -Path $script:log -Force | Out-Null } catch {}
Set-Location $root

Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  Neue Version veröffentlichen'                              -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan

Schritt 'Voraussetzungen prüfen'
Nicht-In-OneDrive $root
Git-Bereit
Bun-Bereit
$conf = [IO.File]::ReadAllText((Join-Path $root 'src-tauri\tauri.conf.json'))
$origin = Origin-Url
if (-not $origin -or $origin -match 'HeyyCzer' -or $conf.Contains('HeyyCzer/windows-island/releases')) {
    Abbruch 'Die Updates sind noch nicht eingerichtet. Führe zuerst UPDATES-EINRICHTEN.bat aus.'
}
$base = $origin -replace '\.git$', ''
Git-Name-Pruefen
Info "Repository: $base"

Schritt 'Version wählen'
$current = Json-Version $root
Info "Aktuelle Version: $current"
Write-Host '    [1] Kleines Update, z. B. Fehler behoben (Enter)'
Write-Host '    [2] Grösseres Update, z. B. neue Funktionen'
$choice = Read-Host '    Auswahl'
$kind = if ($choice -eq '2') { 'minor' } else { 'patch' }
$message = (Read-Host '    Was ist neu? (kurz, Enter für "Update")').Trim()
if (-not $message) { $message = 'Update' }

Schritt 'Änderungen speichern'
& git add -A
& git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    if (-not (Git-Lauf @('commit', '-m', $message))) { Abbruch 'Der Commit ist fehlgeschlagen.' }
}
# Erhöht die Version in package.json und Cargo.toml, committet und setzt den Tag.
& bun pm version $kind -m "v%s: $message"
if ($LASTEXITCODE -ne 0) { Abbruch 'Die Version konnte nicht erhöht werden.' }
$version = Json-Version $root
$tag = "v$version"
Info "Neue Version: $version"

Schritt 'Hochladen'
if (-not (Git-Lauf @('push', 'origin', 'HEAD'))) { Abbruch 'Das Hochladen ist fehlgeschlagen.' }
if (-not (Git-Lauf @('push', 'origin', $tag))) { Abbruch "Der Versions-Tag $tag konnte nicht hochgeladen werden." }
Start-Process "$base/actions"

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host "  Version $version ist unterwegs!"                            -ForegroundColor Green
Write-Host ''
Write-Host '  GitHub baut sie jetzt (ca. 15-25 Minuten, siehe "Actions").'  -ForegroundColor Green
Write-Host '  Danach erscheint bei allen innerhalb von ein paar Stunden'    -ForegroundColor Green
Write-Host '  (oder beim nächsten Start der App) der Update-Knopf.'          -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
try { Stop-Transcript | Out-Null } catch {}
Read-Host 'Enter drücken zum Schliessen'
