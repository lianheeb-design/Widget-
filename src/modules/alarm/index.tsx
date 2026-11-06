import { AlarmClockIcon, AlarmClockOffIcon, BellRingIcon, PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
/**
 * Alarm clock: alarms at a time of day, once or on chosen weekdays. A ringing
 * alarm takes over the island and rings (in the backend, Windows' alarm
 * tones) until it is turned off or snoozed. Alarms are kept in the settings,
 * so they survive a restart; one missed while the PC was busy still rings up
 * to half an hour late.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Block, Desc, Divider, Row } from "../../components/ui/card";
import { Segmented, Select } from "../../components/ui/form";
import { cn } from "../../core/cn";
import { useLocale, useT } from "../../core/i18n";
import { type SettingDef, setSetting, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { fieldClass, newId, smallButton, useKeyboard } from "../shared";
import { playChime, primeChime } from "../timer/chime";
import { tools } from "../tools/bridge";
import { type Alarm, dueRing, nextOccurrence, nextRing, type Ring, untilParts, WEEK } from "./schedule";

const ACCENT = "#FF9F0A";
/** A ringing alarm turns itself off after this long. */
const RING_LIMIT = 10 * 60_000;
const SNOOZE_CHOICES = [5, 9, 10, 15];

const alarmItems: SettingDef<Alarm[]> = { key: "alarm.items", label: "alarm.title", default: [] };
/** Alarm id → the latest ring time already dealt with (rung and stopped, or set after it). */
const alarmHandled: SettingDef<Record<string, number>> = { key: "alarm.handled", label: "alarm.title", default: {} };
const alarmSnooze: SettingDef<Ring | null> = { key: "alarm.snooze", label: "alarm.snooze.label", default: null };
const alarmTone: SettingDef<number> = { key: "alarm.tone", label: "alarm.tone.label", default: 1 };
const alarmSnoozeMinutes: SettingDef<number> = {
	key: "alarm.snoozeMinutes",
	label: "alarm.snooze.label",
	default: 5,
};
export const alarmSettings = {
	showBubble: {
		key: "alarm.showBubble",
		label: "alarm.showBubble.label",
		description: "alarm.showBubble.desc",
		default: true,
	},
} satisfies Record<string, SettingDef>;

/** Writes go through these so a just-set alarm doesn't ring for a time already past. */
function markHandled(handled: Record<string, number>, id: string, at = Date.now()) {
	setSetting(alarmHandled, { ...handled, [id]: Math.max(handled[id] ?? 0, at) });
}

const two = (n: number) => String(n).padStart(2, "0");
const timeOf = (ms: number) => {
	const d = new Date(ms);
	return `${two(d.getHours())}:${two(d.getMinutes())}`;
};

function useWeekdays() {
	const locale = useLocale();
	const t = useT();
	const narrow = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
	const short = new Intl.DateTimeFormat(locale, { weekday: "short" });
	// 2024-01-07 was a Sunday: day `d` of the week is 7 + d.
	const name = (fmt: Intl.DateTimeFormat, d: number) => fmt.format(new Date(2024, 0, 7 + d));
	const repeatText = (days: number[]) => {
		const set = new Set(days);
		if (!set.size) return t("alarm.once");
		if (set.size === 7) return t("alarm.daily");
		if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return t("alarm.weekdays");
		if (set.size === 2 && set.has(0) && set.has(6)) return t("alarm.weekend");
		return WEEK.filter((d) => set.has(d))
			.map((d) => name(short, d))
			.join(", ");
	};
	return { letter: (d: number) => name(narrow, d), repeatText };
}

function Until({ at, now }: { at: number; now: number }) {
	const t = useT();
	const { days, hours, minutes } = untilParts(at, now);
	if (days > 0) return <>{t("alarm.inDays", { d: days, h: hours })}</>;
	if (hours > 0) return <>{t("alarm.inHours", { h: hours, m: two(minutes) })}</>;
	return <>{t("alarm.inMinutes", { m: Math.max(1, minutes) })}</>;
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={on}
			aria-label={label}
			className={cn(
				"relative flex h-5.5 w-9 flex-none items-center rounded-full p-0.5 transition-[background] duration-200",
				on ? "justify-end bg-[#FF9F0A]" : "bg-white/16",
			)}
			onClick={() => onChange(!on)}
		>
			<span className="size-4.5 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.35)]" />
		</button>
	);
}

