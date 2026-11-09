/**
 * Profiles (school, free time, gaming): which modules the island shows, and
 * whether it stays quiet. "All" (no profile) shows everything. A profile can
 * switch itself on at set times (`modules/routines/engine.ts`).
 */
import { createStore } from "./island";
import { readSetting, type SettingDef, type Values } from "./settings";

export type ProfileId = "school" | "free" | "gaming";
export const PROFILE_IDS: ProfileId[] = ["school", "free", "gaming"];
export const PROFILE_EMOJI: Record<ProfileId, string> = { school: "🎒", free: "🏠", gaming: "🎮" };

export interface Schedule {
	/** 0 = Sunday … 6 = Saturday. */
	days: number[];
	/** "HH:MM", local. `to` before `from` runs over midnight. */
	from: string;
	to: string;
}

export const profileActive: SettingDef<ProfileId | null> = {
	key: "profiles.active",
	label: "profiles.title",
	default: null,
};

export const profileModules: SettingDef<Record<ProfileId, string[]>> = {
	key: "profiles.modules",
	label: "profiles.modules",
	default: {
		school: ["timer", "transit", "notes", "weather", "calculator", "translate", "webapps", "clock", "controls"],
		free: ["music", "weather", "transit", "notes", "webapps", "timer", "controls", "shelf", "notifications"],
		gaming: ["music", "controls", "timer"],
	},
};

/** When each profile switches itself on (missing: only by hand). */
export const profileSchedule: SettingDef<Partial<Record<ProfileId, Schedule>>> = {
	key: "profiles.schedule",
	label: "profiles.auto",
	default: {},
};

/** Profiles that keep the island quiet (no peeks but alarms and the like). */
export const profileQuiet: SettingDef<ProfileId[]> = {
	key: "profiles.quiet",
	label: "profiles.quiet",
	default: ["gaming"],
};

/** Calm right now (a quiet profile, the evening routine): peeks wait. */
export const calm = createStore(false);

/** Whether `id` shows under the active profile. */
export function profileAllows(values: Values, id: string) {
	const active = readSetting(values, profileActive);
	if (!active) return true;
	return (readSetting(values, profileModules)[active] ?? []).includes(id);
}

const minutes = (hhmm: string) => {
	const [h, m] = hhmm.split(":").map(Number);
	return (h || 0) * 60 + (m || 0);
};

/** Whether `date` falls inside `s` (over midnight counts for the day it started). */
export function inSchedule(s: Schedule, date: Date) {
	const now = date.getHours() * 60 + date.getMinutes();
	const from = minutes(s.from);
	const to = minutes(s.to);
	if (from === to) return false;
	if (from < to) return s.days.includes(date.getDay()) && now >= from && now < to;
	const yesterday = (date.getDay() + 6) % 7;
	return (s.days.includes(date.getDay()) && now >= from) || (s.days.includes(yesterday) && now < to);
}
