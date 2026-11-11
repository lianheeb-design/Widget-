import { ChevronLeftIcon, ChevronRightIcon, LogOutIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
	ApiError,
	fetchStats,
	type Installation,
	type InstallationStatus,
	listInstallations,
	PAGE_SIZE,
	type Stats,
} from "../lib/api";
import { DetailPanel } from "./DetailPanel";
import { InstallationTable } from "./InstallationTable";
import { NEW_DAYS, StatsCards } from "./StatsCards";
import { StatusDialog } from "./StatusDialog";
import { Button, ErrorBanner, Spinner } from "./ui";

const FILTERS: { value: InstallationStatus | null; label: string }[] = [
	{ value: null, label: "Alle" },
	{ value: "ACTIVE", label: "Aktiv" },
	{ value: "BLOCKED", label: "Gesperrt" },
];
const SEARCH_DELAY = 300;
const AUTO_REFRESH = 60_000;

/** Overview, search and filter, the table, details and block/unblock. */
export function Dashboard({ email, onSignOut }: { email: string; onSignOut: () => void }) {
	const [onlineMinutes, setOnlineMinutes] = useState(15);
	const [search, setSearch] = useState("");
	const [query, setQuery] = useState("");
	const [status, setStatus] = useState<InstallationStatus | null>(null);
	const [page, setPage] = useState(0);
	const [stats, setStats] = useState<Stats | null>(null);
	const [list, setList] = useState<{ rows: Installation[]; total: number } | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [action, setAction] = useState<Installation | null>(null);
	/** Bumped after a change, to reload the details. */
	const [changes, setChanges] = useState(0);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			setQuery(search);
			setPage(0);
		}, SEARCH_DELAY);
		return () => window.clearTimeout(timer);
	}, [search]);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [nextStats, nextList] = await Promise.all([
				fetchStats(onlineMinutes, NEW_DAYS),
				listInstallations({ search: query, status, page }),
			]);
			setStats(nextStats);
			setList(nextList);
			setError(null);
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "Die Daten konnten nicht geladen werden.");
		} finally {
			setLoading(false);
		}
	}, [onlineMinutes, query, status, page]);

	useEffect(() => {
		load();
	}, [load]);

	// Keeps "last contact" fresh while the tab is in front.
	useEffect(() => {
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") load();
		}, AUTO_REFRESH);
		return () => window.clearInterval(timer);
	}, [load]);

	const total = list?.total ?? 0;
	const from = total ? page * PAGE_SIZE + 1 : 0;
	const to = Math.min(total, (page + 1) * PAGE_SIZE);

	return (
		<div className="mx-auto flex max-w-300 flex-col gap-5 px-4 py-6 md:px-8">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-[22px] font-bold tracking-tight">Zugangsverwaltung</h1>
					<p className="text-[13px] text-text-dim">Installationen der Insel sperren und freigeben</p>
				</div>
				<div className="flex items-center gap-2">
					<span className="hidden text-[12.5px] text-text-dim sm:inline">{email}</span>
					<Button variant="ghost" onClick={onSignOut}>
						<LogOutIcon size={15} />
						Abmelden
					</Button>
				</div>
			</header>

			<StatsCards stats={stats} onlineMinutes={onlineMinutes} onOnlineMinutes={setOnlineMinutes} />

			{error && <ErrorBanner message={error} onClose={() => setError(null)} />}

			<section className="flex flex-wrap items-center gap-2">
				<label className="relative min-w-60 flex-1">
					<SearchIcon
						size={15}
						className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-faint"
					/>
					<input
						type="search"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Suchen: Gerät, ID, Version oder Sperrgrund"
						aria-label="Installationen suchen"
						className="h-9 w-full rounded-xl bg-panel pr-3 pl-9 text-[13.5px] outline-none shadow-[inset_0_0_0_1px_var(--color-hairline)] placeholder:text-text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-accent)]"
					/>
				</label>
				<div className="flex rounded-xl bg-panel p-0.75 shadow-[inset_0_0_0_1px_var(--color-hairline)]">
					{FILTERS.map((f) => (
						<button
							key={f.label}
							type="button"
							aria-pressed={status === f.value}
							onClick={() => {
								setStatus(f.value);
								setPage(0);
							}}
							className={`h-7.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
								status === f.value ? "bg-white/12 text-text" : "text-text-dim hover:text-text"
							}`}
						>
							{f.label}
						</button>
					))}
				</div>
				<Button variant="soft" onClick={load} busy={loading} aria-label="Aktualisieren">
					{!loading && <RefreshCwIcon size={14} />}
					Aktualisieren
				</Button>
			</section>

			{!list ? (
				<Spinner label="Wird geladen…" />
			) : list.rows.length === 0 ? (
				<div className="rounded-2xl bg-panel py-14 text-center text-[13.5px] text-text-dim shadow-[inset_0_0_0_1px_var(--color-hairline)]">
					{query || status ? "Keine Installation passt zur Suche." : "Noch keine Installation registriert."}
				</div>
			) : (
				<InstallationTable rows={list.rows} selected={selected} onSelect={setSelected} onAction={setAction} />
			)}

			{total > 0 && (
				<footer className="flex items-center justify-between text-[12.5px] text-text-dim">
					<span className="tabular-nums">
						{from}–{to} von {total.toLocaleString("de-CH")}
					</span>
					<div className="flex gap-1.5">
						<Button
							variant="ghost"
							disabled={page === 0}
							onClick={() => setPage((p) => p - 1)}
							aria-label="Vorherige Seite"
						>
							<ChevronLeftIcon size={15} />
						</Button>
						<Button
							variant="ghost"
							disabled={to >= total}
							onClick={() => setPage((p) => p + 1)}
							aria-label="Nächste Seite"
						>
							<ChevronRightIcon size={15} />
						</Button>
					</div>
				</footer>
			)}

			{selected && (
				<DetailPanel id={selected} version={changes} onClose={() => setSelected(null)} onAction={setAction} />
			)}

			{action && (
				<StatusDialog
					installation={action}
					onClose={() => setAction(null)}
					onDone={() => {
						setAction(null);
						setChanges((n) => n + 1);
						load();
					}}
				/>
			)}
		</div>
	);
}