function AlarmList({
	now,
	snoozed,
	onCancelSnooze,
}: {
	now: number;
	snoozed: Ring | null;
	onCancelSnooze: () => void;
}) {
	const t = useT();
	const list = useSetting(alarmItems);
	const handled = useSetting(alarmHandled);
	const { letter, repeatText } = useWeekdays();
	const [time, setTime] = useState("07:00");
	const [label, setLabel] = useState("");
	const timeKeys = useKeyboard("alarm.time");
	const labelKeys = useKeyboard("alarm.label");
	const sorted = [...list].sort((a, b) => a.time.localeCompare(b.time));
	const next = nextRing(list, now);

	const update = (id: string, change: Partial<Alarm>) => {
		const nextList = list.map((a) => (a.id === id ? { ...a, ...change } : a));
		setSetting(alarmItems, nextList);
		// Turned on or moved: only ring from now on.
		if (change.enabled || change.time || change.days) markHandled(handled, id);
	};
	const add = () => {
		if (!/^\d{2}:\d{2}$/.test(time)) return;
		primeChime();
		const id = newId();
		setSetting(alarmItems, [...list, { id, time, label: label.trim(), days: [], enabled: true }]);
		markHandled(handled, id);
		setLabel("");
	};
	const remove = (id: string) => {
		setSetting(
			alarmItems,
			list.filter((a) => a.id !== id),
		);
		const { [id]: _, ...rest } = handled;
		setSetting(alarmHandled, rest);
	};

	return (
		<div className="flex h-full flex-col gap-2 px-1" onClick={(e) => e.stopPropagation()}>
			<div className="flex items-center gap-1.5 text-[12px] font-[650] text-text-dim">
				<AlarmClockIcon size={13} color={ACCENT} />
				{next ? (
					<span className="truncate">
						{t("alarm.next", { time: timeOf(next.at) })} · <Until at={next.at} now={now} />
					</span>
				) : (
					<span>{list.length ? t("alarm.allOff") : t("alarm.empty")}</span>
				)}
				{snoozed && (
					<button
						type="button"
						className="ml-auto flex-none rounded-full bg-[rgba(255,159,10,0.18)] px-2.5 py-0.5 text-[11.5px] font-bold text-[#ffc56b] hover:bg-[rgba(255,159,10,0.28)]"
						onClick={onCancelSnooze}
					>
						{t("alarm.snoozedUntil", { time: timeOf(snoozed.at) })} ✕
					</button>
				)}
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" data-scroll>
				{sorted.map((a) => (
					<div key={a.id} className="group flex flex-none items-center gap-3 rounded-[12px] px-2 py-1 hover:bg-white/5">
						<Switch on={a.enabled} label={a.time} onChange={(on) => update(a.id, { enabled: on })} />
						<strong
							className={cn("w-15 flex-none text-[22px]/none font-[600] tabular-nums", !a.enabled && "text-text-faint")}
						>
							{a.time}
						</strong>
						<div className="flex min-w-0 flex-1 flex-col">
							<span className="truncate text-[13px] font-[650]">{a.label || t("alarm.title")}</span>
							<span className="truncate text-[11.5px] text-text-faint">
								{repeatText(a.days)}
								{a.enabled && nextOccurrence(a, now) !== null && (
									<>
										{" · "}
										<Until at={nextOccurrence(a, now) ?? now} now={now} />
									</>
								)}
							</span>
						</div>
						<div className="flex flex-none gap-0.5" title={t("alarm.repeat")}>
							{WEEK.map((d) => {
								const on = a.days.includes(d);
								return (
									<button
										type="button"
										key={d}
										className={cn(
											"grid size-5.5 place-items-center rounded-full text-[10.5px] font-bold transition-[background,color]",
											on ? "bg-[rgba(255,159,10,0.25)] text-[#ffc56b]" : "text-text-faint hover:bg-white/10",
										)}
										onClick={() => update(a.id, { days: on ? a.days.filter((x) => x !== d) : [...a.days, d] })}
									>
										{letter(d)}
									</button>
								);
							})}
						</div>
						<button
							type="button"
							className="grid size-6 flex-none place-items-center rounded-full text-text-faint opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-text"
							title={t("alarm.remove")}
							onClick={() => remove(a.id)}
						>
							<Trash2Icon size={12} />
						</button>
					</div>
				))}
			</div>
			<div className="flex gap-1.5">
				<input
					type="time"
					className={`${fieldClass} w-28 [color-scheme:dark]`}
					value={time}
					aria-label={t("alarm.time")}
					onChange={(e) => setTime(e.target.value)}
					{...timeKeys}
					onKeyDown={(e) => (e.key === "Enter" ? add() : timeKeys.onKeyDown(e))}
				/>
				<input
					className={`${fieldClass} flex-1`}
					value={label}
					placeholder={t("alarm.labelPlaceholder")}
					onChange={(e) => setLabel(e.target.value)}
					{...labelKeys}
					onKeyDown={(e) => (e.key === "Enter" ? add() : labelKeys.onKeyDown(e))}
				/>
				<button type="button" className={smallButton} disabled={!time} onClick={add}>
					<PlusIcon size={13} />
					{t("alarm.add")}
				</button>
			</div>
		</div>
	);
}

