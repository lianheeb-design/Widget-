import { providerAction } from "../../core/bridge";

/** Mirrors `Item` in `src-tauri/src/providers/downloads.rs`. */
export interface DownloadItem {
	path: string;
	name: string;
	isDir: boolean;
	/** Lowercase extension, for the icon when there is no preview. */
	ext: string;
	/** Bytes; 0 for folders. */
	size: number;
	/** When it arrived in the folder (Unix ms). */
	at: number;
	/** Windows' preview or the file's icon, as a data URL. */
	thumb: string | null;
}

export interface DownloadsState {
	/** The Downloads folder; `null` when there is none. */
	folder: string | null;
	/** Newest first. */
	items: DownloadItem[];
	/** The latest file that showed up while the island runs (a finished download). */
	latest: { path: string; name: string; seenAt: number } | null;
}

export const DOWNLOADS_PROVIDER = "downloads";
export const DOWNLOADS_GREEN = "#30D158";

export const downloadsAction = (action: "open" | "reveal" | "drag", path: string) =>
	providerAction(DOWNLOADS_PROVIDER, action, path);

export const openDownloadsFolder = () => providerAction(DOWNLOADS_PROVIDER, "openFolder");
