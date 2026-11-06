/**
 * Forecast from Open-Meteo (free, no key, no account), fetched straight from
 * the island's WebView every 15 minutes while the module is on. Only the
 * place's coordinates leave the computer.
 */
import { useEffect, useState } from "react";
import type { WeatherPlace, WeatherUnit } from "./settings";

const REFRESH = 15 * 60_000;
const RETRY = 3 * 60_000;
/** Hours between two columns of the strip, and how many columns. */
export const HOUR_STEP = 2;
export const HOUR_COLUMNS = 6;

export interface WeatherHour {
	time: Date;
	temperature: number;
	code: number;
	day: boolean;
	rain: number;
}

export interface WeatherData {
	temperature: number;
	feels: number;
	code: number;
	day: boolean;
	wind: number;
	windUnit: string;
	high: number;
	low: number;
	sunrise: Date | null;
	sunset: Date | null;
	hours: WeatherHour[];
	fetchedAt: number;
}

export interface WeatherState {
	data: WeatherData | null;
	error: boolean;
}

interface Forecast {
	current: {
		time: string;
		temperature_2m: number;
		apparent_temperature: number;
		weather_code: number;
		is_day: number;
		wind_speed_10m: number;
	};
	current_units?: { wind_speed_10m?: string };
	hourly: {
		time: string[];
		temperature_2m: number[];
		weather_code: number[];
		is_day: number[];
		precipitation_probability: (number | null)[];
	};
	daily: {
		temperature_2m_max: number[];
		temperature_2m_min: number[];
		sunrise: string[];
		sunset: string[];
	};
}

export function forecastUrl(place: WeatherPlace, unit: WeatherUnit) {
	const params = new URLSearchParams({
		latitude: String(place.latitude),
		longitude: String(place.longitude),
		current: "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m",
		hourly: "temperature_2m,weather_code,is_day,precipitation_probability",
		daily: "temperature_2m_max,temperature_2m_min,sunrise,sunset",
		timezone: "auto",
		forecast_days: "2",
		temperature_unit: unit,
		wind_speed_unit: unit === "fahrenheit" ? "mph" : "kmh",
	});
	return `https://api.open-meteo.com/v1/forecast?${params}`;
}

/** Open-Meteo times are local to the place, without an offset: read them as wall-clock times. */
const localDate = (iso: string) => new Date(iso);

export function parseForecast(f: Forecast): WeatherData {
	const hourKey = f.current.time.slice(0, 13);
	const first = Math.max(
		0,
		f.hourly.time.findIndex((t) => t.startsWith(hourKey)),
	);
	const hours: WeatherHour[] = [];
	for (let i = 0; i < HOUR_COLUMNS; i++) {
		const at = first + i * HOUR_STEP;
		if (at >= f.hourly.time.length) break;
		hours.push({
			time: localDate(f.hourly.time[at]),
			// The first column is "now": use the current reading, not the hour's.
			temperature: i === 0 ? f.current.temperature_2m : f.hourly.temperature_2m[at],
			code: i === 0 ? f.current.weather_code : f.hourly.weather_code[at],
			day: (i === 0 ? f.current.is_day : f.hourly.is_day[at]) === 1,
			rain: f.hourly.precipitation_probability[at] ?? 0,
		});
	}
	return {
		temperature: f.current.temperature_2m,
		feels: f.current.apparent_temperature,
		code: f.current.weather_code,
		day: f.current.is_day === 1,
		wind: f.current.wind_speed_10m,
		windUnit: f.current_units?.wind_speed_10m === "mp/h" ? "mph" : (f.current_units?.wind_speed_10m ?? "km/h"),
		high: f.daily.temperature_2m_max[0],
		low: f.daily.temperature_2m_min[0],
		sunrise: f.daily.sunrise[0] ? localDate(f.daily.sunrise[0]) : null,
		sunset: f.daily.sunset[0] ? localDate(f.daily.sunset[0]) : null,
		hours,
		fetchedAt: Date.now(),
	};
}

/** Last forecast per place and unit, so reopening the island shows it at once. */
const cache = new Map<string, WeatherData>();

export function useWeather(place: WeatherPlace | null, unit: WeatherUnit, enabled: boolean): WeatherState {
	const key = place ? `${place.latitude},${place.longitude},${unit}` : "";
	const [state, setState] = useState<WeatherState>(() => ({ data: cache.get(key) ?? null, error: false }));

	// The settings map is rebuilt on every change, so `place` is a new object each time; `key` is its stable identity.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` already covers place and unit
	useEffect(() => {
		setState({ data: cache.get(key) ?? null, error: false });
		if (!enabled || !place) return;
		let cancelled = false;
		let timer = 0;
		const load = async () => {
			let next = REFRESH;
			try {
				const res = await fetch(forecastUrl(place, unit));
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = parseForecast((await res.json()) as Forecast);
				cache.set(key, data);
				if (!cancelled) setState({ data, error: false });
			} catch {
				next = RETRY;
				if (!cancelled) setState((s) => ({ data: s.data, error: true }));
			}
			if (!cancelled) timer = window.setTimeout(load, next);
		};
		const cached = cache.get(key);
		const wait = cached ? Math.max(0, cached.fetchedAt + REFRESH - Date.now()) : 0;
		timer = window.setTimeout(load, wait);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [key, enabled]);

	return state;
}

/** First match of a place search, in the UI language. */
export async function searchPlace(name: string, language: string): Promise<WeatherPlace | null> {
	const params = new URLSearchParams({ name, count: "1", language: language.split("-")[0], format: "json" });
	const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body = (await res.json()) as {
		results?: { name: string; country?: string; latitude: number; longitude: number }[];
	};
	const hit = body.results?.[0];
	return hit ? { name: hit.name, country: hit.country, latitude: hit.latitude, longitude: hit.longitude } : null;
}
