import { CloudRainIcon, CloudSunIcon, XIcon } from "lucide-react";
/**
 * Weather: current conditions for a chosen place and the next twelve hours,
 * from Open-Meteo. It never takes over the compact island; an optional side
 * bubble shows the temperature.
 */
import { useEffect } from "react";
import { currentTemperature } from "../../core/extras";
import { useT } from "../../core/i18n";
import { moduleEnabled, type SettingDef, setSetting, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { useNow } from "../ai-agents/common/format";
import { SkyIcon, skyColor, skyOf } from "./codes";
import { WeatherBubble } from "./components/WeatherBubble";
import { WeatherPanel } from "./components/WeatherPanel";
import { WeatherSettings } from "./components/WeatherSettings";
import { WEATHER_ACCENT, weatherPlace, weatherSettings, weatherUnit } from "./settings";
import { rainAhead, useWeather } from "./useWeather";

/** The rain warning stays in the collapsed island this long, then goes by itself. */
const SHOW_FOR = 10 * 60_000;
/** After a warning (shown or hidden by hand), the next one waits this long. */
const COOLDOWN = 3 * 3_600_000;
/** When the current rain warning started (ms); also written when it's hidden by hand. */
const rainShownAt: SettingDef<number> = { key: "weather.rainShownAt", label: "weather.rainAlert.label", default: 0 };

/** Hides the rain warning now (and for the next few hours). */
const hideRain = () => setSetting(rainShownAt, Date.now() - SHOW_FOR);

/** Over the weather panel while a rain warning shows: when, and a way to hide it. */
function RainBar({ minutes }: { minutes: number }) {
	const t = useT();
	return (
		<div className="mx-1 mb-1.5 flex h-7 items-center gap-2 rounded-[10px] bg-[rgba(90,200,250,0.12)] px-2.5 text-[12.5px] font-[650]">
			<CloudRainIcon size={14} color={WEATHER_ACCENT} />
			<span className="flex-1 truncate">
				{t("weather.rainSoon")} · {t("weather.rainIn", { m: minutes })}
			</span>
			<button
				type="button"
				className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold text-text-dim hover:bg-white/10 hover:text-text"
				onClick={(e) => {
					e.stopPropagation();
					hideRain();
				}}
			>
				<XIcon size={11} />
				{t("weather.rainHide")}
			</button>
		</div>
	);
}

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
		// Rain within the hour: shown in the collapsed island, with a peek when it first comes up.
		const t = useT();
		const warn = useSetting(weatherSettings.rainAlert);
		const now = useNow(60_000, enabled && warn);
		const coming = enabled && warn && data ? rainAhead(data, now) : null;
		const minutes = coming ? Math.max(1, Math.round(coming.inMs / 60_000)) : 0;
		// Shown for a few minutes once per rain spell, not for the whole hour.
		const shownAt = useSetting(rainShownAt);
		// `now` ticks once a minute; a warning hidden by hand must go at once.
		const at = Math.max(now, Date.now());
		const fresh = !!coming && at - shownAt > COOLDOWN;
		useEffect(() => {
			if (fresh) setSetting(rainShownAt, Date.now());
		}, [fresh]);
		const rain = coming && at - shownAt < SHOW_FOR ? coming : null;

		return {
			active: !!rain,
			priority: 5,
			compact: rain
				? {
						left: (
							<span className="flex items-center gap-2 text-[13px] font-[650]">
								<CloudRainIcon size={15} color={WEATHER_ACCENT} />
								{t("weather.rainSoon")}
							</span>
						),
						right: (
							<span className="text-[13px] font-bold tabular-nums" style={{ color: WEATHER_ACCENT }}>
								{t("weather.rainIn", { m: minutes })}
							</span>
						),
						width: 260,
					}
				: undefined,
			activityKey: rain ? `rain:${shownAt}` : undefined,
			menu: rain ? [{ label: t("weather.rainHide"), onSelect: hideRain }] : undefined,
			accent: WEATHER_ACCENT,
			icon:
				data && sky ? (
					<SkyIcon sky={sky} day={data.day} size={15} color={skyColor(sky, data.day)} />
				) : (
					<CloudSunIcon size={15} color={WEATHER_ACCENT} />
				),
			ambient: showBubble && data ? <WeatherBubble data={data} /> : undefined,
			expanded: (
				<div className="flex h-full flex-col">
					{rain && <RainBar minutes={minutes} />}
					<div className="min-h-0 flex-1">
						<WeatherPanel state={state} place={place} />
					</div>
				</div>
			),
			expandedSize: { width: 560, height: rain ? 224 : 190 },
		};
	},
};
