import { PauseIcon, PlayIcon, SquareIcon, TimerIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { NumberField } from "../../../components/ui/form";
import { SectionLabel } from "../../../components/ui/text";
import { useT } from "../../../core/i18n";
import { useSetting } from "../../../core/settings";
import { useNow } from "../../ai-agents/common/format";
import { clockLabel } from "../format";
import { ModeSwitch } from "../mode";
import { TIMER_ACCENT, TIMER_PRESETS, timerLastMinutes } from "../settings";

const button =
	"flex h-8 items-center gap-1.5 rounded-2xl px-3.25 text-[12px] font-bold transition-[filter,background] duration-150 hover:brightness-114";
const primary = `${button} bg-[#ff9f0a] text-black`;
const secondary = `${button} bg-white/9 text-text-dim`;
const chip =
	"h-7 min-w-9.5 rounded-full bg-white/8 px-2.5 text-[12px] font-[650] tabular-nums text-text transition-[background] duration-150 hover:bg-[rgba(255,179,64,0.22)] hover:text-[#ffd08a]";

const MAX_MINUTES = 24 * 60;

export interface TimerPanelProps {
	deadline: number | null;
	pausedRemaining: number | null;
	total: number;
	due: boolean;
	minutes: number;
	onStart: (minutes: number) => void;
	onPause: () => void;
	onResume: () => void;
	onStop: () => void;
	onAdd: (minutes: number) => void;
	onDismiss: () => void;
}

export function TimerPanel(props: TimerPanelProps) {
	const { deadline, pausedRemaining, due } = props;
	const idle = !deadline && pausedRemaining === null && !due;
	return (
		<div
			className="group flex h-full items-center gap-3.5 px-2.5"
			data-due={due || undefined}
			onClick={(e) => e.stopPropagation()}
		>
			<span className="grid size-11.5 flex-none place-items-center rounded-2xl bg-[rgba(255,179,64,0.14)] text-[#ffd08a] group-data-due:animate-pulse group-data-due:bg-[#ff9f0a] group-data-due:text-black">
				<TimerIcon size={21} />
			</span>
			{idle ? <Setup onStart={props.onStart} /> : <Countdown {...props} />}
		</div>
	);
}

/** Quick picks plus a field for any number of minutes. */
function Setup({ onStart }: { onStart: (minutes: number) => void }) {
	const t = useT();
	const last = useSetting(timerLastMinutes);
	const [draft, setDraft] = useState(String(last));
	useEffect(() => setDraft(String(last)), [last]);
	const custom = Math.round(Number(draft));
	const valid = Number.isFinite(custom) && custom >= 1 && custom <= MAX_MINUTES;

	return (
		<>
			<div className="flex min-w-0 flex-1 flex-col gap-1.5">
				<div className="flex items-center gap-2">
					<ModeSwitch />
					<span className="truncate text-[11px] text-text-faint">{t("timer.set")}</span>
				</div>
				<div className="flex flex-wrap gap-1.5">
					{TIMER_PRESETS.map((minutes) => (
						<button
							key={minutes}
							type="button"
							className={chip}
							aria-label={t("timer.minutes", { n: minutes })}
							onClick={() => onStart(minutes)}
						>
							{minutes}
						</button>
					))}
				</div>
			</div>
			<div className="flex flex-none items-center gap-1.75">
				<NumberField
					unit="min"
					min={1}
					max={MAX_MINUTES}
					step={1}
					value={draft}
					aria-label={t("timer.custom")}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && valid && onStart(custom)}
				/>
				<button type="button" className={primary} disabled={!valid} onClick={() => valid && onStart(custom)}>
					<PlayIcon size={13} fill="currentColor" />
					{t("timer.start")}
				</button>
			</div>
		</>
	);
}

/** Remaining time over a bar that burns down from right to left. */
function Countdown({
	deadline,
	pausedRemaining,
	total,
	due,
	minutes,
	onPause,
	onResume,
	onStop,
	onAdd,
	onDismiss,
}: TimerPanelProps) {
	const t = useT();
	const running = !!deadline && !due;
	const now = useNow(250, running);
	const remaining = due ? 0 : running ? deadline - now : (pausedRemaining ?? 0);
	const progress = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0;

	return (
		<>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<SectionLabel size="sm">
					{due ? t("timer.done") : running ? t("timer.running") : t("timer.paused")}
				</SectionLabel>
				<strong
					className={due ? "truncate text-[18px]/[1.2]" : "text-[22px]/[1.1] tabular-nums"}
					style={{ color: due ? TIMER_ACCENT : undefined }}
				>
					{due
						? minutes === 1
							? t("timer.doneMessageOne")
							: t("timer.doneMessage", { n: minutes })
						: clockLabel(remaining)}
				</strong>
				<span className="relative mt-1 h-1.25 overflow-hidden rounded-full bg-white/8">
					<span
						className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-linear"
						style={{
							width: `${progress * 100}%`,
							background: `linear-gradient(90deg, #ff6a00, ${TIMER_ACCENT})`,
							opacity: running ? 1 : 0.45,
						}}
					/>
				</span>
			</div>
			<div className="flex flex-none gap-1.75">
				{due ? (
					<>
						<button type="button" className={secondary} onClick={() => onAdd(5)}>
							{t("timer.addFive")}
						</button>
						<button type="button" className={primary} onClick={() => onDismiss()}>
							{t("timer.dismiss")}
						</button>
					</>
				) : (
					<>
						<button type="button" className={secondary} onClick={() => onAdd(1)}>
							{t("timer.addMinute")}
						</button>
						{running ? (
							<button type="button" className={secondary} onClick={() => onPause()} aria-label={t("timer.pause")}>
								<PauseIcon size={13} fill="currentColor" />
							</button>
						) : (
							<button type="button" className={primary} onClick={() => onResume()} aria-label={t("timer.resume")}>
								<PlayIcon size={13} fill="currentColor" />
							</button>
						)}
						<button type="button" className={secondary} onClick={() => onStop()} aria-label={t("timer.stop")}>
							<SquareIcon size={12} fill="currentColor" />
						</button>
					</>
				)}
			</div>
		</>
	);
}
