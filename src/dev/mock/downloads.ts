import { art, defineMock, provider } from "./kit";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const FOLDER = "C:\\Users\\me\\Downloads";

type Item = {
	path: string;
	name: string;
	isDir: boolean;
	ext: string;
	size: number;
	at: number;
	thumb: string | null;
};

const item = (name: string, size: number, ago: number, thumb: string | null = null): Item => {
	const dot = name.lastIndexOf(".");
	const isDir = dot < 1;
	return {
		path: `${FOLDER}\\${name}`,
		name,
		isDir,
		ext: isDir ? "" : name.slice(dot + 1).toLowerCase(),
		size: isDir ? 0 : size,
		at: Date.now() - ago,
		thumb,
	};
};

const state = provider("downloads", {
	folder: FOLDER as string | null,
	items: [
		item("Rechnung-Oktober.pdf", 182_000, 4 * MINUTE),
		item("Ferienfoto.jpg", 2_400_000, HOUR, art),
		item("setup-2.1.0.exe", 48_000_000, 5 * HOUR),
		item("Projekt", 0, 26 * HOUR),
		item("Vortrag.pptx", 7_300_000, 3 * 24 * HOUR),
	],
	latest: null as { path: string; name: string; seenAt: number } | null,
});

export const downloads = defineMock({
	label: "Downloads",
	start: () => state.publish(),
	controls: [
		{
			kind: "button",
			label: "Finish a download",
			run: () =>
				state.set((s) => {
					const done = item(`Datei-${s.items.length + 1}.zip`, 3_200_000, 0);
					return { ...s, items: [done, ...s.items], latest: { path: done.path, name: done.name, seenAt: Date.now() } };
				}),
		},
		{
			kind: "toggle",
			label: "No Downloads folder",
			value: () => state.get().folder === null,
			set: (on) => state.set((s) => ({ ...s, folder: on ? null : FOLDER, items: on ? [] : s.items })),
		},
	],
	actions: {
		downloads: {
			open: () => null,
			reveal: () => null,
			drag: () => null,
			openFolder: () => null,
		},
	},
});
