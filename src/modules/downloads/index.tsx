import { DownloadIcon } from "lucide-react";
/**
 * Downloads: the newest files in the Downloads folder. Click to open, drag
 * out to any app, show in Explorer, keep on the shelf or ask Claude about.
 * When a download finishes, the island opens for a moment with it on top.
 * Backend: `src-tauri/src/providers/downloads.rs`.
 */
import { useProvider } from "../../core/bridge";
import { useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { DownloadsPanel } from "./components/DownloadsPanel";
import { downloadsSettings } from "./settings";
import { DOWNLOADS_GREEN, DOWNLOADS_PROVIDER, type DownloadsState } from "./types";

const ROW = 48;
const MAX_ROWS = 5;
/**
 * A download noticed longer ago than this no longer opens the island (the
 * window was reloaded and gets the backend's state again).
 */
const PEEK_WINDOW_MS = 15_000;

export const downloadsModule: IslandModule = {
	id: "downloads",
	title: "downloads.title",
	settingsIcon: <DownloadIcon size={14} />,
	settings: Object.values(downloadsSettings),
	useView(): ModuleView {
		const state = useProvider<DownloadsState>(DOWNLOADS_PROVIDER);
		const peekOnNew = useSetting(downloadsSettings.peekOnNew);
		const latest = state?.latest;
		const rows = Math.min(Math.max(state?.items.length ?? 0, 1), MAX_ROWS);
		const fresh = !!latest && Date.now() - latest.seenAt < PEEK_WINDOW_MS;

		return {
			active: false,
			priority: 0,
			accent: DOWNLOADS_GREEN,
			icon: <DownloadIcon size={14} color={DOWNLOADS_GREEN} />,
			expanded: <DownloadsPanel state={state} />,
			expandedSize: { width: 560, height: 46 + rows * ROW },
			activityKey: peekOnNew && fresh ? `download:${latest.path}:${latest.seenAt}` : undefined,
			peekMs: 5000,
		};
	},
};
