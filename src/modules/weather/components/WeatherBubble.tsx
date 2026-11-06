import { SkyIcon, skyColor, skyOf } from "../codes";
import type { WeatherData } from "../useWeather";

/** Side bubble: today's sky with the temperature as a badge. */
export function WeatherBubble({ data }: { data: WeatherData }) {
	const sky = skyOf(data.code);
	return (
		<>
			<SkyIcon sky={sky} day={data.day} size={18} color={skyColor(sky, data.day)} />
			<span className="absolute -right-2 -bottom-1 z-3 grid h-4.5 min-w-5 place-items-center rounded-[9px] bg-[#1f6fd1] px-1.25 text-[10.5px] font-[750] text-white tabular-nums shadow-[0_0_0_2px_var(--island)]">
				{Math.round(data.temperature)}°
			</span>
		</>
	);
}
