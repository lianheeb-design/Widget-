# Startet das Admin-Dashboard der Zugangsverwaltung (ADMIN-DASHBOARD.bat).
# Anleitung: docs/licensing/EINRICHTEN.md

. "$PSScriptRoot\hilfen.ps1"

$root = Split-Path -Parent $PSScriptRoot
$admin = Join-Path $root 'admin'
Pfad-Auffrischen

if (-not (Hat-Befehl 'bun')) {
    Abbruch 'Bun fehlt. Bitte zuerst INSTALLIEREN.bat ausführen.'
}

if (-not (Test-Path (Join-Path $admin '.env.local'))) {
    Wichtig 'Das Dashboard ist noch nicht eingerichtet.'
    Info 'Kopiere admin\.env.example nach admin\.env.local und trage die Supabase-URL'
    Info 'und den öffentlichen Schlüssel ein (Anleitung: docs\licensing\EINRICHTEN.md, Schritt 6).'
    Read-Host 'Enter drücken zum Schliessen'
    exit 1
}

Set-Location $admin
if (-not (Test-Path (Join-Path $admin 'node_modules'))) {
    Schritt 'Dashboard wird vorbereitet (nur beim ersten Mal)'
    bun install
    if ($LASTEXITCODE -ne 0) { Abbruch 'bun install hat nicht geklappt.' }
}

Schritt 'Dashboard läuft auf http://localhost:5174 (dieses Fenster offen lassen, schliessen beendet es)'
bun run dev --open
