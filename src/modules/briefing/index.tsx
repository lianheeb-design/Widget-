import { SunriseIcon } from "lucide-react";
/**
 * Morning briefing: the first time someone is at the computer in the
 * morning, the island opens for a few seconds with the day at a glance —
 * weather, the next train of the usual route, the next alarm and countdown.
 * Then it's gone until tomorrow. Also shown on demand from the settings.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useLocale, useT } from "../../core/i18n";
import { createStore, useIsland } from "../../core/island";
import {
	moduleEnabled,
	readSetting,
	type SettingDef,
	setSetting,
	today,
	useSetting,
	useSettings,
} from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { useNow } from "../ai-agents/common/format";
import { countdownItems } from "../countdown";
import { nextRing } from "../timer/alarmSchedule";
import { tools } from "../tools/bridge";
import { LineBadge, type Station, transit } from "../transit/common";
import { type ApiConnection, startLive, tripOf } from "../transit/live";
import { SkyIcon, skyColor, skyLabel, skyOf } from "../weather/codes";
import { weatherPlace, weatherUnit } from "../weather/settings";
import { rainAhead, useWeather } from "../weather/useWeather";

const ACCENT = "#FFB340";
/** Shown this long (ms). */
const SHOW_MS = 12_000;
/** Mornings only: from 5:00 to 11:00. */
const FROM_HOUR = 5;
const TO_HOUR = 11;
/** Someone touched the keyboard or mouse this recently: they're at the computer. */
const ACTIVE_MS = 60_000;

/** Day it was last shown. */
const shownOn: SettingDef<number> = { key: "briefing.shownOn", label: "briefing.label", default: 0 };
/** Set by the settings' "Show now" (a timestamp). */
export const BRIEFING_NOW: SettingDef<number> = { key: "briefing.showNow", label: "briefing.label", default: 0 };

const route: SettingDef<{ from: Station | null; to: Station | null }> = {
	key: "transit.route",
	label: "transit.view.connections",
	default: { from: null, to: null },
};
const favorites: SettingDef<{ from: Station; to: Station }[]> = {
	key: "transit.favorites",
	label: "transit.favorites",
	default: [],
};
const alarms: SettingDef<Parameters<typeof nextRing>[0]> = { key: "alarm.items", label: "alarm.title", default: [] };

const pad = (n: number) => String(n).padStart(2, "0");

/** The briefing on show right now (its peek key), or `null`. "Thanks" ends it. */
const showing = createStore<string | null>(null);

function Line({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<div className="flex min-w-0 items-center gap-2.5 text-[13px]">
			<span className="grid w-5 flex-none place-items-center">{icon}</span>
			<span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">{children}</span>
		</div>
	);
}

function NextTrain() {
	const t = useT();
	const locale = useLocale();
	const current = useSetting(route);
	const favs = useSetting(favorites);
	const r = current.from && current.to ? { from: current.from, to: current.to } : favs[0];
	const [next, setNext] = useState<ApiConnection | null | undefined>(undefined);
	const key = r ? `${r.from.id}>${r.to.id}` : "";

	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the route's identity
	useEffect(() => {
		if (!r) return;
		const at = new Date();
		transit<{ connections?: ApiConnection[] }>("connections", {
			from: r.from.id,
			to: r.to.id,
			date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
			time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
			limit: 1,
		})
			.then((res) => setNext(res?.connections?.[0] ?? null))
			.catch(() => setNext(null));
	}, [key]);

	if (!r || !next) return null;
	const dep = next.from.departureTimestamp ?? 0;
	const minutes = Math.max(0, Math.round((dep * 1000 + (next.from.delay ?? 0) * 60_000 - Date.now()) / 60_000));
	const first = next.sections.find((s) => s.journey)?.journey;
	const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(dep * 1000);
	return (
		<Line icon={<span>🚆</span>}>
			{first && <LineBadge category={first.category} number={first.number} />}
			<b className="tabular-nums">{time}</b>
			<span className="truncate text-text-dim">
				{r.from.name} → {r.to.name}
				{next.from.platform ? ` · ${t("transit.platform", { p: next.from.platform })}` : ""}
			</span>
			{(next.from.delay ?? 0) > 0 && <span className="font-bold text-[#FF9F0A]">+{next.from.delay}′</span>}
			<span className="flex-none font-bold tabular-nums" style={{ color: ACCENT }}>
				{t("transit.live.min", { m: minutes })}
			</span>
			<button
				type="button"
				className="flex-none rounded-full bg-[#EB0000] px-2 py-0.5 text-[11px] font-bold text-white"
				onClick={() => startLive(tripOf(next, r.from, r.to))}
			>
				{t("transit.live.start")}
			</button>
		</Line>
	);
}

