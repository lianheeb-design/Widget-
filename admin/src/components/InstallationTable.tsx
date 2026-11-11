import type { Installation } from "../lib/api";
import { formatAgo, formatDate } from "../lib/format";
import { Button, CopyButton, DeviceName, OnlineDot, StatusBadge } from "./ui";

/** One row per installation; a click opens its details. */
export function InstallationTable({
	rows,
	selected,
	onSelect,
	onAction,
}: {
	rows: Installation[];
	selected: string | null;
	onSelect: (id: string) => void;
	onAction: (installation: Installation) => void;
}) {
	return (
		<div className="overflow-x-auto rounded-2xl bg-panel shadow-[inset_0_0_0_1px_var(--color-hairline)]">
			<table className="w-full min-w-200 border-collapse text-left text-[13px]">
				<thead>
					<tr className="text-[11.5px] font-semibold tracking-wide text-text-faint uppercase">
						<th className="px-4 py-3">Gerät · Installations-ID</th>
						<th className="px-4 py-3">Status</th>
						<th className="px-4 py-3">Letzter Kontakt</th>
						<th className="px-4 py-3">Version</th>
						<th className="px-4 py-3">Registriert</th>
						<th className="px-4 py-3 text-right">Aktion</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr
							key={row.installation_id}
							onClick={() => onSelect(row.installation_id)}
							className={`cursor-pointer border-t border-hairline transition-colors hover:bg-white/4 ${
								selected === row.installation_id ? "bg-accent/8" : ""
							}`}
						>
							<td className="px-4 py-2.5">
								<span className="flex items-center gap-2.5">
									<OnlineDot lastSeen={row.last_seen} />
									<span className="flex min-w-0 flex-col">
										<DeviceName name={row.device_name} />
										<span className="flex items-center gap-1">
											<code className="font-mono text-[11.5px] text-text-faint" title={row.installation_id}>
												{row.installation_id.slice(0, 8)}…{row.installation_id.slice(-4)}
											</code>
											<CopyButton text={row.installation_id} label="ID kopieren" />
										</span>
									</span>
								</span>
							</td>
							<td className="px-4 py-2.5">
								<StatusBadge status={row.status} />
							</td>
							<td className="px-4 py-2.5 text-text-dim" title={formatDate(row.last_seen)}>
								{formatAgo(row.last_seen)}
							</td>
							<td className="px-4 py-2.5 font-mono text-[12.5px] text-text-dim">{row.app_version ?? "–"}</td>
							<td className="px-4 py-2.5 text-text-dim">{formatDate(row.created_at)}</td>
							<td className="px-4 py-2.5 text-right">
								<Button
									variant={row.status === "BLOCKED" ? "ok" : "danger"}
									className="h-7.5 px-3"
									onClick={(e) => {
										e.stopPropagation();
										onAction(row);
									}}
								>
									{row.status === "BLOCKED" ? "Freigeben" : "Sperren"}
								</Button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
