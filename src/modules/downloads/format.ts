const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** A file size like Explorer shows it: 1536 → "1.5 KB", 48_000_000 → "46 MB". */
export function formatSize(bytes: number, locale?: string) {
	let value = Math.max(0, bytes);
	let unit = 0;
	while (value >= 1024 && unit < UNITS.length - 1) {
		value /= 1024;
		unit++;
	}
	// One decimal only while it says something (1.5 MB), none for bytes or from 10 up.
	const digits = unit > 0 && value < 9.95 ? 1 : 0;
	const number = value.toLocaleString(locale, {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
		useGrouping: false,
	});
	return `${number} ${UNITS[unit]}`;
}
