/**
 * The dashboard's calls: the `admin_*` functions of the migration
 * (`supabase/migrations/*_licensing.sql`). Each one checks on the server that
 * the signed-in user is an admin; nothing here is trusted for that.
 */
import { supabase } from "./supabase";

export type InstallationStatus = "ACTIVE" | "BLOCKED";

export interface Installation {
	installation_id: string;
	/** The computer's name (sent by app 1.2.1 and newer). */
	device_name: string | null;
	status: InstallationStatus;
	created_at: string;
	last_seen: string | null;
	last_status_check: string | null;
	blocked_at: string | null;
	block_reason: string | null;
	app_version: string | null;
}

export interface InstallationEvent {
	id: number;
	event: "REGISTERED" | "BLOCKED" | "UNBLOCKED";
	reason: string | null;
	actor_email: string | null;
	created_at: string;
}

export interface Stats {
	total: number;
	active: number;
	blocked: number;
	online: number;
	new: number;
}

export const PAGE_SIZE = 50;

/** An error to show: the server's reason in plain words. */
export class ApiError extends Error {
	constructor(
		message: string,
		readonly code?: string,
	) {
		super(message);
	}
}

const MESSAGES: Record<string, string> = {
	"42501": "Keine Berechtigung. Dieses Konto ist kein Admin.",
	P0002: "Diese Installation gibt es nicht.",
	"22023": "Ungültige Eingabe.",
	PGRST301: "Die Sitzung ist abgelaufen. Bitte neu anmelden.",
};

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
	if (!supabase) throw new ApiError("Supabase ist nicht eingerichtet.");
	const { data, error } = await supabase.rpc(fn, args);
	if (error) {
		const code = error.code ?? undefined;
		throw new ApiError(
			(code && MESSAGES[code]) ||
				(error.message?.includes("fetch") ? "Server nicht erreichbar." : error.message || "Unbekannter Fehler."),
			code,
		);
	}
	return data as T;
}

export const isAdmin = () => rpc<boolean>("admin_is_admin");

export const fetchStats = (onlineMinutes: number, newDays: number) =>
	rpc<Stats>("admin_stats", { p_online_minutes: onlineMinutes, p_new_days: newDays });

export async function listInstallations(query: {
	search: string;
	status: InstallationStatus | null;
	page: number;
}): Promise<{ rows: Installation[]; total: number }> {
	const rows = await rpc<(Installation & { total_count: number })[]>("admin_list_installations", {
		p_search: query.search.trim() || null,
		p_status: query.status,
		p_limit: PAGE_SIZE,
		p_offset: query.page * PAGE_SIZE,
	});
	return { rows, total: rows.length ? Number(rows[0].total_count) : 0 };
}

export const getInstallation = (id: string) =>
	rpc<{ installation: Installation; events: InstallationEvent[] }>("admin_get_installation", {
		p_installation_id: id,
	});

export const setInstallationStatus = (id: string, status: InstallationStatus, reason: string) =>
	rpc<{ changed: boolean; installation: Installation }>("admin_set_installation_status", {
		p_installation_id: id,
		p_status: status,
		p_reason: reason.trim() || null,
	});
