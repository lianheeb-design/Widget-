import { ZapIcon } from "lucide-react";
/**
 * Reaction test: wait for green, then click as fast as you can. Keeps the best
 * time; clicking too early costs the round.
 */
import { useEffect, useRef, useState } from "react";
import { useT } from "../../core/i18n";
import { type SettingDef, setSetting, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";

const ACCENT = "#30D158";

const best: SettingDef<number> = { key: "reaction.best", label: "reaction.best", default: 0 };

type Phase =
	| { kind: "idle" }
	| { kind: "wait" }
	| { kind: "go"; at: number }
	| { kind: "early" }
	| { kind: "result"; ms: number; record: boolean };

const BG: Record<Phase["kind"], string> = {
	idle: "linear-gradient(135deg, #1c1c1e, #2c2c2e)",
	wait: "linear-gradient(135deg, #8a1c14, #c9291d)",
	go: "linear-gradient(135deg, #1f9d45, #30D158)",
	early: "linear-gradient(135deg, #7a4a00, #c77800)",
	result: "linear-gradient(135deg, #0b3d91, #0A84FF)",
};

function ReactionPanel() {
	const t = useT();
	const record = useSetting(best);
	const [phase, setPhase] = useState<Phase>({ kind: "idle" });
	const [recent, setRecent] = useState<number[]>([]);
	const timer = useRef<number | undefined>(undefined);
	useEffect(() => () => window.clearTimeout(timer.current), []);

	const startRound = () => {
		setPhase({ kind: "wait" });
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(
			() => setPhase({ kind: "go", at: performance.now() }),
			1200 + Math.random() * 2800,
		);
	};

	// pointerdown, not click: a click only fires on release and adds ~80 ms.
	const press = () => {
		switch (phase.kind) {
			case "wait":
				window.clearTimeout(timer.current);
				setPhase({ kind: "early" });
				break;
			case "go": {
				const ms = Math.round(performance.now() - phase.at);
				const isRecord = !record || ms < record;
				if (isRecord) setSetting(best, ms);
				setRecent((r) => [...r.slice(-4), ms]);
				setPhase({ kind: "result", ms, record: isRecord });
				break;
			}
			default:
				startRound();
		}
	};

	const rating = (ms: number) =>
		ms < 200
			? t("reaction.rating.fast")
			: ms < 260
				? t("reaction.rating.good")
				: ms < 340
					? t("reaction.rating.ok")
					: t("reaction.rating.slow");
	const average = recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 0;

	let title: string;
	let sub: string;
	switch (phase.kind) {
		case "idle":
			title = t("reaction.start");
			sub = t("reaction.startHint");
			break;
		case "wait":
			title = t("reaction.wait");
			sub = "";
			break;
		case "go":
			title = t("reaction.go");
			sub = "";
			break;
		case "early":
			title = t("reaction.early");
			sub = t("reaction.earlyHint");
			break;
		case "result":
			title = `${phase.ms} ms`;
			sub = `${phase.record ? t("reaction.newBest") : rating(phase.ms)} · ${t("reaction.again")}`;
			break;
	}

	return (
		<div className="flex h-full gap-3 px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
			<button
				type="button"
				className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[20px] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] transition-[background] duration-75 select-none"
				style={{ background: BG[phase.kind] }}
				onPointerDown={press}
			>
				<strong className={phase.kind === "result" ? "text-[30px]/[1.1] tabular-nums" : "text-[20px]/[1.2]"}>
					{title}
				</strong>
				{sub && <span className="text-[12px] font-[650] text-white/80">{sub}</span>}
			</button>
			<div className="flex w-30 flex-none flex-col justify-center gap-2 text-[12px] text-text-dim">
				<span className="flex items-center gap-1.5 font-[650] text-text">
					<ZapIcon size={14} color={ACCENT} />
					{record ? t("reaction.best", { n: record }) : "–"}
				</span>
				{average > 0 && <span className="tabular-nums">{t("reaction.average", { n: average })}</span>}
				<div className="flex h-6 items-end gap-1" aria-hidden="true">
					{recent.map((ms, i) => (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: the last five rounds, in order
							key={i}
							className="w-3 rounded-[3px]"
							style={{
								height: `${Math.max(15, Math.min(100, 100 - (ms - 150) / 4))}%`,
								background: ms === record ? ACCENT : "rgba(255,255,255,0.25)",
							}}
						/>
					))}
				</div>
				{record > 0 && (
					<button
						type="button"
						className="self-start text-[11px] text-text-faint hover:text-text"
						onClick={() => setSetting(best, 0)}
					>
						{t("reaction.reset")}
					</button>
				)}
			</div>
		</div>
	);
}

export const reactionModule: IslandModule = {
	id: "reaction",
	title: "reaction.title",
	settingsIcon: <ZapIcon size={15} />,
	useView(): ModuleView {
		return {
			active: false,
			priority: 0,
			accent: ACCENT,
			icon: <ZapIcon size={15} color={ACCENT} />,
			expanded: <ReactionPanel />,
			expandedSize: { width: 560, height: 150 },
		};
	},
};
