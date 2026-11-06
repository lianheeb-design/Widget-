import { FlagIcon, PauseIcon, PlayIcon, RotateCcwIcon, TimerResetIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { useT } from "../../core/i18n";
import { useNow } from "../ai-agents/common/format";
import { ModeSwitch } from "./mode";
import { TIMER_ACCENT } from "./settings";

export interface Stopwatch {
	/** When it last started running; `null` while stopped. */
	startedAt: number | null;
	/** Time run before `startedAt`. */
	before: number;
	/** Split times (total elapsed at each lap), oldest first. */
	laps: number[];
}

const RESET: Stopwatch = { startedAt: null, before: 0, laps: [] };

export const elapsed = (s: Stopwatch, now: number) => s.before + (s.startedAt ? now - s.startedAt : 0);

/** `m:ss.cc`, or `h:mm:ss` from one hour on. */
export function stopwatchLabel(ms: number) {
	const total = Math.max(0, Math.floor(ms));
	const hours = Math.floor(total / 3_600_000);
	const minutes = Math.floor((total % 3_600_000) / 60_000);
	const seconds = Math.floor((total % 60_000) / 1000);
	const hundredths = Math.floor((total % 1000) / 10);
	const ss = String(seconds).padStart(2, "0");
	return hours
		? `${hours}:${String(minutes).padStart(2, "0")}:${ss}`
		: `${minutes}:${ss}.${String(hundredths).padStart(2, "0")}`;
}

export function useStopwatch() {
	const [state, setState] = useState<Stopwatch>(RESET);
	return {
		state,
		toggle: useCallback(
			() =>
				setState((s) =>
					s.startedAt ? { ...s, before: elapsed(s, Date.now()), startedAt: null } : { ...s, startedAt: Date.now() },
				),
			[],
		),
		lap: useCallback(
			() => setState((s) => (s.startedAt ? { ...s, laps: [...s.laps, elapsed(s, Date.now())] } : s)),
			[],
		),
		reset: useCallback(() => setState(RESET), []),
	};
}

const button =
	"flex h-8 items-center gap-1.5 rounded-2xl px-3.25 text-[12px] font-bold transition-[filter,background] duration-150 hover:brightness-114 disabled:opacity-40";
const primary = `${button} bg-[#ff9f0a] text-black`;
const secondary = `${button} bg-white/9 text-text-dim`;

export function StopwatchPanel({ stopwatch }: { stopwatch: ReturnType<typeof useStopwatch> }) {
	const t = useT();
	const { state } = stopwatch;
	const running = !!state.startedAt;
	const now = useNow(41, running);
	const total = elapsed(state, now);
	const touched = running || state.before > 0;
	// Newest laps first, each with its own length.
	const laps = state.laps
		.map((at, i) => ({ n: i + 1, length: at - (state.laps[i - 1] ?? 0) }))
		.reverse()
		.slice(0, 3);

	return (
		<div className="flex h-full items-center gap-3.5 px-2.5" onClick={(e) => e.stopPropagation()}>
			<span className="grid size-11.5 flex-none place-items-center rounded-2xl bg-[rgba(255,179,64,0.14)] text-[#ffd08a]">
				<TimerResetIcon size={21} />
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<ModeSwitch />
				<strong
					className="text-[24px]/[1.15] tabular-nums"
					style={{ color: running ? undefined : touched ? TIMER_ACCENT : undefined }}
				>
					{stopwatchLabel(total)}
				</strong>
				<span className="h-4 truncate text-[11.5px] text-text-faint tabular-nums">
					{laps.map((l) => `${t("timer.stopwatch.laps", { n: l.n })} ${stopwatchLabel(l.length)}`).join("   ")}
				</span>
			</div>
			<div className="flex flex-none gap-1.75">
				{running ? (
					<button type="button" className={secondary} onClick={stopwatch.lap}>
						<FlagIcon size={13} />
						{t("timer.stopwatch.lap")}
					</button>
				) : (
					<button type="button" className={secondary} disabled={!touched} onClick={stopwatch.reset}>
						<RotateCcwIcon size={13} />
						{t("timer.stopwatch.reset")}
					</button>
				)}
				<button
					type="button"
					className={running ? secondary : primary}
					aria-label={running ? t("timer.pause") : t("timer.start")}
					onClick={stopwatch.toggle}
				>
					{running ? <PauseIcon size={13} fill="currentColor" /> : <PlayIcon size={13} fill="currentColor" />}
					{running ? t("timer.pause") : touched ? t("timer.resume") : t("timer.start")}
				</button>
			</div>
		</div>
	);
}

/** Compact island: ticks on its own, like the timer's. */
export function StopwatchRemaining({ state }: { state: Stopwatch }) {
	const now = useNow(100, !!state.startedAt);
	const ms = elapsed(state, now);
	return (
		<span
			className="text-[13px] font-bold tabular-nums"
			style={{ color: TIMER_ACCENT, opacity: state.startedAt ? 1 : 0.55 }}
		>
			{stopwatchLabel(ms).replace(/\.\d+$/, "")}
		</span>
	);
}
