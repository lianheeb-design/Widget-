import { useEffect } from "react";
import { command, isTauri } from "./bridge";

const PAD = 6;
/** While something moves: every third frame. At rest: a few times a second. */
const FAST_FRAMES = 3;
const SLOW_MS = 250;
/** How long it keeps measuring fast after the last change. */
const SETTLE_MS = 1200;

let wake: () => void = () => {};

/** Something is about to move (the island changes size): measure fast again at once. */
export function kickHitRects() {
	wake();
}

/**
 * Keeps the backend informed about which parts of the transparent window are
 * interactive. Every element marked with `data-hit` counts; the rects follow
 * animations because they are re-measured every few frames while anything
 * changes, and only a few times a second while the island rests (so it costs
 * next to nothing when idle).
 */
export function useHitRects() {
	useEffect(() => {
		if (!isTauri) return;
		let frame = 0;
		let raf = 0;
		let timer = 0;
		let last = "";
		let changedAt = performance.now();

		const measure = () => {
			const rects = Array.from(document.querySelectorAll<HTMLElement>("[data-hit]")).map((el) => {
				const r = el.getBoundingClientRect();
				return {
					x: Math.round(r.left - PAD),
					y: Math.round(Math.max(0, r.top - PAD)),
					width: Math.round(r.width + PAD * 2),
					height: Math.round(r.height + PAD * 2),
				};
			});
			const key = JSON.stringify(rects);
			if (key !== last) {
				last = key;
				changedAt = performance.now();
				command("set_hit_rects", { rects });
			}
		};

		const tick = () => {
			raf = 0;
			timer = 0;
			if (frame++ % FAST_FRAMES === 0) measure();
			if (performance.now() - changedAt < SETTLE_MS) raf = requestAnimationFrame(tick);
			else timer = window.setTimeout(tick, SLOW_MS);
		};

		wake = () => {
			changedAt = performance.now();
			if (raf) return;
			window.clearTimeout(timer);
			timer = 0;
			raf = requestAnimationFrame(tick);
		};
		// The pointer often comes right before a change (hover, click, wheel).
		const onInput = () => wake();
		window.addEventListener("pointerdown", onInput, true);
		window.addEventListener("wheel", onInput, true);

		raf = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(raf);
			window.clearTimeout(timer);
			window.removeEventListener("pointerdown", onInput, true);
			window.removeEventListener("wheel", onInput, true);
			wake = () => {};
		};
	}, []);
}
