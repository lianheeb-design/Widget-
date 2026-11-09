import { TrainFrontIcon } from "lucide-react";
/**
 * Swiss public transport from transport.opendata.ch (free, no account),
 * fetched by the backend: the departures of one stop, or connections from A
 * to B (`departures.tsx`, `connections.tsx`).
 */
import { Block, Row } from "../../components/ui/card";
import { Segmented } from "../../components/ui/form";
import { useT } from "../../core/i18n";
import { setSetting, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { PlacePicker } from "../picker";
import { ACCENT, chooseDepartureStop, station, transitView, useStationSearch } from "./common";
import { ConnectionsView } from "./connections";
import { DeparturesView } from "./departures";
import { LivePanel, liveAlert, liveTrip, useLiveView } from "./live";

function TransitPanel() {
	const view = transitView.use();
	const live = useSetting(liveTrip);
	if (view === "live" && live) return <LivePanel />;
	return view === "connections" || view === "live" ? <ConnectionsView /> : <DeparturesView />;
}

function TransitSettings() {
	const t = useT();
	const current = useSetting(station);
	const alert = useSetting(liveAlert);
	const { rememberStation, ...picker } = useStationSearch(current);

	return (
		<Block>
			<Row label={t("transit.live.alert.label")} desc={t("transit.live.alert.desc")}>
				<Segmented
					options={[0, 2, 5, 10].map((m) => ({
						value: m,
						label: m ? t("transit.duration", { m }) : t("transit.live.alert.off"),
					}))}
					value={alert}
					onChange={(m) => setSetting(liveAlert, m)}
				/>
			</Row>
			<Row label={t("transit.station.label")} desc={t("transit.station.desc")}>
				{current && <span className="text-[13px] font-[650]">{current.name}</span>}
			</Row>
			<PlacePicker
				{...picker}
				onPick={(next) => chooseDepartureStop(next, current, rememberStation)}
				className="max-h-64"
			/>
		</Block>
	);
}

export const transitModule: IslandModule = {
	id: "transit",
	title: "transit.title",
	settingsIcon: <TrainFrontIcon size={15} />,
	SettingsSection: TransitSettings,
	useView(): ModuleView {
		const view = transitView.use();
		const live = useLiveView();
		const { tracking, ...liveView } = live;
		return {
			...liveView,
			accent: ACCENT,
			icon: <TrainFrontIcon size={15} color="#ff6b6b" />,
			expanded: <TransitPanel />,
			expandedSize: {
				width: 560,
				height: view === "connections" || (view === "live" && !tracking) ? 236 : view === "live" ? 196 : 176,
			},
		};
	},
};
