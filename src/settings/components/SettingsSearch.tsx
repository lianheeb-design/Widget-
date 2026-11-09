/**
 * "Where do I set that?": a search over the settings' pages, modules and
 * their options. A hit opens the page it's on.
 */
import { SearchIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { type MessageKey, useT } from "../../core/i18n";
import {
	appearanceSettings,
	generalSettings,
	layoutSettings,
	monitorSettings,
	positionSettings,
} from "../../core/settings";
import { modules } from "../../modules";

interface Entry {
	label: MessageKey;
	desc?: MessageKey;
	path: string;
	/** The page it's on, shown under the hit. */
	page: MessageKey;
}

const defs = (list: { label: MessageKey; description?: MessageKey }[], path: string, page: MessageKey): Entry[] =>
	list.map((d) => ({ label: d.label, desc: d.description, path, page }));

const ENTRIES: Entry[] = [
	{ label: "settings.general", path: "/", page: "settings.general" },
	{ label: "settings.language.label", desc: "settings.language.desc", path: "/", page: "settings.general" },
	{ label: "settings.autostart.label", path: "/", page: "settings.general" },
	...defs(Object.values(generalSettings), "/", "settings.general"),
	...defs(
		[monitorSettings.monitor, monitorSettings.avoidMaximized, positionSettings.returnToCenter],
		"/",
		"settings.general",
	),
	{ label: "appearance.title", path: "/appearance", page: "appearance.title" },
	...defs(Object.values(appearanceSettings), "/appearance", "appearance.title"),
	{ label: "extras.theme.label", path: "/appearance", page: "appearance.title" },
	{ label: "extras.gradient.label", path: "/appearance", page: "appearance.title" },
	{ label: "extras.halo.label", path: "/appearance", page: "appearance.title" },
	{ label: "extras.motion.label", path: "/appearance", page: "appearance.title" },
	{ label: "modules.title", path: "/modules", page: "modules.title" },
	...defs([layoutSettings.autoTidy], "/modules", "modules.title"),
	...modules
		.filter((m) => !m.system)
		.flatMap((m) => [
			{ label: m.title, path: `/modules/${m.id}`, page: "modules.title" as MessageKey },
			...defs(m.settings ?? [], `/modules/${m.id}`, m.title),
		]),
	{ label: "profiles.page", path: "/routines", page: "profiles.page" },
	{ label: "profiles.title", desc: "profiles.activeDesc", path: "/routines", page: "profiles.page" },
	{ label: "briefing.label", desc: "briefing.desc", path: "/routines", page: "profiles.page" },
	{ label: "routines.commute.label", desc: "routines.commute.desc", path: "/routines", page: "profiles.page" },
	{ label: "routines.evening.label", desc: "routines.evening.desc", path: "/routines", page: "profiles.page" },
	{ label: "shortcuts.title", path: "/shortcuts", page: "shortcuts.title" },
	{ label: "settings.about.title", path: "/about", page: "settings.about.title" },
	{ label: "settings.about.updates.label", path: "/about", page: "settings.about.title" },
	{ label: "settings.about.log.label", path: "/about", page: "settings.about.title" },
	{ label: "backup.label", desc: "backup.desc", path: "/about", page: "settings.about.title" },
	{ label: "report.label", desc: "report.desc", path: "/about", page: "settings.about.title" },
	{ label: "whatsnew.title", path: "/about", page: "settings.about.title" },
];

const MAX_HITS = 8;

export function SettingsSearch() {
	const t = useT();
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();

	const hits = useMemo(() => {
		if (!q) return [];
		const seen = new Set<string>();
		return ENTRIES.filter((e) => {
			const label = t(e.label);
			const text = `${label} ${e.desc ? t(e.desc) : ""}`.toLowerCase();
			const key = `${e.path}|${label}`;
			if (!text.includes(q) || seen.has(key)) return false;
			seen.add(key);
			return true;
		})
			.sort((a, b) => Number(!t(a.label).toLowerCase().startsWith(q)) - Number(!t(b.label).toLowerCase().startsWith(q)))
			.slice(0, MAX_HITS);
	}, [q, t]);

	return (
		<div className="relative mb-1.5 px-0.5">
			<div className="flex h-8.5 items-center gap-2 rounded-[9px] bg-white/5 px-2.5 shadow-[inset_0_0_0_1px_var(--hairline)] focus-within:bg-white/8">
				<SearchIcon size={13} className="flex-none text-text-faint" />
				<input
					className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-faint"
					placeholder={t("search.placeholder")}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape") setQuery("");
						if (e.key === "Enter" && hits[0]) {
							navigate(hits[0].path);
							setQuery("");
						}
					}}
				/>
				{query && (
					<button type="button" className="text-text-faint hover:text-text" onClick={() => setQuery("")}>
						<XIcon size={13} />
					</button>
				)}
			</div>
			{q && (
				<div className="absolute inset-x-0.5 top-10 z-20 flex flex-col rounded-[11px] border border-white/10 bg-[#1c1c22] p-1 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]">
					{hits.length === 0 && <span className="px-2.5 py-2 text-[12.5px] text-text-faint">{t("search.none")}</span>}
					{hits.map((h) => (
						<button
							type="button"
							key={`${h.path}|${h.label}`}
							className="flex flex-col rounded-[8px] px-2.5 py-1.5 text-left hover:bg-white/8"
							onClick={() => {
								navigate(h.path);
								setQuery("");
							}}
						>
							<span className="truncate text-[13px] font-semibold">{t(h.label)}</span>
							<span className="truncate text-[11.5px] text-text-faint">{t(h.page)}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
