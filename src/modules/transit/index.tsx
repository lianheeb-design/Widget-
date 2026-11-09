import { TrainFrontIcon } from "lucide-react";
/**
 * Swiss public transport from transport.opendata.ch (free, no account),
 * fetched by the backend: the departures of one stop, or connections from A
 * to B (`departures.tsx`, `connections.tsx`).
 */
import { Block, Row } from "../../components/ui/card";
import { useT } from "../../core/i18n";
import { useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { PlacePicker } from "../picker";
import { ACCENT, chooseDepartureStop, station, transitView, useStationSearch } from "./common";
import { ConnectionsView } from "./connections";
import { DeparturesView } from "./departures";

function TransitPanel() {
	const view = transitView.use();
	return view === "connections" ? <ConnectionsView /> : <DeparturesView />;
}

function TransitSettings() {
	const t = useT();
	const current = useSetting(station);
	const { rememberStation, ...picker } = useStationSearch(current);

	return (
		<Block>
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
		return {
			active: false,
			priority: 0,
			accent: ACCENT,
			icon: <TrainFrontIcon size={15} color="#ff6b6b" />,
			expanded: <TransitPanel />,
			expandedSize: { width: 560, height: view === "connections" ? 236 : 176 },
		};
	},
};
