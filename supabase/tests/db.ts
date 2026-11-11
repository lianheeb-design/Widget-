/**
 * A real Postgres (PGlite, Postgres compiled to WebAssembly) with the parts of
 * Supabase the migration relies on: the `anon` / `authenticated` /
 * `service_role` roles, Supabase's default grants on `public`, `auth.users`
 * and `auth.uid()` (read from the request's JWT claims, as on Supabase).
 *
 * The real migration file is applied on top, so the tests check the SQL that
 * gets deployed, including its privileges.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = resolve(import.meta.dirname, "../migrations");

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants everything in public to its API roles by default; the
-- migration has to take that back where it matters.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;
`;

export type Role = "anon" | "authenticated" | "service_role";

export interface TestDb {
	pg: PGlite;
	/** Runs `sql` as `role` (with `userId` as the JWT subject), like a request through the Data API. */
	as<T>(role: Role, sql: string, params?: unknown[], userId?: string): Promise<T[]>;
	/** Adds a Supabase Auth user, optionally as an admin of the dashboard. */
	addUser(email: string, admin: boolean): Promise<string>;
}

export async function createDb(): Promise<TestDb> {
	const pg = await PGlite.create();
	await pg.exec(SUPABASE_STUB);
	for (const file of readdirSync(MIGRATIONS).sort()) {
		if (file.endsWith(".sql")) await pg.exec(readFileSync(resolve(MIGRATIONS, file), "utf8"));
	}

	return {
		pg,
		async as<T>(role: Role, sql: string, params: unknown[] = [], userId?: string) {
			return pg.transaction(async (tx) => {
				await tx.query("select set_config('request.jwt.claims', $1, true)", [
					JSON.stringify(userId ? { sub: userId, role } : { role }),
				]);
				await tx.exec(`set local role ${role}`);
				const result = await tx.query<T>(sql, params);
				return result.rows;
			});
		},
		async addUser(email, admin) {
			const id = crypto.randomUUID();
			await pg.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
			if (admin) await pg.query("insert into licensing.admins (user_id) values ($1)", [id]);
			return id;
		},
	};
}

/** The Postgres error code of a failed query (e.g. 42501 insufficient_privilege). */
export async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
	try {
		await promise;
	} catch (e) {
		return (e as { code?: string }).code ?? "unknown";
	}
	return undefined;
}
