# Remote access management

The developer can block single installations of the island from an admin
dashboard, and unblock them again. This document describes how it works, how
it is secured and where its limits are. The step-by-step setup (in German) is
in [`EINRICHTEN.md`](EINRICHTEN.md).

## Overview

```
 Desktop app (Rust)                    Supabase                              Admin dashboard (admin/)
 ──────────────────                    ────────                              ───────────────────────
 src-tauri/src/license/   ── HTTPS ──▶ Edge Function `license`               React + supabase-js
  - installation id + secret            (supabase/functions/license)          - Supabase Auth sign-in
    (Windows Credential Manager)          - validates the request             - admin_* functions only
  - signed answer cached                  - calls public.license_check ──┐
  - checks: start, every 10 min,          - signs an Ed25519 JWT          │
    network back, "Check again"                                           ▼
  - locks the app's own features       Postgres (supabase/migrations)   ◀── admin_* (security definer,
                                         schema `licensing` (private)        check licensing.admins)
                                         - installations
                                         - installation_events (audit)
                                         - admins
```

| Part | Where |
| --- | --- |
| Database schema, functions, privileges | `supabase/migrations/20261111120000_licensing.sql` |
| Edge Function (protocol, token signing) | `supabase/functions/license/handler.ts`, `index.ts` |
| Desktop client | `src-tauri/src/license/` (`engine.rs` holds the rules) |
| Feature gating | `src-tauri/src/features.rs`, gates in `hub.rs`, `providers/mod.rs`, `lib.rs`, `sound.rs`, `pip.rs`, `providers/activities/api.rs` |
| Lock message | `src/components/island/LockedIsland.tsx`, `src/settings/LockedSettings.tsx`, `src/components/LockedMessage.tsx` |
| Admin dashboard | `admin/` |
| Key generation | `scripts/license-keygen.ts` |
| Tests and local test server | `supabase/tests/`, Rust unit tests in `src-tauri/src/license/` |

## Identity

On the first start the app creates, with the operating system's secure random
number generator:

- an **installation id**: a random UUID v4;
- an **installation secret**: 32 random bytes.

Both are stored in the Windows Credential Manager (DPAPI, bound to the Windows
user), like the app's other secrets. If the Credential Manager refuses to
store, a file in the app's local data folder is used instead.

The server stores the id and a SHA-256 hash of the secret. The secret proves on
every check that the request comes from that installation, so knowing an
installation id (for example from a support request) is not enough to act as
that installation.

No account, no name, no e-mail address, no hardware fingerprint. A request
contains exactly: installation id, secret, a fresh random nonce, and the app
version.

Dev builds (`cargo tauri dev`) use their own credential names
(`…-dev`), so the developer can block a dev build without blocking the
installed app. `ISLAND_LICENSE_PROFILE` (dev builds only) adds more, to try
several installations on one computer.

## Protocol

`POST https://<project>.supabase.co/functions/v1/license`

```json
{ "installationId": "uuid", "secret": "base64url(32 bytes)", "nonce": "base64url(16 bytes)", "appVersion": "1.2.0" }
```

The function runs with `verify_jwt = false`: the app carries no Supabase key
at all. The function validates the input strictly and calls
`public.license_check` with the service role key (which exists only inside
Supabase). That function registers an unknown installation as `ACTIVE`, or
verifies the secret of a known one, records the contact (`last_seen`,
`last_status_check`, `app_version`) and returns the status.

Answer `200`: `{ "token": "<JWT>" }`, signed with Ed25519 (`alg: EdDSA`):

| Claim | Meaning |
| --- | --- |
| `iss` | `island-license` |
| `sub` | the installation id |
| `status` | `active`, `blocked` or `outdated` |
| `nonce` | the request's nonce (replay protection) |
| `iat`, `exp` | issued at, and `iat` + offline grace period |
| `chk` | seconds until the next check |
| `v` | token format version (1) |

Errors: `400 invalid_request`, `401 invalid_credentials`, `405`, `413`,
`429 rate_limited` (more than `LICENSE_MAX_REGISTRATIONS_PER_MINUTE` new
installations in a minute), `500 misconfigured`, `503 unavailable`.

## Client rules (`src-tauri/src/license/engine.rs`)

- Only a token that verifies against a public key built into the app counts,
  and only if `sub` is this installation and `nonce` is this request's nonce.
