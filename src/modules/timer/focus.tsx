import { BrainIcon, CoffeeIcon, PauseIcon, PlayIcon, SkipForwardIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Row } from "../../components/ui/card";
import { NumberField } from "../../components/ui/form";
import { focusQuiet } from "../../core/extras";
import { useT } from "../../core/i18n";
import { type SettingDef, setSetting, useSetting } from "../../core/settings";
import { useNow } from "../ai-agents/common/format";
import { playChime, primeChime } from "./chime";
import { clockLabel } from "./format";
import { ModeSwitch } from "./mode";
import { TIMER_ACCENT } from "./settings";

const MINUTE = 60_000;
export const focusWork: SettingDef<number> = { key: "focus.work", label: "focus.work.label", default: 25 };
export const focusBreak: SettingDef<number> = { key: "focus.break", label: "focus.break.label", default: 5 };
export const focusSettings = {
	quiet: {
		key: "focus.quiet",
		label: "focus.quiet.label",
		description: "focus.quiet.desc",
		default: true,
	},
} satisfies Record<string, SettingDef>;

export type FocusPhase = "idle" | "work" | "break";

export interface Focus {
	phase: FocusPhase;
	deadline: number | null;
	pausedRemaining: number | null;
	total: number;
	rounds: number;
	/** Bumped at each switch between work and break, so the island peeks. */
	switches: number;
}

const IDLE: Focus = { phase: "idle", deadline: null, pausedRemaining: null, total: 0, rounds: 0, switches: 0 };

/** Work and break blocks in turn (Pomodoro); quiets other peeks while working. */
export function useFocus(sound: boolean) {
	const work = useSetting(focusWork);
	const rest = useSetting(focusBreak);
	const quiet = useSetting(focusSettings.quiet);
	const [state, setState] = useState<Focus>(IDLE);
	const lengths = useRef({ work, rest });
	lengths.current = { work, rest };

	useEffect(() => {
		focusQuiet.set(quiet && state.phase === "work");
		return () => focusQuiet.set(false);
	}, [quiet, state.phase]);

	useEffect(() => {
		if (!state.deadline) return;
		const deadline = state.deadline;
		const timer = window.setTimeout(
			() => {
				if (sound) playChime();
				setState((s) => {
					if (s.deadline !== deadline) return s;
					const toBreak = s.phase === "work";
					const ms = (toBreak ? lengths.current.rest : lengths.current.work) * MINUTE;
					return {
						...s,
						phase: toBreak ? "break" : "work",
						deadline: Date.now() + ms,
						total: ms,
						rounds: toBreak ? s.rounds + 1 : s.rounds,
						switches: s.switches + 1,
					};
				});
			},
			Math.max(0, deadline - Date.now()),
		);
		return () => window.clearTimeout(timer);
	}, [state.deadline, sound]);

	return {
		state,
		start: () => {
			primeChime();
			const ms = lengths.current.work * MINUTE;
			setState({ ...IDLE, phase: "work", deadline: Date.now() + ms, total: ms });
		},
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
		skip: () =>
			setState((s) => {
				if (s.phase === "idle") return s;
				const toBreak = s.phase === "work";
				const ms = (toBreak ? lengths.current.rest : lengths.current.work) * MINUTE;
				return {
					...s,
					phase: toBreak ? "break" : "work",
					deadline: Date.now() + ms,
					pausedRemaining: null,
					total: ms,
					rounds: toBreak ? s.rounds + 1 : s.rounds,
					switches: s.switches + 1,
				};
			}),
		stop: () => setState(IDLE),
	};
}

const button =
	"flex h-8 items-center gap-1.5 rounded-2xl px-3.25 text-[12px] font-bold transition-[filter,background] duration-150 hover:brightness-114";
const primary = `${button} bg-[#ff9f0a] text-black`;
const secondary = `${button} bg-white/9 text-text-dim`;

