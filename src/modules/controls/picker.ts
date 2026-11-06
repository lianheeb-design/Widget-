import type { SettingDef } from "../../core/settings";

/** Mirrors `State` in `src-tauri/src/providers/tools/picker.rs`. */
export interface PickerState {
	picking: boolean;
	hex: string | null;
	seq: number;
	picked: boolean;
}

export const PICKER_ID = "picker";

/** The last picked colors, newest first. */
export const recentColors: SettingDef<string[]> = {
	key: "controls.colors",
	label: "controls.lastColor",
	default: [],
};

export const MAX_COLORS = 6;

/** Black or white text, whichever reads on `hex`. */
export function inkOn(hex: string) {
	const n = Number.parseInt(hex.slice(1), 16);
	const r = (n >> 16) & 255;
	const g = (n >> 8) & 255;
	const b = n & 255;
	return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#000" : "#fff";
}
