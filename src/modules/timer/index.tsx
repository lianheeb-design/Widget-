import { BrainIcon, CoffeeIcon, TimerIcon, TimerResetIcon } from "lucide-react";
/**
 * Timer: a countdown started from quick picks or any number of minutes. It
 * owns the compact island while it runs, and pops the island open with a
 * chime when it's done. Frontend only, no provider.
 */
import { useCallback, useEffect, useState } from "react";
import { Divider } from "../../components/ui/card";
import { useT } from "../../core/i18n";
import { setSetting, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { CountdownPanel, countdownItems } from "../countdown";
import { AlarmSettings, alarmSettings, useAlarm } from "./alarm";
import { playChime, primeChime } from "./chime";
import { TimerRemaining } from "./components/TimerCompact";
import { TimerPanel } from "./components/TimerPanel";
import { FocusPanel, FocusRemaining, FocusSettings, focusSettings, useFocus } from "./focus";
import { ModeSwitch, timerMode } from "./mode";
import { TIMER_ACCENT, timerLastMinutes, timerSettings } from "./settings";
import { StopwatchPanel, StopwatchRemaining, useStopwatch } from "./stopwatch";

const MINUTE = 60_000;

/** Focus mode and alarm settings, one after the other. */
function TimerSettings() {
	return (
		<>
			<FocusSettings />
			<Divider />
			<AlarmSettings />
		</>
	);
}

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
	settings: [...Object.values(timerSettings), ...Object.values(focusSettings), ...Object.values(alarmSettings)],
	SettingsSection: TimerSettings,
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
		const focus = useFocus(sound);
		const focusOn = focus.state.phase !== "idle";
		const showFocus = !timerShown && mode === "focus";
		const alarm = useAlarm();
		const showAlarm = !timerShown && mode === "alarm";
		const showCountdown = !timerShown && mode === "countdown";
		const countdowns = useSetting(countdownItems).length;

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

		const focusCompact = {
			left: (
				<span className="flex items-center gap-2 text-[13px] font-[650]">
					{focus.state.phase === "break" ? (
						<CoffeeIcon size={15} color="#64D2FF" />
					) : (
						<BrainIcon size={15} color={TIMER_ACCENT} />
					)}
					{focus.state.phase === "break" ? t("focus.break.now") : t("focus.work.now")}
				</span>
			),
			right: <FocusRemaining state={focus.state} />,
			width: 230,
		};

		return {
			active: alarm.ringing || timerShown || watchTouched || focusOn || alarm.snoozed,
			// A ringing alarm beats everything, then a finished timer; a running one beats the music.
			priority: alarm.ringing
				? 97
				: timer.due
					? 95
					: timer.deadline
						? 52
						: focusOn && focus.state.deadline
							? 51
							: watchRunning
								? 50
								: alarm.snoozed
									? 30
									: 20,
			accent: TIMER_ACCENT,
			icon: <TimerIcon size={15} color={TIMER_ACCENT} />,
			compact: alarm.ringing
				? alarm.compact
				: timerShown
					? timerCompact
					: focusOn
						? focusCompact
						: watchTouched
							? stopwatchCompact
							: alarm.compact,
			ambient: alarm.ambient,
			menu: timerShown ? [{ label: t("menu.stopTimer"), onSelect: timer.stop, danger: true }] : undefined,
			expanded: alarm.ringingPanel ? (
				alarm.ringingPanel
			) : showCountdown ? (
				<CountdownPanel header={<ModeSwitch />} />
			) : showAlarm ? (
				alarm.listPanel
			) : showFocus ? (
				<FocusPanel focus={focus} />
			) : showStopwatch ? (
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
			expandedSize: alarm.ringing
				? { width: 560, height: 120 }
				: showAlarm
					? { width: 560, height: alarm.listHeight }
					: showCountdown
						? { width: 560, height: Math.min(290, 140 + Math.max(1, countdowns) * 46) }
						: { width: 560, height: 128 },
			activityKey:
				alarm.activityKey ??
				(timer.due ? `due:${timer.finishedAt}` : focus.state.switches ? `focus:${focus.state.switches}` : undefined),
			attention: alarm.ringing || timer.due,
			forceExpanded: alarm.ringing || timer.due,
			// Alarms ring even with the timer turned off; the off button must show then too.
			showWhenOff: alarm.ringing,
			celebrateKey: timer.due
				? `due:${timer.finishedAt}`
				: focus.state.phase === "break"
					? `focus:${focus.state.switches}`
					: undefined,
		};
	},
};
