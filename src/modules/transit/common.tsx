/** Shared by the departures and the connections view: stops, search, line colors. */
import { TrainFrontIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useT } from "../../core/i18n";
import { createStore } from "../../core/island";
import { type SettingDef, setSetting, useSetting } from "../../core/settings";
import { type PickerItem, remember } from "../picker";
import { tools } from "../tools/bridge";

export const ACCENT = "#EB0000";

export interface Station {
	id: string;
	name: string;
}

export const station: SettingDef<Station | null> = {
	key: "transit.station",
	label: "transit.station.label",
	description: "transit.station.desc",
	default: { id: "8506302", name: "St. Gallen" },
};

/** Stops chosen before, newest first, offered for a quick switch. */
const recentStations: SettingDef<Station[]> = { key: "transit.recent", label: "transit.station.label", default: [] };
export const sameStation = (a: Station, b: Station) => a.id === b.id;
const stationItem = (s: Station): PickerItem<Station> => ({ key: s.id, title: s.name, value: s });

interface Location {
	id: string | null;
	name: string | null;
}

export const transit = <T,>(
	kind: "stationboard" | "locations" | "connections",
	query: Record<string, string | number>,
) => tools<T>("transit", { kind, query });

/** Which view the panel shows: the departures of one stop, or connections from A to B. */
export type TransitView = "departures" | "connections";
export const transitView = createStore<TransitView>("departures");

/**
 * Stop search for the pickers: matches, recently used stops (without
 * `exclude`), and `remember` to put a chosen one first in that list.
 */
export function useStationSearch(exclude?: Station | null) {
	const t = useT();
	const recentList = useSetting(recentStations);
	const search = useCallback(async (query: string) => {
		const r = await transit<{ stations?: Location[] }>("locations", { query, type: "station" });
		const seen = new Set<string>();
		const items: PickerItem<Station>[] = [];
		for (const s of r?.stations ?? []) {
			if (!s.id || !s.name || seen.has(s.id)) continue;
			seen.add(s.id);
			items.push(stationItem({ id: s.id, name: s.name }));
		}
		return items.slice(0, 8);
	}, []);
	const recent = useMemo(() => recentList.filter((s) => s.id !== exclude?.id).map(stationItem), [recentList, exclude]);
	const rememberStation = useCallback(
		(next: Station, also?: Station | null) =>
			setSetting(
				recentStations,
				remember(also ? remember(recentList, also, sameStation, 6) : recentList, next, sameStation, 6),
			),
		[recentList],
	);
	return {
		search,
		recent,
		rememberStation,
		placeholder: t("transit.station.placeholder"),
		notFound: t("transit.station.notFound"),
		failed: t("transit.offline"),
		accent: ACCENT,
		icon: <TrainFrontIcon size={13} className="flex-none" color="#ff6b6b" />,
	};
}

/** Line badge colors close to the Swiss timetable look. */
export function lineStyle(category: string) {
	const c = category.toUpperCase();
	if (["IC", "ICE", "EC", "IR", "RE", "TGV", "RJX", "NJ", "EXT"].includes(c))
		return { background: "#EB0000", color: "#fff" };
	if (c === "S" || c === "SN") return { background: "#fff", color: "#000" };
	if (["B", "BUS", "NFB", "EXB", "KB"].includes(c)) return { background: "#2D6CDF", color: "#fff" };
	if (c === "T" || c === "TRAM" || c === "NFT") return { background: "#1BA34A", color: "#fff" };
	return { background: "rgba(255,255,255,0.14)", color: "#fff" };
}

/** "IR 13", "S 4", or just "B" for long internal numbers. */
export const lineLabel = (category: string, number: string | null) =>
	`${category}${number && !/^\d{4,}$/.test(number) ? ` ${number}` : ""}`;

export function LineBadge({ category, number }: { category: string; number: string | null }) {
	return (
		<span
			className="min-w-11 flex-none rounded-[6px] px-1.5 py-0.25 text-center text-[11.5px] font-[800] whitespace-nowrap"
			style={lineStyle(category)}
		>
			{lineLabel(category, number)}
		</span>
	);
}

/** Tabs at the top of the panel: departures | connection. */
export function ViewSwitch() {
	const t = useT();
	const view = transitView.use();
	return (
		<div className="flex flex-none gap-1">
			{(["departures", "connections"] as const).map((v) => (
				<button
					key={v}
					type="button"
					className={
						view === v
							? "rounded-full bg-[rgba(235,0,0,0.22)] px-2 py-0.5 text-[11px] font-bold tracking-[0.04em] text-[#ff8a80] uppercase"
							: "rounded-full px-2 py-0.5 text-[11px] font-bold tracking-[0.04em] text-text-faint uppercase hover:text-text-dim"
					}
					onClick={() => transitView.set(v)}
				>
					{t(`transit.view.${v}`)}
				</button>
			))}
		</div>
	);
}

/** Keeps `station` in the recent list when it is picked for the departures. */
export function chooseDepartureStop(
	next: Station,
	current: Station | null,
	rememberStation: (s: Station, also?: Station | null) => void,
) {
	setSetting(station, next);
	rememberStation(next, current);
}
