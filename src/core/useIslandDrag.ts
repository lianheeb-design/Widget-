import { useMotionValue, useMotionValueEvent, useSpring, useTransform, useVelocity } from "motion/react";
import { type MouseEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { command, useTauriEvent } from "./bridge";
import {
	ISLAND_OFFSET_KEY,
	ISLAND_OFFSET_Y_KEY,
	positionSettings,
	readSetting,
	setSetting,
	useSettings,
} from "./settings";

/** Pixels the pointer must travel before a press becomes a drag (not a click). */
const DRAG_THRESHOLD = 5;
/** Gap kept between the island (plus its bubbles) and the screen edges. */
const EDGE_MARGIN = 12;
/** How much of the overshoot past an edge shows while dragging. */
const RUBBER = 0.22;
/** Releases this close to the middle snap back to it. */
const CENTER_SNAP = 28;
/** Releases this close to the top snap back to it (placed anywhere). */
const TOP_SNAP = 24;
/** Seconds of release velocity added to where the island lands. */
const FLING = 0.1;
/** Below this the island counts as hanging from the top edge (notch look with ears). */
const FLOAT_FROM = 4;
/** The squash & stretch ends at the latest this long after the last movement (ms). */
const SETTLE_MS = 1500;

/** Island position along the top edge: a bit of lag behind the pointer, bouncy on return. */
const follow = { stiffness: 480, damping: 30, mass: 0.85 };
/** Jelly settle of the squash & stretch. */
const wobble = { stiffness: 520, damping: 16, mass: 0.6 };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const rubber = (v: number, min: number, max: number) =>
	v > max ? max + (v - max) * RUBBER : v < min ? min + (v - min) * RUBBER : v;

interface Options {
	/** Target shell width (the live, animated width is tracked via `onShellUpdate`). */
	width: number;
	/** Target shell height (the live one, like the width, via `onShellUpdate`). */
	height: number;
	/** Gap above the island at the top of the screen. */
	top: number;
	/** Space taken beyond the shell on each side (ears, bubbles). */
	leftExtra: number;
	rightExtra: number;
	/** False while the island is open: it only drifts back to the center once collapsed. */
	canReturn: boolean;
	onDragChange?: (dragging: boolean) => void;
}

/**
 * Dragging the island along the top edge of the screen (or, with "place
 * anywhere" on, anywhere on it), with a squash & stretch deformation driven
 * by its speed. Returns motion values for the shell's `style`, the vertical
 * offset for its container, and the pointer handlers.
 *
 * `x` is the offset from the center the user chose; what's rendered is that
 * offset clamped to the screen for the island's current (animated) size, so
 * expanding next to an edge (or near the bottom) grows inward instead of
 * off-screen.
 */
export function useIslandDrag({ width, height, top, leftExtra, rightExtra, canReturn, onDragChange }: Options) {
	const settings = useSettings();
	const free = readSetting(settings, positionSettings.freePlace);
	// Placed anywhere, it stays where it was put.
	const returnToCenter = readSetting(settings, positionSettings.returnToCenter) && !free;
	const returnDelay = readSetting(settings, positionSettings.returnDelay);
	const stored = Number(settings[ISLAND_OFFSET_KEY]) || 0;
	const storedY = free ? Number(settings[ISLAND_OFFSET_Y_KEY]) || 0 : 0;

	const target = useMotionValue(0);
	const x = useSpring(target, follow);
	const targetY = useMotionValue(0);
	const y = useSpring(targetY, follow);
	const liveWidth = useMotionValue(width);
	const liveHeight = useMotionValue(height);
	const stageWidth = useMotionValue(typeof window === "undefined" ? 0 : window.innerWidth);
	const stageHeight = useMotionValue(typeof window === "undefined" ? 0 : window.innerHeight);
	const left = useMotionValue(leftExtra);
	const right = useMotionValue(rightExtra);
	const gap = useMotionValue(top);
	left.set(leftExtra);
	right.set(rightExtra);
	gap.set(top);
	// 1 while dragging / gliding (deforms and allows rubber-banding), 0 at rest.
	const moving = useMotionValue(0);

	useEffect(() => {
		const onResize = () => {
			stageWidth.set(window.innerWidth);
			stageHeight.set(window.innerHeight);
		};
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [stageWidth, stageHeight]);

	const limits = useCallback(
		(w: number) => {
			const half = stageWidth.get() / 2 - w / 2 - EDGE_MARGIN;
			return { min: Math.min(0, -(half - left.get())), max: Math.max(0, half - right.get()) };
		},
		[stageWidth, left, right],
	);
	/** How far down it may go with height `h` (0: only along the top). */
	const maxY = useCallback(
		(h: number) => Math.max(0, stageHeight.get() - h - gap.get() - EDGE_MARGIN),
		[stageHeight, gap],
	);

	const offset = useTransform(() => {
		const { min, max } = limits(liveWidth.get());
		return moving.get() ? rubber(x.get(), min, max) : clamp(x.get(), min, max);
	});
	// A tall panel opened near the bottom pushes the island up to fit.
	const offsetY = useTransform(() => clamp(y.get(), 0, maxY(liveHeight.get())));

	// --- squash & stretch ------------------------------------------------------
	const velocity = useVelocity(offset);
	const stretch = useSpring(
		useTransform(() => moving.get() * Math.min(Math.abs(velocity.get()) / 2600, 0.3)),
		wobble,
	);
	// Hanging from the top edge, the bottom trails behind the movement.
	const skewX = useSpring(
		useTransform(() => moving.get() * clamp(-velocity.get() / 190, -11, 11)),
		wobble,
	);
	const scaleX = useTransform(stretch, (s) => 1 + s);
	const scaleY = useTransform(stretch, (s) => 1 - s * 0.5);

	// Back to rest once the glide settles.
	const dragging = useRef(false);
	const settle = useRef<number | undefined>(undefined);
	const rest = useCallback(() => {
		window.clearTimeout(settle.current);
		// However the glide ends (or if it never moves at all), the island can't stay squashed.
		settle.current = window.setTimeout(() => {
			if (!dragging.current) moving.set(0);
		}, SETTLE_MS);
	}, [moving]);
	useEffect(() => () => window.clearTimeout(settle.current), []);
	useMotionValueEvent(x, "change", (v) => {
		if (!dragging.current && moving.get() && Math.abs(v - target.get()) < 0.5 && Math.abs(x.getVelocity()) < 20) {
			moving.set(0);
		}
	});

	const [parked, setParked] = useState(false);
	const [floating, setFloating] = useState(false);
	useMotionValueEvent(targetY, "change", (v) => setFloating(v > FLOAT_FROM));

	/** Glide to an offset (animated, deforming). */
	const glideTo = useCallback(
		(to: number, toY = 0) => {
			// Start from what's on screen, which may be clamped narrower than `x`.
			if (!moving.get()) {
				x.jump(offset.get());
				y.jump(offsetY.get());
			}
			moving.set(1);
			target.set(to);
			targetY.set(toY);
			setParked(to !== 0);
			rest();
		},
		[moving, x, y, offset, offsetY, target, targetY, rest],
	);

	const recenter = useCallback(() => {
		glideTo(0, 0);
		setSetting(ISLAND_OFFSET_KEY, 0);
		setSetting(ISLAND_OFFSET_Y_KEY, 0);
	}, [glideTo]);
	useTauriEvent("island://recenter", recenter);

	// Return to the middle after a while (only once collapsed).
	const [isDragging, setIsDragging] = useState(false);
	useEffect(() => {
		if (!returnToCenter || !parked || isDragging || !canReturn) return;
		const id = window.setTimeout(recenter, Math.max(0, returnDelay) * 1000);
		return () => window.clearTimeout(id);
	}, [returnToCenter, returnDelay, parked, isDragging, canReturn, recenter]);

	// Staying put: restore the saved spot (on launch, changed by another window,
	// or back to the top when "place anywhere" is turned off).
	useEffect(() => {
		if (dragging.current) return;
		const toX = returnToCenter ? target.get() : stored;
		if (Math.abs(toX - target.get()) < 0.5 && Math.abs(storedY - targetY.get()) < 0.5) return;
		glideTo(toX, storedY);
	}, [stored, storedY, returnToCenter, glideTo, target, targetY]);

	// --- pointer -----------------------------------------------------------------
	const suppressClick = useRef(false);
	const onDragChangeRef = useRef(onDragChange);
	onDragChangeRef.current = onDragChange;
	const freeRef = useRef(free);
	freeRef.current = free;

	const onPointerDown = useCallback(
		(e: PointerEvent<HTMLElement>) => {
			if (e.button !== 0) return;
			if ((e.target as Element).closest("input, textarea, select, [data-no-drag]")) return;

			const el = e.currentTarget;
			const pointerId = e.pointerId;
			const startX = e.clientX;
			const startY = e.clientY;
			const vertical = freeRef.current;
			let origin = 0;
			let originY = 0;
			let active = false;
			let lastX = startX;
			let lastY = startY;
			let lastT = performance.now();
			let speed = 0;
			let speedY = 0;

			const move = (ev: globalThis.PointerEvent) => {
				if (ev.pointerId !== pointerId) return;
				const dx = ev.clientX - startX;
				const dy = vertical ? ev.clientY - startY : 0;
				if (!active) {
					if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
					active = true;
					dragging.current = true;
					if (!moving.get()) {
						x.jump(offset.get());
						y.jump(offsetY.get());
					}
					moving.set(1);
					origin = offset.get() - dx;
					originY = offsetY.get() - dy;
					try {
						el.setPointerCapture(pointerId);
					} catch {
						/* pointer already gone */
					}
					setIsDragging(true);
					onDragChangeRef.current?.(true);
					command("set_dragging", { dragging: true });
				}
				const now = performance.now();
				const dt = Math.max(1, now - lastT);
				speed = speed * 0.6 + ((ev.clientX - lastX) / dt) * 1000 * 0.4;
				speedY = speedY * 0.6 + ((ev.clientY - lastY) / dt) * 1000 * 0.4;
				lastX = ev.clientX;
				lastY = ev.clientY;
				lastT = now;
				const { min, max } = limits(liveWidth.get());
				target.set(rubber(origin + dx, min, max));
				if (vertical) targetY.set(rubber(originY + dy, 0, maxY(liveHeight.get())));
			};

			const end = (ev: globalThis.PointerEvent) => {
				if (ev.pointerId !== pointerId) return;
				window.removeEventListener("pointermove", move);
				window.removeEventListener("pointerup", end);
				window.removeEventListener("pointercancel", end);
				if (!active) return;

				dragging.current = false;
				setIsDragging(false);
				onDragChangeRef.current?.(false);
				command("set_dragging", { dragging: false });
				try {
					el.releasePointerCapture(pointerId);
				} catch {
					/* already released */
				}
				// A pause before letting go cancels the fling.
				if (performance.now() - lastT > 80) {
					speed = 0;
					speedY = 0;
				}

				const { min, max } = limits(liveWidth.get());
				let to = clamp(origin + (lastX - startX) + speed * FLING, min, max);
				if (Math.abs(to) < CENTER_SNAP) to = 0;
				target.set(to);
				setParked(to !== 0);
				setSetting(ISLAND_OFFSET_KEY, Math.round(to));
				if (vertical) {
					let toY = clamp(originY + (lastY - startY) + speedY * FLING, 0, maxY(liveHeight.get()));
					if (toY < TOP_SNAP) toY = 0;
					targetY.set(toY);
					setSetting(ISLAND_OFFSET_Y_KEY, Math.round(toY));
				}
				rest();

				// The click that follows pointerup must not expand / press buttons.
				suppressClick.current = true;
				window.setTimeout(() => (suppressClick.current = false), 0);
			};

			window.addEventListener("pointermove", move);
			window.addEventListener("pointerup", end);
			window.addEventListener("pointercancel", end);
		},
		[limits, maxY, liveWidth, liveHeight, moving, offset, offsetY, target, targetY, x, y, rest],
	);

	const onClickCapture = useCallback((e: MouseEvent) => {
		if (!suppressClick.current) return;
		suppressClick.current = false;
		e.stopPropagation();
		e.preventDefault();
	}, []);

	/** Pass to the shell's `onUpdate` so clamping follows the animated size. */
	const onShellUpdate = useCallback(
		(latest: Record<string, unknown>) => {
			if (typeof latest.width === "number") liveWidth.set(latest.width);
			if (typeof latest.height === "number") liveHeight.set(latest.height);
		},
		[liveWidth, liveHeight],
	);

	return {
		style: { x: offset, scaleX, scaleY, skewX, transformOrigin: "50% 0" },
		/** Distance from the top (placed anywhere): for the island's container. */
		y: offsetY,
		/** Away from the top edge: no notch ears, round on top too. */
		floating: free && floating,
		dragging: isDragging,
		onPointerDown,
		onClickCapture,
		onShellUpdate,
	};
}
