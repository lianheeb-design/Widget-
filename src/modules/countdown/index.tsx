import { CalendarClockIcon, PlusIcon, XIcon } from "lucide-react";
/** Countdowns: days left until dates the person cares about. */
import { useState } from "react";
import { useLocale, useT } from "../../core/i18n";
import { type SettingDef, setSetting, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { useNow } from "../ai-agents/common/format";
import { fieldClass, newId, smallButton, useKeyboard } from "../shared";

const ACCENT = "#FF375F";
const DAY = 86_400_000;

interface Countdown {
	id: string;
	name: string;
	/** `YYYY-MM-DD`, local. */
	date: string;
}

const items: SettingDef<Countdown[]> = { key: "countdown.items", label: "countdown.title", default: [] };
export const countdownSettings = {
	showBubble: {
		key: "countdown.showBubble",
		label: "countdown.showBubble.label",
		description: "countdown.showBubble.desc",
		default: false,
	},
} satisfies Record<string, SettingDef>;

const localDay = (date: string) => {
	const [y, m, d] = date.split("-").map(Number);
	return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
};
const daysUntil = (date: string, now: number) => {
	const today = new Date(now);
	return Math.round(
		(localDay(date) - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / DAY,
	);
};

function CountdownPanel() {
	const t = useT();
	const locale = useLocale();
	const now = useNow(60_000);
	const list = useSetting(items);
	const [name, setName] = useState("");
	const [date, setDate] = useState("");
	const nameKeys = useKeyboard("countdown.name");
	const dateKeys = useKeyboard("countdown.date");
	const sorted = [...list].sort((a, b) => localDay(a.date) - localDay(b.date));
	const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "long", year: "numeric" });

	const add = () => {
		if (!name.trim() || !date) return;
		setSetting(items, [...list, { id: newId(), name: name.trim(), date }]);
		setName("");
		setDate("");
	};

	return (
		<div className="flex h-full flex-col gap-2 px-1" onClick={(e) => e.stopPropagation()}>
			<div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" data-scroll>
				{sorted.length === 0 && <p className="py-2 text-[12.5px] text-text-dim">{t("countdown.empty")}</p>}
				{sorted.map((c) => {
					const days = daysUntil(c.date, now);
					const label =
						days === 0
							? t("countdown.today")
							: days === 1
								? t("countdown.tomorrow")
								: days > 1
									? t("countdown.inDays", { n: days })
									: t("countdown.ago", { n: -days });
					return (
						<div key={c.id} className="group flex items-center gap-3 rounded-[12px] px-2 py-1 hover:bg-white/5">
							<strong
								className="w-14 flex-none text-right text-[22px]/none tabular-nums"
								style={{ color: days >= 0 ? ACCENT : undefined, opacity: days < 0 ? 0.45 : 1 }}
							>
								{days === 0 ? "🎉" : Math.abs(days)}
							</strong>
							<div className="flex min-w-0 flex-1 flex-col">
								<span className="truncate text-[13.5px] font-[650]">{c.name}</span>
								<span className="truncate text-[11.5px] text-text-faint">
									{label} · {fmt.format(localDay(c.date))}
								</span>
							</div>
							<button
								type="button"
								className="grid size-6 place-items-center rounded-full text-text-faint opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-text"
								title={t("countdown.remove")}
								onClick={() =>
									setSetting(
										items,
										list.filter((x) => x.id !== c.id),
									)
								}
							>
								<XIcon size={12} />
							</button>
						</div>
					);
				})}
			</div>
			<div className="flex gap-1.5">
				<input
					className={`${fieldClass} flex-1`}
					value={name}
					placeholder={t("countdown.namePlaceholder")}
					onChange={(e) => setName(e.target.value)}
					{...nameKeys}
					onKeyDown={(e) => (e.key === "Enter" ? add() : nameKeys.onKeyDown(e))}
				/>
				<input
					type="date"
					className={`${fieldClass} w-36 [color-scheme:dark]`}
					value={date}
					aria-label={t("countdown.date")}
					onChange={(e) => setDate(e.target.value)}
					{...dateKeys}
				/>
				<button type="button" className={smallButton} disabled={!name.trim() || !date} onClick={add}>
					<PlusIcon size={13} />
					{t("countdown.add")}
				</button>
			</div>
		</div>
	);
}

export const countdownModule: IslandModule = {
	id: "countdown",
	title: "countdown.title",
	settingsIcon: <CalendarClockIcon size={15} />,
	settings: Object.values(countdownSettings),
	useView(): ModuleView {
		const list = useSetting(items);
		const showBubble = useSetting(countdownSettings.showBubble);
		const now = useNow(60 * 60_000);
		const next = list
			.map((c) => daysUntil(c.date, now))
			.filter((d) => d >= 0)
			.sort((a, b) => a - b)[0];
		return {
			active: false,
			priority: 0,
			accent: ACCENT,
			icon: <CalendarClockIcon size={15} color={ACCENT} />,
			ambient:
				showBubble && next !== undefined ? (
					<>
						<CalendarClockIcon size={17} color={ACCENT} />
						<span className="absolute -right-1.5 -bottom-1 z-3 grid h-4.5 min-w-4.5 place-items-center rounded-[9px] bg-[#b3243f] px-1.25 text-[10.5px] font-[750] text-white tabular-nums shadow-[0_0_0_2px_var(--island)]">
							{next}
						</span>
					</>
				) : undefined,
			expanded: <CountdownPanel />,
			expandedSize: { width: 560, height: Math.min(260, 110 + Math.max(1, list.length) * 46) },
		};
	},
};
