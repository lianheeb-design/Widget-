/**
 * The `license` Edge Function: registers installations of the island and tells
 * them, in a signed token, whether they may run.
 *
 * Request (POST, JSON):
 *   { installationId: uuid, secret: base64url(32 bytes), nonce: base64url, appVersion: "1.2.0",
 *     deviceName?: "LIAN-LAPTOP" }
 *
 * `deviceName` (the computer's name, from app 1.2.1 on) only tells the
 * developer which PC an installation runs on; it's optional, trimmed to 64
 * characters, and control characters are dropped.
 *
 * Response 200: { token } — a JWT signed with Ed25519 (`alg: EdDSA`). Claims:
 *   iss    "island-license"
 *   sub    the installation id
 *   status "active" | "blocked" | "outdated"
 *   nonce  the request's nonce, so an old answer can't be replayed
 *   iat    issued at (unix seconds)
 *   exp    iat + offline grace period (how long the app may run without a new check)
 *   chk    seconds until the app should check again
 *   v      token format version (1)
 *
 * Errors: 400 invalid_request, 401 invalid_credentials (the id belongs to
 * another secret), 405, 413, 429 rate_limited, 500 misconfigured,
 * 503 unavailable. The app treats every error as temporary: only a signed
 * "blocked" answer blocks it.
 *
 * No API key is needed (the function runs with `verify_jwt = false`): the
 * per-installation secret authenticates the caller, and the database is only
 * reached through `public.license_check` with the service role key, which
 * stays on the server.
 *
 * Kept free of Deno APIs so the tests can run it under Bun (see
 * `supabase/tests`); `index.ts` wires it up for Supabase.
 */

export const ISSUER = "island-license";
export const TOKEN_VERSION = 1;

export type InstallationStatus = "ACTIVE" | "BLOCKED";
export type TokenStatus = "active" | "blocked" | "outdated";

export interface CheckResult {
	outcome: "ok" | "invalid_credentials" | "rate_limited";
	status: InstallationStatus | null;
	registered: boolean;
}

/** Registers or verifies an installation (`public.license_check`). */
export type LicenseStore = (input: {
	installationId: string;
	secretHash: string;
	appVersion: string;
	deviceName: string | null;
	maxRegistrationsPerMinute: number;
}) => Promise<CheckResult>;

export interface LicenseConfig {
	/** Ed25519 private key that signs the tokens. */
	signingKey: CryptoKey;
	/** Goes into the token header (`kid`), to tell keys apart after a rotation. */
	keyId: string;
	/** How long an installation may run offline after a successful check. */
	graceSeconds: number;
	/** How often installations should check (they're told in every token). */
	checkIntervalSeconds: number;
	/** Versions below this get "outdated" (null: any version is fine). */
	minVersion: string | null;
	maxRegistrationsPerMinute: number;
}

export interface HandlerDeps {
	/** `null`: the function isn't set up (missing secret); every request gets 500. */
	config: LicenseConfig | null;
	store: LicenseStore;
	/** Unix seconds (tests pass a fixed clock). */
	now?: () => number;
	log?: (message: string) => void;
}

