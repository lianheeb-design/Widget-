/**
 * AI apps in the quick launch: ChatGPT, Claude, Gemini and friends, each
 * opened on its website or in its desktop app (when one is installed, found
 * by name in the Start menu). The person picks per app: off, automatic (the
 * app when installed, else the website), always web, or always the app.
 */
import { useCallback, useEffect, useState } from "react";
import { type SettingDef, useSetting } from "../../core/settings";
import { errorText, tools } from "../tools/bridge";

export type AiMode = "off" | "auto" | "web" | "app";

export interface AiApp {
	id: string;
	name: string;
	emoji: string;
	url: string;
	/** Start menu names of its desktop app, best first. */
	desktopNames: string[];
}

export const AI_APPS: AiApp[] = [
	{
		id: "chatgpt",
		name: "ChatGPT",
		emoji: "💬",
		url: "https://chatgpt.com/",
		desktopNames: ["ChatGPT", "ChatGPT Classic"],
	},
	{ id: "claude", name: "Claude", emoji: "✳️", url: "https://claude.ai/new", desktopNames: ["Claude"] },
	{
		id: "gemini",
		name: "Gemini",
		emoji: "✨",
		url: "https://gemini.google.com/app",
		desktopNames: ["Gemini", "Google Gemini"],
	},
	{
		id: "copilot",
		name: "Copilot",
		emoji: "🪁",
		url: "https://copilot.microsoft.com/",
		desktopNames: ["Copilot", "Microsoft Copilot"],
	},
	{
		id: "perplexity",
		name: "Perplexity",
		emoji: "🔎",
		url: "https://www.perplexity.ai/",
		desktopNames: ["Perplexity"],
	},
];

export const aiModes: SettingDef<Record<string, AiMode>> = {
	key: "quick.ai",
	label: "quick.ai.title",
	default: { chatgpt: "auto", claude: "auto", gemini: "auto" },
};

export const modeOf = (modes: Record<string, AiMode>, id: string): AiMode => modes[id] ?? "off";

interface StartApp {
	name: string;
	appId: string;
}

/** App id → its desktop app's Start menu id, when installed. */
export type Installed = Record<string, string>;

const ALL_NAMES = AI_APPS.flatMap((a) => a.desktopNames);
let cache: Promise<Installed> | null = null;
const listeners = new Set<(installed: Installed) => void>();

async function detect(): Promise<Installed> {
	const found = (await tools<StartApp[]>("installed_apps", { names: ALL_NAMES }).catch(() => [])) ?? [];
	const installed: Installed = {};
	for (const app of AI_APPS) {
		// The first of its names that is installed wins ("ChatGPT" before "ChatGPT Classic").
		for (const name of app.desktopNames) {
			const hit = found.find((f) => f.name.toLowerCase() === name.toLowerCase());
			if (hit) {
				installed[app.id] = hit.appId;
				break;
			}
		}
	}
	return installed;
}

/** Installed desktop apps, looked up once per session (PowerShell takes a moment) and on `refresh`. */
export function useInstalledApps() {
	const [installed, setInstalled] = useState<Installed | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let alive = true;
		const update = (next: Installed) => alive && setInstalled(next);
		listeners.add(update);
		cache ??= detect();
		cache.then(update);
		return () => {
			alive = false;
			listeners.delete(update);
		};
	}, []);

	const refresh = useCallback(async () => {
		setBusy(true);
		cache = detect();
		const next = await cache;
		for (const listener of listeners) listener(next);
		setBusy(false);
	}, []);

	return { installed, busy, refresh };
}

/** Where a click goes: the app (its Start menu id) or the website. */
export function resolve(
	app: AiApp,
	mode: AiMode,
	installed: Installed | null,
): { kind: "app" | "web"; appId?: string } {
	const appId = installed?.[app.id];
	if ((mode === "auto" || mode === "app") && appId) return { kind: "app", appId };
	return { kind: "web" };
}

/** Opens it the way `resolve` says, or the other way with `swap` (right click). */
export async function openAi(app: AiApp, mode: AiMode, installed: Installed | null, swap = false) {
	let target = resolve(app, mode, installed);
	if (swap) {
		const appId = installed?.[app.id];
		target = target.kind === "app" || !appId ? { kind: "web" } : { kind: "app", appId };
	}
	try {
		if (target.kind === "app" && target.appId) await tools("open_app", { appId: target.appId });
		else await tools("open_target", { target: app.url });
	} catch (e) {
		// The app is gone (uninstalled since the last look): fall back to the website.
		if (target.kind === "app") await tools("open_target", { target: app.url });
		else throw new Error(errorText(e));
	}
}

export function useAiButtons() {
	const modes = useSetting(aiModes);
	return AI_APPS.filter((a) => modeOf(modes, a.id) !== "off").map((a) => ({ app: a, mode: modeOf(modes, a.id) }));
}
