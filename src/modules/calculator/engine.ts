/**
 * The calculator's brain, without `eval`: a small expression parser
 * (+ − × ÷ ^ %, brackets, √, π), "15 % von 240", "+ 10 %", and unit
 * conversions ("5 km in m", "30 °C in °F"). Currencies ("20 CHF in EUR") are
 * recognised here and converted by the panel with daily rates.
 */

export type CalcResult =
	| { kind: "number"; value: number; unit?: string }
	| { kind: "currency"; amount: number; from: string; to: string }
	| { kind: "error" }
	| { kind: "empty" };

// ---------------------------------------------------------------- units

interface UnitDef {
	dim: string;
	/** Factor to the dimension's base unit (temperature: see `toKelvin`). */
	factor: number;
	label: string;
}

const UNITS: Record<string, UnitDef> = {};
function unit(dim: string, factor: number, label: string, ...names: string[]) {
	for (const n of [label, ...names]) UNITS[n.toLowerCase()] = { dim, factor, label };
}
// Length (m)
unit("length", 0.001, "mm", "millimeter", "millimetre");
unit("length", 0.01, "cm", "zentimeter", "centimeter", "centimetre");
unit("length", 0.1, "dm", "dezimeter");
unit("length", 1, "m", "meter", "metre", "metres", "meters");
unit("length", 1000, "km", "kilometer", "kilometre", "kilometers");
unit("length", 0.0254, "in", "inch", "inches", "zoll");
unit("length", 0.3048, "ft", "foot", "feet", "fuss");
unit("length", 0.9144, "yd", "yard", "yards");
unit("length", 1609.344, "mi", "mile", "miles", "meile", "meilen");
// Mass (g)
unit("mass", 0.001, "mg", "milligramm", "milligram");
unit("mass", 1, "g", "gramm", "gram", "grams");
unit("mass", 1000, "kg", "kilo", "kilogramm", "kilogram");
unit("mass", 1_000_000, "t", "tonne", "tonnen", "ton");
unit("mass", 453.59237, "lb", "lbs", "pound", "pounds", "pfund");
unit("mass", 28.349523125, "oz", "ounce", "ounces", "unze");
// Time (s)
unit("time", 0.001, "ms", "millisekunden", "milliseconds");
unit("time", 1, "s", "sek", "sekunde", "sekunden", "sec", "second", "seconds");
unit("time", 60, "min", "minute", "minuten", "minutes");
unit("time", 3600, "h", "std", "stunde", "stunden", "hour", "hours");
unit("time", 86400, "d", "tag", "tage", "tagen", "day", "days");
unit("time", 604800, "wk", "woche", "wochen", "week", "weeks");
unit("time", 31557600, "y", "jahr", "jahre", "year", "years");
// Volume (l)
unit("volume", 0.001, "ml", "milliliter");
unit("volume", 0.01, "cl", "zentiliter", "centiliter");
unit("volume", 0.1, "dl", "deziliter", "deciliter");
unit("volume", 1, "l", "liter", "litre", "liters");
unit("volume", 3.785411784, "gal", "gallon", "gallons", "gallone");
// Area (m²)
unit("area", 1, "m²", "m2", "qm", "quadratmeter");
unit("area", 1_000_000, "km²", "km2", "quadratkilometer");
unit("area", 10_000, "ha", "hektar", "hectare");
// Speed (m/s)
unit("speed", 1, "m/s");
unit("speed", 1 / 3.6, "km/h", "kmh", "kph");
unit("speed", 0.44704, "mph");
unit("speed", 0.514444, "kn", "knoten", "knots");
// Data (bytes)
unit("data", 1, "B", "byte", "bytes");
unit("data", 1024, "KB", "kib", "kilobyte");
unit("data", 1024 ** 2, "MB", "mib", "megabyte");
unit("data", 1024 ** 3, "GB", "gib", "gigabyte");
unit("data", 1024 ** 4, "TB", "tib", "terabyte");
// Temperature (handled apart)
unit("temp", 1, "°C", "c", "celsius", "grad");
unit("temp", 1, "°F", "f", "fahrenheit");
unit("temp", 1, "K", "kelvin");

