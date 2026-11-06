import { TimerIcon, TimerResetIcon } from "lucide-react";
/**
 * Timer: a countdown started from quick picks or any number of minutes. It
 * owns the compact island while it runs, and pops the island open with a
 * chime when it's done. Frontend only, no provider.
 */
import { useCallback, useEffect, useState } from "react";
import { useT } from "../../core/i18n";
import { setSetting, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { playChime, primeChime } from "./chime";
import { TimerRemaining } from "./components/TimerCompact";
import { TimerPanel } from "./components/TimerPanel";
import { timerMode } from "./mode";
import { TIMER_ACCENT, timerLastMinutes, timerSettings } from "./settings";
import { StopwatchPanel, StopwatchRemaining, useStopwatch } from "./stopwatch";

const MINUTE = 60_000;

interface TimerState {
	deadline: number | null;
	pausedRemaining: number | null;
	/** Full length in ms, including added minutes (for the progress bar). */
	total: number;
	due: boolean;
	/** Length shown in the "finished" message. */
	minutes: number;
	/** When it last finished, so each finish peeks the island once. */
	finishedAt: number;
}

const IDLE: TimerState = { deadline: null, pausedRemaining: null, total: 0, due: false, minutes: 0, finishedAt: 0 };

function useTimer(sound: boolean) {
	const [state, setState] = useState<TimerState>(IDLE);

	// One timeout per deadline; a new deadline (pause, +1 min…) clears the old one.
	useEffect(() => {
		if (!state.deadline) return;
		const deadline = state.deadline;
		const timeout = window.setTimeout(
			() => {
				setState((s) => (s.deadline === deadline ? { ...s, due: true, finishedAt: Date.now() } : s));
				if (sound) playChime();
			},
			Math.max(0, deadline - Date.now()),
		);
		return () => window.clearTimeout(timeout);
	}, [state.deadline, sound]);

	const start = useCallback((minutes: number) => {
		primeChime();
		setSetting(timerLastMinutes, minutes);
		setState({ ...IDLE, deadline: Date.now() + minutes * MINUTE, total: minutes * MINUTE, minutes });
	}, []);

	const add = useCallback((minutes: number) => {
		const ms = minutes * MINUTE;
		setState((s) => {
			if (s.due) return { ...IDLE, deadline: Date.now() + ms, total: ms, minutes };
			if (s.deadline) return { ...s, deadline: s.deadline + ms, total: s.total + ms, minutes: s.minutes + minutes };
			if (s.pausedRemaining !== null)
				return { ...s, pausedRemaining: s.pausedRemaining + ms, total: s.total + ms, minutes: s.minutes + minutes };
			return s;
		});
	}, []);

	return {
		...state,
		start,
		add,
		pause: () =>
			setState((s) =>
				s.deadline ? { ...s, deadline: null, pausedRemaining: Math.max(0, s.deadline - Date.now()) } : s,
			),
		resume: () => {
			primeChime();
			setState((s) =>
				s.pausedRemaining !== null ? { ...s, deadline: Date.now() + s.pausedRemaining, pausedRemaining: null } : s,
			);
		},
		stop: () => setState(IDLE),
	};
}

export const timerModule: IslandModule = {
	id: "timer",
	title: "timer.title",
	settingsIcon: <TimerIcon size={15} />,
	settings: Object.values(timerSettings),
	useView(): ModuleView {
		const t = useT();
		const sound = useSetting(timerSettings.sound);
		const timer = useTimer(sound);
		const busy = !!timer.deadline || timer.pausedRemaining !== null;

		const stopwatch = useStopwatch();
		const mode = timerMode.use();
		const watch = stopwatch.state;
		const watchRunning = !!watch.startedAt;
		const watchTouched = watchRunning || watch.before > 0;
		const timerShown = busy || timer.due;
		const showStopwatch = !timerShown && mode === "stopwatch";

		const timerCompact = {
			left: (
				<span className="flex items-center gap-2 text-[13px] font-[650]">
					<TimerIcon size={15} color={TIMER_ACCENT} />
					{timer.due ? t("timer.done") : t("timer.title")}
				</span>
			),
			right: timer.due ? (
				<span className="text-[12px] font-bold" style={{ color: TIMER_ACCENT }}>
					0:00
				</span>
			) : (
				<TimerRemaining deadline={timer.deadline} pausedRemaining={timer.pausedRemaining} />
			),
			width: 230,
		};
		const stopwatchCompact = {
			left: (
				<span className="flex items-center gap-2 text-[13px] font-[650]">
					<TimerResetIcon size={15} color={TIMER_ACCENT} />
					{t("timer.mode.stopwatch")}
				</span>
			),
			right: <StopwatchRemaining state={watch} />,
			width: 230,
		};

		return {
			active: timerShown || watchTouched,
			// A finished timer beats everything; a running one beats the music.
			priority: timer.due ? 95 : timer.deadline ? 52 : watchRunning ? 50 : 20,
			accent: TIMER_ACCENT,
			icon: <TimerIcon size={15} color={TIMER_ACCENT} />,
			compact: timerShown ? timerCompact : watchTouched ? stopwatchCompact : undefined,
			expanded: showStopwatch ? (
				<StopwatchPanel stopwatch={stopwatch} />
			) : (
				<TimerPanel
					deadline={timer.deadline}
					pausedRemaining={timer.pausedRemaining}
					total={timer.total}
					due={timer.due}
					minutes={timer.minutes}
					onStart={timer.start}
					onPause={timer.pause}
					onResume={timer.resume}
					onStop={timer.stop}
					onAdd={timer.add}
					onDismiss={timer.stop}
				/>
			),
			expandedSize: { width: 560, height: 128 },
			activityKey: timer.due ? `due:${timer.finishedAt}` : undefined,
			attention: timer.due,
			forceExpanded: timer.due,
		};
	},
};
