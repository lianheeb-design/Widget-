import { MapPinIcon } from "lucide-react";
import { Block, Divider, Row } from "../../../components/ui/card";
import { Segmented } from "../../../components/ui/form";
import { useT } from "../../../core/i18n";
import { setSetting, useSetting } from "../../../core/settings";
import { PlacePicker } from "../../picker";
import { useWeatherPicker } from "../place";
import { type WeatherUnit, weatherPlace, weatherUnit } from "../settings";
import { placeDetail } from "../useWeather";

/** Place search and unit, beside the module's standard switches. */
export function WeatherSettings() {
	const t = useT();
	const place = useSetting(weatherPlace);
	const unit = useSetting(weatherUnit);
	const { choose, ...picker } = useWeatherPicker();

	return (
		<>
			<Block>
				<Row label={t("weather.place.label")} desc={t("weather.place.desc")}>
					{place && (
						<span className="flex flex-none items-center gap-1.5 text-[13px] font-[650]">
							<MapPinIcon size={13} color="#5AC8FA" />
							{placeDetail(place) ? `${place.name}, ${placeDetail(place)}` : place.name}
						</span>
					)}
				</Row>
				<PlacePicker {...picker} onPick={choose} className="max-h-64" />
			</Block>
			<Divider />
			<Row label={t("weather.unit.label")}>
				<Segmented<WeatherUnit>
					value={unit}
					options={[
						{ value: "celsius", label: t("weather.unit.celsius") },
						{ value: "fahrenheit", label: t("weather.unit.fahrenheit") },
					]}
					onChange={(value) => setSetting(weatherUnit, value)}
				/>
			</Row>
		</>
	);
}
