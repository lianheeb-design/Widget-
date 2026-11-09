/** The next trains, buses and trams from one stop. */
import { ChevronDownIcon, MapPinIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useT } from "../../core/i18n";
import { useSetting } from "../../core/settings";
import { useNow } from "../ai-agents/common/format";
import { IslandPlacePicker } from "../picker";
import {
	ACCENT,
	chooseDepartureStop,
	LineBadge,
	type Station,
	station,
	transit,
	useStationSearch,
	ViewSwitch,
} from "./common";

const REFRESH = 45_000;
const ROWS = 5;

interface Departure {
	stop: { departureTimestamp: number | null; delay: number | null; platform: string | null };
	category: string;
	number: string | null;
	to: string;
}

function StationChooser({ onDone }: { onDone?: () => void }) {
	const current = useSetting(station);
	const { rememberStation, ...picker } = useStationSearch(current);
	return (
		<IslandPlacePicker
			{...picker}
			owner="transit.station"
			className="h-full px-1 py-0.5"
			onPick={(next) => {
				chooseDepartureStop(next, current, rememberStation);
				onDone?.();
			}}
			onCancel={onDone}
		/>
	);
}

export function DeparturesView() {
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
			<div className="flex items-center gap-2 text-[12.5px] font-[650] text-text-dim">
				<ViewSwitch />
				<button
					type="button"
					title={t("transit.station.change")}
					className="flex min-w-0 items-center gap-1.5 rounded-full px-1.5 py-0.5 transition-[background] hover:bg-white/10 hover:text-text"
					onClick={onChangeStop}
				>
					<MapPinIcon size={12} color={ACCENT} className="flex-none" />
					<span className="truncate">{stop.name}</span>
					<ChevronDownIcon size={12} className="flex-none opacity-70" />
				</button>
				{error && <span className="ml-auto truncate text-warn">{t("transit.offline")}</span>}
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
						<LineBadge category={r.category} number={r.number} />
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