function RingingPanel({ alarm, onSnooze, onStop }: { alarm: Alarm; onSnooze: () => void; onStop: () => void }) {
	const t = useT();
	const minutes = useSetting(alarmSnoozeMinutes);
	return (
		<div className="flex h-full items-center gap-4 px-3" onClick={(e) => e.stopPropagation()}>
			<span className="grid size-14 flex-none animate-pulse place-items-center rounded-full bg-[rgba(255,159,10,0.2)]">
				<BellRingIcon size={28} color={ACCENT} />
			</span>
			<div className="flex min-w-0 flex-1 flex-col">
				<strong className="text-[40px]/none font-[600] tabular-nums">{alarm.time}</strong>
				<span className="truncate text-[13.5px] font-[650] text-text-dim">{alarm.label || t("alarm.title")}</span>
			</div>
			<button
				type="button"
				className="flex h-11 flex-none items-center gap-1.5 rounded-[22px] bg-white/10 px-4 text-[13px] font-bold text-text hover:bg-white/15"
				onClick={onSnooze}
			>
				<AlarmClockIcon size={15} />
				{t("alarm.snooze.button", { n: minutes })}
			</button>
			<button
				type="button"
				className="flex h-11 flex-none items-center gap-1.5 rounded-[22px] bg-[#FF9F0A] px-5 text-[13px] font-bold text-black hover:brightness-110"
				onClick={onStop}
			>
				<AlarmClockOffIcon size={15} />
				{t("alarm.stop")}
			</button>
		</div>
	);
}

/** Checks the alarms every second without re-rendering the island each time. */
function useRinging() {
	const list = useSetting(alarmItems);
	const handled = useSetting(alarmHandled);
	const snooze = useSetting(alarmSnooze);
	const tone = useSetting(alarmTone);
	const snoozeMinutes = useSetting(alarmSnoozeMinutes);
	const [ring, setRing] = useState<Ring | undefined>(undefined);
	const [now, setNow] = useState(() => Date.now());
	const latest = useRef({ list, handled, snooze });
	latest.current = { list, handled, snooze };
	const ringKey = ring ? `${ring.id}:${ring.at}` : undefined;
	const startedAt = useRef(0);

	useEffect(() => {
		const check = () => {
			const at = Date.now();
			const { list, handled, snooze } = latest.current;
			const due = dueRing(list, handled, snooze, at);
			setRing((old) => (old?.id === due?.id && old?.at === due?.at ? old : due));
			// The list's "in 3 h 05 min" only needs the minute.
			setNow((old) => (Math.floor(old / 60_000) === Math.floor(at / 60_000) ? old : at));
		};
		check();
		const timer = window.setInterval(check, 1000);
		return () => window.clearInterval(timer);
	}, []);
	// Settings changed (alarm added, stopped…): check right away.
	useEffect(() => {
		setRing(dueRing(list, handled, snooze, Date.now()));
	}, [list, handled, snooze]);

	const finish = useCallback(
		(snoozeFor?: number) => {
			if (!ring) return;
			const { list, handled } = latest.current;
			const at = Date.now();
			markHandled(handled, ring.id, at);
			setSetting(alarmSnooze, snoozeFor ? { id: ring.id, at: at + snoozeFor * 60_000 } : null);
			// A one-time alarm is done once it is turned off.
			const alarm = list.find((a) => a.id === ring.id);
			if (!snoozeFor && alarm && !alarm.days.length && alarm.enabled)
				setSetting(
					alarmItems,
					list.map((a) => (a.id === ring.id ? { ...a, enabled: false } : a)),
				);
			setRing(undefined);
		},
		[ring],
	);

	// Ring in the backend while due; a short chime if the backend can't.
	useEffect(() => {
		if (!ringKey) return;
		startedAt.current = Date.now();
		let fallback = 0;
		tools("alarm_start", { tone }).catch(() => {
			playChime();
			fallback = window.setInterval(playChime, 2500);
		});
		return () => {
			window.clearInterval(fallback);
			tools("alarm_stop").catch(() => undefined);
		};
	}, [ringKey, tone]);

	// Nobody there: stop after a while, like a phone does.
	useEffect(() => {
		if (ringKey && now - startedAt.current > RING_LIMIT) finish();
	}, [now, ringKey, finish]);

	return {
		ring,
		now,
		alarm: ring ? list.find((a) => a.id === ring.id) : undefined,
		snoozed: !ring && snooze && list.some((a) => a.id === snooze.id) ? snooze : null,
		stop: () => finish(),
		snooze: () => finish(snoozeMinutes),
		// Ending a snooze is turning the alarm off: a one-time alarm is then done.
		cancelSnooze: () => {
			if (snooze && list.some((a) => a.id === snooze.id && !a.days.length && a.enabled))
				setSetting(
					alarmItems,
					list.map((a) => (a.id === snooze.id ? { ...a, enabled: false } : a)),
				);
			setSetting(alarmSnooze, null);
		},
		anyOn: list.some((a) => a.enabled),
		count: list.length,
	};
}