- `blocked` applies at once and stays, online or offline and across restarts,
  until the server says otherwise.
- `active` lasts for the grace period (`exp - iat`, 24 h by default) after it
  arrived, measured on the local clock, so a wrong system clock doesn't matter.
  Without a new answer in that time the app stops (`expired`, message
  "Connection needed") until it reaches the server again.
- A failed check (offline, timeout, server error, garbage, wrong signature)
  never blocks: the grace period simply keeps running.
- A new installation runs for 24 h before its first answer (`pending`), so it
  works when installed offline.
- A clock turned back by more than 2 h (relative to the latest time seen,
  which is stored) counts as `expired`: it would otherwise stretch the grace
  period forever.
- `outdated` (app below `LICENSE_MIN_VERSION`) holds until the app is updated;
  an updated app asks again.
- A stored token is verified again on every start; an edited one is dropped.

Checks run at startup, every `chk` seconds (10 min by default, bounded to
5 min–24 h), when Windows reports that the internet is back, and when the user
clicks "Check again" / "Check now". Failed checks retry after 5, 10, 20, 60,
120, 300 and 600 s (±20 % jitter, so clients don't all retry at once after an
outage). Requests time out after 10 s.

## What "blocked" does in the app

Not just a message:

- **Started locked**: none of the app's features start (`features.rs`): no data
  providers, hence no media, clipboard, notifications, calendar, Claude Code
  hooks, global shortcuts, local HTTP API (`127.0.0.1:5199`), file drops,
  sounds. The island shows only the lock message, the settings window only
  the lock page with the installation id, and the tray stays (open settings,
  hide, quit, install a ready update).
- **Locked while running**: the gates close at once (no snapshots to the UI,
  `provider_action` refused, shortcuts ignored, local API answers `423`,
  sounds silent, PiP and web apps closed). Then the app restarts itself into
  the locked state, so no background thread keeps running. It only restarts
  when the locked state is stored (so the new process surely comes up locked),
  and at most once per 5 minutes; otherwise it stays up with the gates closed.
- **Unblocked**: the features start right away, without a restart.

The lock message shows no technical details (no error codes, no server
address). The installation id is shown in the settings window, so the user can
quote it when contacting the developer.

## Admin side

- Sign-in with **Supabase Auth** (e-mail and password). Only users listed in
  `licensing.admins` are admins.
- The dashboard holds only the public anon/publishable key. Every action is a
  `public.admin_*` function (`security definer`, empty `search_path`) that
  first checks `licensing.admins`, and raises `42501` otherwise.
- The tables are in the private schema `licensing`, which the Data API doesn't
  expose. Row level security is on with no policies, and no API role
  (`anon`, `authenticated`, `service_role`) has any privilege on them.
  `license_check` is executable by `service_role` only.
- Every block and unblock writes `installation_events` with the admin's id and
  e-mail address, the reason and the time. The table is append-only (an update
  trigger refuses changes); deleting an installation removes its history too
  (for data deletion requests).
- The session is kept in `sessionStorage`: closing the browser signs out.

## Configuration

Desktop app, `src-tauri/license.json` (baked in at build time; `build.rs`
refuses a broken file):

| Key | Meaning |
| --- | --- |
| `endpoint` | URL of the Edge Function. Empty: the check is off (builds before the server is set up behave as before). |
| `publicKeys` | Ed25519 public keys (base64). Several while rotating keys. |

Dev builds only: `ISLAND_LICENSE_ENDPOINT`, `ISLAND_LICENSE_PUBLIC_KEY`
(override the file, `http://127.0.0.1` allowed), `ISLAND_LICENSE_PROFILE`.

Edge Function secrets (`npx supabase secrets set NAME=value`):

| Secret | Default | Meaning |
| --- | --- | --- |
| `LICENSE_SIGNING_KEY` | (required) | Ed25519 private key, base64 PKCS#8, from `bun scripts/license-keygen.ts` |
| `LICENSE_KEY_ID` | `main` | `kid` in the token header |
| `LICENSE_GRACE_HOURS` | `24` | Offline grace period (1–720) |
| `LICENSE_CHECK_MINUTES` | `10` | Check interval told to the apps (5–1440) |
| `LICENSE_MIN_VERSION` | – | Versions below get "Update required" |
| `LICENSE_MAX_REGISTRATIONS_PER_MINUTE` | `30` | Cap on new installations per minute |