const MAX_BODY_BYTES = 4096;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** 32 random bytes, base64url without padding. */
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
/** 16 to 64 random bytes, base64url without padding. */
const NONCE_RE = /^[A-Za-z0-9_-]{22,86}$/;
const VERSION_RE = /^\d{1,5}\.\d{1,5}\.\d{1,5}(?:[-+][0-9A-Za-z.-]{1,16})?$/;

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
	const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
	const log = deps.log ?? ((message: string) => console.error(message));

	return async (req) => {
		if (req.method !== "POST") return error(405, "method_not_allowed", { Allow: "POST" });
		const { config } = deps;
		if (!config) return error(500, "misconfigured");

		const declared = Number(req.headers.get("content-length") ?? "0");
		if (declared > MAX_BODY_BYTES) return error(413, "payload_too_large");
		let text: string;
		try {
			text = await req.text();
		} catch {
			return error(400, "invalid_request");
		}
		if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return error(413, "payload_too_large");

		const input = parseRequest(text);
		if (!input) return error(400, "invalid_request");

		let result: CheckResult;
		try {
			result = await deps.store({
				installationId: input.installationId,
				secretHash: await sha256Hex(input.secret),
				appVersion: input.appVersion,
				deviceName: input.deviceName,
				maxRegistrationsPerMinute: config.maxRegistrationsPerMinute,
			});
		} catch (e) {
			log(`license: store failed: ${e instanceof Error ? e.message : String(e)}`);
			return error(503, "unavailable", { "Retry-After": "60" });
		}

		if (result.outcome === "invalid_credentials") return error(401, "invalid_credentials");
		if (result.outcome === "rate_limited") return error(429, "rate_limited", { "Retry-After": "60" });
		if (result.outcome !== "ok" || (result.status !== "ACTIVE" && result.status !== "BLOCKED")) {
			log(`license: unexpected store result ${JSON.stringify(result)}`);
			return error(503, "unavailable", { "Retry-After": "60" });
		}

		const iat = now();
		const token = await signToken(config, {
			iss: ISSUER,
			sub: input.installationId,
			status: tokenStatus(result.status, input.appVersion, config.minVersion),
			nonce: input.nonce,
			iat,
			exp: iat + config.graceSeconds,
			chk: config.checkIntervalSeconds,
			v: TOKEN_VERSION,
		});
		return json(200, { token });
	};
}

interface CheckRequest {
	installationId: string;
	secret: string;
	nonce: string;
	appVersion: string;
	deviceName: string | null;
}

export function parseRequest(text: string): CheckRequest | null {
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return null;
	}
	if (!body || typeof body !== "object" || Array.isArray(body)) return null;
	const { installationId, secret, nonce, appVersion, deviceName } = body as Record<string, unknown>;
	if (typeof installationId !== "string" || !UUID_RE.test(installationId)) return null;
	if (typeof secret !== "string" || !SECRET_RE.test(secret)) return null;
	if (typeof nonce !== "string" || !NONCE_RE.test(nonce)) return null;
	if (typeof appVersion !== "string" || appVersion.length > 32 || !VERSION_RE.test(appVersion)) return null;
	if (deviceName !== undefined && deviceName !== null && typeof deviceName !== "string") return null;
	return { installationId, secret, nonce, appVersion, deviceName: cleanDeviceName(deviceName) };
}

/** A computer name fit to show: printable, trimmed, at most 64 characters, or null. */
export function cleanDeviceName(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point
	const name = Array.from(raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim())
		.slice(0, 64)
		.join("")
		.trim();
	return name || null;
}

/** Blocked wins; an active installation below the minimum version is "outdated". */
export function tokenStatus(status: InstallationStatus, appVersion: string, minVersion: string | null): TokenStatus {
	if (status === "BLOCKED") return "blocked";
	if (minVersion && compareVersions(appVersion, minVersion) < 0) return "outdated";
	return "active";
}

/** Compares `major.minor.patch` numerically (pre-release suffixes are ignored). */
export function compareVersions(a: string, b: string): number {
	const parts = (v: string) =>
		v
			.split(/[-+]/)[0]
			.split(".")
			.map((n) => Number.parseInt(n, 10) || 0);
	const [x, y] = [parts(a), parts(b)];
	for (let i = 0; i < 3; i++) {
		const diff = (x[i] ?? 0) - (y[i] ?? 0);
		if (diff !== 0) return Math.sign(diff);
	}
	return 0;
}

export interface TokenClaims {
	iss: string;
	sub: string;
	status: TokenStatus;
	nonce: string;
	iat: number;
	exp: number;
	chk: number;
	v: number;
}

/** A compact JWS (JWT) signed with Ed25519. */
export async function signToken(
	config: Pick<LicenseConfig, "signingKey" | "keyId">,
	claims: TokenClaims,
): Promise<string> {
	const header = { alg: "EdDSA", typ: "JWT", kid: config.keyId };
	const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
	const signature = await crypto.subtle.sign({ name: "Ed25519" }, config.signingKey, new TextEncoder().encode(input));
	return `${input}.${base64url(new Uint8Array(signature))}`;
}

