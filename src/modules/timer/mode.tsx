import { cn } from "../../core/cn";
import { useT } from "../../core/i18n";
import { createStore } from "../../core/island";

export type TimerMode = "timer" | "stopwatch" | "focus" | "alarm" | "countdown";

/** Which of the two the panel shows while neither is running. */
export const timerMode = createStore<TimerMode>("timer");

/** Two small tabs in the panel's label line. */
export function ModeSwitch() {
	const t = useT();
	const mode = timerMode.use();
	return (
		<div className="flex gap-0.5">
			{(["timer", "stopwatch", "focus", "alarm", "countdown"] as const).map((m) => (
				<button
					key={m}
					type="button"
					className={cn(
						"rounded-full px-1.75 py-0.5 text-[11px] font-bold tracking-[0.04em] uppercase transition-[background,color] duration-150",
						mode === m ? "bg-[rgba(255,179,64,0.2)] text-[#ffd08a]" : "text-text-faint hover:text-text-dim",
					)}
					onClick={() => timerMode.set(m)}
				>
					{t(`timer.mode.${m}`)}
				</button>
			))}
		</div>
	);
}
