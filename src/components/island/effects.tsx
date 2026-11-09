/**
 * The island's extra effects: motion styles, a sheen sweeping over it when
 * something new comes in, confetti when a timer or focus round is done, and
 * the glow colors for the halo, the alert pulse and the resting breath.
 */
import { AnimatePresence, motion, type Transition } from "motion/react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import type { MotionStyle } from "../../core/extras";
import type { Variant } from "./geometry";

const MOTION: Record<Exclude<MotionStyle, "standard">, { shell: Transition; expand: Transition }> = {
	bouncy: {
		shell: { type: "spring", stiffness: 360, damping: 17, mass: 0.9 },
		expand: { type: "spring", stiffness: 290, damping: 14, mass: 0.9 },
	},
	smooth: {
		shell: { type: "spring", stiffness: 210, damping: 30, mass: 1 },
		expand: { type: "spring", stiffness: 170, damping: 28, mass: 1 },
	},
	fast: {
		shell: { type: "spring", stiffness: 700, damping: 48, mass: 0.7 },
		expand: { type: "spring", stiffness: 620, damping: 44, mass: 0.7 },
	},
	off: { shell: { duration: 0 }, expand: { duration: 0 } },
};

/** The look's springs, swapped for the chosen motion style. */
export function withMotion(v: Variant, style: MotionStyle): Variant {
	if (style === "standard") return v;
	const m = MOTION[style];
	return { ...v, shellSpring: m.shell, expandSpring: m.expand };
}

/** CSS for the glow: a steady halo, a pulse while something needs you, or a slow breath at rest. */
export function glowCss({
	halo,
	pulse,
	breathe,
}: {
	halo: string | null;
	pulse: string | null;
	breathe: string | null;
}): { style?: CSSProperties; className?: string } {
	if (pulse) return { style: { "--glow": pulse } as CSSProperties, className: "animate-island-pulse" };
	if (breathe) return { style: { "--glow": breathe } as CSSProperties, className: "animate-island-breathe" };
	if (halo)
		return {
			style: {
				boxShadow: `0 0 22px -2px color-mix(in srgb, ${halo} 70%, transparent), 0 14px 34px -14px rgba(0, 0, 0, 0.7)`,
			},
		};
	return {};
}

/** A band of light sweeping across the island once per `trigger`. */
export function Sheen({ trigger }: { trigger: string | null }) {
	return (
		<AnimatePresence>
			{trigger && (
				<motion.span
					key={trigger}
					className="pointer-events-none absolute inset-y-0 z-3 w-1/2 bg-[linear-gradient(100deg,transparent,rgba(255,255,255,0.16),transparent)]"
					initial={{ left: "-60%", opacity: 1 }}
					animate={{ left: "120%", opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.9, ease: [0.4, 0, 0.2, 1] }}
				/>
			)}
		</AnimatePresence>
	);
}

const COLORS = ["#FF453A", "#FF9F0A", "#FFD60A", "#30D158", "#64D2FF", "#0A84FF", "#BF5AF2", "#FF375F"];
const PIECES = 34;

/** A burst of confetti out of the island, once per `trigger`, gone after two seconds. */
export function Confetti({ trigger }: { trigger: string | null }) {
	const [shown, setShown] = useState<string | null>(null);
	useEffect(() => {
		if (!trigger) return;
		setShown(trigger);
		const timer = window.setTimeout(() => setShown(null), 2300);
		return () => window.clearTimeout(timer);
	}, [trigger]);

	const pieces = useMemo(
		() =>
			Array.from({ length: PIECES }, (_, i) => ({
				id: `${shown}-${i}`,
				color: COLORS[i % COLORS.length],
				x: (Math.random() - 0.5) * 520,
				y: 90 + Math.random() * 260,
				rotate: (Math.random() - 0.5) * 900,
				delay: Math.random() * 0.15,
				duration: 1.3 + Math.random() * 0.7,
				round: Math.random() < 0.3,
			})),
		[shown],
	);

	if (!shown) return null;
	return (
		<span className="pointer-events-none absolute top-1/2 left-1/2 z-20 size-0">
			{pieces.map((p) => (
				<motion.span
					key={p.id}
					className="absolute block h-2.5 w-1.5"
					style={{ background: p.color, borderRadius: p.round ? "999px" : "1px" }}
					initial={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 0.6 }}
					animate={{ x: p.x, y: p.y, rotate: p.rotate, opacity: 0, scale: 1 }}
					transition={{ duration: p.duration, delay: p.delay, ease: [0.15, 0.6, 0.35, 1] }}
				/>
			))}
		</span>
	);
}
