import type { SettingDef } from "../../core/settings";

export interface WeatherPlace {
	name: string;
	country?: string;
	latitude: number;
	longitude: number;
}

export type WeatherUnit = "celsius" | "fahrenheit";

/** Switches rendered directly in the module settings page. */
export const weatherSettings = {
	showBubble: {
		key: "weather.showBubble",
		label: "weather.showBubble.label",
		description: "weather.showBubble.desc",
		default: false,
	},
} satisfies Record<string, SettingDef>;

/** Where the forecast is for. Changed by searching in the settings. */
export const weatherPlace: SettingDef<WeatherPlace | null> = {
	key: "weather.place",
	label: "weather.place.label",
	description: "weather.place.desc",
	default: { name: "St. Gallen", country: "Schweiz", latitude: 47.4239, longitude: 9.3748 },
};

export const weatherUnit: SettingDef<WeatherUnit> = {
	key: "weather.unit",
	label: "weather.unit.label",
	default: "celsius",
};

export const WEATHER_ACCENT = "#5AC8FA";
