import type { SettingDef } from "../../core/settings";

/** Switches rendered directly in the module settings page. */
export const timerSettings = {
	sound: {
		key: "timer.sound",
		label: "timer.sound.label",
		description: "timer.sound.desc",
		default: true,
	},
} satisfies Record<string, SettingDef>;

/** Minutes of the last timer started, offered again in the custom field. */
export const timerLastMinutes: SettingDef<number> = {
	key: "timer.lastMinutes",
	label: "timer.custom",
	default: 10,
};

/** Quick picks in the panel. */
export const TIMER_PRESETS = [1, 5, 10, 15, 25, 45];

export const TIMER_ACCENT = "#FFB340";
