import { ArrowLeftRightIcon, ClipboardPasteIcon, CopyIcon, LanguagesIcon, XIcon } from "lucide-react";
/**
 * Translator: type or paste a text, pick the language, Enter translates.
 * MyMemory by default (free, no account); with the person's own DeepL key
 * (backend: `src-tauri/src/providers/tools/translate.rs`) DeepL instead.
 */
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Block, Desc, Row } from "../../components/ui/card";
import { Input } from "../../components/ui/form";
import { cn } from "../../core/cn";
import { useLocale, useT } from "../../core/i18n";
import { type SettingDef, setSetting, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { useKeyboard } from "../shared";
import { errorText, tools } from "../tools/bridge";

const ACCENT = "#0A84FF";
const LANGUAGES = [
	"de",
	"en",
	"fr",
	"it",
	"es",
	"pt",
	"nl",
	"pl",
	"tr",
	"sq",
	"hr",
	"sr",
	"ru",
	"uk",
	"ar",
	"zh",
	"ja",
	"ko",
	"sv",
	"da",
	"el",
	"hu",
	"cs",
	"ro",
];

const fromLang: SettingDef<string> = { key: "translate.from", label: "translate.from", default: "auto" };
const toLang: SettingDef<string> = { key: "translate.to", label: "translate.to", default: "en" };

interface Translation {
	text: string;
	detected: string | null;
	service: "mymemory" | "deepl" | null;
}

function useLanguageName() {
	const locale = useLocale();
	return useMemo(() => {
		let names: Intl.DisplayNames | null = null;
		try {
			names = new Intl.DisplayNames([locale], { type: "language" });
		} catch {
			names = null;
		}
		return (code: string) => names?.of(code) ?? code;
	}, [locale]);
}

function LanguageSelect({ value, onChange, auto }: { value: string; onChange: (v: string) => void; auto?: boolean }) {
	const t = useT();
	const name = useLanguageName();
	const sorted = useMemo(() => [...LANGUAGES].sort((a, b) => name(a).localeCompare(name(b))), [name]);
	return (
		<select
			className="h-7 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/8 px-3 text-[12.5px] font-[650] text-text outline-none hover:bg-white/12 [&_option]:bg-[#1c1c22]"
			value={value}
			onChange={(e) => onChange(e.target.value)}
		>
			{auto && <option value="auto">{t("translate.auto")}</option>}
			{sorted.map((code) => (
				<option key={code} value={code}>
					{name(code)}
				</option>
			))}
		</select>
	);
}

function errorMessage(t: ReturnType<typeof useT>, e: unknown) {
	const code = errorText(e);
	if (code === "quota") return t("translate.error.quota");
	if (code === "badKey") return t("translate.error.badKey");
	if (code === "network") return t("translate.error.network");
	return t("translate.error.other");
}

function TranslatePanel() {
	const t = useT();
	const name = useLanguageName();
	const from = useSetting(fromLang);
	const to = useSetting(toLang);
	const [input, setInput] = useState("");
	const [result, setResult] = useState<Translation | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const keys = useKeyboard("translate.input");

	const run = useCallback(
		(text: string, source = from, target = to) => {
			if (!text.trim()) {
				setResult(null);
				return;
			}
			setBusy(true);
			setError(null);
			tools<Translation>("translate_run", { text, from: source, to: target })
				.then((r) => setResult(r))
				.catch((e) => setError(errorMessage(t, e)))
				.finally(() => setBusy(false));
		},
		[from, to, t],
	);

	const swap = () => {
		const source = from === "auto" ? (result?.detected ?? "de") : from;
		setSetting(fromLang, to);
		setSetting(toLang, source);
		if (result?.text) {
			setInput(result.text);
			run(result.text, to, source);
		}
	};
	const paste = () =>
		tools<string | null>("clipboard_text")
			.then((text) => {
				if (!text) return setError(t("translate.emptyClipboard"));
				setInput(text);
				run(text);
			})
			.catch(() => setError(t("translate.emptyClipboard")));
	const copy = () =>
		result?.text &&
		tools("copy_text", { text: result.text }).then(() => {
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1200);
		});

	return (
		<div className="flex h-full flex-col gap-1.5 px-1" onClick={(e) => e.stopPropagation()}>
			<div className="flex items-center gap-1.5">
				<LanguageSelect
					value={from}
					auto
					onChange={(v) => {
						setSetting(fromLang, v);
						run(input, v, to);
					}}
				/>
				<button
					type="button"
					title={t("translate.swap")}
					className="grid size-7 flex-none place-items-center rounded-full text-text-dim hover:bg-white/10 hover:text-text"
					onClick={swap}
				>
					<ArrowLeftRightIcon size={13} />
				</button>
				<LanguageSelect
					value={to}
					onChange={(v) => {
						setSetting(toLang, v);
						run(input, from, v);
					}}
				/>
				<button
					type="button"
					className="flex h-7 flex-none items-center gap-1.5 rounded-full bg-white/8 px-2.5 text-[12px] font-bold text-text-dim hover:bg-white/12 hover:text-text"
					onClick={paste}
				>
					<ClipboardPasteIcon size={12} />
					{t("translate.paste")}
				</button>
			</div>
			<div className="flex min-h-0 flex-1 gap-2">
				<div className="relative flex min-w-0 flex-1">
					<textarea
						className="min-h-0 flex-1 resize-none rounded-[12px] bg-white/7 px-3 py-2 text-[13px] text-text outline-none select-text placeholder:text-text-faint focus:bg-white/10"
						value={input}
						placeholder={t("translate.placeholder")}
						spellCheck={false}
						onChange={(e) => setInput(e.target.value)}
						{...keys}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								run(input);
							} else keys.onKeyDown(e);
						}}
					/>
					{input && (
						<button
							type="button"
							title={t("translate.clear")}
							className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full text-text-faint hover:bg-white/10 hover:text-text"
							onClick={() => {
								setInput("");
								setResult(null);
								setError(null);
							}}
						>
							<XIcon size={12} />
						</button>
					)}
				</div>
				<div className="relative flex min-w-0 flex-1 flex-col rounded-[12px] bg-[rgba(10,132,255,0.1)] px-3 py-2">
					<div
						className={cn(
							"min-h-0 flex-1 overflow-y-auto text-[13px] whitespace-pre-wrap select-text",
							busy && "opacity-50",
						)}
						data-scroll
					>
						{error ? (
							<span className="text-warn">{error}</span>
						) : result?.text ? (
							result.text
						) : (
							<span className="text-text-faint">{busy ? t("translate.busy") : t("translate.hint")}</span>
						)}
					</div>
					{result?.text && (
						<button
							type="button"
							title={t("translate.copy")}
							className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full text-text-faint hover:bg-white/10 hover:text-text"
							onClick={copy}
						>
							<CopyIcon size={12} color={copied ? "#30D158" : undefined} />
						</button>
					)}
				</div>
			</div>
			<span className="h-4 truncate px-1 text-[11px] text-text-faint">
				{result?.detected && from === "auto" ? `${t("translate.detected", { lang: name(result.detected) })} · ` : ""}
				{result?.service === "deepl" ? "DeepL" : result?.service === "mymemory" ? "MyMemory" : ""}
				{copied ? ` · ${t("translate.copied")}` : ""}
			</span>
		</div>
	);
}

