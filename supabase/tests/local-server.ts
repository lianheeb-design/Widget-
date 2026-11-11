/**
 * A local stand-in for the Supabase project, for trying the whole system on
 * one computer before (or without) deploying:
 *
 *   cd supabase/tests && bun local-server.ts
 *
 * It runs the real `license` Edge Function handler and the real migration (on
 * PGlite, see `db.ts`), plus the few parts of Supabase Auth and the Data API
 * the admin dashboard uses. Nothing is stored: every start begins empty.
 *
 * - Desktop app (dev build): set ISLAND_LICENSE_ENDPOINT and
 *   ISLAND_LICENSE_PUBLIC_KEY to the values printed at startup.
 * - Admin dashboard: VITE_SUPABASE_URL=http://127.0.0.1:8787 and any
 *   VITE_SUPABASE_ANON_KEY; sign in with LOCAL_ADMIN_EMAIL / LOCAL_ADMIN_PASSWORD.
 * - Rust end-to-end test: `cargo test --lib -- --ignored local_server`.
 *
 * For testing only: the "auth" here hands out unsigned tokens and must never
 * face a network.
 */

import { createHandler, type LicenseConfig, type LicenseStore } from "../functions/license/handler";
import { createDb, type Role } from "./db";

const PORT = Number(process.env.PORT ?? 8787);
const ADMIN_EMAIL = process.env.LOCAL_ADMIN_EMAIL ?? "admin@localhost";
const ADMIN_PASSWORD = process.env.LOCAL_ADMIN_PASSWORD ?? "local-admin";
/** A second, non-admin account, to see the dashboard refuse it. */
const USER_EMAIL = "user@localhost";
const USER_PASSWORD = "local-user";

const db = await createDb();
const adminId = await db.addUser(ADMIN_EMAIL, true);
const userId = await db.addUser(USER_EMAIL, false);
const accounts = new Map([
	[ADMIN_EMAIL, { id: adminId, password: ADMIN_PASSWORD }],
	[USER_EMAIL, { id: userId, password: USER_PASSWORD }],
]);

const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("base64");

const config: LicenseConfig = {
	signingKey: keys.privateKey,
	keyId: "local",
	graceSeconds: Number(process.env.LICENSE_GRACE_HOURS ?? 24) * 3600,
	checkIntervalSeconds: Number(process.env.LICENSE_CHECK_MINUTES ?? 10) * 60,
	minVersion: process.env.LICENSE_MIN_VERSION ?? null,
	maxRegistrationsPerMinute: 30,
};

const store: LicenseStore = async (input) => {
	const [row] = await db.as<Awaited<ReturnType<LicenseStore>>>(
		"service_role",
		"select * from public.license_check($1, $2, $3, $4)",
		[input.installationId, input.secretHash, input.appVersion, input.maxRegistrationsPerMinute],
	);
	return row;
};
const license = createHandler({ config, store, log: (m) => console.error(m) });

/** Functions the dashboard calls, and whether they return rows or one value. */
const RPC: Record<string, "rows" | "value"> = {
	admin_is_admin: "value",
	admin_stats: "value",
	admin_list_installations: "rows",
	admin_get_installation: "value",
	admin_set_installation_status: "value",
};

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers":
		"authorization, apikey, content-type, x-client-info, accept-profile, content-profile, prefer",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(status: number, body: unknown) {
	return new Response(body === null ? null : JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...CORS },
	});
}

/** An unsigned JWT-shaped token (supabase-js only reads it). */
function token(id: string, email: string) {
	const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
	const exp = Math.floor(Date.now() / 1000) + 3600;
	return `${enc({ alg: "none", typ: "JWT" })}.${enc({ sub: id, email, role: "authenticated", exp })}.local`;
}

function session(id: string, email: string) {
	const now = Math.floor(Date.now() / 1000);
	return {
		access_token: token(id, email),
		token_type: "bearer",
		expires_in: 3600,
		expires_at: now + 3600,
		refresh_token: `refresh:${id}`,
		user: { id, email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} },
	};
}

