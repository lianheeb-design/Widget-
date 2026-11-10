/**
 * Routines: small "when this, then that" rules from ready-made templates,
 * run by the island window while it's open.
 *
 * - Profiles switch themselves on in their time window (and off after it).
 * - Way to school/work: on chosen days at a set time, the next connection of
 *   a route is followed live.
 * - Calmer evenings: in a time window the island dims and doesn't peek.
 */
import { useEffect, useRef } from "react";
import {
	calm,
	inSchedule,
	PROFILE_IDS,
	type ProfileId,
	profileActive,
	profileQuiet,
	profileSchedule,
} from "../../core/profiles";
import { readSetting, type SettingDef, setSetting, today, useSettings } from "../../core/settings";
import { useNow } from "../ai-agents/common/format";
import { type Station, transit } from "../transit/common";
import { type ApiConnection, liveTrip, startLive, tripOf } from "../transit/live";

export interface CommuteRoutine {
	on: boolean;
	/** 0 = Sunday … 6 = Saturday. */
	days: number[];
	/** "HH:MM". */
	time: string;
	route: { from: Station; to: Station } | null;
}

export const routineCommute: SettingDef<CommuteRoutine> = {
	key: "routines.commute",
	label: "routines.commute.label",
	default: { on: false, days: [1, 2, 3, 4, 5], time: "07:00", route: null },
};
const commuteDone: SettingDef<number> = { key: "routines.commute.done", label: "routines.commute.label", default: 0 };

export interface EveningRoutine {
	on: boolean;
	from: string;
	to: string;
}

export const routineEvening: SettingDef<EveningRoutine> = {
	key: "routines.evening",
	label: "routines.evening.label",
	default: { on: false, from: "21:00", to: "06:30" },
};

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
/** A commute routine still starts this long after its time (the PC was just switched on). */
const COMMUTE_GRACE_MIN = 20;

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toMinutes = (s: string) => {
	const [h, m] = s.split(":").map(Number);
	return (h || 0) * 60 + (m || 0);
};

/** Runs the routines; returns whether the island should look dimmed (calm evening). */
export function useRoutines(): { dim: boolean } {
	const values = useSettings();
	const now = useNow(20_000);
	const date = new Date(now);

	// Profiles in their time window.
	const schedule = readSetting(values, profileSchedule);
	const scheduled = PROFILE_IDS.find((id) => schedule[id] && inSchedule(schedule[id], date)) ?? null;
	const lastScheduled = useRef<ProfileId | null | undefined>(undefined);
	useEffect(() => {
		const first = lastScheduled.current === undefined;
		if (!first && scheduled === lastScheduled.current) return;
		lastScheduled.current = scheduled;
		// At the start only switch on (keep a profile picked by hand); afterwards follow each window's start and end.
		if (!first || scheduled !== null) setSetting(profileActive, scheduled);
	}, [scheduled]);

	// Calm: a quiet profile, or the evening routine.
	const evening = readSetting(values, routineEvening);
	const calmEvening = evening.on && inSchedule({ days: EVERY_DAY, from: evening.from, to: evening.to }, date);
	const active = readSetting(values, profileActive);
	const quiet = (active !== null && readSetting(values, profileQuiet).includes(active)) || calmEvening;
	useEffect(() => calm.set(quiet), [quiet]);

	// The way to school or work, followed live.
	const commute = readSetting(values, routineCommute);
	const since = date.getHours() * 60 + date.getMinutes() - toMinutes(commute.time);
	const due =
		commute.on &&
		!!commute.route &&
		commute.days.includes(date.getDay()) &&
		since >= 0 &&
		since < COMMUTE_GRACE_MIN &&
		readSetting(values, commuteDone) !== today() &&
		!readSetting(values, liveTrip);
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when it becomes due, with the route of that moment
	useEffect(() => {
		const route = commute.route;
		if (!due || !route) return;
		let timer = 0;
		let cancelled = false;
		// Offline right then (the PC just woke up): try again each minute while it's still due.
		const attempt = () => {
			const at = new Date();
			transit<{ connections?: ApiConnection[] }>("connections", {
				from: route.from.id,
				to: route.to.id,
				date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
				time: hhmm(at),
				limit: 1,
			})
				.then((r) => {
					const next = r?.connections?.[0];
					if (cancelled || !next) return;
					setSetting(commuteDone, today());
					startLive(tripOf(next, route.from, route.to));
				})
				.catch(() => {
					if (!cancelled) timer = window.setTimeout(attempt, 60_000);
				});
		};
		attempt();
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [due]);

	return { dim: calmEvening };
}
