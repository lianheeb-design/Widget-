/**
 * Text whose digits roll like a departure board when they change ("12:59" →
 * "13:00"). Other characters stay put. Off: plain text.
 */
import { AnimatePresence, motion } from "motion/react";
import { useLook } from "../core/extras";

export function RollingText({ text, className }: { text: string; className?: string }) {
	const { rolling } = useLook();
	if (!rolling) return <span className={className}>{text}</span>;
	const chars = [...text];
	return (
		<span className={className}>
			<span className="sr-only">{text}</span>
			{chars.map((c, i) =>
				/\d/.test(c) ? (
					// Keyed by position: the slot stays, its digit rolls.
					// biome-ignore lint/suspicious/noArrayIndexKey: a digit's place in the text is its identity
					<span key={i} aria-hidden className="relative inline-block overflow-hidden align-bottom tabular-nums">
						<AnimatePresence mode="popLayout" initial={false}>
							<motion.span
								key={c}
								className="inline-block"
								initial={{ y: "-100%", opacity: 0 }}
								animate={{ y: 0, opacity: 1 }}
								exit={{ y: "100%", opacity: 0 }}
								transition={{ type: "spring", stiffness: 420, damping: 32 }}
							>
								{c}
							</motion.span>
						</AnimatePresence>
					</span>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: see above
					<span key={i} aria-hidden>
						{c}
					</span>
				),
			)}
		</span>
	);
}
