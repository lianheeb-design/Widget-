/**
 * The `license` Edge Function's handler, backed by the real migration on
 * PGlite (see `db.ts`): requests go in as they would from the desktop app,
 * and the signed tokens are checked the way the app checks them.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
	cleanDeviceName,
	compareVersions,
	createHandler,
	type HandlerDeps,
	type LicenseConfig,
	type LicenseStore,
	loadConfig,
	postgrestStore,
	serviceKeyFrom,
	signToken,
	tokenStatus,
} from "../functions/license/handler";
import { createDb, type TestDb } from "./db";

const NOW = 1_800_000_000;
const ENDPOINT = "https://example.supabase.co/functions/v1/license";

/** Same seed as the Rust test vector in `src-tauri/src/license/token.rs`. */
const VECTOR_SEED = new Uint8Array(32).map((_, i) => i + 1);
const VECTOR_PUBLIC_KEY = "ebVWLo/mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ=";
const VECTOR_TOKEN =
	"eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsImtpZCI6InRlc3QifQ.eyJpc3MiOiJpc2xhbmQtbGljZW5zZSIsInN1YiI6IjZmMWQyYzNiLTRhNTktNGU2Zi04YTdiLTljMGQxZTJmM2E0YiIsInN0YXR1cyI6ImFjdGl2ZSIsIm5vbmNlIjoiQUFBQUFBQUFBQUFBQUFBQUFBQUFBQSIsImlhdCI6MTgwMDAwMDAwMCwiZXhwIjoxODAwMDg2NDAwLCJjaGsiOjYwMCwidiI6MX0.3FZOpxbEF3ZUdZfQ8DVsOZWF1gvO8_wlIp28NUyLGeoHLu08z6F0Txcl4Ik9TwyrMZpGK1a_jYYM_UTVVuqfCA";

function pkcs8FromSeed(seed: Uint8Array): Uint8Array<ArrayBuffer> {
	const prefix = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
	return new Uint8Array([...prefix, ...seed]);
}

function randomB64url(bytes: number): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

interface Claims {
	iss: string;
	sub: string;
	status: string;
	nonce: string;
	iat: number;
	exp: number;
	chk: number;
	v: number;
}

/** Verifies a token like the app does: signature with the public key, then the claims. */
async function verify(token: string, publicKey: CryptoKey): Promise<Claims | null> {
	const [header, payload, signature] = token.split(".");
	const ok = await crypto.subtle.verify(
		{ name: "Ed25519" },
		publicKey,
		Buffer.from(signature, "base64url"),
		new TextEncoder().encode(`${header}.${payload}`),
	);
	if (!ok) return null;
	expect(JSON.parse(Buffer.from(header, "base64url").toString())).toMatchObject({ alg: "EdDSA", typ: "JWT" });
	return JSON.parse(Buffer.from(payload, "base64url").toString());
}

let db: TestDb;
let keys: CryptoKeyPair;
let config: LicenseConfig;
let admin: string;

/** `public.license_check` as the service role, as the deployed function calls it. */
const dbStore: LicenseStore = async (input) => {
	const [row] = await db.as<{ outcome: string; status: string | null; registered: boolean }>(
		"service_role",
		"select * from public.license_check($1, $2, $3, $4, $5)",
		[input.installationId, input.secretHash, input.appVersion, input.maxRegistrationsPerMinute, input.deviceName],
	);
	return row as Awaited<ReturnType<LicenseStore>>;
};

function handler(overrides: Partial<HandlerDeps> = {}) {
	return createHandler({ config, store: dbStore, now: () => NOW, log: () => {}, ...overrides });
}

function installation() {
	return { installationId: crypto.randomUUID(), secret: randomB64url(32) };
}

function request(body: unknown, init: RequestInit = {}) {
	return new Request(ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
		...init,
	});
}