const toKelvin = (v: number, u: string) => (u === "°C" ? v + 273.15 : u === "°F" ? ((v - 32) * 5) / 9 + 273.15 : v);
const fromKelvin = (k: number, u: string) => (u === "°C" ? k - 273.15 : u === "°F" ? ((k - 273.15) * 9) / 5 + 32 : k);

const lookup = (name: string) =>
	UNITS[name.toLowerCase().replace(/^°/, "°")] ?? UNITS[name.toLowerCase().replace("°", "")];

function convert(value: number, fromName: string, toName: string): CalcResult {
	const from = lookup(fromName);
	const to = lookup(toName);
	if (!from || !to || from.dim !== to.dim) return { kind: "error" };
	if (from.dim === "temp")
		return { kind: "number", value: fromKelvin(toKelvin(value, from.label), to.label), unit: to.label };
	return { kind: "number", value: (value * from.factor) / to.factor, unit: to.label };
}

// ---------------------------------------------------------------- parser

type Token = { t: "num"; v: number } | { t: "op"; v: string } | { t: "pct" } | { t: "fn"; v: string };

function tokenize(src: string): Token[] | null {
	const out: Token[] = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (c === " ") {
			i++;
			continue;
		}
		const num = /^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
		if (num) {
			out.push({ t: "num", v: Number.parseFloat(num[0]) });
			i += num[0].length;
			continue;
		}
		if ("+-*/^()".includes(c)) {
			out.push({ t: "op", v: c });
			i++;
			continue;
		}
		if (c === "%") {
			out.push({ t: "pct" });
			i++;
			continue;
		}
		if (c === "√") {
			out.push({ t: "fn", v: "sqrt" });
			i++;
			continue;
		}
		if (c === "π") {
			out.push({ t: "num", v: Math.PI });
			i++;
			continue;
		}
		const word = /^[a-z]+/i.exec(src.slice(i));
		if (word) {
			const w = word[0].toLowerCase();
			if (w === "pi") out.push({ t: "num", v: Math.PI });
			else if (w === "e") out.push({ t: "num", v: Math.E });
			else if (["sqrt", "wurzel", "sin", "cos", "tan", "ln", "log", "abs", "round"].includes(w))
				out.push({ t: "fn", v: w === "wurzel" ? "sqrt" : w });
			else return null;
			i += word[0].length;
			continue;
		}
		return null;
	}
	return out;
}

const FNS: Record<string, (x: number) => number> = {
	sqrt: Math.sqrt,
	sin: (x) => Math.sin((x * Math.PI) / 180),
	cos: (x) => Math.cos((x * Math.PI) / 180),
	tan: (x) => Math.tan((x * Math.PI) / 180),
	ln: Math.log,
	log: Math.log10,
	abs: Math.abs,
	round: Math.round,
};

