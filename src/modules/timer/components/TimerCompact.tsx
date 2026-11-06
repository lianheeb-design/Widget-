import { useNow } from "../../ai-agents/common/format";
import { clockLabel } from "../format";
import { TIMER_ACCENT } from "../settings";

/** Ticks on its own so the whole island doesn't re-render every second. */
export function TimerRemaining({
	deadline,
	pausedRemaining,
}: {
	deadline: number | null;
	pausedRemaining: number | null;
}) {
	const now = useNow(500, !!deadline);
	const remaining = deadline ? deadline - now : (pausedRemaining ?? 0);
	return (
		<span className="text-[13px] font-bold tabular-nums" style={{ color: TIMER_ACCENT, opacity: deadline ? 1 : 0.55 }}>
			{clockLabel(remaining)}
		</span>
	);
}