`SUPABASE_URL` and the service role key are provided by Supabase.

Admin dashboard, `admin/.env.local`: `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` (the public anon or publishable key; never the
service role / secret key).

### Rotating the signing key

1. `bun scripts/license-keygen.ts --write` adds the new public key to
   `src-tauri/license.json` (the old one stays).
2. Release that version and wait until most installations have it.
3. Set the new private key as `LICENSE_SIGNING_KEY` (and a new
   `LICENSE_KEY_ID`).
4. In a later release, remove the old public key.

Installations still on a version without the new key can't verify new tokens:
they run until their grace period ends and then show "Connection needed" until
updated.

## Limits of client-side enforcement

Read this before relying on the feature.

- **The app runs on the user's computer.** Someone with the technical skill
  can patch the binary, so it never checks or ignores the answer. Signatures
  stop forged answers and replays, not a modified program.
- **The app is GPL-3.0.** Everyone who receives it has the right to get the
  source code, change it and run their changed version, including one
  without this check. Blocking is a tool against ordinary use of a
  distributed build, not a copy protection, and must not be presented as one.
- **No hardware fingerprint, on purpose.** Deleting the app's entry in the
  Windows Credential Manager (or using another Windows account) creates a new
  installation, which registers as `ACTIVE`. Blocking stops a specific
  installation, not a person. `LICENSE_MAX_REGISTRATIONS_PER_MINUTE` limits
  mass registrations; there is no automatic "new installations need
  approval" mode.
- **Offline grace period.** A blocked installation that cuts itself off from
  the network before its next check keeps running until its grace period
  (24 h by default) ends.
- **Clock.** Turning the clock back within the 2 h tolerance, again and again,
  can stretch the grace period slightly; a larger jump ends it.
- **Availability is now a dependency.** If the Supabase project is deleted,
  paused or misconfigured, every installation stops after its grace period
  ("Connection needed"). Keep the project running for as long as the app is in
  use, or ship an update with an empty `endpoint` first.
- **Cost.** One check per installation every 10 minutes is about 4,300 Edge
  Function calls per month and installation. Compare with your Supabase plan's
  quota; raise `LICENSE_CHECK_MINUTES` if needed (blocks then take longer to
  arrive).

## Privacy

What the server stores per installation: id, hash of the secret, status, app
version, registration time, last contact, block time and reason, and the
history of status changes. Supabase also logs requests (including the IP
address) as part of running the service. The privacy policy
(`docs/privacy/index.md`) says so.

To delete an installation's data (SQL editor in Supabase):

```sql
delete from licensing.installations where installation_id = '…';
```

## Tests

```bash
cd supabase/tests && bun install && bun test        # SQL (on PGlite) and Edge Function
cd src-tauri && cargo test --lib license             # client rules, token, storage
```

End to end, over real HTTP (client ⇄ Edge Function handler ⇄ SQL):

```bash
cd supabase/tests && bun local-server.ts             # leave it running
cd src-tauri && cargo test --lib -- --ignored local_server
```

The local server also serves the admin dashboard (`VITE_SUPABASE_URL=http://127.0.0.1:8787`,
any anon key, sign in as `admin@localhost` / `local-admin`) and a dev build of
the app (`ISLAND_LICENSE_ENDPOINT` / `ISLAND_LICENSE_PUBLIC_KEY` as printed).
It keeps everything in memory and is for local testing only.

| Scenario | Covered by |
| --- | --- |
| New installation is registered | `database.test.ts`, `license-function.test.ts`, `engine.rs`, end to end |
| Existing installation is recognized | same |
| Active installation works normally | same |
| Blocked installation stops its features | `engine.rs` (blocked across restarts), `license::tests` (gates), end to end |
| Unblocked installation works again | same |
| Offline behavior (grace period, first run, clock) | `engine.rs` |
| Backend outage doesn't crash | `engine.rs` (`server_errors_are_temporary`), `license-function.test.ts`, end to end |
| Unauthorized admin actions are refused | `database.test.ts`, end to end (403 / 401) |
| Invalid tokens are refused | `token.rs`, `engine.rs` (forged, replayed, edited storage) |
| Installations are kept apart | `database.test.ts`, `license-function.test.ts`, end to end |