/**
 * Reads the function's settings from its environment (Supabase secrets).
 * Throws with a readable message when something is missing or wrong.
 */
export async function loadConfig(env: Record<string, string | undefined>): Promise<LicenseConfig> {
	const pkcs8 = env.LICENSE_SIGNING_KEY?.trim();
	if (!pkcs8) throw new Error("LICENSE_SIGNING_KEY is not set");
	let signingKey: CryptoKey;
	try {
		signingKey = await crypto.subtle.importKey("pkcs8", base64Decode(pkcs8), { name: "Ed25519" }, false, ["sign"]);
	} catch {
		throw new Error("LICENSE_SIGNING_KEY is not a base64 PKCS#8 Ed25519 private key");
	}
	const minVersion = env.LICENSE_MIN_VERSION?.trim() || null;
	if (minVersion && !VERSION_RE.test(minVersion)) throw new Error("LICENSE_MIN_VERSION must look like 1.2.0");
	return {
		signingKey,
		keyId: env.LICENSE_KEY_ID?.trim() || "main",
		graceSeconds: Math.round(numberSetting(env.LICENSE_GRACE_HOURS, 24, 1, 24 * 30) * 3600),
		checkIntervalSeconds: Math.round(numberSetting(env.LICENSE_CHECK_MINUTES, 10, 5, 24 * 60) * 60),
		minVersion,
		maxRegistrationsPerMinute: Math.round(numberSetting(env.LICENSE_MAX_REGISTRATIONS_PER_MINUTE, 30, 1, 10_000)),
	};
}

function numberSetting(raw: string | undefined, fallback: number, min: number, max: number): number {
	if (raw === undefined || raw.trim() === "") return fallback;
	const value = Number(raw);
	if (!Number.isFinite(value) || value < min || value > max) {
		throw new Error(`setting out of range (${min}–${max}): ${raw}`);
	}
	return value;
}

/**
 * `public.license_check` through the Data API, as the service role. Works with
 * both the legacy `service_role` JWT and the newer `sb_secret_…` keys.
 */
export function postgrestStore(supabaseUrl: string, serviceKey: string, fetchImpl: typeof fetch = fetch): LicenseStore {
	const url = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/license_check`;
	const headers: Record<string, string> = { "Content-Type": "application/json", apikey: serviceKey };
	if (serviceKey.split(".").length === 3) headers.Authorization = `Bearer ${serviceKey}`;

	return async ({ installationId, secretHash, appVersion, deviceName, maxRegistrationsPerMinute }) => {
		const res = await fetchImpl(url, {
			method: "POST",
			headers,
			body: JSON.stringify({
				p_installation_id: installationId,
				p_secret_hash: secretHash,
				p_app_version: appVersion,
				p_max_registrations_per_minute: maxRegistrationsPerMinute,
				p_device_name: deviceName,
			}),
			signal: AbortSignal.timeout(8000),
		});
		if (!res.ok) throw new Error(`license_check: HTTP ${res.status} ${await res.text().catch(() => "")}`);
		const rows: unknown = await res.json();
		const row = (Array.isArray(rows) ? rows[0] : rows) as Partial<CheckResult> | undefined;
		if (!row || typeof row.outcome !== "string") throw new Error("license_check: unexpected response");
		return { outcome: row.outcome, status: row.status ?? null, registered: row.registered === true } as CheckResult;
	};
}

/** The service role key from the function's environment (legacy or new key format). */
export function serviceKeyFrom(env: Record<string, string | undefined>): string | null {
	const legacy = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
	if (legacy) return legacy;
	try {
		const keys = JSON.parse(env.SUPABASE_SECRET_KEYS ?? "null") as Record<string, string> | null;
		return keys?.default ?? Object.values(keys ?? {})[0] ?? null;
	} catch {
		return null;
	}
}

export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function base64url(data: string | Uint8Array): string {
	const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64Decode(text: string): Uint8Array<ArrayBuffer> {
	const normalized = text.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
	const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
	});
}

function error(status: number, code: string, headers: Record<string, string> = {}): Response {
	return json(status, { error: code }, headers);
}