function AlarmSettings() {
	const t = useT();
	const tone = useSetting(alarmTone);
	const snooze = useSetting(alarmSnoozeMinutes);
	return (
		<>
			<Block>
				<Row label={t("alarm.tone.label")} desc={t("alarm.tone.desc")}>
					<span className="flex flex-none items-center gap-2">
						<Select value={tone} onChange={(e) => setSetting(alarmTone, Number(e.target.value))}>
							{Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
								<option key={n} value={n}>
									{t("alarm.tone.option", { n })}
								</option>
							))}
						</Select>
						<Button onClick={() => tools("alarm_test", { tone }).catch(() => playChime())}>
							<PlayIcon size={12} />
							{t("alarm.tone.test")}
						</Button>
					</span>
				</Row>
			</Block>
			<Divider />
			<Row label={t("alarm.snooze.label")}>
				<Segmented<number>
					value={snooze}
					options={SNOOZE_CHOICES.map((n) => ({ value: n, label: t("alarm.minutes", { n }) }))}
					onChange={(value) => setSetting(alarmSnoozeMinutes, value)}
				/>
			</Row>
			<Divider />
			<Desc>{t("alarm.note")}</Desc>
		</>
	);
}

export const alarmModule: IslandModule = {
	id: "alarm",
	title: "alarm.title",
	settingsIcon: <AlarmClockIcon size={15} />,
	settings: Object.values(alarmSettings),
	SettingsSection: AlarmSettings,
	useView(): ModuleView {
		const t = useT();
		const showBubble = useSetting(alarmSettings.showBubble);
		const r = useRinging();
		const ringing = !!r.ring && !!r.alarm;

		return {
			active: ringing || !!r.snoozed,
			// A ringing alarm beats everything, even a finished timer.
			priority: ringing ? 97 : 30,
			accent: ACCENT,
			icon: <AlarmClockIcon size={15} color={ACCENT} />,
			compact: ringing
				? {
						left: (
							<span className="flex items-center gap-2 text-[13px] font-[650]">
								<BellRingIcon size={15} color={ACCENT} className="animate-pulse" />
								{r.alarm?.label || t("alarm.title")}
							</span>
						),
						right: (
							<span className="text-[12.5px] font-bold tabular-nums" style={{ color: ACCENT }}>
								{r.alarm?.time}
							</span>
						),
						width: 250,
					}
				: r.snoozed
					? {
							left: (
								<span className="flex items-center gap-2 text-[13px] font-[650]">
									<AlarmClockIcon size={15} color={ACCENT} />
									{t("alarm.snoozed")}
								</span>
							),
							right: (
								<span className="text-[12px] font-bold tabular-nums" style={{ color: ACCENT }}>
									{timeOf(r.snoozed.at)}
								</span>
							),
							width: 250,
						}
					: undefined,
			ambient: showBubble && r.anyOn ? <AlarmClockIcon size={16} color={ACCENT} /> : undefined,
			expanded:
				ringing && r.alarm ? (
					<RingingPanel alarm={r.alarm} onSnooze={r.snooze} onStop={r.stop} />
				) : (
					<AlarmList now={r.now} snoozed={r.snoozed} onCancelSnooze={r.cancelSnooze} />
				),
			expandedSize: ringing
				? { width: 560, height: 120 }
				: { width: 560, height: Math.min(300, 118 + Math.max(1, r.count) * 40) },
			activityKey: r.ring ? `ring:${r.ring.id}:${r.ring.at}` : undefined,
			attention: ringing,
			forceExpanded: ringing,
		};
	},
};