export function FocusPanel({ focus }: { focus: ReturnType<typeof useFocus> }) {
	const t = useT();
	const work = useSetting(focusWork);
	const rest = useSetting(focusBreak);
	const quiet = useSetting(focusSettings.quiet);
	const { state } = focus;
	const running = !!state.deadline;
	const now = useNow(500, running);
	const remaining = running ? (state.deadline ?? 0) - now : (state.pausedRemaining ?? work * MINUTE);
	const progress = state.total ? Math.min(1, Math.max(0, remaining / state.total)) : 1;
	const onBreak = state.phase === "break";
	const color = onBreak ? "#64D2FF" : TIMER_ACCENT;

	return (
		<div className="flex h-full items-center gap-3.5 px-2.5" onClick={(e) => e.stopPropagation()}>
			<span
				className="grid size-11.5 flex-none place-items-center rounded-2xl"
				style={{ background: onBreak ? "rgba(100,210,255,0.14)" : "rgba(255,179,64,0.14)", color }}
			>
				{onBreak ? <CoffeeIcon size={21} /> : <BrainIcon size={21} />}
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<ModeSwitch />
				<strong
					className="text-[22px]/[1.15] tabular-nums"
					style={{ color: state.phase === "idle" ? undefined : color }}
				>
					{clockLabel(remaining)}
				</strong>
				<span className="truncate text-[11.5px] text-text-faint">
					{state.phase === "idle"
						? t("focus.plan", { work, rest })
						: `${onBreak ? t("focus.break.now") : t("focus.work.now")} · ${t("focus.rounds", { n: onBreak ? state.rounds : state.rounds + 1 })}${quiet && !onBreak ? ` · ${t("focus.quiet.on")}` : ""}`}
				</span>
				<span className="relative mt-0.5 h-1 overflow-hidden rounded-full bg-white/8">
					<span
						className="absolute inset-y-0 left-0 rounded-full"
						style={{ width: `${progress * 100}%`, background: color }}
					/>
				</span>
			</div>
			<div className="flex flex-none gap-1.75">
				{state.phase === "idle" ? (
					<button type="button" className={primary} onClick={focus.start}>
						<PlayIcon size={13} fill="currentColor" />
						{t("focus.start")}
					</button>
				) : (
					<>
						<button type="button" className={secondary} onClick={focus.skip} title={t("focus.skip")}>
							<SkipForwardIcon size={13} />
						</button>
						{running ? (
							<button type="button" className={secondary} onClick={focus.pause} aria-label={t("timer.pause")}>
								<PauseIcon size={13} fill="currentColor" />
							</button>
						) : (
							<button type="button" className={primary} onClick={focus.resume} aria-label={t("timer.resume")}>
								<PlayIcon size={13} fill="currentColor" />
							</button>
						)}
						<button type="button" className={secondary} onClick={focus.stop} aria-label={t("timer.stop")}>
							<SquareIcon size={12} fill="currentColor" />
						</button>
					</>
				)}
			</div>
		</div>
	);
}

export function FocusRemaining({ state }: { state: Focus }) {
	const now = useNow(500, !!state.deadline);
	const ms = state.deadline ? state.deadline - now : (state.pausedRemaining ?? 0);
	return (
		<span
			className="text-[13px] font-bold tabular-nums"
			style={{ color: state.phase === "break" ? "#64D2FF" : TIMER_ACCENT, opacity: state.deadline ? 1 : 0.55 }}
		>
			{clockLabel(ms)}
		</span>
	);
}

/** Lengths of the focus blocks, in the timer's settings. */
export function FocusSettings() {
	const t = useT();
	const work = useSetting(focusWork);
	const rest = useSetting(focusBreak);
	const field = (def: SettingDef<number>, value: number, max: number) => (
		<NumberField
			unit="min"
			min={1}
			max={max}
			step={1}
			value={value}
			aria-label={t(def.label)}
			onChange={(e) => {
				const n = Math.round(Number(e.target.value));
				if (Number.isFinite(n) && n >= 1 && n <= max) setSetting(def, n);
			}}
		/>
	);
	return (
		<>
			<Row label={t("focus.work.label")} desc={t("focus.work.desc")}>
				{field(focusWork, work, 180)}
			</Row>
			<Row label={t("focus.break.label")}>{field(focusBreak, rest, 60)}</Row>
		</>
	);
}