/** The caller of a Data API request: anonymous, or the signed-in user. */
function caller(req: Request): { role: Role; id?: string; email?: string } {
	const auth = req.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
	const payload = auth.split(".")[1];
	if (!payload) return { role: "anon" };
	try {
		const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as { sub?: string; email?: string };
		return claims.sub ? { role: "authenticated", id: claims.sub, email: claims.email } : { role: "anon" };
	} catch {
		return { role: "anon" };
	}
}

async function rpc(req: Request, fn: string): Promise<Response> {
	const kind = RPC[fn];
	if (!kind) return json(404, { code: "PGRST202", message: `function ${fn} not found` });
	const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
	const names = Object.keys(body);
	if (!names.every((n) => /^p_[a-z_]+$/.test(n))) return json(400, { code: "PGRST100", message: "bad arguments" });
	const args = names.map((n, i) => `${n} => $${i + 1}`).join(", ");
	const sql = kind === "rows" ? `select * from public.${fn}(${args})` : `select public.${fn}(${args}) as value`;
	const who = caller(req);
	try {
		const rows = await db.as<Record<string, unknown>>(
			who.role,
			sql,
			names.map((n) => body[n]),
			who.id,
		);
		return json(200, kind === "rows" ? rows : (rows[0]?.value ?? null));
	} catch (e) {
		const error = e as { code?: string; message?: string };
		const status = error.code === "42501" ? (who.role === "anon" ? 401 : 403) : 400;
		return json(status, { code: error.code ?? "XX000", message: error.message ?? "error", details: null, hint: null });
	}
}

Bun.serve({
	port: PORT,
	hostname: "127.0.0.1",
	async fetch(req) {
		const url = new URL(req.url);
		if (req.method === "OPTIONS") {
			// supabase-js sends a few headers of its own (x-supabase-api-version…), like the real API allows.
			const asked = req.headers.get("access-control-request-headers");
			const headers = asked ? { ...CORS, "Access-Control-Allow-Headers": asked } : CORS;
			return new Response(null, { status: 204, headers });
		}

		// For the Rust end-to-end test, which needs the key the tokens are signed with.
		if (url.pathname === "/local/public-key") return new Response(publicKey);
		if (url.pathname === "/functions/v1/license") {
			const res = await license(req);
			console.log(`license ${res.status}`);
			return res;
		}
		if (url.pathname === "/auth/v1/token" && req.method === "POST") {
			const body = (await req.json().catch(() => ({}))) as Record<string, string>;
			if (url.searchParams.get("grant_type") === "refresh_token") {
				const id = body.refresh_token?.replace(/^refresh:/, "");
				const entry = [...accounts].find(([, a]) => a.id === id);
				return entry ? json(200, session(entry[1].id, entry[0])) : json(400, { error: "invalid_grant" });
			}
			const account = accounts.get(body.email ?? "");
			if (!account || account.password !== body.password) {
				return json(400, { error: "invalid_grant", error_description: "Invalid login credentials" });
			}
			return json(200, session(account.id, body.email));
		}
		if (url.pathname === "/auth/v1/user") {
			const who = caller(req);
			return who.id ? json(200, { id: who.id, email: who.email, aud: "authenticated" }) : json(401, {});
		}
		if (url.pathname === "/auth/v1/logout") return json(204, null);
		if (url.pathname.startsWith("/rest/v1/rpc/") && req.method === "POST") {
			return rpc(req, url.pathname.slice("/rest/v1/rpc/".length));
		}
		return json(404, { error: "not found" });
	},
});

console.log(`Local license server on http://127.0.0.1:${PORT}`);
console.log();
console.log("Desktop app (dev build):");
console.log(`  ISLAND_LICENSE_ENDPOINT=http://127.0.0.1:${PORT}/functions/v1/license`);
console.log(`  ISLAND_LICENSE_PUBLIC_KEY=${publicKey}`);
console.log("Admin dashboard (admin/.env.local):");
console.log(`  VITE_SUPABASE_URL=http://127.0.0.1:${PORT}`);
console.log("  VITE_SUPABASE_ANON_KEY=local");
console.log(`  sign in: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}   (not an admin: ${USER_EMAIL} / ${USER_PASSWORD})`);
