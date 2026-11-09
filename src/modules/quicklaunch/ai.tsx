/**
 * AI apps in the quick launch: ChatGPT, Claude, Gemini and friends, each
 * opened as a web app in the island's own window, in the browser, or in its
 * desktop app (when one is installed, found by name in the Start menu). The
 * person picks per app: off, island, browser, app, or automatic (the app when
 * installed, else the browser).
 */
import { useCallback, useEffect, useState } from "react";
import { type SettingDef, useSetting } from "../../core/settings";
import { errorText, tools } from "../tools/bridge";

/** `island`: the website in the island's own window under it; `web`: in the default browser. */
export type AiMode = "off" | "island" | "web" | "app" | "auto";

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
	default: { chatgpt: "island", claude: "island", gemini: "island" },
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

export type AiTarget = { kind: "island" | "web" } | { kind: "app"; appId: string };

/** Where a click goes: the island's own web window, the browser, or the desktop app. */
export function resolve(app: AiApp, mode: AiMode, installed: Installed | null): AiTarget {
	if (mode === "island") return { kind: "island" };
	const appId = installed?.[app.id];
	if ((mode === "auto" || mode === "app") && appId) return { kind: "app", appId };
	return { kind: "web" };
}

/** What a right click opens: the browser, or the island's window when a click already opens the browser. */
export function alternative(target: AiTarget): AiTarget {
	return target.kind === "web" ? { kind: "island" } : { kind: "web" };
}

/** Opens it the way `resolve` says, or the other way with `swap` (right click). */
export async function openAi(app: AiApp, mode: AiMode, installed: Installed | null, swap = false) {
	const first = resolve(app, mode, installed);
	const target = swap ? alternative(first) : first;
	try {
		if (target.kind === "app") await tools("open_app", { appId: target.appId });
		else if (target.kind === "island") await tools("open_webapp", { id: app.id, url: app.url, title: app.name });
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
