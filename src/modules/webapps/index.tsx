import { ArrowLeftIcon, ExternalLinkIcon, RotateCwIcon, SparklesIcon, XIcon } from "lucide-react";
/**
 * AI apps inside the island: ChatGPT, Claude, Gemini… as their web apps,
 * right in an enlarged island panel. The page itself is a native child
 * webview of the island window (backend: `src-tauri/src/webapp.rs`), laid
 * over the empty box this panel reserves for it; the panel keeps telling the
 * backend where that box is. While one is open the island stays open until
 * it is closed with the X.
 */
import { useEffect, useRef, useState } from "react";
import { command } from "../../core/bridge";
import { cn } from "../../core/cn";
import { islandSize, SIZE_SCALE } from "../../core/extras";
import { useT } from "../../core/i18n";
import { useIsland } from "../../core/island";
import { useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { AI_APPS, type AiApp, islandWebApp, useAiButtons, WEBAPPS_MODULE } from "../quicklaunch/ai";
import { tools } from "../tools/bridge";

const ACCENT = "#10A37F";
const SIZE = { width: 640, height: 640 };
/** The island window's height (`STRIP_HEIGHT` in `src-tauri/src/window.rs`). */
const STRIP = 720;
/** Room above the panel (the island's top gap) and under it (its shadow). */
const MARGIN = 48;

/**
 * As big as `SIZE`, but never taller than the island window or the screen
 * (a small laptop, or the island's "large" size scales the panel up).
 */
function webAppSize(scale: number) {
	const room = Math.min(STRIP, window.screen?.availHeight || STRIP) - MARGIN;
	const height = Math.max(320, Math.min(SIZE.height, Math.floor(room / scale)));
	return { width: SIZE.width, height };
}
/** How often the panel checks where its box is (the island can move or animate). */
const TRACK_MS = 120;

const headerButton =
	"grid size-7 flex-none place-items-center rounded-full text-text-dim transition-[background,color] hover:bg-white/10 hover:text-text";

/** The empty box the web app is laid over; reports its rect while mounted. */
function WebAppBox({ app }: { app: AiApp }) {
	const t = useT();
	const box = useRef<HTMLDivElement>(null);
	const [failed, setFailed] = useState(false);
	// Another tab chosen or the island closing: hide at once, not after the panel's
	// exit animation (the native page would sit on top of the next tab meanwhile).
	const { tab, mode } = useIsland();
	const shown = tab === WEBAPPS_MODULE && mode === "expanded";

	useEffect(() => {
		if (!shown) return;
		let sent = "";
		let previous = "";
		const track = () => {
			const r = box.current?.getBoundingClientRect();
			if (!r || r.width < 50 || r.height < 50) return;
			const rect = {
				x: Math.round(r.left),
				y: Math.round(r.top),
				width: Math.round(r.width),
				height: Math.round(r.height),
			};
			const key = JSON.stringify(rect);
			// Only once it holds still for a tick: not at every frame of the opening animation.
			if (key === previous && key !== sent) {
				sent = key;
				tools("webapp_show", { id: app.id, url: app.url, rect })
					.then(() => setFailed(false))
					.catch(() => setFailed(true));
			}
			previous = key;
		};
		track();
		const timer = window.setInterval(track, TRACK_MS);
		return () => {
			window.clearInterval(timer);
			// Hidden (closed, another tab, island collapsed): the keyboard goes back to the app in use.
			tools("webapp_hide")
				.catch(() => undefined)
				.finally(() => command("restore_focus"));
		};
	}, [app.id, app.url, shown]);

	return (
		<div ref={box} className="relative min-h-0 flex-1 overflow-hidden rounded-[14px] bg-[#111]">
			<div className="absolute inset-0 grid place-items-center text-[12.5px] text-text-faint">
				{failed ? t("webapps.failed") : t("webapps.loading", { name: app.name })}
			</div>
		</div>
	);
}

function WebAppView({ app }: { app: AiApp }) {
	const t = useT();
	const { keepOpen } = useIsland();
	// Open while the web app is shown, wherever the pointer goes; another tab or ✕ ends it.
	useEffect(() => {
		keepOpen(true, WEBAPPS_MODULE);
		return () => keepOpen(false, WEBAPPS_MODULE);
	}, [keepOpen]);
	const enabled = useAiButtons().map((b) => b.app);
	const tabs = enabled.some((a) => a.id === app.id) ? enabled : [app, ...enabled];
	const cmd = (what: string) => tools<string | null>(`webapp_${what}`, { id: app.id });

	return (
		<div className="flex h-full flex-col gap-2 px-1 pb-1" onClick={(e) => e.stopPropagation()}>
			<div className="flex items-center gap-1">
				<div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
					{tabs.map((a) => (
						<button
							type="button"
							key={a.id}
							className={cn(
								"flex h-7 flex-none items-center gap-1.5 rounded-full px-2.5 text-[12px] font-[650] transition-[background,color]",
								a.id === app.id ? "bg-white/14 text-text" : "text-text-dim hover:bg-white/8 hover:text-text",
							)}
							onClick={() => islandWebApp.set(a.id)}
						>
							<span className="text-[13px] leading-none">{a.emoji}</span>
							{a.name}
						</button>
					))}
				</div>
				<button type="button" className={headerButton} title={t("webapps.back")} onClick={() => cmd("back")}>
					<ArrowLeftIcon size={14} />
				</button>
				<button type="button" className={headerButton} title={t("webapps.reload")} onClick={() => cmd("reload")}>
					<RotateCwIcon size={13} />
				</button>
				<button
					type="button"
					className={headerButton}
					title={t("webapps.browser")}
					onClick={() =>
						cmd("url")
							.then((url) => tools("open_target", { target: url || app.url }))
							.catch(() => tools("open_target", { target: app.url }))
					}
				>
					<ExternalLinkIcon size={13} />
				</button>
				<button
					type="button"
					className={headerButton}
					title={t("webapps.close")}
					onClick={() => islandWebApp.set(null)}
				>
					<XIcon size={15} />
				</button>
			</div>
			{/* A new box per app: the old one hides its web app first. */}
			<WebAppBox key={app.id} app={app} />
		</div>
	);
}

/** Nothing open yet: the apps to pick from. */
function WebAppChooser() {
	const t = useT();
	const enabled = useAiButtons().map((b) => b.app);
	const apps = enabled.length ? enabled : AI_APPS.slice(0, 3);
	return (
		<div className="flex h-full flex-col gap-1.5 px-1" onClick={(e) => e.stopPropagation()}>
			<div className="grid grid-cols-5 gap-2">
				{apps.map((a) => (
					<button
						type="button"
						key={a.id}
						className="flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-[18px] bg-white/7 px-1.5 transition-[background,transform] hover:bg-white/12 active:scale-95"
						onClick={() => islandWebApp.set(a.id)}
					>
						<span className="text-[24px] leading-none">{a.emoji}</span>
						<span className="max-w-full truncate text-[11.5px] font-[650] text-text-dim">{a.name}</span>
					</button>
				))}
			</div>
			<span className="truncate px-1 text-[11.5px] text-text-faint">{t("webapps.hint")}</span>
		</div>
	);
}

function WebAppsPanel() {
	const open = islandWebApp.use();
	const app = AI_APPS.find((a) => a.id === open);
	return app ? <WebAppView app={app} /> : <WebAppChooser />;
}

export const webAppsModule: IslandModule = {
	id: WEBAPPS_MODULE,
	title: "webapps.title",
	settingsIcon: <SparklesIcon size={15} />,
	useView(): ModuleView {
		const open = !!islandWebApp.use();
		const scale = SIZE_SCALE[useSetting(islandSize)] ?? 1;
		return {
			active: false,
			priority: 0,
			accent: ACCENT,
			icon: <SparklesIcon size={15} color={ACCENT} />,
			expanded: <WebAppsPanel />,
			expandedSize: open ? webAppSize(scale) : { width: 560, height: 130 },
		};
	},
};
