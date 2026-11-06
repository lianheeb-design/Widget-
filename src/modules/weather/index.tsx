import { CloudSunIcon } from "lucide-react";
/**
 * Weather: current conditions for a chosen place and the next twelve hours,
 * from Open-Meteo. It never takes over the compact island; an optional side
 * bubble shows the temperature.
 */
import { useEffect } from "react";
import { currentTemperature } from "../../core/extras";
import { moduleEnabled, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { SkyIcon, skyColor, skyOf } from "./codes";
import { WeatherBubble } from "./components/WeatherBubble";
import { WeatherPanel } from "./components/WeatherPanel";
import { WeatherSettings } from "./components/WeatherSettings";
import { WEATHER_ACCENT, weatherPlace, weatherSettings, weatherUnit } from "./settings";
import { useWeather } from "./useWeather";

export const weatherModule: IslandModule = {
	id: "weather",
	title: "weather.title",
	settingsIcon: <CloudSunIcon size={15} />,
	settings: Object.values(weatherSettings),
	SettingsSection: WeatherSettings,
	useView(): ModuleView {
		const enabled = useSetting(moduleEnabled(weatherModule));
		const place = useSetting(weatherPlace);
		const unit = useSetting(weatherUnit);
		const showBubble = useSetting(weatherSettings.showBubble);
		const state = useWeather(place, unit, enabled);
		const data = state.data;
		const temperature = data?.temperature ?? null;
		useEffect(() => currentTemperature.set(temperature), [temperature]);
		const sky = data ? skyOf(data.code) : null;

		return {
			active: false,
			priority: 0,
			accent: WEATHER_ACCENT,
			icon:
				data && sky ? (
					<SkyIcon sky={sky} day={data.day} size={15} color={skyColor(sky, data.day)} />
				) : (
					<CloudSunIcon size={15} color={WEATHER_ACCENT} />
				),
			ambient: showBubble && data ? <WeatherBubble data={data} /> : undefined,
			expanded: <WeatherPanel state={state} place={place} />,
			expandedSize: { width: 560, height: 190 },
		};
	},
};
