/** Choosing the forecast's place: search, recent places, and saving the choice. */
import { useCallback, useMemo } from "react";
import { useLocale, useT } from "../../core/i18n";
import { setSetting, useSetting } from "../../core/settings";
import { type PickerItem, remember } from "../picker";
import { sameWeatherPlace, WEATHER_ACCENT, type WeatherPlace, weatherPlace, weatherRecent } from "./settings";
import { placeDetail, searchPlaces } from "./useWeather";

const itemOf = (place: WeatherPlace): PickerItem<WeatherPlace> => ({
	key: `${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`,
	title: place.name,
	subtitle: placeDetail(place) || undefined,
	value: place,
});

export function useWeatherPicker() {
	const t = useT();
	const locale = useLocale();
	const current = useSetting(weatherPlace);
	const recentList = useSetting(weatherRecent);

	const search = useCallback(async (query: string) => (await searchPlaces(query, locale)).map(itemOf), [locale]);
	const recent = useMemo(
		() => recentList.filter((p) => !current || !sameWeatherPlace(p, current)).map(itemOf),
		[recentList, current],
	);
	const choose = useCallback(
		(place: WeatherPlace) => {
			setSetting(weatherPlace, place);
			setSetting(
				weatherRecent,
				remember(current ? remember(recentList, current, sameWeatherPlace) : recentList, place, sameWeatherPlace),
			);
		},
		[current, recentList],
	);

	return {
		search,
		recent,
		choose,
		placeholder: t("weather.place.placeholder"),
		notFound: t("weather.place.notFound"),
		failed: t("weather.place.failed"),
		accent: WEATHER_ACCENT,
	};
}
