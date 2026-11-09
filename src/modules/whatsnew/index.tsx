import { SparklesIcon } from "lucide-react";
/**
 * "What's new": after an update, the island shows once what the new version
 * brings. It peeks a moment after the start, then stays in the collapsed
 * island until "Got it". The notes for each version are listed below;
 * versions without notes (small fixes) show nothing.
 */
import { useEffect, useState } from "react";
import { type MessageKey, useT } from "../../core/i18n";
import { useIsland } from "../../core/island";
import { type SettingDef, setSetting, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";

const ACCENT = "#BF5AF2";
/** Let the island settle after the start before it peeks. */
const DELAY = 2500;

export const WHATS_NEW = "whatsnew";

/** What each version brings, newest first. */
export const RELEASE_NOTES: Record<string, { icon: string; text: MessageKey }[]> = {
	"1.0.0": [
		{ icon: "🎉", text: "whatsnew.v100.hello" },
		{ icon: "☀️", text: "whatsnew.v100.briefing" },
		{ icon: "🎒", text: "whatsnew.v100.profiles" },
		{ icon: "🔁", text: "whatsnew.v100.routines" },
		{ icon: "🧹", text: "whatsnew.v100.tidy" },
		{ icon: "🎮", text: "whatsnew.v100.games" },
		{ icon: "💾", text: "whatsnew.v100.backup" },
		{ icon: "🛟", text: "whatsnew.v100.healing" },
	],
	"0.7.0": [
		{ icon: "🚆", text: "whatsnew.v070.live" },
		{ icon: "🌧️", text: "whatsnew.v070.rain" },
		{ icon: "📅", text: "whatsnew.v070.countdown" },
		{ icon: "🔀", text: "whatsnew.v070.switch" },
		{ icon: "🖱️", text: "whatsnew.v070.menu" },
		{ icon: "⚡", text: "whatsnew.v070.speed" },
	],
};

/** The last version whose notes were seen. */
const seen: SettingDef<string | null> = { key: "whatsnew.seen", label: "whatsnew.title", default: null };

const notesOf = (version: string) => RELEASE_NOTES[version] ?? [];

/** The notes of `version` as a list (also used on the About page). */
export function ReleaseNotes({ version, className }: { version: string; className?: string }) {
	const t = useT();
	const notes = notesOf(version);
	if (notes.length === 0) return <p className="text-[12.5px] text-text-dim">{t("whatsnew.none")}</p>;
	return (
		<ul className={className}>
			{notes.map((n) => (
				<li key={n.text} className="flex gap-2.5 text-[12.5px] leading-snug">
					<span className="w-5 flex-none text-center">{n.icon}</span>
					<span className="min-w-0 flex-1">{t(n.text)}</span>
				</li>
			))}
		</ul>
	);
}

function WhatsNewPanel() {
	const t = useT();
	const { collapse } = useIsland();
	return (
		<div className="flex h-full flex-col gap-2 px-1" onClick={(e) => e.stopPropagation()}>
			<div className="flex items-center gap-2">
				<SparklesIcon size={16} color={ACCENT} />
				<strong className="flex-1 truncate text-[14.5px]">{t("whatsnew.heading", { version: __APP_VERSION__ })}</strong>
				<button
					type="button"
					className="rounded-full px-3 py-1 text-[12px] font-bold text-white transition-[filter] hover:brightness-110"
					style={{ background: ACCENT }}
					onClick={() => {
						setSetting(seen, __APP_VERSION__);
						collapse();
					}}
				>
					{t("whatsnew.done")}
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto" data-scroll>
				<ReleaseNotes version={__APP_VERSION__} className="flex flex-col gap-1.5" />
			</div>
		</div>
	);
}

export const whatsNewModule: IslandModule = {
	id: WHATS_NEW,
	title: "whatsnew.title",
	system: true,
	settingsIcon: <SparklesIcon size={15} />,
	useView(): ModuleView {
		const t = useT();
		const last = useSetting(seen);
		const [ready, setReady] = useState(false);
		useEffect(() => {
			const timer = window.setTimeout(() => setReady(true), DELAY);
			return () => window.clearTimeout(timer);
		}, []);
		const fresh = ready && last !== __APP_VERSION__ && notesOf(__APP_VERSION__).length > 0;
		const dismiss = () => setSetting(seen, __APP_VERSION__);

		return {
			active: fresh,
			priority: 1,
			hidden: true,
			accent: ACCENT,
			icon: <SparklesIcon size={15} color={ACCENT} />,
			compact: fresh
				? {
						left: (
							<span className="flex items-center gap-2 text-[13px] font-[650]">
								<SparklesIcon size={15} color={ACCENT} />
								{t("whatsnew.short", { version: __APP_VERSION__ })}
							</span>
						),
						right: (
							<span className="text-[12px] font-bold" style={{ color: ACCENT }}>
								{t("whatsnew.open")}
							</span>
						),
						width: 260,
					}
				: undefined,
			// Peeks once, a moment after the first start of a new version.
			activityKey: fresh ? `whatsnew:${__APP_VERSION__}` : undefined,
			// A big version is a party.
			celebrateKey: fresh && /^\d+\.0\.0$/.test(__APP_VERSION__) ? `whatsnew:${__APP_VERSION__}` : undefined,
			// Opening the island goes to the notes until they are read.
			attention: fresh,
			menu: fresh ? [{ label: t("whatsnew.hide"), onSelect: dismiss }] : undefined,
			expanded: <WhatsNewPanel />,
			expandedSize: { width: 560, height: 280 },
		};
	},
};
