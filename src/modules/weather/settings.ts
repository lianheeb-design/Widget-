import type { SettingDef } from "../../core/settings";

export interface WeatherPlace {
	name: string;
	country?: string;
	/** Canton, state or region, to tell places of the same name apart. */
	region?: string;
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

/** Places chosen before, newest first, offered for a quick switch. */
export const weatherRecent: SettingDef<WeatherPlace[]> = {
	key: "weather.recent",
	label: "weather.place.label",
	default: [],
};

export const sameWeatherPlace = (a: WeatherPlace, b: WeatherPlace) =>
	Math.abs(a.latitude - b.latitude) < 0.01 && Math.abs(a.longitude - b.longitude) < 0.01;

export const weatherUnit: SettingDef<WeatherUnit> = {
	key: "weather.unit",
	label: "weather.unit.label",
	default: "celsius",
};

export const WEATHER_ACCENT = "#5AC8FA";
