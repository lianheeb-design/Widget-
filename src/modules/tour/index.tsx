import { CompassIcon } from "lucide-react";
/**
 * Welcome tour: on a new install, the island opens with four short steps
 * on how to use it. It stays open until the last step or "Skip".
 */
import { useState } from "react";
import { cn } from "../../core/cn";
import { useT } from "../../core/i18n";
import { TOUR_PENDING } from "../../core/migrate";
import { type SettingDef, setSetting, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";

const ACCENT = "#0A84FF";
const pending: SettingDef<boolean> = { key: TOUR_PENDING, label: "tour.title", default: false };

const STEPS = [
	{ icon: "👋", title: "tour.s1.title", text: "tour.s1.text" },
	{ icon: "🗂️", title: "tour.s2.title", text: "tour.s2.text" },
	{ icon: "🖱️", title: "tour.s3.title", text: "tour.s3.text" },
	{ icon: "⚙️", title: "tour.s4.title", text: "tour.s4.text" },
] as const;

function TourPanel() {
	const t = useT();
	const [step, setStep] = useState(0);
	const s = STEPS[step];
	const last = step === STEPS.length - 1;
	const done = () => setSetting(pending, false);

	return (
		<div className="flex h-full flex-col gap-2 px-1" onClick={(e) => e.stopPropagation()}>
			<div className="flex min-h-0 flex-1 items-center gap-4">
				<span className="grid size-14 flex-none place-items-center rounded-[18px] bg-white/7 text-[30px]">
					{s.icon}
				</span>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<strong className="text-[15.5px]">{t(s.title)}</strong>
					<span className="text-[12.5px]/snug text-text-dim">{t(s.text)}</span>
				</div>
			</div>
			<div className="flex items-center gap-2">
				<div className="flex flex-1 gap-1.5">
					{STEPS.map((x, i) => (
						<span
							key={x.title}
							className={cn("h-1.5 rounded-full transition-all", i === step ? "w-5" : "w-1.5 bg-white/20")}
							style={i === step ? { background: ACCENT } : undefined}
						/>
					))}
				</div>
				{!last && (
					<button
						type="button"
						className="rounded-full px-3 py-1 text-[12px] font-bold text-text-dim hover:bg-white/8 hover:text-text"
						onClick={done}
					>
						{t("tour.skip")}
					</button>
				)}
				{step > 0 && (
					<button
						type="button"
						className="rounded-full bg-white/8 px-3 py-1 text-[12px] font-bold hover:bg-white/12"
						onClick={() => setStep(step - 1)}
					>
						{t("tour.back")}
					</button>
				)}
				<button
					type="button"
					className="rounded-full px-3.5 py-1 text-[12px] font-bold text-white hover:brightness-110"
					style={{ background: ACCENT }}
					onClick={() => (last ? done() : setStep(step + 1))}
				>
					{last ? t("tour.done") : t("tour.next")}
				</button>
			</div>
		</div>
	);
}

export const tourModule: IslandModule = {
	id: "tour",
	title: "tour.title",
	settingsIcon: <CompassIcon size={15} />,
	system: true,
	useView(): ModuleView {
		const open = useSetting(pending);
		return {
			active: false,
			priority: 0,
			hidden: true,
			accent: ACCENT,
			icon: <CompassIcon size={15} color={ACCENT} />,
			expanded: <TourPanel />,
			expandedSize: { width: 560, height: 150 },
			// Stays open until the last step or "Skip".
			forceExpanded: open,
			attention: open,
			openable: open,
		};
	},
};
