import { defineMock, provider } from "./kit";

const picker = provider("picker", { picking: false, hex: null as string | null, seq: 0, picked: false });
let pickTimer = 0;

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
