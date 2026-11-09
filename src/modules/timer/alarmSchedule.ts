/**
 * When alarms ring. Pure functions on local wall-clock time, so a missed
 * check (the PC was busy, the WebView throttled) still rings a little late
 * instead of never.
 */

export interface Alarm {
	id: string;
	/** `HH:MM`, local. */
	time: string;
	label: string;
	/** Weekdays it repeats on (0 = Sunday … 6 = Saturday); empty rings once. */
	days: number[];
	enabled: boolean;
}

/** A ring that was missed by up to this long still goes off. */
export const GRACE = 30 * 60_000;
const DAY_MS = 86_400_000;

function parse(time: string): [number, number] {
	const [h, m] = time.split(":").map(Number);
	return [Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0];
}

/** `alarm` on the day `back` days before `now` (negative: after), or null on a day it doesn't ring. */
function onDay(alarm: Alarm, now: number, offset: number): number | null {
	const [h, m] = parse(alarm.time);
	const day = new Date(now);
	day.setDate(day.getDate() + offset);
	day.setHours(h, m, 0, 0);
	if (alarm.days.length && !alarm.days.includes(day.getDay())) return null;
	return day.getTime();
}

/** The latest time at or before `now` the alarm was set to ring. */
export function lastOccurrence(alarm: Alarm, now: number): number | null {
	for (let offset = 0; offset >= -7; offset--) {
		const at = onDay(alarm, now, offset);
		if (at !== null && at <= now) return at;
	}
	return null;
}

/** The next time after `now` the alarm rings. */
export function nextOccurrence(alarm: Alarm, now: number): number | null {
	for (let offset = 0; offset <= 7; offset++) {
		const at = onDay(alarm, now, offset);
		if (at !== null && at > now) return at;
	}
	return null;
}

export interface Ring {
	id: string;
	/** When it was set to ring (the snooze end for a snoozed one). */
	at: number;
}

/**
 * The alarm that should ring now: a snooze that ran out, or an enabled alarm
 * whose time passed less than `GRACE` ago and wasn't handled since.
 */
export function dueRing(
	alarms: Alarm[],
	handled: Record<string, number>,
	snooze: Ring | null,
	now: number,
): Ring | undefined {
	if (snooze && now >= snooze.at && alarms.some((a) => a.id === snooze.id)) return snooze;
	for (const alarm of alarms) {
		if (!alarm.enabled) continue;
		const at = lastOccurrence(alarm, now);
		if (at === null || now - at >= GRACE) continue;
		if (at > (handled[alarm.id] ?? 0)) return { id: alarm.id, at };
	}
	return undefined;
}

/** The next enabled alarm to ring. */
export function nextRing(alarms: Alarm[], now: number): (Ring & { alarm: Alarm }) | undefined {
	let best: (Ring & { alarm: Alarm }) | undefined;
	for (const alarm of alarms) {
		if (!alarm.enabled) continue;
		const at = nextOccurrence(alarm, now);
		if (at !== null && (!best || at < best.at)) best = { id: alarm.id, at, alarm };
	}
	return best;
}

/** "in 7 h 05 min" parts. */
export function untilParts(at: number, now: number) {
	const exact = Math.max(0, (at - now) / 60_000);
	// Rounded up under an hour ("in 1 min" with seconds left), down above it (never "1 d 0 h" for 23:59).
	const minutes = exact < 60 ? Math.ceil(exact) : Math.floor(exact);
	return { days: Math.floor(minutes / (DAY_MS / 60_000)), hours: Math.floor(minutes / 60) % 24, minutes: minutes % 60 };
}

/** Monday first, as on Swiss and German calendars. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0];
