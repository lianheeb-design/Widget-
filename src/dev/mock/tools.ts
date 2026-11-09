import { defineMock, provider } from "./kit";

const picker = provider("picker", { picking: false, hex: null as string | null, seq: 0, picked: false });
let pickTimer = 0;
const desktop = provider("desktop", { browser: false, battery: 76 as number | null, charging: false });
let dark = true;
const at = (min: number) => Math.round(Date.now() / 1000) + min * 60;
const board = () => ({
	stationboard: [
		{ stop: { departureTimestamp: at(2), delay: 0, platform: "3" }, category: "S", number: "1", to: "Wil SG" },
		{ stop: { departureTimestamp: at(6), delay: 2, platform: "1" }, category: "IR", number: "13", to: "Zürich HB" },
		{ stop: { departureTimestamp: at(9), delay: 0, platform: "D" }, category: "B", number: "1", to: "Winkeln" },
		{ stop: { departureTimestamp: at(14), delay: 0, platform: "4" }, category: "S", number: "4", to: "Uznach" },
		{
			stop: { departureTimestamp: at(21), delay: 0, platform: "2" },
			category: "IC",
			number: "5",
			to: "Genève-Aéroport",
		},
	],
});

const point = (name: string, min: number, platform: string | null, delay = 0) => ({
	station: { name },
	departureTimestamp: at(min),
	arrivalTimestamp: at(min),
	delay,
	platform,
});
const connections = () => ({
	connections: [
		{
			from: point("Altstätten SG", 4, "2", 2),
			to: point("St. Gallen", 37, "5"),
			duration: "00d00:33:00",
			transfers: 0,
			sections: [
				{
					journey: { category: "IR", number: "13", to: "Zürich HB" },
					walk: null,
					departure: point("Altstätten SG", 4, "2", 2),
					arrival: point("St. Gallen", 37, "5"),
				},
			],
		},
		{
			from: point("Altstätten SG", 12, "1"),
			to: point("St. Gallen", 53, "3"),
			duration: "00d00:41:00",
			transfers: 1,
			sections: [
				{
					journey: { category: "S", number: "4", to: "Sargans" },
					walk: null,
					departure: point("Altstätten SG", 12, "1"),
					arrival: point("Heerbrugg", 20, "2"),
				},
				{
					journey: null,
					walk: { duration: 180 },
					departure: point("Heerbrugg", 20, null),
					arrival: point("Heerbrugg", 23, null),
				},
				{
					journey: { category: "B", number: "301", to: "St. Gallen" },
					walk: null,
					departure: point("Heerbrugg", 24, "B"),
					arrival: point("St. Gallen", 53, "3"),
				},
			],
		},
	],
});

/** The `tools` provider: control center, Git and ChatGPT. */
let brightness: number | null = 70;
let volume = { level: 0.42, muted: false };
let hasKey = true;
let ahead = 1;
let files = [
	{ path: "src/modules/weather/useWeather.ts", kind: "modified", staged: false },
	{ path: "src/modules/timer/stopwatch.tsx", kind: "untracked", staged: false },
	{ path: "README.md", kind: "modified", staged: true },
	{ path: "docs/old-notes.md", kind: "deleted", staged: false },
];
const wait = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

export const tools = defineMock({
	label: "Tools (Steuerung, Git, ChatGPT)",
	controls: [
		{
			kind: "toggle",
			label: "Brightness supported",
			value: () => brightness !== null,
			set: (on) => (brightness = on ? 70 : null),
		},
		{ kind: "toggle", label: "OpenAI key saved", value: () => hasKey, set: (on) => (hasKey = on) },
		{
			kind: "toggle",
			label: "Browser in front",
			value: () => desktop.get().browser,
			set: (on) => desktop.set((d) => ({ ...d, browser: on })),
		},
	],
	actions: {
		tools: {
			state: () => ({ brightness, volume }),
			brightness: (p) => {
				brightness = (p as { level: number }).level;
			},
			volume: (p) => {
				volume = { ...volume, ...(p as object) };
			},
			lock: () => null,
			copy_text: () => null,
			dark_mode: () => dark,
			set_dark_mode: (p) => {
				dark = (p as { on: boolean }).on;
			},
			open_target: () => null,
			open_settings: () => null,
			transit: (p) =>
				(p as { kind: string }).kind === "stationboard"
					? board()
					: (p as { kind: string }).kind === "connections"
						? connections()
						: {
								stations: [
									{ id: "8506302", name: "St. Gallen" },
									{ id: "8589801", name: "St. Gallen, Marktplatz/Neumarkt" },
									{ id: "8506121", name: "St. Gallen Haggen" },
								],
							},
			installed_apps: () =>
				wait(600, [
					{ name: "ChatGPT", appId: "OpenAI.Codex_2p2nqsd0c76g0!App" },
					{ name: "Claude", appId: "Claude_pzs8sxrjxfjjc!Claude" },
				]),
			open_app: () => null,
			translate_status: () => ({ hasKey: false }),
			translate_set_key: () => null,
			translate_clear_key: () => null,
			translate_run: (p) =>
				wait(400, {
					text: `[${(p as { to: string }).to}] ${(p as { text: string }).text}`,
					detected: "de",
					service: "mymemory",
				}),
			clipboard_text: () => "Guten Morgen, wie geht es dir?",
			webapp_show: () => null,
			webapp_hide: () => null,
			webapp_focus: () => null,
			webapp_back: () => null,
			webapp_reload: () => null,
			webapp_url: () => "https://chatgpt.com/",
			alarm_start: () => null,
			alarm_stop: () => null,
			alarm_test: () => null,
			pick_color: () => {
				// Wander through a few colors, then "click" on the last one.
				const steps = ["#2F86FF", "#3DDC84", "#FF4F7B", "#FFB340"];
				let i = 0;
				window.clearInterval(pickTimer);
				pickTimer = window.setInterval(() => {
					const seq = picker.get().seq;
					if (i < steps.length) picker.set({ picking: true, hex: steps[i++], seq, picked: false });
					else {
						window.clearInterval(pickTimer);
						picker.set({ picking: false, hex: steps[steps.length - 1], seq: seq + 1, picked: true });
					}
				}, 700);
				return null;
			},
			screenclip: () => wait(450, null),
			screenshot: () => wait(450, null),
			open_screenshots: () => null,
			git_available: () => ({ version: "2.47.1.windows.1" }),
			git_pick: () => "C:\\Projekte\\windows-dynamic-island",
			git_status: () => ({
				root: "C:/Projekte/windows-dynamic-island",
				branch: "deutsch-wetter-timer",
				upstream: "origin/deutsch-wetter-timer",
				ahead,
				behind: 0,
				github: "HeyyCzer/windows-island",
				files,
				staged: files.filter((f) => f.staged).length,
			}),
			git_add: () => {
				files = files.map((f) => ({ ...f, staged: true }));
				return wait(300, null);
			},
			git_commit: () => {
				files = [];
				ahead += 1;
				return wait(500, null);
			},
			git_push: () => {
				ahead = 0;
				return wait(900, null);
			},
			git_pull: () => wait(700, null),
			openai_status: () => ({ hasKey }),
			openai_models: () => ["gpt-5.4-mini", "gpt-5.4", "gpt-5-mini"],
			openai_chat: () =>
				wait(1200, {
					text: "Gern! **Drei Ideen** für heute Abend:\n- Eine kurze Wanderung zum Sonnenuntergang\n- Pizza selber machen\n- Einen Film mit Freunden schauen",
				}),
		},
	},
});
