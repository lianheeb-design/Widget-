/** `m:ss`, or `h:mm:ss` from one hour on. */
export function clockLabel(ms: number) {
	const seconds = Math.max(0, Math.ceil(ms / 1000));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = String(seconds % 60).padStart(2, "0");
	return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
