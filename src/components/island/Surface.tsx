import { AnimatePresence, motion, type Transition } from "motion/react";
import type { ReactNode } from "react";
import type { Appearance } from "../../core/appearance";
import { cn } from "../../core/cn";
import { glowCss, Sheen } from "./effects";
import { cornerRadius, type Geo } from "./geometry";
import { glowStyle } from "./Rim";

/** The island's black body; its content blurs out and in whenever `contentKey` changes. */
export function Surface({
	g,
	big,
	look,
	transition,
	contentKey,
	rim,
	glow,
	sheen,
	rounded,
	children,
}: {
	g: Geo;
	big: boolean;
	look: Appearance;
	transition: Transition;
	contentKey: string;
	rim: ReactNode;
	/** Halo, alert pulse and resting breath colors (`null`: none). */
	glow: { halo: string | null; pulse: string | null; breathe: string | null };
	/** A new value sweeps a sheen over the island. */
	sheen: string | null;
	/** Round on top too (away from the top edge), whatever the look. */
	rounded?: boolean;
	children: ReactNode;
}) {
	const windows = look.style === "windows";
	const effect = glowCss(glow);
	return (
		<motion.div
			className={cn(
				"absolute inset-0 overflow-hidden bg-(image:--island-body) bg-island shadow-[0_14px_34px_-14px_rgba(0,0,0,0.7)] transition-shadow duration-400 ease-[ease]",
				big && "shadow-[0_26px_60px_-18px_rgba(0,0,0,0.85),inset_0_-1px_0_rgba(255,255,255,0.06)]",
				effect.className,
			)}
			style={{ ...(windows ? glowStyle(look) : undefined), ...effect.style }}
			initial={false}
			animate={cornerRadius(g, windows || !!rounded)}
			transition={transition}
		>
			<AnimatePresence mode="popLayout" initial={false}>
				<motion.div
					key={contentKey}
					className="absolute top-0 left-1/2 origin-top -translate-x-1/2"
					style={{ width: g.width, height: g.height }}
					initial={{ opacity: 0, scale: 0.9, filter: "blur(10px)" }}
					animate={{
						opacity: 1,
						scale: 1,
						filter: "blur(0px)",
						transition: { duration: 0.32, delay: 0.06, ease: [0.2, 0.9, 0.3, 1] },
					}}
					exit={{
						opacity: 0,
						scale: 0.94,
						filter: "blur(8px)",
						transition: { duration: 0.16, ease: "easeIn" },
					}}
				>
					{children}
				</motion.div>
			</AnimatePresence>
			<Sheen trigger={sheen} />
			{rim}
		</motion.div>
	);
}