function BriefingPanel() {
	const t = useT();
	const locale = useLocale();
	const { collapse } = useIsland();
	const values = useSettings();
	const now = useNow(30_000);
	const place = useSetting(weatherPlace);
	const unit = useSetting(weatherUnit);
	const weather = useWeather(place, unit, true).data;
	const hour = new Date(now).getHours();
	const greeting = hour < TO_HOUR ? t("briefing.morning") : hour < 17 ? t("briefing.day") : t("briefing.evening");
	const date = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(now);
	const rain = weather ? rainAhead(weather, now) : null;
	const sky = weather ? skyOf(weather.code) : null;

	const ring = nextRing(readSetting(values, alarms), now);
	const ringSoon = ring && ring.at - now < 24 * 3_600_000;
	const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
	const todayStart = new Date(now).setHours(0, 0, 0, 0);
	const countdown = readSetting(values, countdownItems)
		.map((c) => {
			const [y, m, d] = c.date.split("-").map(Number);
			return { ...c, days: Math.round((new Date(y, m - 1, d).getTime() - todayStart) / 86_400_000) };
		})
		.filter((c) => c.days >= 0)
		.sort((a, b) => a.days - b.days)[0];

	return (
		<div className="flex h-full flex-col gap-1.5 px-1" onClick={(e) => e.stopPropagation()}>
			<div className="flex items-center gap-2">
				<SunriseIcon size={17} color={ACCENT} />
				<strong className="text-[15px]">{greeting}</strong>
				<span className="flex-1 truncate text-[12.5px] text-text-dim">{date}</span>
				<button
					type="button"
					className="rounded-full px-3 py-1 text-[12px] font-bold text-black"
					style={{ background: ACCENT }}
					onClick={() => {
						// Gone for good, not just folded: reopening the island mustn't bring it back.
						showing.set(null);
						collapse();
					}}
				>
					{t("briefing.thanks")}
				</button>
			</div>
			<div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5">
				{weather && sky && (
					<Line icon={<SkyIcon sky={sky} day={weather.day} size={16} color={skyColor(sky, weather.day)} />}>
						<b className="tabular-nums">{Math.round(weather.temperature)}°</b>
						<span className="truncate text-text-dim">
							{t(skyLabel(sky))} · {t("weather.high", { n: Math.round(weather.high) })} ·{" "}
							{t("weather.low", { n: Math.round(weather.low) })}
							{place ? ` · ${place.name}` : ""}
						</span>
						{rain && (
							<span className="flex-none font-bold text-[#5AC8FA]">
								🌧️ {t("weather.rainIn", { m: Math.max(1, Math.round(rain.inMs / 60_000)) })}
							</span>
						)}
					</Line>
				)}
				<NextTrain />
				{ringSoon && (
					<Line icon={<span>⏰</span>}>
						<b className="tabular-nums">{time.format(ring.at)}</b>
						<span className="truncate text-text-dim">{ring.alarm.label || t("briefing.alarm")}</span>
					</Line>
				)}
				{countdown && (
					<Line icon={<span>📅</span>}>
						<b>{countdown.name}</b>
						<span className="text-text-dim">
							{countdown.days === 0 ? t("countdown.today") : t("countdown.inDays", { n: countdown.days })}
						</span>
					</Line>
				)}
			</div>
		</div>
	);
}

export const briefingModule: IslandModule = {
	id: "briefing",
	title: "briefing.label",
	settingsIcon: <SunriseIcon size={15} />,
	system: true,
	useView(): ModuleView {
		const enabled = useSetting(moduleEnabled(briefingModule));
		const last = useSetting(shownOn);
		const asked = useSetting(BRIEFING_NOW);
		const current = showing.use();
		const hour = new Date().getHours();
		const candidate = enabled && last !== today() && hour >= FROM_HOUR && hour < TO_HOUR;

		// Mornings: check once a minute whether someone is at the computer.
		useEffect(() => {
			if (!candidate) return;
			const check = () =>
				tools<number | null>("idle_ms")
					.then((idle) => {
						if (idle === null || idle >= ACTIVE_MS) return;
						setSetting(shownOn, today());
						showing.set(`morning:${today()}`);
					})
					.catch(() => undefined);
			check();
			const timer = window.setInterval(check, 60_000);
			return () => window.clearInterval(timer);
		}, [candidate]);

		// "Show now" from the settings.
		const seenAsk = useRef(asked);
		useEffect(() => {
			if (asked === seenAsk.current) return;
			seenAsk.current = asked;
			showing.set(`asked:${asked}`);
		}, [asked]);

		// Gone again after a while.
		useEffect(() => {
			if (!current) return;
			const timer = window.setTimeout(() => showing.set((s) => (s === current ? null : s)), SHOW_MS + 500);
			return () => window.clearTimeout(timer);
		}, [current]);

		return {
			active: false,
			priority: 0,
			hidden: true,
			accent: ACCENT,
			icon: <SunriseIcon size={15} color={ACCENT} />,
			expanded: <BriefingPanel />,
			expandedSize: { width: 560, height: 176 },
			activityKey: current ?? undefined,
			peekMs: SHOW_MS,
			// Opening the island while it shows stays on it.
			attention: !!current,
			// Once over (or thanked), its tab can't come back by reopening the island.
			openable: !!current,
		};
	},
};