async function checkIn(app: ReturnType<typeof installation>, h = handler(), version = "1.2.0") {
	const nonce = randomB64url(16);
	const res = await h(request({ ...app, nonce, appVersion: version }));
	const body = (await res.json()) as { token?: string; error?: string };
	const claims = body.token ? await verify(body.token, keys.publicKey) : null;
	return { res, body, claims, nonce };
}

beforeEach(async () => {
	db = await createDb();
	admin = await db.addUser("admin@example.com", true);
	keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
	config = {
		signingKey: keys.privateKey,
		keyId: "main",
		graceSeconds: 24 * 3600,
		checkIntervalSeconds: 600,
		minVersion: null,
		maxRegistrationsPerMinute: 30,
	};
});

const setStatus = (id: string, status: "ACTIVE" | "BLOCKED") =>
	db.as("authenticated", "select public.admin_set_installation_status($1, $2, null)", [id, status], admin);

describe("status check", () => {
	test("records the computer name, cleaned, and works without one", async () => {
		const app = installation();
		const send = (deviceName: unknown) =>
			handler()(request({ ...app, nonce: randomB64url(16), appVersion: "1.2.1", deviceName }));
		const stored = async () =>
			(
				await db.pg.query<{ device_name: string | null }>(
					"select device_name from licensing.installations where installation_id = $1",
					[app.installationId],
				)
			).rows[0].device_name;

		expect((await send(" LIAN-\u0007LAPTOP\n")).status).toBe(200);
		expect(await stored()).toBe("LIAN-LAPTOP");
		// App 1.2.0 sends no name: the last one stays.
		expect((await send(undefined)).status).toBe(200);
		expect((await send(null)).status).toBe(200);
		expect(await stored()).toBe("LIAN-LAPTOP");
		expect((await send(42)).status).toBe(400);
		expect(cleanDeviceName("é".repeat(70))).toBe("é".repeat(64));
		expect(cleanDeviceName("   ")).toBeNull();
	});

	test("registers a new installation and signs an active token", async () => {
		const app = installation();
		const { res, claims, nonce } = await checkIn(app);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(claims).toEqual({
			iss: "island-license",
			sub: app.installationId,
			status: "active",
			nonce,
			iat: NOW,
			exp: NOW + 24 * 3600,
			chk: 600,
			v: 1,
		});
		const rows = await db.pg.query("select 1 from licensing.installations where installation_id = $1", [
			app.installationId,
		]);
		expect(rows.rows).toHaveLength(1);
	});

	test("only stores a hash of the secret", async () => {
		const app = installation();
		await checkIn(app);
		const [row] = (
			await db.pg.query<{ secret_hash: string }>(
				"select secret_hash from licensing.installations where installation_id = $1",
				[app.installationId],
			)
		).rows;
		expect(row.secret_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(row.secret_hash).not.toContain(app.secret);
	});

	test("blocking and unblocking show up in the next check", async () => {
		const app = installation();
		expect((await checkIn(app)).claims?.status).toBe("active");
		await setStatus(app.installationId, "BLOCKED");
		expect((await checkIn(app)).claims?.status).toBe("blocked");
		await setStatus(app.installationId, "ACTIVE");
		expect((await checkIn(app)).claims?.status).toBe("active");
	});

	test("keeps installations apart", async () => {
		const [a, b] = [installation(), installation()];
		await checkIn(a);
		await checkIn(b);
		await setStatus(a.installationId, "BLOCKED");
		const [ca, cb] = [await checkIn(a), await checkIn(b)];
		expect([ca.claims?.sub, ca.claims?.status]).toEqual([a.installationId, "blocked"]);
		expect([cb.claims?.sub, cb.claims?.status]).toEqual([b.installationId, "active"]);
	});

	test("refuses an id with another installation's secret", async () => {
		const app = installation();
		await checkIn(app);
		const { res, body } = await checkIn({ ...app, secret: randomB64url(32) });
		expect(res.status).toBe(401);
		expect(body).toEqual({ error: "invalid_credentials" });
	});

	test("marks versions below the minimum as outdated, but blocked still wins", async () => {
		config.minVersion = "1.3.0";
		const app = installation();
		expect((await checkIn(app, handler(), "1.2.9")).claims?.status).toBe("outdated");
		expect((await checkIn(app, handler(), "1.3.0")).claims?.status).toBe("active");
		await setStatus(app.installationId, "BLOCKED");
		expect((await checkIn(app, handler(), "1.0.0")).claims?.status).toBe("blocked");
	});

	test("a forged or altered token doesn't verify", async () => {
		const { body } = await checkIn(installation());
		const [header, payload, signature] = (body.token as string).split(".");
		const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
		const forged = Buffer.from(JSON.stringify({ ...claims, status: "active", exp: claims.exp + 1 })).toString(
			"base64url",
		);
		expect(await verify(`${header}.${forged}.${signature}`, keys.publicKey)).toBeNull();

		const other = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
		const foreign = await signToken({ signingKey: other.privateKey, keyId: "main" }, claims);
		expect(await verify(foreign, keys.publicKey)).toBeNull();
	});

	test("echoes each request's nonce, so old answers can't be replayed", async () => {
		const app = installation();
		const first = await checkIn(app);
		const second = await checkIn(app);
		expect(first.claims?.nonce).toBe(first.nonce);
		expect(second.claims?.nonce).toBe(second.nonce);
		expect(first.nonce).not.toBe(second.nonce);
	});
});

describe("bad requests and failures", () => {
	test("rejects malformed input", async () => {
		const app = installation();
		const nonce = randomB64url(16);
		const bad = [
			"not json",
			"[]",
			{ ...app, nonce },
			{ ...app, nonce, appVersion: "latest" },
			{ ...app, nonce: "short", appVersion: "1.0.0" },
			{ ...app, secret: "too-short", nonce, appVersion: "1.0.0" },
			{ ...app, installationId: "not-a-uuid", nonce, appVersion: "1.0.0" },
			{ ...app, installationId: app.installationId.toUpperCase(), nonce, appVersion: "1.0.0" },
		];
		for (const body of bad) {
			const res = await handler()(request(body));
			expect(res.status).toBe(400);
		}
		expect((await db.pg.query("select 1 from licensing.installations")).rows).toHaveLength(0);
	});

	test("only POST, and only small bodies", async () => {
		expect((await handler()(new Request(ENDPOINT))).status).toBe(405);
		const big = request({ padding: "x".repeat(5000) });
		expect((await handler()(big)).status).toBe(413);
	});

	test("a database failure is a temporary error, never a block", async () => {
		const failing: LicenseStore = async () => {
			throw new Error("connection refused");
		};
		const { res, body } = await checkIn(installation(), handler({ store: failing }));
		expect(res.status).toBe(503);
		expect(res.headers.get("retry-after")).toBe("60");
		expect(body).toEqual({ error: "unavailable" });
	});

	test("too many new registrations are turned away for a minute", async () => {
		config.maxRegistrationsPerMinute = 1;
		expect((await checkIn(installation())).res.status).toBe(200);
		expect((await checkIn(installation())).res.status).toBe(429);
	});

	test("without its secret the function answers 500", async () => {
		const { res, body } = await checkIn(installation(), handler({ config: null }));
		expect(res.status).toBe(500);
		expect(body).toEqual({ error: "misconfigured" });
	});
});

describe("configuration", () => {
	test("reads the secrets, with defaults", async () => {
		const pkcs8 = Buffer.from(pkcs8FromSeed(VECTOR_SEED)).toString("base64");
		const loaded = await loadConfig({ LICENSE_SIGNING_KEY: pkcs8 });
		expect(loaded).toMatchObject({
			keyId: "main",
			graceSeconds: 86400,
			checkIntervalSeconds: 600,
			minVersion: null,
			maxRegistrationsPerMinute: 30,
		});
		const custom = await loadConfig({
			LICENSE_SIGNING_KEY: pkcs8,
			LICENSE_KEY_ID: "2026",
			LICENSE_GRACE_HOURS: "72",
			LICENSE_CHECK_MINUTES: "15",
			LICENSE_MIN_VERSION: "1.2.0",
		});
		expect(custom).toMatchObject({
			keyId: "2026",
			graceSeconds: 259200,
			checkIntervalSeconds: 900,
			minVersion: "1.2.0",
		});
	});

	test("refuses missing or broken secrets", async () => {
		await expect(loadConfig({})).rejects.toThrow("LICENSE_SIGNING_KEY");
		await expect(loadConfig({ LICENSE_SIGNING_KEY: "bm9wZQ==" })).rejects.toThrow("PKCS#8");
		const pkcs8 = Buffer.from(pkcs8FromSeed(VECTOR_SEED)).toString("base64");
		await expect(loadConfig({ LICENSE_SIGNING_KEY: pkcs8, LICENSE_CHECK_MINUTES: "1" })).rejects.toThrow("range");
		await expect(loadConfig({ LICENSE_SIGNING_KEY: pkcs8, LICENSE_MIN_VERSION: "new" })).rejects.toThrow("MIN_VERSION");
	});

	test("finds the service key in both formats", () => {
		expect(serviceKeyFrom({ SUPABASE_SERVICE_ROLE_KEY: "a.b.c" })).toBe("a.b.c");
		expect(serviceKeyFrom({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x"}' })).toBe("sb_secret_x");
		expect(serviceKeyFrom({})).toBeNull();
	});

	test("calls license_check through the Data API with the service key", async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		const fakeFetch = (async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return new Response(JSON.stringify([{ outcome: "ok", status: "ACTIVE", registered: true }]));
		}) as unknown as typeof fetch;
		const input = {
			installationId: "id",
			secretHash: "h",
			appVersion: "1.0.0",
			deviceName: "PC",
			maxRegistrationsPerMinute: 5,
		};

		expect(await postgrestStore("https://x.supabase.co/", "aaa.bbb.ccc", fakeFetch)(input)).toEqual({
			outcome: "ok",
			status: "ACTIVE",
			registered: true,
		});
		expect(calls[0].url).toBe("https://x.supabase.co/rest/v1/rpc/license_check");
		expect(calls[0].init.headers).toMatchObject({ apikey: "aaa.bbb.ccc", Authorization: "Bearer aaa.bbb.ccc" });
		expect(JSON.parse(calls[0].init.body as string)).toEqual({
			p_installation_id: "id",
			p_secret_hash: "h",
			p_app_version: "1.0.0",
			p_max_registrations_per_minute: 5,
			p_device_name: "PC",
		});

		await postgrestStore("https://x.supabase.co", "sb_secret_abc", fakeFetch)(input);
		expect(calls[1].init.headers).not.toHaveProperty("Authorization");

		const failing = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
		await expect(postgrestStore("https://x.supabase.co", "k", failing)(input)).rejects.toThrow("HTTP 500");
	});
});

describe("helpers", () => {
	test("compares versions numerically", () => {
		expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
		expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
		expect(compareVersions("1.2.0-beta", "1.2.0")).toBe(0);
		expect(compareVersions("0.9.0", "1.0.0")).toBe(-1);
		expect(tokenStatus("ACTIVE", "1.0.0", null)).toBe("active");
	});

	test("matches the test vector the Rust client checks", async () => {
		const key = await crypto.subtle.importKey("pkcs8", pkcs8FromSeed(VECTOR_SEED), { name: "Ed25519" }, true, ["sign"]);
		const token = await signToken(
			{ signingKey: key, keyId: "test" },
			{
				iss: "island-license",
				sub: "6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b",
				status: "active",
				nonce: "AAAAAAAAAAAAAAAAAAAAAA",
				iat: 1800000000,
				exp: 1800086400,
				chk: 600,
				v: 1,
			},
		);
		expect(token).toBe(VECTOR_TOKEN);
		const jwk = await crypto.subtle.exportKey("jwk", key);
		expect(Buffer.from(jwk.x as string, "base64url").toString("base64")).toBe(VECTOR_PUBLIC_KEY);
	});
});
