import { BanIcon, CircleCheckIcon, PlusCircleIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ApiError, getInstallation, type Installation, type InstallationEvent } from "../lib/api";
import { formatAgo, formatDate } from "../lib/format";
import { Button, CopyButton, DeviceName, ErrorBanner, OnlineDot, Spinner, StatusBadge } from "./ui";

const EVENTS: Record<InstallationEvent["event"], { label: string; icon: ReactNode; tone: string }> = {
	REGISTERED: { label: "Registriert", icon: <PlusCircleIcon size={14} />, tone: "text-[#64b5ff] bg-accent/15" },
	BLOCKED: { label: "Gesperrt", icon: <BanIcon size={14} />, tone: "text-[#ff6961] bg-danger/15" },
	UNBLOCKED: { label: "Freigegeben", icon: <CircleCheckIcon size={14} />, tone: "text-[#4ee67a] bg-ok/15" },
};

/** Everything about one installation, with its block history (newest first). */
export function DetailPanel({
	id,
	version,
	onClose,
	onAction,
}: {
	id: string;
	/** Changes after a block/unblock, to load the history again. */
	version: number;
	onClose: () => void;
	onAction: (installation: Installation) => void;
}) {
	const [data, setData] = useState<{ installation: Installation; events: InstallationEvent[] } | null>(null);
	const [error, setError] = useState<string | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `version` is a trigger (reload after a change), not an input
	useEffect(() => {
		let cancelled = false;
		setError(null);
		getInstallation(id)
			.then((result) => !cancelled && setData(result))
			.catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "Konnte nicht geladen werden."));
		return () => {
			cancelled = true;
		};
	}, [id, version]);

	const item = data?.installation.installation_id === id ? data.installation : null;

	return (
		<aside className="fixed inset-y-0 right-0 z-20 flex w-full max-w-110 flex-col bg-panel shadow-[-1px_0_0_var(--color-hairline),-30px_0_80px_-20px_rgba(0,0,0,0.8)]">
			<header className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
				<h2 className="text-[15px] font-bold">Installation</h2>
				<button
					type="button"
					aria-label="Schliessen"
					className="grid size-8 place-items-center rounded-lg text-text-dim hover:bg-white/8 hover:text-text"
					onClick={onClose}
				>
					<XIcon size={16} />
				</button>
			</header>

			<div className="flex-1 overflow-y-auto px-5 py-4">
				{error && <ErrorBanner message={error} />}
				{!item && !error && <Spinner label="Wird geladen…" />}
				{item && data && (
					<div className="flex flex-col gap-5">
						<div className="flex flex-col gap-1">
							<span className="text-[11.5px] font-semibold tracking-wide text-text-faint uppercase">Gerät</span>
							<DeviceName name={item.device_name} className="text-[17px]" />
						</div>
						<div className="flex flex-col gap-2">
							<span className="text-[11.5px] font-semibold tracking-wide text-text-faint uppercase">
								Installations-ID
							</span>
							<div className="flex items-center gap-2 rounded-xl bg-white/5 py-1.5 pr-1.5 pl-3 shadow-[inset_0_0_0_1px_var(--color-hairline)]">
								<code className="flex-1 font-mono text-[12.5px] break-all select-all">{item.installation_id}</code>
								<CopyButton text={item.installation_id} />
							</div>
						</div>

						<dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-[13px]">
							<Field label="Status">
								<StatusBadge status={item.status} />
							</Field>
							<Field label="Letzter Kontakt">
								<span className="flex items-center gap-2">
									<OnlineDot lastSeen={item.last_seen} />
									{formatAgo(item.last_seen)}
									<span className="text-text-faint">{formatDate(item.last_seen)}</span>
								</span>
							</Field>
							<Field label="Letzte Prüfung">{formatDate(item.last_status_check)}</Field>
							<Field label="Registriert">{formatDate(item.created_at)}</Field>
							<Field label="Version">
								<code className="font-mono text-[12.5px]">{item.app_version ?? "–"}</code>
							</Field>
							{item.status === "BLOCKED" && (
								<>
									<Field label="Gesperrt seit">{formatDate(item.blocked_at)}</Field>
									<Field label="Sperrgrund">
										{item.block_reason ? (
											<span className="whitespace-pre-wrap">{item.block_reason}</span>
										) : (
											<span className="text-text-faint">kein Grund angegeben</span>
										)}
									</Field>
								</>
							)}
						</dl>

						<Button
							variant={item.status === "BLOCKED" ? "ok" : "danger"}
							className="self-start"
							onClick={() => onAction(item)}
						>
							{item.status === "BLOCKED" ? "Installation freigeben" : "Installation sperren"}
						</Button>

						<section className="flex flex-col gap-3">
							<h3 className="text-[11.5px] font-semibold tracking-wide text-text-faint uppercase">Sperrhistorie</h3>
							<ol className="flex flex-col gap-3">
								{data.events.map((event) => {
									const look = EVENTS[event.event];
									return (
										<li key={event.id} className="flex gap-3">
											<span className={`grid size-7 flex-none place-items-center rounded-lg ${look.tone}`}>
												{look.icon}
											</span>
											<div className="flex min-w-0 flex-col gap-0.5">
												<span className="text-[13px] font-semibold">
													{look.label}
													<span className="ml-2 font-normal text-text-faint">{formatDate(event.created_at)}</span>
												</span>
												{event.actor_email && (
													<span className="text-[12px] text-text-dim">von {event.actor_email}</span>
												)}
												{event.reason && (
													<span className="text-[12.5px] whitespace-pre-wrap text-text-dim">«{event.reason}»</span>
												)}
											</div>
										</li>
									);
								})}
							</ol>
						</section>
					</div>
				)}
			</div>
		</aside>
	);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<>
			<dt className="text-text-dim">{label}</dt>
			<dd className="m-0 min-w-0">{children}</dd>
		</>
	);
}
