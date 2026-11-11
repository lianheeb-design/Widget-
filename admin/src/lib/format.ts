const LOCALE = "de-CH";

const absolute = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" });
const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

/** "11.11.2026, 14:05" */
export function formatDate(iso: string | null): string {
	return iso ? absolute.format(new Date(iso)) : "–";
}

/** "vor 3 Minuten", "gestern"… */
export function formatAgo(iso: string | null, now = Date.now()): string {
	if (!iso) return "nie";
	const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
	const abs = Math.abs(seconds);
	if (abs < 60) return "gerade eben";
	if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
	if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
	if (abs < 30 * 86_400) return relative.format(Math.round(seconds / 86_400), "day");
	return absolute.format(new Date(iso));
}

/**
 * Checked in recently: the app checks every 10 minutes while it runs, so a
 * quarter of an hour without contact means it's off (or offline).
 */
export function isOnline(iso: string | null, minutes = 15, now = Date.now()): boolean {
	return !!iso && now - new Date(iso).getTime() < minutes * 60_000;
}
