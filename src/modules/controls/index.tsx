import { CheckIcon, PipetteIcon, SlidersHorizontalIcon } from "lucide-react";
/**
 * Controls: brightness and volume sliders, lock the PC, screenshots and a
 * screen color picker. Backed by the `tools` provider. While the picker runs,
 * the compact island shows the color under the cursor.
 */
import { useEffect, useRef, useState } from "react";
import { useProvider } from "../../core/bridge";
import { useT } from "../../core/i18n";
import { setSetting, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { ControlsPanel } from "./components/ControlsPanel";
import { MAX_COLORS, PICKER_ID, type PickerState, recentColors } from "./picker";

const ACCENT = "#0A84FF";
const SHOW_PICKED_MS = 3500;

function Swatch({ hex }: { hex: string }) {
	return (
		<span
			className="size-4 flex-none rounded-[5px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]"
			style={{ background: hex }}
		/>
	);
}

export const controlsModule: IslandModule = {
	id: "controls",
	title: "controls.title",
	settingsIcon: <SlidersHorizontalIcon size={15} />,
	useView(): ModuleView {
		const t = useT();
		const picker = useProvider<PickerState>(PICKER_ID);
		const colors = useSetting(recentColors);
		const [shown, setShown] = useState<{ hex: string; seq: number } | null>(null);
		const handled = useRef(0);
		const colorsRef = useRef(colors);
		colorsRef.current = colors;

		// A finished pick: remember it and show it for a moment.
		useEffect(() => {
			if (!picker || picker.picking || !picker.picked || !picker.hex || picker.seq === handled.current) return;
			handled.current = picker.seq;
			const hex = picker.hex;
			setSetting(recentColors, [hex, ...colorsRef.current.filter((c) => c !== hex)].slice(0, MAX_COLORS));
			setShown({ hex, seq: picker.seq });
			const id = window.setTimeout(() => setShown(null), SHOW_PICKED_MS);
			return () => window.clearTimeout(id);
		}, [picker]);

		const picking = !!picker?.picking;
		const compact = picking
			? {
					left: (
						<span className="flex items-center gap-2 text-[13px] font-[650]">
							<PipetteIcon size={15} color="#FF9F0A" />
							{picker?.hex && <Swatch hex={picker.hex} />}
							<span className="font-mono tabular-nums">{picker?.hex ?? ""}</span>
						</span>
					),
					right: <span className="text-[11.5px] text-text-dim">{t("controls.pipetteHint")}</span>,
					width: 360,
				}
			: shown
				? {
						left: (
							<span className="flex items-center gap-2 text-[13px] font-[650]">
								<Swatch hex={shown.hex} />
								<span className="font-mono">{shown.hex}</span>
							</span>
						),
						right: (
							<span className="flex items-center gap-1 text-[12px] font-[650] text-[#30D158]">
								<CheckIcon size={13} />
								{t("controls.pipetteCopied")}
							</span>
						),
						width: 260,
					}
				: undefined;

		return {
			active: picking || !!shown,
			priority: picking ? 99 : shown ? 96 : 0,
			accent: ACCENT,
			icon: <SlidersHorizontalIcon size={15} color={ACCENT} />,
			compact,
			expanded: <ControlsPanel />,
			expandedSize: { width: 560, height: 168 },
		};
	},
};
