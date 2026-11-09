/**
 * Extra look-and-feel settings of this fork: a mini island at rest and while
 * a browser is active (so it doesn't cover the browser's tabs), a delay
 * before hover opens it, its size, color and corners, and what the resting
 * pill shows.
 */
import { useEffect, useState } from "react";
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
export const QUIET_ALLOWED = new Set(["timer", "controls", "update", "transit"]);

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

// ---------------------------------------------------------------- look 2.0

/** Second color of a top-to-bottom gradient fill; `null`: one color. */
export const islandGradient: SettingDef<string | null> = {
	key: "appearance.gradient",
	label: "extras.gradient.label",
	default: null,
};

/** A soft glow around the island: off, in a chosen color, or in the open module's color. */
export type HaloMode = "off" | "color" | "module";
export const islandHalo: SettingDef<HaloMode> = { key: "appearance.halo", label: "extras.halo.label", default: "off" };
export const islandHaloColor: SettingDef<string> = {
	key: "appearance.haloColor",
	label: "extras.halo.label",
	default: "#5E5CE6",
};

/** How the island moves when it opens, closes and resizes. */
export type MotionStyle = "standard" | "bouncy" | "smooth" | "fast" | "off";
export const MOTION_STYLES: MotionStyle[] = ["standard", "bouncy", "smooth", "fast", "off"];
export const islandMotion: SettingDef<MotionStyle> = {
	key: "appearance.motion",
	label: "extras.motion.label",
	default: "standard",
};

/** The little extras, each with its own switch. */
export const effectSettings = {
	pulse: {
		key: "effects.pulse",
		label: "extras.effects.pulse.label",
		description: "extras.effects.pulse.desc",
		default: true,
	},
	sheen: {
		key: "effects.sheen",
		label: "extras.effects.sheen.label",
		description: "extras.effects.sheen.desc",
		default: true,
	},
	rolling: {
		key: "effects.rolling",
		label: "extras.effects.rolling.label",
		description: "extras.effects.rolling.desc",
		default: true,
	},
	confetti: {
		key: "effects.confetti",
		label: "extras.effects.confetti.label",
		description: "extras.effects.confetti.desc",
		default: true,
	},
	breathe: {
		key: "effects.breathe",
		label: "extras.effects.breathe.label",
		description: "extras.effects.breathe.desc",
		default: false,
	},
} satisfies Record<string, SettingDef>;

export interface Theme {
	id: string;
	color: string;
	gradient: string | null;
	opacity: number;
	halo: HaloMode;
	haloColor: string;
	/** A rim preset of `core/appearance.ts` (Windows Island style). */
	border: string;
}

/** One click sets color, gradient, glow and rim together. */
export const THEMES: Theme[] = [
	{ id: "classic", color: "#000000", gradient: null, opacity: 100, halo: "off", haloColor: "#5E5CE6", border: "none" },
	{
		id: "midnight",
		color: "#0B1026",
		gradient: "#000000",
		opacity: 100,
		halo: "color",
		haloColor: "#5E5CE6",
		border: "aurora",
	},
	{
		id: "neon",
		color: "#14001F",
		gradient: "#000000",
		opacity: 100,
		halo: "color",
		haloColor: "#FF00CC",
		border: "neon",
	},
	{
		id: "sunset",
		color: "#2A0E12",
		gradient: "#120408",
		opacity: 100,
		halo: "color",
		haloColor: "#FF7A59",
		border: "sunset",
	},
	{
		id: "glacier",
		color: "#0A1C2B",
		gradient: "#020A12",
		opacity: 96,
		halo: "color",
		haloColor: "#7FDBFF",
		border: "glacier",
	},
	{
		id: "forest",
		color: "#06201A",
		gradient: "#010A08",
		opacity: 100,
		halo: "color",
		haloColor: "#3DDC84",
		border: "forest",
	},
	{ id: "glass", color: "#1C1C24", gradient: null, opacity: 72, halo: "module", haloColor: "#FFFFFF", border: "mono" },
];

/** The visitor asked Windows for less motion ("Animation effects" off). */
export function useReducedMotion() {
	const query = "(prefers-reduced-motion: reduce)";
	const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches ?? false);
	useEffect(() => {
		const media = window.matchMedia?.(query);
		if (!media) return;
		const update = () => setReduced(media.matches);
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);
	return reduced;
}

/** Motion style and effects, with Windows' "less motion" switching the lively ones off. */
export function useLook() {
	const reduced = useReducedMotion();
	const motion = useSetting(islandMotion);
	const gradient = useSetting(islandGradient);
	const halo = useSetting(islandHalo);
	const haloColor = useSetting(islandHaloColor);
	const pulse = useSetting(effectSettings.pulse);
	const sheen = useSetting(effectSettings.sheen);
	const rolling = useSetting(effectSettings.rolling);
	const confetti = useSetting(effectSettings.confetti);
	const breathe = useSetting(effectSettings.breathe);
	return {
		motion: reduced ? ("off" as MotionStyle) : motion,
		gradient,
		halo,
		haloColor,
		pulse: pulse && !reduced,
		sheen: sheen && !reduced,
		rolling: rolling && !reduced,
		confetti: confetti && !reduced,
		breathe: breathe && !reduced,
	};
}
