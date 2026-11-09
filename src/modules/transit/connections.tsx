/**
 * Connections from A to B (e.g. Altstätten SG → St. Gallen): the next few
 * with times, duration, changes, lines and platforms; a click shows where to
 * change. Favorite routes are one click away.
 */
import {
	ArrowLeftIcon,
	ArrowLeftRightIcon,
	ArrowRightIcon,
	ChevronRightIcon,
	FootprintsIcon,
	RadioIcon,
	StarIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../core/cn";
import { useLocale, useT } from "../../core/i18n";
import { type SettingDef, setSetting, useSetting } from "../../core/settings";
import { IslandPlacePicker } from "../picker";
import { LineBadge, type Station, transit, useStationSearch, ViewSwitch } from "./common";
import { liveTrip, startLive, stopLive, tripOf } from "./live";

const COUNT = 4;
const REFRESH = 60_000;

interface Route {
	from: Station | null;
	to: Station | null;
}

const route: SettingDef<Route> = {
	key: "transit.route",
	label: "transit.view.connections",
	default: { from: null, to: { id: "8506302", name: "St. Gallen" } },
};
const favorites: SettingDef<{ from: Station; to: Station }[]> = {
	key: "transit.favorites",
	label: "transit.favorites",
	default: [],
};

interface Point {
	station: { name: string | null } | null;
	departureTimestamp: number | null;
	arrivalTimestamp: number | null;
	delay: number | null;
	platform: string | null;
}

interface Section {
	journey: { category: string; number: string | null; to: string } | null;
	walk: { duration: number | null } | null;
	departure: Point;
	arrival: Point;
}

interface Connection {
	from: Point;
	to: Point;
	duration: string | null;
	transfers: number | null;
	sections: Section[];
}

/** "00d00:33:00" → 33 (minutes). */
export function durationMinutes(duration: string | null): number | null {
	const m = duration?.match(/^(\d+)d(\d+):(\d+):(\d+)$/);
	if (!m) return null;
	return Number(m[1]) * 1440 + Number(m[2]) * 60 + Number(m[3]);
}

/** Stable key of a leg: where and when it starts, and what it is. */
const sectionKey = (s: Section) =>
	`${s.departure.station?.name}-${s.departure.departureTimestamp}-${s.journey ? `${s.journey.category}${s.journey.number}` : "walk"}`;

const sameRoute = (a: Route, b: Route) => a.from?.id === b.from?.id && a.to?.id === b.to?.id;

function useClock() {
	const locale = useLocale();
	const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
	return (seconds: number | null) => (seconds ? time.format(seconds * 1000) : "–");
}

function Duration({ minutes }: { minutes: number | null }) {
	const t = useT();
	if (minutes === null) return null;
	return (
		<>
			{minutes >= 60
				? t("transit.durationLong", { h: Math.floor(minutes / 60), m: String(minutes % 60).padStart(2, "0") })
				: t("transit.duration", { m: minutes })}
		</>
	);
}

function StopButton({
	station,
	placeholder,
	onClick,
}: {
	station: Station | null;
	placeholder: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className={cn(
				"flex h-6.5 min-w-0 flex-1 items-center rounded-full bg-white/7 px-2.5 text-[12.5px] font-[650] transition-[background] hover:bg-white/12",
				station ? "text-text" : "text-text-faint",
			)}
			onClick={onClick}
		>
			<span className="truncate">{station?.name ?? placeholder}</span>
		</button>
	);
}

function Details({ connection, route, onBack }: { connection: Connection; route: Route; onBack: () => void }) {
	const t = useT();
	const clock = useClock();
	const live = useSetting(liveTrip);
	const followed =
		live?.dep === connection.from.departureTimestamp && live.from.id === route.from?.id && live.to.id === route.to?.id;
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-1">
			<div className="flex items-center justify-between gap-2">
				<button
					type="button"
					className="flex w-fit items-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] font-[650] text-text-dim hover:bg-white/8 hover:text-text"
					onClick={onBack}
				>
					<ArrowLeftIcon size={12} />
					{t("transit.back")}
				</button>
				{route.from && route.to && (
					<button
						type="button"
						title={t("transit.live.hint")}
						className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-bold transition-[background]"
						style={
							followed
								? { color: "#ff8a80", background: "rgba(255,255,255,0.06)" }
								: { color: "#fff", background: "#EB0000" }
						}
						onClick={() => {
							if (followed) stopLive();
							else if (route.from && route.to) startLive(tripOf(connection, route.from, route.to));
						}}
					>
						<RadioIcon size={12} />
						{followed ? t("transit.live.stop") : t("transit.live.start")}
					</button>
				)}
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" data-scroll>
				{connection.sections.map((s) =>
					s.journey ? (
						<div key={sectionKey(s)} className="flex items-center gap-2.5 text-[12.5px]">
							<LineBadge category={s.journey.category} number={s.journey.number} />
							<div className="flex min-w-0 flex-1 flex-col">
								<span className="truncate">
									<b className="tabular-nums">{clock(s.departure.departureTimestamp)}</b> {s.departure.station?.name}
									{s.departure.platform && (
										<span className="text-text-faint"> · {t("transit.platform", { p: s.departure.platform })}</span>
									)}
									{(s.departure.delay ?? 0) > 0 && (
										<span className="font-bold text-[#FF9F0A]"> +{s.departure.delay}′</span>
									)}
								</span>
								<span className="truncate text-text-dim">
									<b className="tabular-nums">{clock(s.arrival.arrivalTimestamp)}</b> {s.arrival.station?.name}
									{s.arrival.platform && (
										<span className="text-text-faint"> · {t("transit.platform", { p: s.arrival.platform })}</span>
									)}
								</span>
							</div>
							<span className="max-w-32 flex-none truncate text-[11.5px] text-text-faint">→ {s.journey.to}</span>
						</div>
					) : (
						<div key={sectionKey(s)} className="flex items-center gap-2.5 pl-3 text-[12px] text-text-faint">
							<FootprintsIcon size={13} />
							{t("transit.walk", { m: Math.max(1, Math.round((s.walk?.duration ?? 0) / 60)) })}
						</div>
					),
				)}
			</div>
		</div>
	);
}

