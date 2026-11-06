import { ChevronDownIcon, MapPinIcon, TrainFrontIcon } from "lucide-react";
/**
 * Departures: the next trains, buses and trams from one Swiss stop, from
 * transport.opendata.ch (free, no account), fetched by the backend.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Block, Row } from "../../components/ui/card";
import { useLocale, useT } from "../../core/i18n";
import { type SettingDef, setSetting, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { useNow } from "../ai-agents/common/format";
import { IslandPlacePicker, type PickerItem, PlacePicker, remember } from "../picker";
import { tools } from "../tools/bridge";

const ACCENT = "#EB0000";
const REFRESH = 45_000;
const ROWS = 5;

interface Station {
	id: string;
	name: string;
}

const station: SettingDef<Station | null> = {
	key: "transit.station",
	label: "transit.station.label",
	description: "transit.station.desc",
	default: { id: "8506302", name: "St. Gallen" },
};

/** Stops chosen before, newest first, offered for a quick switch. */
const recentStations: SettingDef<Station[]> = { key: "transit.recent", label: "transit.station.label", default: [] };
const sameStation = (a: Station, b: Station) => a.id === b.id;
const stationItem = (s: Station): PickerItem<Station> => ({ key: s.id, title: s.name, value: s });

interface Location {
	id: string | null;
	name: string | null;
	icon?: string | null;
}

/** Search, recent stops and saving the choice, for the island and the settings. */
function useStationPicker() {
	const t = useT();
	const current = useSetting(station);
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
	const recent = useMemo(() => recentList.filter((s) => s.id !== current?.id).map(stationItem), [recentList, current]);
	const choose = useCallback(
		(next: Station) => {
			setSetting(station, next);
			setSetting(recentStations, remember(current ? [current, ...recentList] : recentList, next, sameStation));
		},
		[current, recentList],
	);
	return {
		search,
		recent,
		choose,
		placeholder: t("transit.station.placeholder"),
		notFound: t("transit.station.notFound"),
		failed: t("transit.offline"),
		accent: ACCENT,
		icon: <TrainFrontIcon size={13} className="flex-none" color="#ff6b6b" />,
	};
}

function StationChooser({ onDone }: { onDone?: () => void }) {
	const { choose, ...picker } = useStationPicker();
	return (
		<IslandPlacePicker
			{...picker}
			owner="transit.station"
			className="h-full px-1 py-0.5"
			onPick={(next) => {
				choose(next);
				onDone?.();
			}}
			onCancel={onDone}
		/>
	);
}

interface Departure {
	stop: { departureTimestamp: number | null; delay: number | null; platform: string | null };
	category: string;
	number: string | null;
	to: string;
}

const transit = <T,>(kind: "stationboard" | "locations", query: Record<string, string | number>) =>
	tools<T>("transit", { kind, query });

/** Line badge colors close to the Swiss timetable look. */
function lineStyle(category: string) {
	const c = category.toUpperCase();
	if (["IC", "ICE", "EC", "IR", "RE", "TGV", "RJX", "NJ"].includes(c)) return { background: "#EB0000", color: "#fff" };
	if (c === "S" || c === "SN") return { background: "#fff", color: "#000" };
	if (c === "B" || c === "BUS" || c === "NFB") return { background: "#2D6CDF", color: "#fff" };
	if (c === "T" || c === "TRAM" || c === "NFT") return { background: "#1BA34A", color: "#fff" };
	return { background: "rgba(255,255,255,0.14)", color: "#fff" };
}

function TransitPanel() {
	const stop = useSetting(station);
	const [picking, setPicking] = useState(false);
	if (picking || !stop) return <StationChooser onDone={stop ? () => setPicking(false) : undefined} />;
	return <Departures stop={stop} onChangeStop={() => setPicking(true)} />;
}

