# Richtet die automatischen Updates über dein eigenes GitHub ein.
# Wird von UPDATES-EINRICHTEN.bat aufgerufen.

. (Join-Path $PSScriptRoot 'hilfen.ps1')
$root = Split-Path -Parent $PSScriptRoot
$script:log = Join-Path $root 'updates-einrichten-log.txt'
try { Start-Transcript -Path $script:log -Force | Out-Null } catch {}
Set-Location $root

Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  Updates über dein eigenes GitHub einrichten'              -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Danach baut GitHub jede neue Version automatisch, und alle, die die'
Write-Host 'App haben, bekommen in der Insel einen Update-Knopf.'
Write-Host 'Du brauchst ein GitHub-Konto (gratis auf github.com).'

# --- 0. Voraussetzungen -----------------------------------------------------
Schritt 'Voraussetzungen prüfen'
Nicht-In-OneDrive $root
if (-not (Test-Path (Join-Path $root 'package.json'))) { Abbruch 'Projektdateien nicht gefunden. Starte die Datei im entpackten Projektordner.' }
Git-Bereit
Bun-Bereit
$tauri = Join-Path $root 'node_modules\@tauri-apps\cli\tauri.js'
if (-not (Test-Path $tauri)) {
    Info 'Pakete werden installiert...'
    & bun install --backend=copyfile
}
if (-not (Test-Path $tauri)) { Abbruch 'Das Tauri-Werkzeug fehlt. Führe zuerst INSTALLIEREN.bat aus.' }
Info 'OK'

# --- 1. GitHub-Name und Repository -----------------------------------------
Schritt '1/6  Dein GitHub'
$defaultUser = 'lianheeb-design'
$defaultRepo = 'Widget-'
do {
    $user = (Read-Host "    Dein GitHub-Benutzername (Enter für `"$defaultUser`")").Trim()
    if (-not $user) { $user = $defaultUser }
} until ($user -match '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$')
$repo = (Read-Host "    Name des Repositorys (Enter für `"$defaultRepo`")").Trim()
if (-not $repo) { $repo = $defaultRepo }
if ($repo -notmatch '^[A-Za-z0-9._-]+$') { Abbruch "Der Name '$repo' geht nicht: nur Buchstaben, Ziffern, - _ und ." }
$base = "https://github.com/$user/$repo"
Info "Repository: $base"

# --- 2. Signatur-Schlüssel --------------------------------------------------
Schritt '2/6  Signatur-Schlüssel'
$keyDir = Join-Path $env:USERPROFILE 'Dynamic-Island-Update-Schluessel'
$key = Join-Path $keyDir 'update.key'
$pub = "$key.pub"
$pwFile = Join-Path $keyDir 'passwort.txt'
if ((Test-Path $key) -and (Test-Path $pub) -and (Test-Path $pwFile)) {
    Info 'Vorhandener Schlüssel wird verwendet.'
    $password = (Get-Content $pwFile -Raw).Trim()
} else {
    New-Item -ItemType Directory -Force $keyDir | Out-Null
    $chars = [char[]]'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    $password = -join (1..32 | ForEach-Object { $chars | Get-Random })
    & bun $tauri signer generate -w $key -p $password --ci -f | Out-Null
    if (-not (Test-Path $key) -or -not (Test-Path $pub)) { Abbruch 'Der Schlüssel konnte nicht erstellt werden.' }
    Set-Content -Path $pwFile -Value $password -Encoding ASCII
    $readme = @"
Signatur-Schlüssel für die Updates von Dynamic Island (Deutsch)

NICHT LÖSCHEN und NIEMANDEM GEBEN.

Ohne diesen Ordner können die installierten Apps keine Updates mehr
bekommen. Mach am besten eine Kopie auf einen USB-Stick.
"@
    Set-Content -Path (Join-Path $keyDir 'LIES-MICH.txt') -Value $readme -Encoding UTF8
    Info "Erstellt in: $keyDir"
}
Wichtig 'Diesen Ordner nie löschen oder weitergeben (am besten auf einem USB-Stick sichern):'
Wichtig "  $keyDir"

# --- 3. App auf dein GitHub umstellen ---------------------------------------
Schritt '3/6  App auf dein GitHub umstellen'
$conf = Join-Path $root 'src-tauri\tauri.conf.json'
$text = [IO.File]::ReadAllText($conf)
$pubkey = (Get-Content $pub -Raw).Trim()
$text = [regex]::Replace($text, '"pubkey"\s*:\s*"[^"]*"', ('"pubkey": "' + $pubkey + '"'))
$text = [regex]::Replace($text, 'https://github\.com/[^/"]+/[^/"]+/releases/latest/download/latest\.json', "$base/releases/latest/download/latest.json")
[IO.File]::WriteAllText($conf, $text, (New-Object Text.UTF8Encoding $false))
if (-not ([IO.File]::ReadAllText($conf)).Contains("$base/releases/latest/download/latest.json")) { Abbruch 'tauri.conf.json konnte nicht angepasst werden.' }
Info 'OK'

# --- 4. Git vorbereiten -----------------------------------------------------
Schritt '4/6  Projekt für GitHub vorbereiten'
Git-Name-Pruefen
$origin = Origin-Url
if ((Test-Path (Join-Path $root '.git')) -and $origin -and $origin -match 'HeyyCzer') {
    # Der Verlauf des Original-Projekts ist nur angerissen; frisch anfangen.
    Remove-Item -Path (Join-Path $root '.git') -Recurse -Force
}
if (-not (Test-Path (Join-Path $root '.git'))) {
    if (-not (Git-Lauf @('init', '-b', 'main'))) { Abbruch 'git init ist fehlgeschlagen.' }
}
& git add -A
& git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    if (-not (Git-Lauf @('commit', '-m', 'Dynamic Island (Deutsch): Updates über eigenes GitHub'))) { Abbruch 'Der Commit ist fehlgeschlagen.' }
}
& git remote remove origin 2>$null
& git remote add origin "$base.git"
Info 'OK'

