import { motion } from "motion/react";
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppearance } from "../core/appearance";
import { useTauriEvent } from "../core/bridge";
import { cn } from "../core/cn";
import { islandFill, SIZE_SCALE, useDesktop, useExtras, useLook } from "../core/extras";
import { useSyncLocale } from "../core/i18n";
import { type IslandApi, IslandContext } from "../core/island";
import { kickHitRects, useHitRects } from "../core/useHitRects";
import { useIslandController } from "../core/useIslandController";
import { useIslandDrag } from "../core/useIslandDrag";
import { modules } from "../modules";
import { requestAskFocus } from "../modules/ask/store";
import { requestFindFocus } from "../modules/find/store";
import { AmbientBubbles, SecondaryBubble } from "./island/Bubbles";
import { islandContent } from "./island/content";
import { Confetti, withMotion } from "./island/effects";
import { ambientWidth, BUBBLE, BUBBLE_GAP, type Geo, geometry, variantOf } from "./island/geometry";
import { launcherSize } from "./island/Launcher";
import { QuickMenu } from "./island/QuickMenu";
import { Rim } from "./island/Rim";
import { Surface } from "./island/Surface";
import { useIslandFileDrop } from "./island/useIslandFileDrop";

export function Island() {
	const ctl = useIslandController(modules);
	const { mode, primary, secondary, focused } = ctl;
	const look = useAppearance();
	const windows = look.style === "windows";
	const fx = useLook();
	const v = withMotion(variantOf(look), fx.motion);
	useHitRects();
	useSyncLocale();
	useIslandFileDrop(ctl);

	const extras = useExtras();
	const desktop = useDesktop();

	const bigSize = ctl.launcher ? launcherSize(ctl.entries.length) : focused?.view.expandedSize;
	const big = mode === "expanded" || mode === "peek";
	const hidden = mode === "hidden";
	const swallowed = mode === "swallowed";
	const restingMode = mode === "compact" || mode === "idle";
	// A thin bar instead of the resting island: always, or while a browser is
	// the active window, so it doesn't sit on top of the browser's tabs.
	const mini = restingMode && ((mode === "idle" && extras.mini) || (extras.miniInBrowser && !!desktop?.browser));
	const resting = restingMode && !mini;
	const showSecondary = resting && mode === "compact" && secondary !== undefined;
	const idleSlots = windows && look.idleClock ? extras.idle.reduce((n, item) => n + (item === "event" ? 2 : 1), 0) : 0;
	const base: Geo = mini
		? windows
			? { width: 74, height: 9, radius: 4.5, ear: 0 }
			: { width: 92, height: 5, radius: 4, ear: 4 }
		: geometry(v, look, mode, bigSize, primary);
	const widened =
		!mini && mode === "idle" && idleSlots > 1 ? { ...base, width: base.width + (idleSlots - 1) * 62 } : base;
	const roundness = Math.min(100, Math.max(0, extras.rounding)) / 100;
	const g: Geo = { ...widened, radius: widened.radius * roundness, ear: widened.ear * Math.max(roundness, 0.35) };
	const scale = SIZE_SCALE[extras.size] ?? 1;

	// The island's fill: a CSS variable the body, the ears and the bubbles share;
	// the body may fade into a second color towards the bottom.
	useEffect(() => {
		const root = document.documentElement.style;
		root.setProperty("--island", islandFill(extras.color, extras.opacity));
		root.setProperty(
			"--island-body",
			fx.gradient
				? `linear-gradient(180deg, ${islandFill(extras.color, extras.opacity)}, ${islandFill(fx.gradient, extras.opacity)})`
				: "none",
		);
	}, [extras.color, extras.opacity, fx.gradient]);

	// Glow: a steady halo, a pulse in the color of whatever needs you, a breath at rest.
	const needy = ctl.entries.find((e) => e.view.forceExpanded) ?? ctl.entries.find((e) => e.view.attention);
	const glow = {
		halo:
			fx.halo === "color" ? fx.haloColor : fx.halo === "module" ? ((focused ?? primary)?.view.accent ?? null) : null,
		pulse: fx.pulse && needy ? (needy.view.accent ?? "#FF9F0A") : null,
		breathe: fx.breathe && resting ? (fx.halo === "off" ? fx.haloColor : (primary?.view.accent ?? fx.haloColor)) : null,
	};

	// A sheen each time the island peeks with something new.
	const peeks = useRef(0);
	const [sheen, setSheen] = useState<string | null>(null);
	useEffect(() => {
		if (mode !== "peek" || !fx.sheen) return;
		peeks.current += 1;
		setSheen(`peek-${peeks.current}`);
	}, [mode, fx.sheen]);

	// Confetti when a module celebrates (timer done, focus round finished).
	const celebrate = fx.confetti ? (ctl.entries.find((e) => e.view.celebrateKey)?.view.celebrateKey ?? null) : null;
	const transition = big ? v.expandSpring : v.shellSpring;

	const drag = useIslandDrag({
		width: g.width,
		leftExtra: g.ear + (resting ? ambientWidth(ctl.entries.filter((e) => e.view.ambient).length) : 0),
		rightExtra: g.ear + (showSecondary ? BUBBLE_GAP + BUBBLE : 0),
		canReturn: !big,
		onDragChange: ctl.lockHover,
	});

	// Global shortcut: the page opens (controller) and its input takes the keyboard.
	useTauriEvent("island://ask", requestAskFocus);
	useTauriEvent("island://find", requestFindFocus);

	const api: IslandApi = useMemo(
		() => ({ mode, tab: ctl.tab, expand: ctl.expand, collapse: ctl.collapse, keepOpen: ctl.keepOpen }),
		[mode, ctl.tab, ctl.expand, ctl.collapse, ctl.keepOpen],
	);

	// Right-click: quick actions of what the island shows.
	const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
	const { keepOpen } = ctl;
	const closeMenu = useCallback(() => {
		setMenuAt(null);
		keepOpen(false, "menu");
	}, [keepOpen]);
	const openMenu = (e: MouseEvent<HTMLElement>) => {
		// Text fields and the like keep their own menu.
		if ((e.target as Element).closest("input, textarea, select, [contenteditable]")) return;
		e.preventDefault();
		const box = e.currentTarget.getBoundingClientRect();
		const zoom = box.width / e.currentTarget.offsetWidth || 1;
		setMenuAt({ x: (e.clientX - box.left) / zoom, y: (e.clientY - box.top) / zoom });
		keepOpen(true, "menu");
	};
	const shown = big ? [focused] : [primary, showSecondary ? secondary : undefined];
	const menuItems = shown.flatMap((e) => e?.view.menu ?? []);

	// The island is about to change shape: its clickable area must follow at once.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the dependencies are the triggers, not inputs
	useEffect(() => {
		kickHitRects();
	}, [mode, g.width, g.height, menuAt, showSecondary, mini, drag.dragging]);

	const content = mini ? { key: "mini", node: null } : islandContent(ctl, look, v);
	const rim = windows ? <Rim look={look} /> : null;
	const bubble = { transition: v.shellSpring, rim, onOpen: ctl.expand };

	return (
		<IslandContext.Provider value={api}>
			<div className="pointer-events-none fixed inset-0 flex items-start justify-center">
				{/* The tray's black hole: the island spins into its own center and comes back out. */}
				<motion.div
					className="pointer-events-none relative flex origin-top justify-center"
					initial={false}
					animate={swallowed ? { scale: 0, rotate: -200, opacity: 0 } : { scale, rotate: 0, opacity: 1 }}
					transition={
						swallowed
							? { duration: 0.46, ease: [0.55, 0, 1, 0.45] }
							: { duration: 0.56, ease: [0.34, 1.4, 0.64, 1], opacity: { duration: 0.26 } }
					}
				>
					<motion.div
						className={cn(
							"pointer-events-auto relative touch-none will-change-[width,height,transform]",
							drag.dragging && "cursor-grabbing **:cursor-grabbing",
						)}
						{...(hidden || swallowed ? {} : { "data-hit": true })}
						{...ctl.domHover}
						style={{ ...drag.style, marginTop: v.top }}
						onPointerDown={drag.onPointerDown}
						onClickCapture={drag.onClickCapture}
						onUpdate={drag.onShellUpdate}
						onWheel={ctl.onWheel}
						onContextMenu={openMenu}
						initial={false}
						animate={{
							width: g.width,
							height: g.height,
							opacity: hidden ? 0 : 1,
							y: hidden ? -g.height - 12 - v.top : 0,
						}}
						transition={transition}
						onClick={() => resting && ctl.expand()}
					>
						{/* Concave "ears" that blend the notch into the top edge of the screen. */}
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
							big={big}
							look={look}
							transition={transition}
							contentKey={content.key}
							rim={rim}
							glow={glow}
							sheen={sheen}
						>
							{content.node}
						</Surface>

						<Confetti trigger={celebrate} />
						<AmbientBubbles entries={ctl.entries} visible={resting} shrunk={mode === "idle" && !windows} {...bubble} />
						<SecondaryBubble entry={showSecondary ? secondary : undefined} {...bubble} />
						<QuickMenu at={menuAt} items={menuItems} onWhatsNew={() => ctl.expand("whatsnew")} onClose={closeMenu} />
					</motion.div>
				</motion.div>
			</div>
		</IslandContext.Provider>
	);
}