function Departures({ stop, onChangeStop }: { stop: Station; onChangeStop: () => void }) {
	const t = useT();
	const locale = useLocale();
	const now = useNow(15_000);
	const [rows, setRows] = useState<Departure[] | null>(null);
	const [error, setError] = useState(false);
	const id = stop.id;
	const alive = useRef(true);

	const load = useCallback(() => {
		if (!id) return;
		transit<{ stationboard?: Departure[] }>("stationboard", { id, limit: 12 })
			.then((r) => {
				if (!alive.current) return;
				setRows(r?.stationboard ?? []);
				setError(false);
			})
			.catch(() => alive.current && setError(true));
	}, [id]);

	useEffect(() => {
		alive.current = true;
		setRows(null);
		load();
		const timer = window.setInterval(load, REFRESH);
		return () => {
			alive.current = false;
			window.clearInterval(timer);
		};
	}, [load]);

	const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
	const upcoming = (rows ?? []).filter((r) => (r.stop.departureTimestamp ?? 0) * 1000 > now - 30_000).slice(0, ROWS);

	return (
		<div className="flex h-full flex-col gap-1 px-1" onClick={(e) => e.stopPropagation()}>
			<div className="flex items-center gap-1.5 text-[12.5px] font-[650] text-text-dim">
				<button
					type="button"
					title={t("transit.station.change")}
					className="-mx-1.5 flex min-w-0 items-center gap-1.5 rounded-full px-1.5 py-0.5 transition-[background] hover:bg-white/10 hover:text-text"
					onClick={onChangeStop}
				>
					<MapPinIcon size={12} color={ACCENT} className="flex-none" />
					<span className="truncate">{stop.name}</span>
					<ChevronDownIcon size={12} className="flex-none opacity-70" />
				</button>
				{error && <span className="ml-auto text-warn">{t("transit.offline")}</span>}
			</div>
			{rows === null && !error && <p className="py-2 text-[12.5px] text-text-dim">{t("transit.loading")}</p>}
			{rows !== null && upcoming.length === 0 && (
				<p className="py-2 text-[12.5px] text-text-dim">{t("transit.none")}</p>
			)}
			{upcoming.map((r) => {
				const at = (r.stop.departureTimestamp ?? 0) * 1000;
				const minutes = Math.max(0, Math.round((at - now) / 60_000));
				const delay = r.stop.delay ?? 0;
				return (
					<div
						key={`${at}-${r.category}${r.number}-${r.to}-${r.stop.platform}`}
						className="flex items-center gap-2.5 text-[13px]"
					>
						<span className="w-11 flex-none font-[650] tabular-nums">{time.format(at)}</span>
						<span
							className="min-w-11 flex-none rounded-[6px] px-1.5 py-0.25 text-center text-[11.5px] font-[800]"
							style={lineStyle(r.category)}
						>
							{r.category}
							{r.number && !/^\d{4,}$/.test(r.number) ? ` ${r.number}` : ""}
						</span>
						<span className="min-w-0 flex-1 truncate">{r.to}</span>
						{delay > 0 && <span className="flex-none text-[12px] font-bold text-[#FF9F0A]">+{delay}′</span>}
						{r.stop.platform && (
							<span className="flex-none text-[11.5px] text-text-faint">
								{t("transit.platform", { p: r.stop.platform })}
							</span>
						)}
						<span className="w-12 flex-none text-right text-[12px] font-[650] text-text-dim tabular-nums">
							{minutes === 0 ? t("transit.now") : `${minutes}′`}
						</span>
					</div>
				);
			})}
		</div>
	);
}

function TransitSettings() {
	const t = useT();
	const current = useSetting(station);
	const { choose, ...picker } = useStationPicker();

	return (
		<Block>
			<Row label={t("transit.station.label")} desc={t("transit.station.desc")}>
				{current && <span className="text-[13px] font-[650]">{current.name}</span>}
			</Row>
			<PlacePicker {...picker} onPick={choose} className="max-h-64" />
		</Block>
	);
}

export const transitModule: IslandModule = {
	id: "transit",
	title: "transit.title",
	settingsIcon: <TrainFrontIcon size={15} />,
	SettingsSection: TransitSettings,
	useView(): ModuleView {
		return {
			active: false,
			priority: 0,
			accent: ACCENT,
			icon: <TrainFrontIcon size={15} color="#ff6b6b" />,
			expanded: <TransitPanel />,
			expandedSize: { width: 560, height: 176 },
		};
	},
};
