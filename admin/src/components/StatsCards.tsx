import { ActivityIcon, BanIcon, CircleCheckIcon, LayersIcon, SparklesIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Stats } from "../lib/api";

export const ONLINE_WINDOWS = [
	{ minutes: 15, label: "15 Min." },
	{ minutes: 60, label: "1 Std." },
	{ minutes: 24 * 60, label: "24 Std." },
] as const;

export const NEW_DAYS = 7;

/** The overview: how many installations, in which state, how many in use. */
export function StatsCards({
	stats,
	onlineMinutes,
	onOnlineMinutes,
}: {
	stats: Stats | null;
	onlineMinutes: number;
	onOnlineMinutes: (minutes: number) => void;
}) {
	const value = (n: number | undefined) => (n === undefined ? "–" : n.toLocaleString("de-CH"));
	return (
		<section className="grid grid-cols-2 gap-3 md:grid-cols-5">
			<Card icon={<LayersIcon size={16} />} tone="text-text-dim" label="Gesamt" value={value(stats?.total)} />
			<Card icon={<CircleCheckIcon size={16} />} tone="text-[#4ee67a]" label="Aktiv" value={value(stats?.active)} />
			<Card icon={<BanIcon size={16} />} tone="text-[#ff6961]" label="Gesperrt" value={value(stats?.blocked)} />
			<Card
				icon={<ActivityIcon size={16} />}
				tone="text-[#64b5ff]"
				label="In Betrieb"
				value={value(stats?.online)}
				footer={
					<select
						aria-label="Zeitraum für «In Betrieb»"
						value={onlineMinutes}
						onChange={(e) => onOnlineMinutes(Number(e.target.value))}
						className="rounded-md bg-white/6 px-1.5 py-0.5 text-[11.5px] text-text-dim outline-none"
					>
						{ONLINE_WINDOWS.map((w) => (
							<option key={w.minutes} value={w.minutes}>
								Kontakt in {w.label}
							</option>
						))}
					</select>
				}
			/>
			<Card
				icon={<SparklesIcon size={16} />}
				tone="text-[#ffb340]"
				label="Neu"
				value={value(stats?.new)}
				footer={<span className="text-[11.5px] text-text-faint">letzte {NEW_DAYS} Tage</span>}
			/>
		</section>
	);
}

function Card({
	icon,
	tone,
	label,
	value,
	footer,
}: {
	icon: ReactNode;
	tone: string;
	label: string;
	value: string;
	footer?: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5 rounded-2xl bg-panel px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--color-hairline)]">
			<span className={`flex items-center gap-1.5 text-[12.5px] font-semibold ${tone}`}>
				{icon}
				{label}
			</span>
			<span className="text-[26px] font-bold tabular-nums tracking-tight">{value}</span>
			{footer}
		</div>
	);
}
