import { DownloadIcon } from "lucide-react";
/**
 * Updates: when a new version of this fork has been downloaded (see
 * `src-tauri/src/updater.rs`), the island offers it with one button.
 * Installing restarts the island.
 */
import { useState } from "react";
import { command, useProvider } from "../../core/bridge";
import { useT } from "../../core/i18n";
import type { IslandModule, ModuleView } from "../../core/types";

const ACCENT = "#0A84FF";

function InstallButton({ compact }: { compact?: boolean }) {
	const t = useT();
	const [busy, setBusy] = useState(false);
	return (
		<button
			type="button"
			className={
				compact
					? "rounded-full bg-[#0A84FF] px-2.5 py-0.75 text-[11.5px] font-bold text-white disabled:opacity-50"
					: "flex h-8.5 items-center gap-1.5 rounded-[14px] bg-[#0A84FF] px-3.5 text-[12.5px] font-bold text-white transition-[filter] hover:brightness-110 disabled:opacity-50"
			}
			disabled={busy}
			data-no-drag
			onClick={(e) => {
				e.stopPropagation();
				setBusy(true);
				command("install_update");
			}}
		>
			{!compact && <DownloadIcon size={14} />}
			{busy ? t("update.installing") : t("update.install")}
		</button>
	);
}

export const updateModule: IslandModule = {
	id: "update",
	title: "update.title",
	settingsIcon: <DownloadIcon size={15} />,
	useView(): ModuleView {
		const t = useT();
		const update = useProvider<{ version: string }>("update");
		const version = update?.version;
		return {
			active: !!version,
			priority: 40,
			accent: ACCENT,
			icon: <DownloadIcon size={15} color={ACCENT} />,
			compact: version
				? {
						left: (
							<span className="flex items-center gap-2 text-[13px] font-[650]">
								<DownloadIcon size={15} color={ACCENT} />
								{t("update.short", { version })}
							</span>
						),
						right: <InstallButton compact />,
						width: 300,
					}
				: undefined,
			expanded: version ? (
				<div className="flex h-full items-center gap-3.5 px-2.5" onClick={(e) => e.stopPropagation()}>
					<span className="grid size-11.5 flex-none place-items-center rounded-2xl bg-[rgba(10,132,255,0.16)] text-[#64B5FF]">
						<DownloadIcon size={21} />
					</span>
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<strong className="truncate text-[15px]">{t("update.ready", { version })}</strong>
						<span className="truncate text-[12px] text-text-dim">{t("update.hint")}</span>
					</div>
					<InstallButton />
				</div>
			) : (
				<div className="m-auto text-[12.5px] text-text-dim">{t("update.none")}</div>
			),
			expandedSize: { width: 560, height: 110 },
			activityKey: version ? `update:${version}` : undefined,
		};
	},
};
