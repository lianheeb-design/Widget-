import { MapPinIcon, TrainFrontIcon } from "lucide-react";
/**
 * Departures: the next trains, buses and trams from one Swiss stop, from
 * transport.opendata.ch (free, no account), fetched by the backend.
 */
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Block, Desc, Row } from "../../components/ui/card";
import { Input } from "../../components/ui/form";
import { useLocale, useT } from "../../core/i18n";
import { type SettingDef, setSetting, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { useNow } from "../ai-agents/common/format";
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
	const t = useT();
	const locale = useLocale();
	const stop = useSetting(station);
	const now = useNow(15_000);
	const [rows, setRows] = useState<Departure[] | null>(null);
	const [error, setError] = useState(false);
	const id = stop?.id;
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

	if (!stop) return <div className="m-auto text-[12.5px] text-text-dim">{t("transit.noStation")}</div>;
	const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
	const upcoming = (rows ?? []).filter((r) => (r.stop.departureTimestamp ?? 0) * 1000 > now - 30_000).slice(0, ROWS);

	return (
		<div className="flex h-full flex-col gap-1 px-1" onClick={(e) => e.stopPropagation()}>
			<div className="flex items-center gap-1.5 text-[12.5px] font-[650] text-text-dim">
				<MapPinIcon size={12} color={ACCENT} />
				<span className="truncate">{stop.name}</span>
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
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const search = async (e: FormEvent) => {
		e.preventDefault();
		if (!query.trim()) return;
		setBusy(true);
		setError(null);
		try {
			const r = await transit<{ stations?: { id: string | null; name: string | null }[] }>("locations", {
				query: query.trim(),
				type: "station",
			});
			const hit = r?.stations?.find((s) => s.id && s.name);
			if (hit?.id && hit.name) {
				setSetting(station, { id: hit.id, name: hit.name });
				setQuery("");
			} else setError(t("transit.station.notFound"));
		} catch {
			setError(t("transit.offline"));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Block>
			<Row label={t("transit.station.label")} desc={t("transit.station.desc")}>
				{current && <span className="text-[13px] font-[650]">{current.name}</span>}
			</Row>
			<form className="flex gap-2" onSubmit={search}>
				<Input
					className="flex-1"
					value={query}
					placeholder={t("transit.station.placeholder")}
					onChange={(e) => setQuery(e.target.value)}
				/>
				<Button type="submit" variant="primary" disabled={busy || !query.trim()}>
					{t("transit.station.search")}
				</Button>
			</form>
			{error && <Desc tone="error">{error}</Desc>}
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
