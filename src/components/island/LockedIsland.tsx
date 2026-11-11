import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useAppearance } from "../../core/appearance";
import { cn } from "../../core/cn";
import { islandFill, SIZE_SCALE, useExtras } from "../../core/extras";
import { useSyncLocale, useT } from "../../core/i18n";
import type { LicenseStatus } from "../../core/license";
import { ISLAND_HIDDEN_KEY, useSettings } from "../../core/settings";
import { kickHitRects, useHitRects } from "../../core/useHitRects";
import { LockedAction, lockedLook } from "../LockedMessage";
import { type Geo, geometry, variantOf } from "./geometry";
import { Rim } from "./Rim";
import { Surface } from "./Surface";

const NO_GLOW = { halo: null, pulse: null, breathe: null };
const COMPACT: Geo = { width: 250, height: 38, radius: 19, ear: 10 };
const OPEN: Geo = { width: 470, height: 148, radius: 32, ear: 14 };
/** Leaving the island closes the message after this long (ms). */
const CLOSE_DELAY = 350;

/**
 * The island of a locked installation (blocked, offline too long, outdated):
 * a small pill saying so, opening on hover or click to the full message. Same
 * shape, color and look as the island, but none of its modules run.
 *
 * Right after startup, while the first check is still settling, it shows only
 * the resting island: an installation that was offline over the weekend
 * shouldn't flash "connection needed" while the network comes up.
 */
export function LockedIsland({ status }: { status: LicenseStatus }) {
	const t = useT();
	const look = useAppearance();
	const extras = useExtras();
	const settings = useSettings();
	const windows = look.style === "windows";
	const v = variantOf(look);
	useHitRects();
	useSyncLocale();

	const [open, setOpen] = useState(false);
	const [pinned, setPinned] = useState(false);
	const closeTimer = useRef(0);

	useEffect(() => {
		const root = document.documentElement.style;
		root.setProperty("--island", islandFill(extras.color, extras.opacity));
		root.setProperty("--island-body", "none");
	}, [extras.color, extras.opacity]);

	const swallowed = settings[ISLAND_HIDDEN_KEY] === true;
	const settling = status.initial && status.state === "expired";
	const expanded = !settling && (open || pinned);
	const base: Geo = settling ? geometry(v, look, "idle", undefined, undefined) : expanded ? OPEN : COMPACT;
	const g: Geo = windows ? { ...base, ear: 0 } : base;
	const transition = expanded ? v.expandSpring : v.shellSpring;
	const style = lockedLook(status);
	const Icon = style.icon;

	// biome-ignore lint/correctness/useExhaustiveDependencies: the dependencies are the triggers, not inputs
	useEffect(() => {
		kickHitRects();
	}, [g.width, g.height, swallowed]);

	const content = settling ? (
		<span />
	) : expanded ? (
		<div className="flex h-full items-center gap-4 px-6" onClick={(e) => e.stopPropagation()}>
			<span
				className="grid size-12 flex-none place-items-center rounded-2xl"
				style={{ background: style.tint, color: style.color }}
			>
				<Icon size={22} />
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<strong className="text-[15px] leading-tight">{t(style.title)}</strong>
				<span className="text-[12.5px]/[1.4] text-text-dim">{t(style.body)}</span>
				<span className="text-[12px]/[1.4] text-text-faint">{t(style.hint)}</span>
				<LockedAction
					status={status}
					className="mt-1.5 self-start rounded-full bg-white/10 px-3 py-1 text-[12px] font-semibold text-text transition-[filter,opacity] hover:brightness-125 disabled:opacity-50"
				/>
			</div>
		</div>
	) : (
		<span className="flex h-full items-center justify-center gap-2 text-[13px] font-[650]">
			<Icon size={15} color={style.color} />
			{t(style.short)}
		</span>
	);

	return (
		<div className="pointer-events-none fixed inset-0 flex items-start justify-center">
			<motion.div
				className="pointer-events-none relative flex origin-top justify-center"
				initial={false}
				animate={
					swallowed
						? { scale: 0, rotate: -200, opacity: 0 }
						: { scale: SIZE_SCALE[extras.size] ?? 1, rotate: 0, opacity: 1 }
				}
				transition={
					swallowed
						? { duration: 0.46, ease: [0.55, 0, 1, 0.45] }
						: { duration: 0.56, ease: [0.34, 1.4, 0.64, 1], opacity: { duration: 0.26 } }
				}
			>
				<motion.div
					className={cn("pointer-events-auto relative", !settling && "cursor-pointer")}
					{...(swallowed ? {} : { "data-hit": true })}
					style={{ marginTop: v.top }}
					initial={false}
					animate={{ width: g.width, height: g.height }}
					transition={transition}
					onPointerEnter={() => {
						window.clearTimeout(closeTimer.current);
						setOpen(true);
					}}
					onPointerLeave={() => {
						window.clearTimeout(closeTimer.current);
						closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
					}}
					onClick={() => setPinned((p) => !p)}
					role="alert"
					aria-label={t(style.title)}
				>
					{!windows && (
						<>
							<motion.span
								className="pointer-events-none absolute top-0 right-full bg-[radial-gradient(circle_at_0_100%,transparent_70%,var(--island)_71%)]"
								initial={false}
								animate={{ width: g.ear, height: g.ear }}
								transition={v.shellSpring}
							/>
							<motion.span
								className="pointer-events-none absolute top-0 left-full bg-[radial-gradient(circle_at_100%_100%,transparent_70%,var(--island)_71%)]"
								initial={false}
								animate={{ width: g.ear, height: g.ear }}
								transition={v.shellSpring}
							/>
						</>
					)}
					<Surface
						g={g}
						big={expanded}
						look={look}
						transition={transition}
						contentKey={settling ? "settling" : expanded ? "open" : "compact"}
						rim={windows ? <Rim look={look} /> : null}
						glow={NO_GLOW}
						sheen={null}
					>
						{content}
					</Surface>
				</motion.div>
			</motion.div>
		</div>
	);
}
