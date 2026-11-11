/**
 * The migration's functions and privileges, on a real Postgres (see `db.ts`).
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { createDb, errorCode, type TestDb } from "./db";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

interface CheckRow {
	outcome: string;
	status: string | null;
	registered: boolean;
}

let db: TestDb;
let admin: string;
let user: string;

beforeEach(async () => {
	db = await createDb();
	admin = await db.addUser("admin@example.com", true);
	user = await db.addUser("someone@example.com", false);
});

const check = (id: string, hash = HASH_A, version = "1.2.0", max = 30) =>
	db.as<CheckRow>("service_role", "select * from public.license_check($1, $2, $3, $4)", [id, hash, version, max]);

const setStatus = (id: string, status: string, reason: string | null, by = admin) =>
	db.as<{ admin_set_installation_status: { changed: boolean; installation: Record<string, unknown> } }>(
		"authenticated",
		"select public.admin_set_installation_status($1, $2, $3)",
		[id, status, reason],
		by,
	);

describe("license_check", () => {
	test("registers a new installation as ACTIVE", async () => {
		const id = crypto.randomUUID();
		const [row] = await check(id);
		expect(row).toEqual({ outcome: "ok", status: "ACTIVE", registered: true });

		const [stored] = (
			await db.pg.query<Record<string, unknown>>("select * from licensing.installations where installation_id = $1", [
				id,
			])
		).rows;
		expect(stored.status).toBe("ACTIVE");
		expect(stored.app_version).toBe("1.2.0");
		expect(stored.last_seen).not.toBeNull();
		expect(stored.secret_hash).toBe(HASH_A);

		const events = (
			await db.pg.query("select event from licensing.installation_events where installation_id = $1", [id])
		).rows;
		expect(events).toEqual([{ event: "REGISTERED" }]);
	});

	test("recognizes an existing installation and updates its contact", async () => {
		const id = crypto.randomUUID();
		await check(id, HASH_A, "1.2.0");
		await db.pg.query(
			"update licensing.installations set last_seen = now() - interval '1 day' where installation_id = $1",
			[id],
		);
		const [row] = await check(id, HASH_A, "1.3.0");
		expect(row).toEqual({ outcome: "ok", status: "ACTIVE", registered: false });

		const [stored] = (
			await db.pg.query<{ app_version: string; fresh: boolean }>(
				"select app_version, last_seen > now() - interval '1 minute' as fresh from licensing.installations where installation_id = $1",
				[id],
			)
		).rows;
		expect(stored).toEqual({ app_version: "1.3.0", fresh: true });
		const count = await db.pg.query("select 1 from licensing.installation_events where installation_id = $1", [id]);
		expect(count.rows).toHaveLength(1); // registered once only
	});

	test("rejects a known id with the wrong secret, without touching it", async () => {
		const id = crypto.randomUUID();
		await check(id, HASH_A);
		const [row] = await check(id, HASH_B, "9.9.9");
		expect(row).toEqual({ outcome: "invalid_credentials", status: null, registered: false });
		const [stored] = (
			await db.pg.query<{ app_version: string }>(
				"select app_version from licensing.installations where installation_id = $1",
				[id],
			)
		).rows;
		expect(stored.app_version).toBe("1.2.0");
	});

	test("reports BLOCKED for a blocked installation", async () => {
		const id = crypto.randomUUID();
		await check(id);
		await setStatus(id, "BLOCKED", "abuse");
		expect((await check(id))[0]).toEqual({ outcome: "ok", status: "BLOCKED", registered: false });
	});

	test("stores the device name, keeps it when an older version sends none, follows a rename", async () => {
		const id = crypto.randomUUID();
		const deviceOf = async () =>
			(
				await db.pg.query<{ device_name: string | null }>(
					"select device_name from licensing.installations where installation_id = $1",
					[id],
				)
			).rows[0].device_name;
		const checkFrom = (device: string | null) =>
			db.as("service_role", "select * from public.license_check($1, $2, $3, $4, $5)", [
				id,
				HASH_A,
				"1.2.1",
				30,
				device,
			]);

		await checkFrom("  LIAN-LAPTOP  ");
		expect(await deviceOf()).toBe("LIAN-LAPTOP");
		await check(id); // the 4-argument call of app 1.2.0 still works
		expect(await deviceOf()).toBe("LIAN-LAPTOP");
		await checkFrom("SCHUL-PC");
		expect(await deviceOf()).toBe("SCHUL-PC");
		await checkFrom("x".repeat(80));
		expect(await deviceOf()).toBe("x".repeat(64));
		// With the wrong secret nothing changes.
		await db.as("service_role", "select * from public.license_check($1, $2, $3, $4, $5)", [
			id,
			HASH_B,
			"1.2.1",
			30,
			"EVIL",
		]);
		expect(await deviceOf()).toBe("x".repeat(64));
	});

	test("keeps installations apart", async () => {
		const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
		await check(a, HASH_A);
		await check(b, HASH_B);
		await setStatus(a, "BLOCKED", null);
		expect((await check(a, HASH_A))[0].status).toBe("BLOCKED");
		expect((await check(b, HASH_B))[0].status).toBe("ACTIVE");
		// One installation's secret doesn't open the other.
		expect((await check(b, HASH_A))[0].outcome).toBe("invalid_credentials");
	});

	test("limits registrations per minute", async () => {
		await check(crypto.randomUUID(), HASH_A, "1.2.0", 2);
		await check(crypto.randomUUID(), HASH_A, "1.2.0", 2);
		const [row] = await check(crypto.randomUUID(), HASH_A, "1.2.0", 2);
		expect(row.outcome).toBe("rate_limited");
		const total = await db.pg.query("select 1 from licensing.installations");
		expect(total.rows).toHaveLength(2);
	});

	test("validates its arguments", async () => {
		expect(await errorCode(check(crypto.randomUUID(), "not-a-hash"))).toBe("22023");
		expect(await errorCode(check(crypto.randomUUID(), HASH_A, "x".repeat(40)))).toBe("22023");
	});

	test("cannot be called by the desktop app's roles", async () => {
		const call = (role: "anon" | "authenticated") =>
			db.as(
				role,
				"select * from public.license_check($1, $2, $3, $4)",
				[crypto.randomUUID(), HASH_A, "1.0.0", 30],
				user,
			);
		expect(await errorCode(call("anon"))).toBe("42501");
		expect(await errorCode(call("authenticated"))).toBe("42501");
	});
});

describe("admin functions", () => {
	test("block and unblock write the audit trail", async () => {
		const id = crypto.randomUUID();
		await check(id);

		const [blocked] = await setStatus(id, "BLOCKED", "  shared publicly  ");
		expect(blocked.admin_set_installation_status.changed).toBe(true);
		expect(blocked.admin_set_installation_status.installation.status).toBe("BLOCKED");
		expect(blocked.admin_set_installation_status.installation.block_reason).toBe("shared publicly");
		expect(blocked.admin_set_installation_status.installation.blocked_at).not.toBeNull();

		const [again] = await setStatus(id, "BLOCKED", "twice");
		expect(again.admin_set_installation_status.changed).toBe(false);

		const [unblocked] = await setStatus(id, "ACTIVE", "resolved");
		expect(unblocked.admin_set_installation_status.installation.status).toBe("ACTIVE");
		expect(unblocked.admin_set_installation_status.installation.blocked_at).toBeNull();
		expect(unblocked.admin_set_installation_status.installation.block_reason).toBeNull();

		const [detail] = await db.as<{
			admin_get_installation: { events: { event: string; reason: string | null; actor_email: string | null }[] };
		}>("authenticated", "select public.admin_get_installation($1)", [id], admin);
		expect(detail.admin_get_installation.events.map((e) => [e.event, e.reason, e.actor_email])).toEqual([
			["UNBLOCKED", "resolved", "admin@example.com"],
			["BLOCKED", "shared publicly", "admin@example.com"],
			["REGISTERED", null, null],
		]);
	});

	test("stats count by status, contact and registration", async () => {
		const [a, b, c] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
		for (const id of [a, b, c]) await check(id);
		await setStatus(b, "BLOCKED", null);
		await db.pg.query(
			"update licensing.installations set last_seen = now() - interval '2 hours', created_at = now() - interval '30 days' where installation_id = $1",
			[c],
		);
		const [row] = await db.as<{ admin_stats: Record<string, number> }>(
			"authenticated",
			"select public.admin_stats(30, 7)",
			[],
			admin,
		);
		expect(row.admin_stats).toEqual({ total: 3, active: 2, blocked: 1, online: 2, new: 2 });
	});

	test("list searches, filters and pages", async () => {
		const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
		for (const id of ids) await check(id);
		await setStatus(ids[0], "BLOCKED", "100% fraud_case");

		type Row = { installation_id: string; status: string; total_count: number };
		const list = (search: string | null, status: string | null, limit = 50, offset = 0) =>
			db.as<Row>(
				"authenticated",
				"select * from public.admin_list_installations($1, $2, $3, $4)",
				[search, status, limit, offset],
				admin,
			);

		expect(await list(null, null)).toHaveLength(5);
		const blocked = await list(null, "BLOCKED");
		expect(blocked.map((r) => r.installation_id)).toEqual([ids[0]]);
		expect((await list(ids[3].slice(0, 13), null))[0].installation_id).toBe(ids[3]);
		// By computer name, with the name in the result.
		await db.as("service_role", "select * from public.license_check($1, $2, $3, $4, $5)", [
			ids[2],
			HASH_A,
			"1.2.1",
			30,
			"Wohnzimmer-PC",
		]);
		const byDevice = await list("wohnzimmer", null);
		expect(byDevice.map((r) => [r.installation_id, (r as Row & { device_name: string }).device_name])).toEqual([
			[ids[2], "Wohnzimmer-PC"],
		]);
		// Wildcards in the search are literal.
		expect(await list("100%", null)).toHaveLength(1);
		expect(await list("%", null)).toHaveLength(1);
		const page = await list(null, null, 2, 2);
		expect(page).toHaveLength(2);
		expect(Number(page[0].total_count)).toBe(5);
		expect(await errorCode(list(null, "DELETED"))).toBe("22023");
	});

	test("are refused to signed-in users who aren't admins", async () => {
		const id = crypto.randomUUID();
		await check(id);
		const calls = [
			["select public.admin_stats()", []],
			["select * from public.admin_list_installations()", []],
			["select public.admin_get_installation($1)", [id]],
			["select public.admin_set_installation_status($1, 'BLOCKED', null)", [id]],
		] as const;
		for (const [sql, params] of calls) {
			expect(await errorCode(db.as("authenticated", sql, [...params], user))).toBe("42501");
			// Signed in but no user id in the token.
			expect(await errorCode(db.as("authenticated", sql, [...params]))).toBe("42501");
		}
		const [row] = await db.as<{ admin_is_admin: boolean }>("authenticated", "select public.admin_is_admin()", [], user);
		expect(row.admin_is_admin).toBe(false);
		const [stored] = (
			await db.pg.query<{ status: string }>("select status from licensing.installations where installation_id = $1", [
				id,
			])
		).rows;
		expect(stored.status).toBe("ACTIVE");
	});

	test("are refused to anonymous callers", async () => {
		for (const sql of ["select public.admin_stats()", "select public.admin_is_admin()"]) {
			expect(await errorCode(db.as("anon", sql))).toBe("42501");
		}
	});

	test("the tables can't be reached directly, not even by the service role", async () => {
		for (const role of ["anon", "authenticated", "service_role"] as const) {
			for (const sql of [
				"select * from licensing.installations",
				"update licensing.installations set status = 'ACTIVE'",
				"select * from licensing.installation_events",
				"insert into licensing.admins (user_id) values (gen_random_uuid())",
			]) {
				expect(await errorCode(db.as(role, sql, [], admin))).toBe("42501");
			}
		}
	});

	test("the audit trail is append-only", async () => {
		const id = crypto.randomUUID();
		await check(id);
		expect(await errorCode(db.pg.query("update licensing.installation_events set reason = 'x'"))).toBe("42501");
		// Deleting an installation (a data deletion request) takes its history along.
		await db.pg.query("delete from licensing.installations where installation_id = $1", [id]);
		expect((await db.pg.query("select 1 from licensing.installation_events")).rows).toHaveLength(0);
	});

	test("unknown installations and bad input are errors", async () => {
		expect(
			await errorCode(db.as("authenticated", "select public.admin_get_installation($1)", [crypto.randomUUID()], admin)),
		).toBe("P0002");
		expect(await errorCode(setStatus(crypto.randomUUID(), "BLOCKED", null))).toBe("P0002");
		const id = crypto.randomUUID();
		await check(id);
		expect(await errorCode(setStatus(id, "PAUSED", null))).toBe("22023");
		expect(await errorCode(setStatus(id, "BLOCKED", "x".repeat(501)))).toBe("22023");
	});
});