/** The optional DeepL key, kept by the backend in the Credential Manager. */
function TranslateSettings() {
	const t = useT();
	const [hasKey, setHasKey] = useState<boolean | null>(null);
	const [key, setKey] = useState("");
	const [error, setError] = useState<string | null>(null);
	const refresh = useCallback(
		() =>
			tools<{ hasKey: boolean }>("translate_status")
				.then((s) => setHasKey(!!s?.hasKey))
				.catch(() => setHasKey(false)),
		[],
	);
	useEffect(() => {
		refresh();
	}, [refresh]);

	const save = (e: FormEvent) => {
		e.preventDefault();
		if (!key.trim()) return;
		tools("translate_set_key", { key: key.trim() })
			.then(() => {
				setKey("");
				setError(null);
				refresh();
			})
			.catch((err) => setError(errorText(err)));
	};

	return (
		<Block>
			<Row label={t("translate.deepl.label")} desc={t("translate.deepl.desc")}>
				{hasKey && (
					<Button onClick={() => tools("translate_clear_key").then(refresh)}>{t("translate.deepl.remove")}</Button>
				)}
			</Row>
			{hasKey ? (
				<Desc>{t("translate.deepl.saved")}</Desc>
			) : (
				<form className="flex gap-2" onSubmit={save}>
					<Input
						className="flex-1"
						type="password"
						value={key}
						placeholder={t("translate.deepl.placeholder")}
						autoComplete="off"
						onChange={(e) => setKey(e.target.value)}
					/>
					<Button type="submit" variant="primary" disabled={!key.trim()}>
						{t("translate.deepl.save")}
					</Button>
				</form>
			)}
			{error && <Desc tone="error">{error}</Desc>}
		</Block>
	);
}

export const translateModule: IslandModule = {
	id: "translate",
	title: "translate.title",
	settingsIcon: <LanguagesIcon size={15} />,
	SettingsSection: TranslateSettings,
	useView(): ModuleView {
		return {
			active: false,
			priority: 0,
			accent: ACCENT,
			icon: <LanguagesIcon size={15} color={ACCENT} />,
			expanded: <TranslatePanel />,
			expandedSize: { width: 560, height: 200 },
		};
	},
};
