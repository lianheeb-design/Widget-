# Zugangsverwaltung einrichten (Installationen sperren und freigeben)

Mit der Zugangsverwaltung kannst du einzelne Installationen deiner Insel aus der
Ferne sperren und wieder freigeben. Jede Installation bekommt beim ersten Start
eine zufällige ID, ohne Konto, Login oder persönliche Daten. Du verwaltest
alles in einem eigenen Admin-Dashboard.

Wie es technisch funktioniert, wie es abgesichert ist und **wo die Grenzen
liegen**, steht in [`README.md`](README.md) (Englisch). Lies vor allem den
Abschnitt *Limits of client-side enforcement*.

**Solange `src-tauri/license.json` keinen `endpoint` hat, ist die Prüfung aus**
und die Insel läuft wie bisher. Du kannst also in Ruhe einrichten.

---

## Was du brauchst

- Ein kostenloses Konto bei [supabase.com](https://supabase.com)
- **Node.js** (für `npx supabase …`) und **Bun** (hast du schon vom Installieren)
- Etwa 30 Minuten

---

## 1. Supabase-Projekt anlegen

1. Auf [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Name z. B. `insel-zugang`, ein **starkes Datenbank-Passwort** (im Passwort-Manager speichern), Region **Central EU (Zurich)** oder **Frankfurt**.
3. Warten, bis das Projekt bereit ist.
4. Notiere dir unter **Project Settings → API** (bzw. **API Keys**):
   - die **Project URL**, z. B. `https://abcdefghijklmnop.supabase.co`
   - die **Project Ref**: der Teil vor `.supabase.co`, hier `abcdefghijklmnop`
   - den **anon**- bzw. **publishable**-Schlüssel (öffentlich, für das Dashboard)

> Den **service_role**- bzw. **secret**-Schlüssel brauchst du nirgends. Er gehört nie in die App und nie ins Dashboard.

## 2. Signatur-Schlüssel erzeugen

> **PowerShell:** Meldet sie «Ausführung von Skripts ist deaktiviert», schreib `npx.cmd` statt `npx`. Die Sicherheitseinstellung musst du nicht ändern.

Anmelden und das Projekt verbinden:

```bash
npx supabase login
```

Taste Enter, im Browser bestätigen, den angezeigten Code im Terminal eintippen.

```bash
npx supabase link --project-ref DEINE-PROJECT-REF
```

Schlüsselpaar erzeugen. Der private Schlüssel landet in einer Datei statt auf dem Bildschirm, geht direkt zu Supabase, und die Datei wird danach gelöscht:

```bash
bun scripts/license-keygen.ts --write --secret-file license-secret.env
```

```bash
npx supabase secrets set --env-file license-secret.env --yes
```

```bash
del license-secret.env
```

- Der **private Schlüssel** existiert danach nur noch bei Supabase (als Geheimnis, nicht mehr auslesbar). Er gehört **nie** in Git, in die App oder in einen Chat. Geht er verloren, erzeugst du einfach ein neues Paar (siehe *Schlüssel wechseln*).
- Der **öffentliche Schlüssel** steht jetzt in `src-tauri/license.json` unter `publicKeys`. Damit prüft die App, dass eine Antwort wirklich von deinem Server kommt.

## 3. Datenbank und Edge Function hochladen

```bash
npx supabase db push --remote
```

Legt die Tabellen und Funktionen an (`supabase/migrations/…_licensing.sql`).

> **Hängt das bei «Initialising login role…»?** Dann blockiert dein Netzwerk den Datenbank-Port 5432. Spiel die Migration stattdessen über HTTPS ein: `npx supabase db query --remote --yes --file supabase/migrations/20261111120000_licensing.sql`.

```bash
npx supabase functions deploy license --no-verify-jwt --use-api --yes
```

Optionale Einstellungen (jederzeit änderbar, ohne neue App-Version):

| Geheimnis | Standard | Bedeutung |
| --- | --- | --- |
| `LICENSE_GRACE_HOURS` | 24 | So lange läuft die Insel ohne Internet weiter |
| `LICENSE_CHECK_MINUTES` | 10 | So oft prüft eine laufende Insel |
| `LICENSE_MIN_VERSION` | – | Ältere Versionen zeigen «Update nötig», z. B. `1.2.0` |
| `LICENSE_MAX_REGISTRATIONS_PER_MINUTE` | 30 | Schutz gegen Massen-Registrierungen |

Beispiel: `npx supabase secrets set LICENSE_GRACE_HOURS=72`

### Kurz testen

In PowerShell (ersetze `DEINE-PROJECT-REF`):

```powershell
$body = @{ installationId = [guid]::NewGuid().ToString(); secret = "A" * 43; nonce = "B" * 22; appVersion = "1.1.0" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://DEINE-PROJECT-REF.supabase.co/functions/v1/license" -Body $body -ContentType "application/json"
```

Kommt eine Antwort mit `token`, läuft alles. Diese Test-Installation siehst du später im Dashboard und kannst sie ignorieren oder löschen (siehe unten).

## 4. Admin-Konto anlegen

1. Supabase → **Authentication → Users → Add user → Create new user**: deine E-Mail-Adresse, ein **starkes, einzigartiges Passwort**, *Auto Confirm User* anhaken.
2. **Authentication → Sign In / Providers** (bzw. *Settings*): **Allow new users to sign up** ausschalten. So kann sich niemand sonst ein Konto anlegen. (Selbst wenn: Ohne Eintrag in der Admin-Liste sieht und ändert ein Konto nichts.)
3. **SQL Editor** → neue Abfrage, deine Adresse einsetzen, **Run**:

```sql
insert into licensing.admins (user_id)
select id from auth.users where email = 'deine@adresse.ch';
```

## 5. App mit dem Server verbinden

In `src-tauri/license.json` den `endpoint` eintragen:

```json
{
	"endpoint": "https://DEINE-PROJECT-REF.supabase.co/functions/v1/license",
	"publicKeys": ["…steht schon da…"]
}
```

Beide Werte sind nicht geheim und dürfen ins Git. Der Build prüft die Datei: Ist sie fehlerhaft, bricht er mit einer klaren Meldung ab.

Dann wie gewohnt eine neue Version veröffentlichen (**`UPDATE-VEROEFFENTLICHEN.bat`**) oder lokal installieren (**`INSTALLIEREN.bat`**). Bestehende Installationen bekommen das Update, registrieren sich beim nächsten Start und erscheinen im Dashboard.

> **Erst veröffentlichen, wenn Schritt 3 getestet ist.** Erreicht eine Installation den Server nie, zeigt sie nach 24 Stunden «Verbindung nötig».

## 6. Dashboard starten

1. `admin/.env.example` kopieren nach `admin/.env.local` und ausfüllen:

   ```
   VITE_SUPABASE_URL=https://DEINE-PROJECT-REF.supabase.co
   VITE_SUPABASE_ANON_KEY=dein-anon-oder-publishable-key
   ```

2. **`ADMIN-DASHBOARD.bat`** doppelklicken. Der Browser öffnet `http://localhost:5174`.
3. Mit dem Admin-Konto aus Schritt 4 anmelden. Schliesst du den Browser, bist du abgemeldet.

Das Dashboard läuft nur auf deinem PC. Du kannst es auch bei einem Hoster für statische Seiten veröffentlichen (`cd admin`, `bun run build`, Ordner `admin/dist`), musst es aber nicht.

---

## Bedienung

- **Übersicht:** Gesamtzahl, aktiv, gesperrt, *In Betrieb* (letzter Kontakt im gewählten Zeitraum) und neu registriert (7 Tage).
- **Gerät:** Ab App-Version 1.2.1 zeigt jede Zeile den **Computernamen** (wie in Windows unter *System → Info* eingestellt, z. B. `LIAN-LAPTOP`). Ältere Versionen zeigen «Gerät unbekannt», bis sie aktualisiert sind.
- **Suchen** nach Gerät, ID (auch Teilen davon), Version oder Sperrgrund; **filtern** nach Status.
- **Sperren:** In der Zeile oder in der Detailansicht auf *Sperren*, einen Grund eintragen (sieht nur du), bestätigen.
- **Freigeben:** genauso, mit einer optionalen Notiz.
- **Details:** Klick auf eine Zeile zeigt volle ID, Status, Registrierung, letzten Kontakt, Version, Sperrgrund und die **Sperrhistorie** (wer hat wann was gemacht).

### Wann wirkt eine Sperre?

- Läuft die Insel: bei der nächsten Prüfung, spätestens nach etwa **10 Minuten**. Die Insel zeigt dann «**Zugriff deaktiviert**», schaltet ihre Funktionen ab und startet sich einmal neu, damit wirklich nichts mehr im Hintergrund läuft.
- Ist der PC aus: beim nächsten Start.
- Ist die Insel offline: Sie läuft höchstens bis zum Ende ihrer Gnadenfrist (24 Stunden nach der letzten erfolgreichen Prüfung) und stoppt dann mit «Verbindung nötig». Sobald sie wieder online ist, sieht sie die Sperre.

Eine **Freigabe** wirkt genauso bei der nächsten Prüfung. Die Insel startet ihre Funktionen dann ohne Neustart. Wer gesperrt ist, kann auch auf *Erneut prüfen* klicken.

### Wie finde ich eine bestimmte Installation?

Die Person sieht ihre **Installations-ID** in der Insel unter *Einstellungen → Über → Zugang* bzw. auf der Sperrseite im Einstellungsfenster (mit Kopier-Knopf). Diese ID im Dashboard suchen.

---

## Testen, bevor du veröffentlichst

Alles lässt sich auch ganz ohne Supabase auf deinem PC ausprobieren:

```bash
cd supabase/tests
bun install
bun test
```

Damit laufen 35 Tests gegen die echte Datenbank-Logik und die Edge Function.

```bash
bun local-server.ts
```

Ein lokaler Testserver mit derselben Logik. Er zeigt die Werte für die App und das Dashboard an (Admin `admin@localhost` / `local-admin`).

---

## Gut zu wissen

- **Grenzen:** Eine Sperre ist kein Kopierschutz. Wer technisch versiert ist, kann die App verändern (sie ist Open Source unter GPL-3.0, das ist sogar erlaubt) oder durch Löschen ihrer Daten als neue Installation starten. Details in [`README.md`](README.md).
- **Der Server muss laufen.** Löschst oder pausierst du das Supabase-Projekt, zeigen alle Installationen nach 24 Stunden «Verbindung nötig». Willst du die Prüfung beenden: zuerst eine Version mit leerem `endpoint` veröffentlichen.
- **Kontingent:** Jede laufende Insel prüft alle 10 Minuten, das sind bis zu ~4300 Aufrufe pro Monat und Installation. Der Gratis-Plan von Supabase enthält 500 000 Edge-Function-Aufrufe im Monat. Bei vielen Installationen `LICENSE_CHECK_MINUTES` erhöhen (Sperren wirken dann später) oder einen bezahlten Plan nehmen.
- **Datenschutz:** Die Datenschutzerklärung (`docs/privacy/index.md`) beschreibt die Prüfung. Sag den Leuten, die deine Insel bekommen, dass es sie gibt.
- **Daten einer Installation löschen** (z. B. auf Anfrage): Supabase → SQL Editor:

  ```sql
  delete from licensing.installations where installation_id = 'DIE-ID';
  ```

- **Schlüssel wechseln** (falls der private Schlüssel bekannt wurde): Ablauf in [`README.md`](README.md), Abschnitt *Rotating the signing key*.
