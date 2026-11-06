/**
 * Extra look-and-feel settings of this fork: a mini island at rest and while
 * a browser is active (so it doesn't cover the browser's tabs), a delay
 * before hover opens it, its size, color and corners, and what the resting
 * pill shows.
 */
import { useProvider } from "./bridge";
import { createStore } from "./island";
import { type SettingDef, useSetting } from "./settings";

export const extraSettings = {
	mini: {
		key: "island.mini",
		label: "extras.mini.label",
		description: "extras.mini.desc",
		default: false,
	},
	miniInBrowser: {
		key: "island.miniInBrowser",
		label: "extras.miniInBrowser.label",
		description: "extras.miniInBrowser.desc",
		default: true,
	},
} satisfies Record<string, SettingDef>;

export const openDelay: SettingDef<number> = { key: "island.openDelay", label: "extras.delay.label", default: 110 };
export const OPEN_DELAYS = [110, 250, 450, 800];

export type IslandSize = "small" | "medium" | "large";
export const islandSize: SettingDef<IslandSize> = {
	key: "appearance.size",
	label: "extras.size.label",
	default: "medium",
};
export const SIZE_SCALE: Record<IslandSize, number> = { small: 0.86, medium: 1, large: 1.12 };

export const islandColor: SettingDef<string> = {
	key: "appearance.color",
	label: "extras.color.label",
	default: "#000000",
};
/** 40–100 (%). */
export const islandOpacity: SettingDef<number> = {
	key: "appearance.opacity",
	label: "extras.opacity.label",
	default: 100,
};
/** 0–100 (%) of the usual corner radius. */
export const islandRounding: SettingDef<number> = {
	key: "appearance.rounding",
	label: "extras.rounding.label",
	default: 100,
};

export type IdleItem = "clock" | "date" | "weather" | "battery" | "event";
export const IDLE_ITEMS: IdleItem[] = ["clock", "date", "weather", "battery", "event"];
export const idleItems: SettingDef<IdleItem[]> = {
	key: "appearance.idleItems",
	label: "extras.idle.label",
	default: ["clock"],
};

/** Mirrors `Desktop` in `src-tauri/src/providers/tools/desktop.rs`. */
export interface DesktopState {
	browser: boolean;
	battery: number | null;
	charging: boolean;
}
export const DESKTOP_ID = "desktop";
export const useDesktop = () => useProvider<DesktopState>(DESKTOP_ID);

/** Focus mode quiets peeks from everything but these modules. */
export const focusQuiet = createStore(false);
export const QUIET_ALLOWED = new Set(["timer", "controls", "update"]);

/** Current temperature in the weather module's unit, for the resting pill. */
export const currentTemperature = createStore<number | null>(null);

/** `#rrggbb` + opacity → a CSS color. */
export function islandFill(hex: string, opacity: number) {
	const n = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
	if (Number.isNaN(n)) return "#000";
	const a = Math.min(100, Math.max(40, opacity)) / 100;
	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function useExtras() {
	return {
		mini: useSetting(extraSettings.mini),
		miniInBrowser: useSetting(extraSettings.miniInBrowser),
		delay: useSetting(openDelay),
		size: useSetting(islandSize),
		color: useSetting(islandColor),
		opacity: useSetting(islandOpacity),
		rounding: useSetting(islandRounding),
		idle: useSetting(idleItems),
	};
}
