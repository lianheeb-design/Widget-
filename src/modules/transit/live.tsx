/**
 * A connection followed live: picked in the connections view, it stays in
 * the collapsed island ("IR 13 · Gl. 2 · in 7 Min") until the person
 * arrives. Delays and platforms are fetched again every minute; shortly
 * before the departure the island peeks and pulses; on the way it shows the
 * next change or the arrival.
 */
import { FlagIcon, RepeatIcon, TrainFrontIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { RollingText } from "../../components/RollingText";
import { useLocale, useT } from "../../core/i18n";
import { type SettingDef, setSetting, useSetting } from "../../core/settings";
import type { ModuleView } from "../../core/types";
import { useNow } from "../ai-agents/common/format";
import { LineBadge, type Station, transit, transitView } from "./common";

const REFRESH = 60_000;
/** After arriving, the live view stays this long (s), then ends by itself. */
const LINGER = 120;

export interface LiveLeg {
	/** Train, bus…; `null` for a walk. */
	category: string | null;
	number: string | null;
	direction: string | null;
	from: string;
	to: string;
	/** Planned times (s) and delays (min). */
	dep: number;
	arr: number;
	depDelay: number;
	arrDelay: number;
	platform: string | null;
	arrPlatform: string | null;
}

export interface LiveTrip {
	from: Station;
	to: Station;
	/** Planned departure (s): which connection this is. */
	dep: number;
	legs: LiveLeg[];
}

export const liveTrip: SettingDef<LiveTrip | null> = {
	key: "transit.live",
	label: "transit.view.live",
	default: null,
};
/** Minutes before the departure the island peeks and pulses (0: never). */
export const liveAlert: SettingDef<number> = {
	key: "transit.liveAlert",
	label: "transit.live.alert.label",
	description: "transit.live.alert.desc",
	default: 5,
};

/** The parts of a transport.opendata.ch connection the live view needs. */
interface ApiPoint {
	station: { name: string | null } | null;
	departureTimestamp: number | null;
	arrivalTimestamp: number | null;
	delay: number | null;
	platform: string | null;
}
export interface ApiConnection {
	from: ApiPoint;
	to: ApiPoint;
	sections: {
		journey: { category: string; number: string | null; to: string } | null;
		walk: { duration: number | null } | null;
		departure: ApiPoint;
		arrival: ApiPoint;
	}[];
}

/** A connection as followed live (walks get times from their neighbors). */
export function tripOf(c: ApiConnection, from: Station, to: Station): LiveTrip {
	const legs: LiveLeg[] = [];
	let clock = c.from.departureTimestamp ?? 0;
	for (const s of c.sections) {
		const dep = s.departure.departureTimestamp ?? clock;
		const arr = s.arrival.arrivalTimestamp ?? dep + (s.walk?.duration ?? 0);
		legs.push({
			category: s.journey?.category ?? null,
			number: s.journey?.number ?? null,
			direction: s.journey?.to ?? null,
			from: s.departure.station?.name ?? "",
			to: s.arrival.station?.name ?? "",
			dep,
			arr,
			depDelay: s.departure.delay ?? 0,
			arrDelay: s.arrival.delay ?? 0,
			platform: s.departure.platform || null,
			arrPlatform: s.arrival.platform || null,
		});
		clock = arr;
	}
	return { from, to, dep: c.from.departureTimestamp ?? 0, legs };
}

const departs = (l: LiveLeg) => l.dep + l.depDelay * 60;
const arrives = (l: LiveLeg) => l.arr + Math.max(l.arrDelay, 0) * 60;

export type LivePhase =
	/** Waiting for the first train: `seconds` until it leaves. */
	| { kind: "before"; leg: LiveLeg; seconds: number }
	/** On board: `seconds` until this leg arrives; `last` when that's the destination. */
	| { kind: "riding"; leg: LiveLeg; seconds: number; last: boolean; index: number }
	/** Between two trains: `seconds` until `next` leaves from `at`. */
	| { kind: "change"; next: LiveLeg; at: string; seconds: number; index: number }
	| { kind: "done"; since: number };

/** Where the trip stands at `now` (s). */
export function livePhase(trip: LiveTrip, now: number): LivePhase {
	const rides = trip.legs.filter((l) => l.category);
	if (rides.length === 0) return { kind: "done", since: 0 };
	if (now < departs(rides[0])) return { kind: "before", leg: rides[0], seconds: departs(rides[0]) - now };
	for (let i = 0; i < rides.length; i++) {
		const leg = rides[i];
		if (now < arrives(leg))
			return { kind: "riding", leg, seconds: arrives(leg) - now, last: i === rides.length - 1, index: i };
		const next = rides[i + 1];
		if (next && now < departs(next))
			return { kind: "change", next, at: next.from || leg.to, seconds: departs(next) - now, index: i };
	}
	return { kind: "done", since: now - arrives(rides[rides.length - 1]) };
}

/** "in 7 Min", "in 1 h 05", "jetzt". */
function useSpan() {
	const t = useT();
	return (seconds: number) => {
		if (seconds < 60) return t("transit.live.now");
		const minutes = Math.ceil(seconds / 60);
		return minutes >= 60
			? t("transit.live.hours", { h: Math.floor(minutes / 60), m: String(minutes % 60).padStart(2, "0") })
			: t("transit.live.min", { m: minutes });
	};
}

function useClock() {
	const locale = useLocale();
	const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
	return (seconds: number) => time.format(seconds * 1000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Fetches delays and platforms of the followed connection again every minute. */
function useLiveRefresh(trip: LiveTrip | null) {
	const latest = useRef(trip);
	latest.current = trip;
	const key = trip ? `${trip.from.id}-${trip.to.id}-${trip.dep}` : "";

	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the trip's identity; its delays change on every refresh
	useEffect(() => {
		const current = latest.current;
		if (!current) return;
		const { from, to, dep } = current;
		const at = new Date(dep * 1000);
		let cancelled = false;
		const refresh = () => {
			const now = Date.now() / 1000;
			const live = latest.current;
			if (!live || livePhase(live, now).kind === "done") return;
			transit<{ connections?: ApiConnection[] }>("connections", {
				from: from.id,
				to: to.id,
				date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
				time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
				limit: 3,
			})
				.then((r) => {
					const match = r?.connections?.find((c) => c.from.departureTimestamp === dep);
					if (cancelled || !match || latest.current?.dep !== dep) return;
					setSetting(liveTrip, tripOf(match, from, to));
				})
				.catch(() => undefined);
		};
		refresh();
		const timer = window.setInterval(refresh, REFRESH);
		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [key]);
}

const RED = "#ff6b6b";
const ORANGE = "#FF9F0A";

function Delay({ minutes }: { minutes: number }) {
	if (minutes <= 0) return null;
	return <span className="text-[11.5px] font-bold text-[#FF9F0A]">+{minutes}′</span>;
}

/** The collapsed island while a connection is followed (plain function: called from `useView`). */
function liveCompact(phase: LivePhase, alert: boolean, t: ReturnType<typeof useT>, span: (seconds: number) => string) {
	if (phase.kind === "done") {
		return {
			left: (
				<span className="flex items-center gap-2 text-[13px] font-[650]">
					<FlagIcon size={14} color="#30D158" />
					{t("transit.live.arrived")}
				</span>
			),
			right: null,
		};
	}
	if (phase.kind === "before") {
		const { leg } = phase;
		return {
			left: (
				<span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-[650]">
					<LineBadge category={leg.category ?? ""} number={leg.number} />
					{leg.platform && <span className="truncate text-text-dim">{t("transit.platform", { p: leg.platform })}</span>}
					<Delay minutes={leg.depDelay} />
				</span>
			),
			right: (
				<span
					className="text-[13px] font-bold whitespace-nowrap tabular-nums"
					style={{ color: alert ? RED : leg.depDelay > 0 ? ORANGE : undefined }}
				>
					<RollingText text={span(phase.seconds)} />
				</span>
			),
		};
	}
	if (phase.kind === "change") {
		const { next } = phase;
		return {
			left: (
				<span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-[650]">
					<RepeatIcon size={13} color={RED} className="flex-none" />
					<span className="truncate">{phase.at}</span>
					{next.platform && (
						<span className="flex-none text-text-dim">{t("transit.platform", { p: next.platform })}</span>
					)}
				</span>
			),
			right: (
				<span className="flex items-center gap-1.5 text-[13px] font-bold whitespace-nowrap tabular-nums">
					<LineBadge category={next.category ?? ""} number={next.number} />
					<RollingText text={span(phase.seconds)} />
				</span>
			),
		};
	}
	const { leg } = phase;
	return {
		left: (
			<span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-[650]">
				<LineBadge category={leg.category ?? ""} number={leg.number} />
				<span className="truncate text-text-dim">→ {leg.to}</span>
			</span>
		),
		right: (
			<span className="text-[13px] font-bold whitespace-nowrap tabular-nums">
				<RollingText text={span(phase.seconds)} />
			</span>
		),
	};
}

/** The open island on the live view: what's next, big, and every leg. */
export function LivePanel() {
	const t = useT();
	const span = useSpan();
	const clock = useClock();
	const trip = useSetting(liveTrip);
	const alertMinutes = useSetting(liveAlert);
	const now = useNow(5000, !!trip) / 1000;
	if (!trip) return null;
	const phase = livePhase(trip, now);
	const alert = phase.kind === "before" && alertMinutes > 0 && phase.seconds <= alertMinutes * 60;

	const [headline, big] =
		phase.kind === "before"
			? [alert ? t("transit.live.go") : t("transit.live.departsIn"), span(phase.seconds)]
			: phase.kind === "change"
				? [t("transit.live.changeAt", { at: phase.at }), span(phase.seconds)]
				: phase.kind === "riding"
					? [
							phase.last
								? t("transit.live.arriveIn", { to: trip.to.name })
								: t("transit.live.nextStop", { to: phase.leg.to }),
							span(phase.seconds),
						]
					: [t("transit.live.arrived"), <FlagIcon key="flag" size={28} color="#30D158" />];
	const current =
		phase.kind === "before" || phase.kind === "riding" ? phase.leg : phase.kind === "change" ? phase.next : null;

	return (
		<div className="flex h-full flex-col gap-1.5 px-1" onClick={(e) => e.stopPropagation()}>
			<div className="flex items-center gap-3">
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="truncate text-[12px] font-[650] text-text-dim">
						{trip.from.name} → {trip.to.name}
					</span>
					<span className="truncate text-[13px] font-[650]" style={{ color: alert ? RED : undefined }}>
						{headline}
					</span>
				</div>
				<strong
					className="flex-none text-[30px]/none font-[750] tabular-nums"
					style={{
						color: alert ? RED : current && current.depDelay > 0 && phase.kind !== "riding" ? ORANGE : undefined,
					}}
				>
					{big}
				</strong>
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" data-scroll>
				{trip.legs
					.filter((l) => l.category)
					.map((l) => {
						const active = l === current;
						const gone = arrives(l) <= now;
						return (
							<div
								key={`${l.dep}-${l.category}${l.number}`}
								className="flex items-center gap-2 rounded-[8px] px-1 py-0.5 text-[12px]"
								style={{ background: active ? "rgba(235,0,0,0.13)" : undefined, opacity: gone ? 0.45 : 1 }}
							>
								<LineBadge category={l.category ?? ""} number={l.number} />
								<span className="min-w-0 flex-1 truncate">
									<b className="tabular-nums">{clock(l.dep)}</b> {l.from}
									{l.platform && <span className="text-text-faint"> · {t("transit.platform", { p: l.platform })}</span>}{" "}
									<Delay minutes={l.depDelay} />
									<span className="text-text-faint"> → </span>
									<b className="tabular-nums">{clock(l.arr)}</b> {l.to}
								</span>
							</div>
						);
					})}
			</div>
			<div className="flex justify-end gap-1">
				<button
					type="button"
					className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold text-text-dim hover:bg-white/8 hover:text-text"
					onClick={() => transitView.set("connections")}
				>
					<TrainFrontIcon size={11} />
					{t("transit.view.connections")}
				</button>
				<button
					type="button"
					className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold hover:bg-white/8"
					style={{ color: "#ff8a80" }}
					onClick={stopLive}
				>
					<XIcon size={11} />
					{t("transit.live.stop")}
				</button>
			</div>
		</div>
	);
}

export function stopLive() {
	setSetting(liveTrip, null);
	if (transitView.get() === "live") transitView.set("connections");
}

export function startLive(trip: LiveTrip) {
	setSetting(liveTrip, trip);
	transitView.set("live");
}

/**
 * The parts of the transit module's view that come from the followed
 * connection: the compact island, the peek and pulse before the departure,
 * and its quick action.
 */
export function useLiveView(): Pick<
	ModuleView,
	"active" | "priority" | "compact" | "activityKey" | "attention" | "menu"
> & {
	tracking: boolean;
} {
	const t = useT();
	const span = useSpan();
	const trip = useSetting(liveTrip);
	const alertMinutes = useSetting(liveAlert);
	const now = useNow(5000, !!trip) / 1000;
	useLiveRefresh(trip);
	const phase = trip ? livePhase(trip, now) : null;
	const over = phase?.kind === "done" && phase.since > LINGER;

	useEffect(() => {
		if (over) stopLive();
	}, [over]);

	if (!trip || !phase || over) return { active: false, priority: 0, tracking: false };
	const alert = phase.kind === "before" && alertMinutes > 0 && phase.seconds <= alertMinutes * 60;
	const compact = liveCompact(phase, alert, t, span);
	return {
		tracking: true,
		active: true,
		// Above music and most else; right before the departure, above nearly everything.
		priority: alert ? 70 : 48,
		compact: { left: compact.left, right: compact.right, width: 300 },
		// Peeks once when the departure is near, and at each change.
		activityKey: alert
			? `alert:${trip.dep}`
			: phase.kind === "change"
				? `change:${trip.dep}:${phase.index}`
				: undefined,
		attention: alert,
		menu: [{ label: t("transit.live.stop"), onSelect: stopLive, danger: true }],
	};
}
