import { MapPinIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Block, Desc, Divider, Row } from "../../../components/ui/card";
import { Input, Segmented } from "../../../components/ui/form";
import { useLocale, useT } from "../../../core/i18n";
import { setSetting, useSetting } from "../../../core/settings";
import { type WeatherUnit, weatherPlace, weatherUnit } from "../settings";
import { searchPlace } from "../useWeather";

/** Place search and unit, beside the module's standard switches. */
export function WeatherSettings() {
	const t = useT();
	const locale = useLocale();
	const place = useSetting(weatherPlace);
	const unit = useSetting(weatherUnit);
	const [input, setInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const search = async (e: FormEvent) => {
		e.preventDefault();
		const name = input.trim();
		if (!name) return;
		setBusy(true);
		setError(null);
		try {
			const hit = await searchPlace(name, locale);
			if (!hit) setError(t("weather.place.notFound"));
			else {
				setSetting(weatherPlace, hit);
				setInput("");
			}
		} catch {
			setError(t("weather.place.failed"));
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<Block>
				<Row label={t("weather.place.label")} desc={t("weather.place.desc")}>
					{place && (
						<span className="flex flex-none items-center gap-1.5 text-[13px] font-[650]">
							<MapPinIcon size={13} color="#5AC8FA" />
							{place.country ? `${place.name}, ${place.country}` : place.name}
						</span>
					)}
				</Row>
				<form className="flex gap-2" onSubmit={search}>
					<Input
						className="flex-1"
						value={input}
						placeholder={t("weather.place.placeholder")}
						spellCheck={false}
						onChange={(e) => {
							setInput(e.target.value);
							setError(null);
						}}
					/>
					<Button type="submit" variant="primary" disabled={busy || !input.trim()}>
						{busy ? t("weather.place.searching") : t("weather.place.search")}
					</Button>
				</form>
				{error && <Desc tone="error">{error}</Desc>}
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
