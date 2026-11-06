import { Gamepad2Icon } from "lucide-react";
/** Snake: arrow keys or WASD, eat the apples, don't bite yourself. */
import { useCallback, useEffect, useRef, useState } from "react";
import { command } from "../../core/bridge";
import { useT } from "../../core/i18n";
import { useIsland } from "../../core/island";
import { type SettingDef, setSetting, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";

const ACCENT = "#30D158";
const COLS = 26;
const ROWS = 8;
const CELL = 19;
const START_SPEED = 150;
const best: SettingDef<number> = { key: "snake.best", label: "snake.best", default: 0 };

type Point = { x: number; y: number };
type Phase = "ready" | "playing" | "paused" | "over";

const DIRS: Record<string, Point> = {
	ArrowUp: { x: 0, y: -1 },
	ArrowDown: { x: 0, y: 1 },
	ArrowLeft: { x: -1, y: 0 },
	ArrowRight: { x: 1, y: 0 },
	w: { x: 0, y: -1 },
	s: { x: 0, y: 1 },
	a: { x: -1, y: 0 },
	d: { x: 1, y: 0 },
};

function freeCell(snake: Point[]): Point {
	for (;;) {
		const p = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
		if (!snake.some((s) => s.x === p.x && s.y === p.y)) return p;
	}
}

function SnakeGame() {
	const t = useT();
	const island = useIsland();
	const record = useSetting(best);
	const canvas = useRef<HTMLCanvasElement>(null);
	const [phase, setPhase] = useState<Phase>("ready");
	const [score, setScore] = useState(0);
	const game = useRef({
		snake: [
			{ x: 6, y: 4 },
			{ x: 5, y: 4 },
			{ x: 4, y: 4 },
		] as Point[],
		dir: { x: 1, y: 0 },
		queued: [] as Point[],
		apple: { x: 14, y: 4 },
		speed: START_SPEED,
	});

	const draw = useCallback(() => {
		const ctx = canvas.current?.getContext("2d");
		if (!ctx) return;
		const g = game.current;
		ctx.clearRect(0, 0, COLS * CELL, ROWS * CELL);
		ctx.fillStyle = "rgba(255,255,255,0.035)";
		for (let y = 0; y < ROWS; y++) for (let x = y % 2; x < COLS; x += 2) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
		ctx.fillStyle = "#FF453A";
		ctx.beginPath();
		ctx.arc(g.apple.x * CELL + CELL / 2, g.apple.y * CELL + CELL / 2, CELL / 2 - 3, 0, Math.PI * 2);
		ctx.fill();
		g.snake.forEach((p, i) => {
			ctx.fillStyle = i === 0 ? "#7CF2A0" : ACCENT;
			ctx.beginPath();
			ctx.roundRect(p.x * CELL + 1.5, p.y * CELL + 1.5, CELL - 3, CELL - 3, 5);
			ctx.fill();
		});
	}, []);

	const reset = useCallback(() => {
		const snake = [
			{ x: 6, y: 4 },
			{ x: 5, y: 4 },
			{ x: 4, y: 4 },
		];
		game.current = { snake, dir: { x: 1, y: 0 }, queued: [], apple: freeCell(snake), speed: START_SPEED };
		setScore(0);
		draw();
	}, [draw]);

	useEffect(draw, [draw]);

	// The game loop, while playing.
	useEffect(() => {
		if (phase !== "playing") return;
		let timer = 0;
		const step = () => {
			const g = game.current;
			const next = g.queued.shift();
			if (next && (next.x !== -g.dir.x || next.y !== -g.dir.y)) g.dir = next;
			const head = { x: g.snake[0].x + g.dir.x, y: g.snake[0].y + g.dir.y };
			const hitWall = head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS;
			const eats = head.x === g.apple.x && head.y === g.apple.y;
			const body = eats ? g.snake : g.snake.slice(0, -1);
			if (hitWall || body.some((p) => p.x === head.x && p.y === head.y)) {
				setPhase("over");
				return;
			}
			g.snake = [head, ...body];
			if (eats) {
				g.apple = freeCell(g.snake);
				g.speed = Math.max(70, g.speed - 4);
				setScore((s) => s + 1);
			}
			draw();
			timer = window.setTimeout(step, g.speed);
		};
		timer = window.setTimeout(step, game.current.speed);
		return () => window.clearTimeout(timer);
	}, [phase, draw]);

	useEffect(() => {
		if (phase === "over" && score > record) setSetting(best, score);
	}, [phase, score, record]);

	// Keyboard while the panel is open; the island holds the keyboard meanwhile.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const dir = DIRS[e.key] ?? DIRS[e.key.toLowerCase()];
			if (dir) {
				e.preventDefault();
				const q = game.current.queued;
				if (q.length < 3) q.push(dir);
				if (phase === "ready" || phase === "paused") setPhase("playing");
			} else if (e.key === " " || e.key === "p") {
				e.preventDefault();
				setPhase((p) => (p === "playing" ? "paused" : p === "paused" ? "playing" : p));
			} else if (e.key === "Escape") {
				setPhase((p) => (p === "playing" ? "paused" : p));
				command("restore_focus");
				island.keepOpen(false, "snake");
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [phase, island]);

	useEffect(() => {
		if (phase === "playing") island.keepOpen(true, "snake");
		else if (phase === "over") island.keepOpen(false, "snake");
		return () => island.keepOpen(false, "snake");
	}, [phase, island]);

	const start = () => {
		command("focus_island");
		if (phase === "over" || phase === "ready") reset();
		setPhase("playing");
	};

	const overlay =
		phase === "ready"
			? t("snake.start")
			: phase === "paused"
				? t("snake.paused")
				: phase === "over"
					? t("snake.over", { n: score })
					: null;

	return (
		<div className="flex h-full flex-col items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
			<div className="flex w-full max-w-[494px] items-center justify-between text-[12px] font-[650] text-text-dim">
				<span>{t("snake.score", { n: score })}</span>
				<span>{t("snake.best", { n: Math.max(record, phase === "over" ? score : 0) })}</span>
			</div>
			<div className="relative overflow-hidden rounded-[14px] bg-white/5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
				<canvas ref={canvas} width={COLS * CELL} height={ROWS * CELL} className="block" />
				{overlay && (
					<button
						type="button"
						className="absolute inset-0 grid place-items-center bg-black/55 text-[14px] font-bold text-white backdrop-blur-[2px]"
						onClick={start}
					>
						<span className="flex flex-col items-center gap-0.5">
							{overlay}
							<span className="text-[11.5px] font-[550] text-white/70">{t("snake.hint")}</span>
						</span>
					</button>
				)}
			</div>
		</div>
	);
}

export const snakeModule: IslandModule = {
	id: "snake",
	title: "snake.title",
	settingsIcon: <Gamepad2Icon size={15} />,
	useView(): ModuleView {
		return {
			active: false,
			priority: 0,
			accent: ACCENT,
			icon: <Gamepad2Icon size={15} color={ACCENT} />,
			expanded: <SnakeGame />,
			expandedSize: { width: 560, height: 196 },
		};
	},
};
