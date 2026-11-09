import { CalculatorIcon, CopyIcon, DeleteIcon } from "lucide-react";
/**
 * Calculator: type or tap a sum ("15 % von 240", "(12+8)*3"), convert units
 * ("5 km in m") and currencies ("20 CHF in EUR", daily rates of the European
 * Central Bank via frankfurter.dev, no account). A click copies the result;
 * the last sums stay as a history.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../core/cn";
import { useLocale, useT } from "../../core/i18n";
import { type SettingDef, setSetting, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { useKeyboard } from "../shared";
import { tools } from "../tools/bridge";
import { type CalcResult, calculate, formatNumber } from "./engine";

const ACCENT = "#FF9500";
const HISTORY = 6;

interface Entry {
	input: string;
	result: string;
}

const history: SettingDef<Entry[]> = { key: "calc.history", label: "calc.title", default: [] };

/** Daily rates per base currency, fetched once per session and base. */
const rates = new Map<string, Promise<Record<string, number>>>();
function ratesFor(base: string) {
	let p = rates.get(base);
	if (!p) {
		p = fetch(`https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(base)}`)
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((d: { rates?: Record<string, number> }) => d.rates ?? {});
		p.catch(() => rates.delete(base));
		rates.set(base, p);
	}
	return p;
}

/** The result as text: numbers right away, currencies once the rates are in. */
function useResult(result: CalcResult) {
	const t = useT();
	const locale = useLocale();
	const [money, setMoney] = useState<string | null>(null);
	const key = result.kind === "currency" ? `${result.amount}${result.from}${result.to}` : "";

	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the currency result
	useEffect(() => {
		setMoney(null);
		if (result.kind !== "currency") return;
		let alive = true;
		const { amount, from, to } = result;
		if (from === to) {
			setMoney(`${formatNumber(amount, locale)} ${to}`);
			return;
		}
		ratesFor(from)
			.then((r) => {
				if (!alive) return;
				const rate = r[to];
				setMoney(rate ? `${formatNumber(Math.round(amount * rate * 100) / 100, locale)} ${to}` : t("calc.noCurrency"));
			})
			.catch(() => alive && setMoney(t("calc.offline")));
		return () => {
			alive = false;
		};
	}, [key, locale]);

	if (result.kind === "number") return `${formatNumber(result.value, locale)}${result.unit ? ` ${result.unit}` : ""}`;
	if (result.kind === "currency") return money ?? "…";
	return null;
}

const KEYS = [
	["C", "(", ")", "÷"],
	["7", "8", "9", "×"],
	["4", "5", "6", "−"],
	["1", "2", "3", "+"],
	["0", ".", "%", "="],
];
const OPS = new Set(["÷", "×", "−", "+", "%", "(", ")"]);

function CalculatorPanel() {
	const t = useT();
	const list = useSetting(history);
	const [input, setInput] = useState("");
	const [copied, setCopied] = useState(false);
	const keys = useKeyboard("calc.input");
	const field = useRef<HTMLInputElement>(null);
	const result = useMemo(() => calculate(input), [input]);
	const text = useResult(result);

	const copy = (value: string) => {
		tools("copy_text", { text: value })
			.then(() => {
				setCopied(true);
				window.setTimeout(() => setCopied(false), 1200);
			})
			.catch(() => undefined);
	};
	const commit = () => {
		if (!text || text === "…") return;
		setSetting(
			history,
			[{ input: input.trim(), result: text }, ...list.filter((e) => e.input !== input.trim())].slice(0, HISTORY),
		);
	};
	const press = (k: string) => {
		if (k === "C") setInput("");
		else if (k === "=") commit();
		else
			setInput((v) =>
				(v + (OPS.has(k) && k !== "(" && k !== ")" ? ` ${k} ` : k)).replace(/\s{2,}/g, " ").replace(/^ /, ""),
			);
		field.current?.focus({ preventScroll: true });
	};

	return (
		<div className="flex h-full gap-3 px-1" onClick={(e) => e.stopPropagation()}>
			<div className="flex min-w-0 flex-1 flex-col gap-1.5">
				<div className="flex items-center gap-1.5">
					<input
						ref={field}
						className="h-9 min-w-0 flex-1 rounded-[12px] bg-white/7 px-3 text-[15px] text-text outline-none select-text placeholder:text-text-faint focus:bg-white/10"
						value={input}
						placeholder={t("calc.placeholder")}
						spellCheck={false}
						onChange={(e) => setInput(e.target.value)}
						{...keys}
						onKeyDown={(e) => (e.key === "Enter" ? commit() : keys.onKeyDown(e))}
					/>
					<button
						type="button"
						title={t("calc.backspace")}
						className="grid size-9 flex-none place-items-center rounded-[12px] text-text-dim hover:bg-white/8 hover:text-text"
						onClick={() => setInput((v) => v.trimEnd().slice(0, -1).trimEnd())}
					>
						<DeleteIcon size={15} />
					</button>
				</div>
				<button
					type="button"
					disabled={!text}
					title={t("calc.copy")}
					className="group flex h-10 items-center justify-end gap-2 rounded-[12px] px-3 text-right disabled:cursor-default"
					onClick={() => text && copy(text)}
				>
					{text && <CopyIcon size={13} className="flex-none text-text-faint opacity-0 group-hover:opacity-100" />}
					<span
						className={cn(
							"truncate text-[26px]/none font-[600] tabular-nums",
							result.kind === "error" ? "text-[17px] text-text-faint" : "",
						)}
						style={{ color: result.kind === "error" ? undefined : copied ? "#30D158" : ACCENT }}
					>
						{copied ? t("calc.copied") : result.kind === "error" ? t("calc.error") : text ? `= ${text}` : ""}
					</span>
				</button>
				<div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" data-scroll>
					{list.length === 0 && <p className="px-1 text-[11.5px] text-text-faint">{t("calc.hint")}</p>}
					{list.map((e) => (
						<button
							key={e.input}
							type="button"
							className="flex flex-none items-center gap-2 rounded-[8px] px-2 py-0.5 text-left text-[12px] hover:bg-white/6"
							onClick={() => setInput(e.input)}
						>
							<span className="min-w-0 flex-1 truncate text-text-dim">{e.input}</span>
							<span className="flex-none font-[650] tabular-nums">= {e.result}</span>
						</button>
					))}
				</div>
			</div>
			<div className="grid w-50 flex-none grid-cols-4 gap-1.5">
				{KEYS.flat().map((k) => (
					<button
						key={k}
						type="button"
						className={cn(
							"h-7.5 rounded-[10px] text-[14px] font-[650] transition-[background,transform] active:scale-95",
							k === "="
								? "bg-[#FF9500] text-black hover:brightness-110"
								: k === "C"
									? "bg-white/12 text-[#ff8a80] hover:bg-white/16"
									: OPS.has(k)
										? "bg-white/10 text-[#ffc56b] hover:bg-white/15"
										: "bg-white/6 text-text hover:bg-white/12",
						)}
						onClick={() => press(k)}
					>
						{k}
					</button>
				))}
			</div>
		</div>
	);
}

export const calculatorModule: IslandModule = {
	id: "calculator",
	title: "calc.title",
	settingsIcon: <CalculatorIcon size={15} />,
	useView(): ModuleView {
		return {
			active: false,
			priority: 0,
			accent: ACCENT,
			icon: <CalculatorIcon size={15} color={ACCENT} />,
			expanded: <CalculatorPanel />,
			expandedSize: { width: 560, height: 196 },
		};
	},
};