export function ConnectionsView() {
	const t = useT();
	const clock = useClock();
	const current = useSetting(route);
	const favs = useSetting(favorites);
	const live = useSetting(liveTrip);
	const [picking, setPicking] = useState<"from" | "to" | null>(null);
	const [page, setPage] = useState(0);
	const [rows, setRows] = useState<Connection[] | null>(null);
	const [error, setError] = useState(false);
	const [open, setOpen] = useState<Connection | null>(null);
	const search = useStationSearch(picking === "from" ? current.from : current.to);
	const alive = useRef(true);
	const fromId = current.from?.id;
	const toId = current.to?.id;

	const load = useCallback(() => {
		if (!fromId || !toId) return;
		transit<{ connections?: Connection[] }>("connections", { from: fromId, to: toId, limit: COUNT, page })
			.then((r) => {
				if (!alive.current) return;
				setRows(r?.connections ?? []);
				setError(false);
			})
			.catch(() => alive.current && setError(true));
	}, [fromId, toId, page]);

	useEffect(() => {
		alive.current = true;
		setRows(null);
		setOpen(null);
		load();
		// Only "now" goes stale; later pages stay as they are.
		const timer = page === 0 ? window.setInterval(load, REFRESH) : 0;
		return () => {
			alive.current = false;
			window.clearInterval(timer);
		};
	}, [load, page]);

	const setRoute = (next: Route) => {
		setSetting(route, next);
		setPage(0);
	};

	if (picking) {
		const { rememberStation, ...picker } = search;
		return (
			<IslandPlacePicker
				{...picker}
				placeholder={picking === "from" ? t("transit.from") : t("transit.to")}
				owner={`transit.${picking}`}
				className="h-full px-1 py-0.5"
				onPick={(s) => {
					rememberStation(s);
					setRoute({ ...current, [picking]: s });
					setPicking(null);
				}}
				onCancel={() => setPicking(null)}
			/>
		);
	}

	const isFavorite = favs.some((f) => sameRoute(f, current));
	const toggleFavorite = () => {
		const { from, to } = current;
		if (!from || !to) return;
		setSetting(favorites, isFavorite ? favs.filter((f) => !sameRoute(f, current)) : [...favs, { from, to }].slice(-6));
	};
	const otherFavorites = favs.filter((f) => !sameRoute(f, current));

	return (
		<div className="flex h-full flex-col gap-1.5 px-1" onClick={(e) => e.stopPropagation()}>
			<div className="flex items-center gap-1.5">
				<ViewSwitch live={!!live} />
				<StopButton station={current.from} placeholder={t("transit.from")} onClick={() => setPicking("from")} />
				<button
					type="button"
					title={t("transit.swap")}
					className="grid size-6.5 flex-none place-items-center rounded-full text-text-dim hover:bg-white/10 hover:text-text"
					onClick={() => setRoute({ from: current.to, to: current.from })}
				>
					<ArrowLeftRightIcon size={13} />
				</button>
				<StopButton station={current.to} placeholder={t("transit.to")} onClick={() => setPicking("to")} />
				<button
					type="button"
					title={isFavorite ? t("transit.unfavorite") : t("transit.favorite")}
					disabled={!current.from || !current.to}
					className="grid size-6.5 flex-none place-items-center rounded-full hover:bg-white/10 disabled:opacity-30"
					onClick={toggleFavorite}
				>
					<StarIcon size={13} color={isFavorite ? "#FFD60A" : "currentColor"} fill={isFavorite ? "#FFD60A" : "none"} />
				</button>
			</div>
			{otherFavorites.length > 0 && !open && (
				<div className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
					{otherFavorites.map((f) => (
						<button
							key={`${f.from.id}-${f.to.id}`}
							type="button"
							className="flex flex-none items-center gap-1 rounded-full bg-white/6 px-2 py-0.5 text-[11.5px] font-[650] text-text-dim hover:bg-white/12 hover:text-text"
							onClick={() => setRoute(f)}
						>
							<StarIcon size={10} color="#FFD60A" fill="#FFD60A" />
							{f.from.name} <ArrowRightIcon size={10} /> {f.to.name}
						</button>
					))}
				</div>
			)}
			{open ? (
				<Details connection={open} route={current} onBack={() => setOpen(null)} />
			) : (
				<>
					<div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" data-scroll>
						{(!current.from || !current.to) && (
							<p className="py-2 text-[12.5px] text-text-dim">{t("transit.pickRoute")}</p>
						)}
						{current.from && current.to && rows === null && !error && (
							<p className="py-2 text-[12.5px] text-text-dim">{t("transit.loading")}</p>
						)}
						{error && <p className="py-2 text-[12.5px] text-warn">{t("transit.offline")}</p>}
						{rows !== null && rows.length === 0 && !error && (
							<p className="py-2 text-[12.5px] text-text-dim">{t("transit.noConnections")}</p>
						)}
						{rows?.map((c) => {
							const lines = c.sections.filter((s) => s.journey);
							const delay = c.from.delay ?? 0;
							return (
								<button
									type="button"
									key={`${c.from.departureTimestamp}-${c.to.arrivalTimestamp}-${c.duration}-${c.transfers}`}
									className="flex flex-none items-center gap-2.5 rounded-[10px] px-1.5 py-1 text-left text-[13px] hover:bg-white/6"
									onClick={() => setOpen(c)}
								>
									<span className="flex-none font-[650] tabular-nums">
										{clock(c.from.departureTimestamp)}
										{delay > 0 && <span className="text-[11.5px] font-bold text-[#FF9F0A]"> +{delay}′</span>}
										<span className="text-text-faint"> → </span>
										{clock(c.to.arrivalTimestamp)}
									</span>
									<span className="flex min-w-0 flex-1 gap-1 overflow-hidden">
										{lines
											.slice(0, 3)
											.map((s) =>
												s.journey ? (
													<LineBadge key={sectionKey(s)} category={s.journey.category} number={s.journey.number} />
												) : null,
											)}
									</span>
									<span className="flex-none text-[11.5px] text-text-faint">
										{c.from.platform ? t("transit.platform", { p: c.from.platform }) : ""}
									</span>
									<span className="w-26 flex-none text-right text-[11.5px] text-text-dim tabular-nums">
										<Duration minutes={durationMinutes(c.duration)} />
										{" · "}
										{c.transfers ? t("transit.changes", { n: c.transfers }) : t("transit.direct")}
									</span>
									<ChevronRightIcon size={13} className="flex-none text-text-faint" />
								</button>
							);
						})}
					</div>
					{current.from && current.to && (
						<div className="flex justify-end gap-1">
							{page > 0 && (
								<button
									type="button"
									className="rounded-full px-2.5 py-0.5 text-[11.5px] font-bold text-text-dim hover:bg-white/8 hover:text-text"
									onClick={() => setPage(0)}
								>
									{t("transit.nowButton")}
								</button>
							)}
							<button
								type="button"
								className="rounded-full px-2.5 py-0.5 text-[11.5px] font-bold hover:bg-white/8"
								style={{ color: "#ff8a80" }}
								onClick={() => setPage((p) => p + 1)}
							>
								{t("transit.later")} →
							</button>
						</div>
					)}
				</>
			)}
		</div>
	);
}