# --- 5. Repository erstellen und hochladen ----------------------------------
Schritt '5/6  Repository auf GitHub erstellen und hochladen'
# Gibt es das Repository schon (öffentlich)? Dann nichts erstellen.
$env:GIT_TERMINAL_PROMPT = '0'
& git ls-remote "$base.git" *> $null
$exists = $LASTEXITCODE -eq 0
Remove-Item Env:GIT_TERMINAL_PROMPT -ErrorAction SilentlyContinue
if ($exists) {
    Info 'Das Repository gibt es schon.'
} else {
    Wichtig 'Im Browser öffnet sich GitHub. Melde dich an, dann:'
    Wichtig "  - Repository name: $repo"
    Wichtig '  - "Public" (öffentlich) auswählen'
    Wichtig '  - NICHTS weiter ankreuzen (kein README, kein .gitignore, keine Lizenz)'
    Wichtig '  - auf "Create repository" klicken'
    Start-Process "https://github.com/new?name=$repo&visibility=public&description=Dynamic%20Island%20f%C3%BCr%20Windows%20auf%20Deutsch"
    Read-Host '    Wenn das Repository erstellt ist: Enter drücken'
}
do {
    Info 'Wird hochgeladen (beim ersten Mal öffnet sich ein Fenster zur GitHub-Anmeldung)...'
    $ok = Git-Lauf @('push', '-u', 'origin', 'main')
    if (-not $ok) {
        Wichtig 'Das Hochladen hat nicht geklappt. Ist das Repository erstellt und der Name richtig geschrieben?'
        $again = Read-Host '    Nochmals versuchen? (j/n)'
        if ($again -notmatch '^[jJyY]') { Abbruch 'Hochladen abgebrochen.' }
    }
} until ($ok)
Info 'OK'

# --- 6. Geheime Schlüssel bei GitHub hinterlegen ----------------------------
Schritt '6/6  Schlüssel bei GitHub hinterlegen'
Info 'GitHub braucht den Schlüssel, um die Updates zu signieren. Zwei kurze Schritte:'
Set-Clipboard -Value (Get-Content $key -Raw).Trim()
Start-Process "$base/settings/secrets/actions/new"
Wichtig 'Schritt A (die Seite "New secret" ist offen, der Schlüssel ist schon kopiert):'
Wichtig '  - Name: TAURI_SIGNING_PRIVATE_KEY'
Wichtig '  - Secret: Strg+V'
Wichtig '  - auf "Add secret" klicken'
Read-Host '    Fertig? Enter drücken'
Set-Clipboard -Value $password
Start-Process "$base/settings/secrets/actions/new"
Wichtig 'Schritt B (das Passwort ist jetzt kopiert):'
Wichtig '  - Name: TAURI_SIGNING_PRIVATE_KEY_PASSWORD'
Wichtig '  - Secret: Strg+V'
Wichtig '  - auf "Add secret" klicken'
Read-Host '    Fertig? Enter drücken'
Set-Clipboard -Value ' '

# --- Erste Version veröffentlichen ------------------------------------------
Schritt 'Erste Version veröffentlichen'
$version = Json-Version $root
$tag = "v$version"
& git tag -f $tag | Out-Null
if (-not (Git-Lauf @('push', 'origin', $tag, '--force'))) { Abbruch "Der Versions-Tag $tag konnte nicht hochgeladen werden." }
Start-Process "$base/actions"

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host '  Fertig eingerichtet!'                                       -ForegroundColor Green
Write-Host ''
Write-Host "  GitHub baut jetzt Version $version (ca. 15-25 Minuten)."    -ForegroundColor Green
Write-Host '  Den Fortschritt siehst du im Browser unter "Actions".'      -ForegroundColor Green
Write-Host ''
Write-Host '  Danach liegt der Installer hier:'                           -ForegroundColor Green
Write-Host "  $base/releases/latest"                                      -ForegroundColor Green
Write-Host ''
Write-Host '  Installiere ihn einmal auf jedem PC (auch bei dir). Ab dann'  -ForegroundColor Green
Write-Host '  kommen Updates per Knopf in der Insel.'                     -ForegroundColor Green
Write-Host '  Neue Version veröffentlichen: UPDATE-VEROEFFENTLICHEN.bat'  -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
try { Stop-Transcript | Out-Null } catch {}
Read-Host 'Enter drücken zum Schliessen'