/** Recursive descent: expr = term (± term)*, term = power (×÷ power)*, power = unary (^ power)?. */
function parse(tokens: Token[]): number | null {
	let pos = 0;
	const peek = () => tokens[pos];
	const isOp = (v: string) => {
		const tk = peek();
		return tk?.t === "op" && tk.v === v;
	};

	// A value with an optional trailing % (as a fraction), and whether it had one.
	function postfix(): { v: number; pct: boolean } | null {
		const v = unary();
		if (v === null) return null;
		if (peek()?.t === "pct") {
			pos++;
			return { v: v / 100, pct: true };
		}
		return { v, pct: false };
	}
	function primary(): number | null {
		const tk = peek();
		if (!tk) return null;
		if (tk.t === "num") {
			pos++;
			return tk.v;
		}
		if (tk.t === "fn") {
			pos++;
			const arg = isOp("(") ? primary() : unary();
			return arg === null ? null : FNS[tk.v](arg);
		}
		if (isOp("(")) {
			pos++;
			const v = expr();
			if (!isOp(")")) return v; // forgive a missing ")" at the end
			pos++;
			return v;
		}
		return null;
	}
	function unary(): number | null {
		if (isOp("-")) {
			pos++;
			const v = unary();
			return v === null ? null : -v;
		}
		if (isOp("+")) {
			pos++;
			return unary();
		}
		const base = primary();
		if (base === null) return null;
		if (isOp("^")) {
			pos++;
			const exp = unary();
			return exp === null ? null : base ** exp;
		}
		return base;
	}
	function term(): { v: number; pct: boolean } | null {
		let left = postfix();
		if (left === null) return null;
		while (isOp("*") || isOp("/") || peek()?.t === "num" || isOp("(") || peek()?.t === "fn") {
			// "2(3)" or "2π": an implied ×.
			const op = isOp("*") || isOp("/") ? (tokens[pos++] as { v: string }).v : "*";
			const right = postfix();
			if (right === null) return null;
			left = { v: op === "*" ? left.v * right.v : left.v / right.v, pct: false };
		}
		return left;
	}
	function expr(): number | null {
		const first = term();
		if (first === null) return null;
		let v = first.v;
		while (isOp("+") || isOp("-")) {
			const op = (tokens[pos++] as { v: string }).v;
			const right = term();
			if (right === null) return null;
			// "200 + 10 %" adds ten percent of 200, like a pocket calculator.
			const amount = right.pct ? v * right.v : right.v;
			v = op === "+" ? v + amount : v - amount;
		}
		return v;
	}

	const v = expr();
	return pos === tokens.length ? v : null;
}

function evaluate(src: string): number | null {
	const tokens = tokenize(src);
	if (!tokens?.length) return null;
	const v = parse(tokens);
	return v === null || !Number.isFinite(v) ? null : v;
}

/** Commas as decimal points, the usual symbols, words. */
function normalize(input: string) {
	return input
		.trim()
		.replace(/(\d),(\d)/g, "$1.$2")
		.replace(/[×xX](?=\s*[\d(√π])/g, "*")
		.replace(/[÷:]/g, "/")
		.replace(/[−–]/g, "-")
		.replace(/\s+/g, " ");
}

const CURRENCY = /^[a-z]{3}$/i;

export function calculate(input: string): CalcResult {
	const src = normalize(input);
	if (!src) return { kind: "empty" };

	// "15 % von 240", "15% of 240"
	const pctOf = /^(.+?)\s*%\s*(von|of|vom)\s+(.+)$/i.exec(src);
	if (pctOf) {
		const a = evaluate(pctOf[1]);
		const b = evaluate(pctOf[3]);
		return a === null || b === null ? { kind: "error" } : { kind: "number", value: (a / 100) * b };
	}

	// "5 km in m", "20 CHF in EUR", "30°C to °F"
	const conv = /^(.+?)\s*([a-zäöü°²/]+[a-z0-9²/]*)\s+(in|to|nach|zu|als)\s+([a-zäöü°²/]+[a-z0-9²/]*)$/i.exec(src);
	if (conv) {
		const amount = evaluate(conv[1]);
		if (amount === null) return { kind: "error" };
		const [from, to] = [conv[2], conv[4]];
		if (CURRENCY.test(from) && CURRENCY.test(to) && !lookup(from) && !lookup(to))
			return { kind: "currency", amount, from: from.toUpperCase(), to: to.toUpperCase() };
		return convert(amount, from, to);
	}

	const v = evaluate(src);
	return v === null ? { kind: "error" } : { kind: "number", value: v };
}

/** Up to 10 significant digits, without float noise (0.1 + 0.2 = 0.3). */
export function formatNumber(value: number, locale: string) {
	const rounded = Number.parseFloat(value.toPrecision(12));
	const abs = Math.abs(rounded);
	if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) return rounded.toExponential(6).replace(/\.?0+e/, "e");
	return new Intl.NumberFormat(locale, { maximumFractionDigits: 10, useGrouping: true }).format(rounded);
}
