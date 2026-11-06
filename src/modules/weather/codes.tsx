import {
	CloudDrizzleIcon,
	CloudFogIcon,
	CloudIcon,
	CloudLightningIcon,
	CloudMoonIcon,
	CloudRainIcon,
	CloudSnowIcon,
	CloudSunIcon,
	CloudSunRainIcon,
	MoonIcon,
	SunIcon,
} from "lucide-react";
import type { MessageKey } from "../../core/i18n";

/** Groups of WMO weather codes, as Open-Meteo reports them. */
export type Sky =
	| "clear"
	| "mainlyClear"
	| "partlyCloudy"
	| "overcast"
	| "fog"
	| "drizzle"
	| "rain"
	| "showers"
	| "snow"
	| "snowShowers"
	| "thunder";

export function skyOf(code: number): Sky {
	if (code === 0) return "clear";
	if (code === 1) return "mainlyClear";
	if (code === 2) return "partlyCloudy";
	if (code === 3) return "overcast";
	if (code === 45 || code === 48) return "fog";
	if (code >= 51 && code <= 57) return "drizzle";
	if (code >= 61 && code <= 67) return "rain";
	if (code >= 71 && code <= 77) return "snow";
	if (code >= 80 && code <= 82) return "showers";
	if (code === 85 || code === 86) return "snowShowers";
	if (code >= 95) return "thunder";
	return "overcast";
}

export const skyLabel = (sky: Sky): MessageKey => `weather.code.${sky}`;

export function SkyIcon({ sky, day, size, color }: { sky: Sky; day: boolean; size: number; color?: string }) {
	const props = { size, color, strokeWidth: 1.9 };
	switch (sky) {
		case "clear":
			return day ? <SunIcon {...props} /> : <MoonIcon {...props} />;
		case "mainlyClear":
		case "partlyCloudy":
			return day ? <CloudSunIcon {...props} /> : <CloudMoonIcon {...props} />;
		case "fog":
			return <CloudFogIcon {...props} />;
		case "drizzle":
			return <CloudDrizzleIcon {...props} />;
		case "rain":
			return <CloudRainIcon {...props} />;
		case "showers":
			return day ? <CloudSunRainIcon {...props} /> : <CloudRainIcon {...props} />;
		case "snow":
		case "snowShowers":
			return <CloudSnowIcon {...props} />;
		case "thunder":
			return <CloudLightningIcon {...props} />;
		default:
			return <CloudIcon {...props} />;
	}
}

/** Icon tint that reads on black. */
export function skyColor(sky: Sky, day: boolean): string {
	if (sky === "clear" || sky === "mainlyClear") return day ? "#FFD60A" : "#C9D4FF";
	if (sky === "thunder") return "#FFD60A";
	if (sky === "snow" || sky === "snowShowers") return "#E8F6FF";
	if (sky === "rain" || sky === "showers" || sky === "drizzle") return "#7CC4FF";
	return "#C7CDD6";
}

/**
 * The sky behind the current conditions: a vertical wash that changes with
 * the weather and with day or night. It's the one splash of color in the panel.
 */
export function skyGradient(sky: Sky, day: boolean): string {
	if (!day) {
		if (sky === "clear" || sky === "mainlyClear")
			return "linear-gradient(165deg, #1B2A6B 0%, #2E2160 55%, #120F2B 100%)";
		return "linear-gradient(165deg, #232B3D 0%, #171C28 100%)";
	}
	switch (sky) {
		case "clear":
		case "mainlyClear":
			return "linear-gradient(165deg, #2F86FF 0%, #4FA9FF 50%, #8AC9FF 100%)";
		case "partlyCloudy":
			return "linear-gradient(165deg, #3C7BD8 0%, #6E9CCF 60%, #A7BDD6 100%)";
		case "fog":
			return "linear-gradient(165deg, #6F7C8C 0%, #96A1AD 100%)";
		case "snow":
		case "snowShowers":
			return "linear-gradient(165deg, #7E9BB8 0%, #B9CCDD 100%)";
		case "thunder":
			return "linear-gradient(165deg, #2B2F45 0%, #4A4A63 100%)";
		case "rain":
		case "showers":
		case "drizzle":
			return "linear-gradient(165deg, #3D5770 0%, #5D7891 100%)";
		default:
			return "linear-gradient(165deg, #56677D 0%, #7F8EA1 100%)";
	}
}
