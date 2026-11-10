import { CalendarClockIcon, PartyPopperIcon, PinIcon, PinOffIcon, PlusIcon, XIcon } from "lucide-react";
/** Countdowns: days left until dates the person cares about. */
import { type ReactNode, useState } from "react";
import { cn } from "../../core/cn";
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

export const countdownItems: SettingDef<Countdown[]> = {
	key: "countdown.items",
	label: "countdown.title",
	default: [],
};
/** The countdown shown in the collapsed island, if any. */
const pinned: SettingDef<string | null> = { key: "countdown.pinned", label: "countdown.pin", default: null };
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

/** The countdown list (shown in the timer tab since 1.0, under its mode switch). */
export function CountdownPanel({ header }: { header?: ReactNode }) {
	const t = useT();
	const locale = useLocale();
	const now = useNow(60_000);
	const list = useSetting(countdownItems);
	const top = useSetting(pinned);
	const [name, setName] = useState("");
	const [date, setDate] = useState("");
	const nameKeys = useKeyboard("countdown.name");
	const dateKeys = useKeyboard("countdown.date");
	const sorted = [...list].sort((a, b) => localDay(a.date) - localDay(b.date));
	const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "long", year: "numeric" });

	const add = () => {
		if (!name.trim() || !date) return;
		setSetting(countdownItems, [...list, { id: newId(), name: name.trim(), date }]);
		setName("");
		setDate("");
	};

	return (
		<div className="flex h-full flex-col gap-2 px-1" onClick={(e) => e.stopPropagation()}>
			{header}
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
								{days === 0 ? <PartyPopperIcon size={22} className="ml-auto" /> : Math.abs(days)}
							</strong>
							<div className="flex min-w-0 flex-1 flex-col">
								<span className="truncate text-[13.5px] font-[650]">{c.name}</span>
								<span className="truncate text-[11.5px] text-text-faint">
									{label} · {fmt.format(localDay(c.date))}
								</span>
							</div>
							<button
								type="button"
								className={cn(
									"grid size-6 place-items-center rounded-full hover:bg-white/10 hover:text-text",
									top === c.id ? "text-[#FF375F]" : "text-text-faint opacity-0 group-hover:opacity-100",
								)}
								title={top === c.id ? t("countdown.unpin") : t("countdown.pin")}
								onClick={() => setSetting(pinned, top === c.id ? null : c.id)}
							>
								{top === c.id ? <PinOffIcon size={12} /> : <PinIcon size={12} />}
							</button>
							<button
								type="button"
								className="grid size-6 place-items-center rounded-full text-text-faint opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-text"
								title={t("countdown.remove")}
								onClick={() =>
									setSetting(
										countdownItems,
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
	// Its list lives in the timer tab; a pinned countdown still shows in the collapsed island.
	partOf: "timer",
	settingsIcon: <CalendarClockIcon size={15} />,
	settings: Object.values(countdownSettings),
	useView(): ModuleView {
		const t = useT();
		const list = useSetting(countdownItems);
		const showBubble = useSetting(countdownSettings.showBubble);
		const now = useNow(10 * 60_000);
		const pinnedId = useSetting(pinned);
		const pin = list.find((c) => c.id === pinnedId);
		const pinDays = pin ? daysUntil(pin.date, now) : -1;
		const next = list
			.map((c) => daysUntil(c.date, now))
			.filter((d) => d >= 0)
			.sort((a, b) => a - b)[0];
		return {
			active: !!pin && pinDays >= 0,
			priority: 2,
			compact:
				pin && pinDays >= 0
					? {
							left: (
								<span className="flex min-w-0 items-center gap-2 text-[13px] font-[650]">
									<CalendarClockIcon size={15} color={ACCENT} className="flex-none" />
									<span className="truncate">{pin.name}</span>
								</span>
							),
							right: (
								<span className="text-[13px] font-bold whitespace-nowrap tabular-nums" style={{ color: ACCENT }}>
									{pinDays === 0
										? t("countdown.today")
										: pinDays === 1
											? t("countdown.tomorrow")
											: t("countdown.short", { n: pinDays })}
								</span>
							),
							width: 270,
						}
					: undefined,
			menu: pin ? [{ label: t("countdown.unpin"), onSelect: () => setSetting(pinned, null) }] : undefined,
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
