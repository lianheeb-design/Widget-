import { ChevronDownIcon, MapPinIcon, SunriseIcon, SunsetIcon, WindIcon } from "lucide-react";
import { useState } from "react";
import { Empty } from "../../../components/ui/text";
import { useLocale, useT } from "../../../core/i18n";
import { IslandPlacePicker } from "../../picker";
import { SkyIcon, skyColor, skyGradient, skyLabel, skyOf } from "../codes";
import { useWeatherPicker } from "../place";
import type { WeatherPlace } from "../settings";
import type { WeatherData, WeatherHour, WeatherState } from "../useWeather";

const round = (n: number) => Math.round(n);

export function WeatherPanel({ state, place }: { state: WeatherState; place: WeatherPlace | null }) {
	const t = useT();
	const [picking, setPicking] = useState(false);
	if (picking || !place) return <PlaceChooser onDone={place ? () => setPicking(false) : undefined} />;
	const change = () => setPicking(true);
	if (!state.data)
		return (
			<Empty>
				<span className="flex flex-col items-center gap-2">
					{state.error ? t("weather.offline") : t("weather.loading")}
					<PlaceButton place={place} onClick={change} />
				</span>
			</Empty>
		);
	return <Forecast data={state.data} place={place} stale={state.error} onChangePlace={change} />;
}

/** Search for another place right in the island. */
function PlaceChooser({ onDone }: { onDone?: () => void }) {
	const { choose, ...picker } = useWeatherPicker();
	return (
		<IslandPlacePicker
			{...picker}
			owner="weather.place"
			className="h-full px-1 py-0.5"
			onPick={(place) => {
				choose(place);
				onDone?.();
			}}
			onCancel={onDone}
		/>
	);
}

function PlaceButton({ place, onClick, light }: { place: WeatherPlace; onClick: () => void; light?: boolean }) {
	const t = useT();
	return (
		<button
			type="button"
			title={t("weather.place.change")}
			className={
				light
					? "-mx-1.5 flex min-w-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] font-[650] text-white/85 transition-[background] hover:bg-white/15 hover:text-white"
					: "flex min-w-0 items-center gap-1 rounded-full bg-white/8 px-2.5 py-1 text-[12px] font-[650] text-text-dim hover:bg-white/12 hover:text-text"
			}
			onClick={(e) => {
				e.stopPropagation();
				onClick();
			}}
		>
			<MapPinIcon size={12} className="flex-none" />
			<span className="truncate">{place.name}</span>
			<ChevronDownIcon size={12} className="flex-none opacity-70" />
		</button>
	);
}

function Forecast({
	data,
	place,
	stale,
	onChangePlace,
}: {
	data: WeatherData;
	place: WeatherPlace;
	stale: boolean;
	onChangePlace: () => void;
}) {
	const t = useT();
	const locale = useLocale();
	const sky = skyOf(data.code);
	const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });

	return (
		<div className="flex h-full gap-3 p-1.5" onClick={(e) => e.stopPropagation()}>
			{/* Current conditions on their own patch of sky. */}
			<section
				className="relative flex w-48 flex-none flex-col justify-between overflow-hidden rounded-[20px] p-3.5 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
				style={{ background: skyGradient(sky, data.day) }}
			>
				<span className="flex min-w-0">
					<PlaceButton place={place} onClick={onChangePlace} light />
				</span>
				<div className="flex items-end justify-between gap-2">
					<strong className="text-[46px]/[0.95] font-[300] tracking-[-0.03em] tabular-nums">
						{round(data.temperature)}°
					</strong>
					<SkyIcon sky={sky} day={data.day} size={34} color="#ffffff" />
				</div>
				<div className="flex flex-col gap-0.5">
					<span className="truncate text-[13px] font-[650]">{t(skyLabel(sky))}</span>
					<span className="truncate text-[11.5px] text-white/75 tabular-nums">
						↑ {round(data.high)}° ↓ {round(data.low)}° · {t("weather.feels", { n: round(data.feels) })}
					</span>
				</div>
			</section>

			<section className="flex min-w-0 flex-1 flex-col justify-between py-1.5 pr-1">
				<HourStrip hours={data.hours} />
				<footer className="flex items-center gap-3.5 text-[11.5px] text-text-dim tabular-nums">
					{data.sunrise && (
						<span className="flex items-center gap-1">
							<SunriseIcon size={13} color="#FFB340" />
							{time.format(data.sunrise)}
						</span>
					)}
					{data.sunset && (
						<span className="flex items-center gap-1">
							<SunsetIcon size={13} color="#FF7A59" />
							{time.format(data.sunset)}
						</span>
					)}
					<span className="flex items-center gap-1">
						<WindIcon size={13} />
						{t("weather.wind", { n: round(data.wind), unit: data.windUnit })}
					</span>
					{stale && <span className="ml-auto text-warn">{t("weather.offline")}</span>}
				</footer>
			</section>
		</div>
	);
}

/** Time, icon and temperature per column, joined by a temperature line. */
function HourStrip({ hours }: { hours: WeatherHour[] }) {
	const t = useT();
	const locale = useLocale();
	const hour = new Intl.DateTimeFormat(locale, { hour: "2-digit" });
	const temps = hours.map((h) => h.temperature);
	const min = Math.min(...temps);
	const span = Math.max(1, Math.max(...temps) - min);
	// 0–100 wide, 4–24 tall: columns are equal, so x is each column's center.
	const points = hours.map((h, i) => [((i + 0.5) / hours.length) * 100, 24 - ((h.temperature - min) / span) * 20]);
	const path = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");

	return (
		<div className="flex flex-col">
			<div className="grid" style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}>
				{hours.map((h, i) => {
					const sky = skyOf(h.code);
					return (
						<div key={h.time.getTime()} className="flex flex-col items-center gap-1.5">
							<span className="text-[11px] font-[650] text-text-faint">
								{i === 0 ? t("weather.now") : hour.format(h.time)}
							</span>
							<SkyIcon sky={sky} day={h.day} size={19} color={skyColor(sky, h.day)} />
							<span className="text-[13px] font-[650] tabular-nums">{round(h.temperature)}°</span>
						</div>
					);
				})}
			</div>
			<svg viewBox="0 0 100 28" preserveAspectRatio="none" className="mt-0.5 h-6 w-full" aria-hidden="true">
				<defs>
					{/* Warm at the top of the range, cold at the bottom. */}
					<linearGradient id="weather-line" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="4" y2="24">
						<stop offset="0" stopColor="#FFB340" />
						<stop offset="1" stopColor="#5AC8FA" />
					</linearGradient>
				</defs>
				<path
					d={path}
					fill="none"
					stroke="url(#weather-line)"
					strokeWidth="2"
					strokeLinecap="round"
					vectorEffect="non-scaling-stroke"
				/>
			</svg>
			<div className="grid" style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}>
				{hours.map((h) => (
					<span
						key={h.time.getTime()}
						className="text-center text-[10.5px] font-[650] tabular-nums text-[#64D2FF]"
						style={{ visibility: h.rain >= 10 ? "visible" : "hidden" }}
					>
						{h.rain}%
					</span>
				))}
			</div>
		</div>
	);
}
