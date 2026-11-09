/**
 * The island's right-click menu: the quick actions of what it shows (stop
 * the live view, unpin a countdown…), "What's new" and the settings.
 */
import { SettingsIcon, SparklesIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect } from "react";
import { command } from "../../core/bridge";
import { cn } from "../../core/cn";
import { useT } from "../../core/i18n";
import { PROFILE_EMOJI, PROFILE_IDS, profileActive } from "../../core/profiles";
import { setSetting, useSetting } from "../../core/settings";
import type { ModuleView } from "../../core/types";

export type MenuItem = NonNullable<ModuleView["menu"]>[number];

export function QuickMenu({
	at,
	items,
	onWhatsNew,
	onClose,
}: {
	/** Where it opens, in px from the island's top left corner; `null`: closed. */
	at: { x: number; y: number } | null;
	items: MenuItem[];
	onWhatsNew: () => void;
	onClose: () => void;
}) {
	const t = useT();
	const profile = useSetting(profileActive);
	useEffect(() => {
		if (!at) return;
		const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		// Any press outside closes it (inside, the item's click does).
		const press = (e: PointerEvent) => !(e.target as Element).closest("[data-quick-menu]") && onClose();
		window.addEventListener("keydown", key);
		window.addEventListener("pointerdown", press, true);
		return () => {
			window.removeEventListener("keydown", key);
			window.removeEventListener("pointerdown", press, true);
		};
	}, [at, onClose]);

	const all: (MenuItem & { icon?: ReactNode })[] = [
		...items,
		{ label: t("menu.whatsNew"), onSelect: onWhatsNew, icon: <SparklesIcon size={13} /> },
		{ label: t("menu.settings"), onSelect: () => command("open_settings"), icon: <SettingsIcon size={13} /> },
	];

	return (
		<AnimatePresence>
			{at && (
				<motion.div
					data-hit
					data-quick-menu
					className="absolute z-40 flex min-w-48 flex-col rounded-[14px] border border-white/10 bg-[#1c1c1e]/96 p-1 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)] backdrop-blur-xl"
					style={{ left: at.x, top: at.y }}
					initial={{ opacity: 0, scale: 0.92, y: -4 }}
					animate={{ opacity: 1, scale: 1, y: 0 }}
					exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.1 } }}
					transition={{ type: "spring", stiffness: 520, damping: 34 }}
					onPointerDown={(e) => e.stopPropagation()}
					onClick={(e) => e.stopPropagation()}
					onContextMenu={(e) => e.preventDefault()}
				>
					{/* Profiles: which modules show (all, school, free time, gaming). */}
					<div className="mb-1 flex gap-0.5 border-b border-white/8 pb-1">
						{[null, ...PROFILE_IDS].map((id) => (
							<button
								type="button"
								key={id ?? "all"}
								title={id ? t(`profiles.name.${id}`) : t("profiles.all")}
								className={cn(
									"flex h-7 flex-1 items-center justify-center rounded-[8px] px-1.5 text-[12px] font-bold whitespace-nowrap",
									profile === id ? "bg-white/16 text-text" : "text-text-dim hover:bg-white/8",
								)}
								onClick={() => {
									setSetting(profileActive, id);
									onClose();
								}}
							>
								{id ? PROFILE_EMOJI[id] : t("profiles.all")}
							</button>
						))}
					</div>
					{all.map((item, i) => (
						<button
							type="button"
							// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list while the menu is open
							key={i}
							className={cn(
								"flex h-7.5 items-center gap-2 rounded-[9px] px-2.5 text-left text-[12.5px] font-[600] whitespace-nowrap hover:bg-white/10",
								item.danger ? "text-[#ff6b6b]" : "text-text",
								i === items.length && items.length > 0 && "mt-1 border-t border-white/8 pt-1",
							)}
							onClick={() => {
								onClose();
								item.onSelect();
							}}
						>
							{item.icon}
							{item.label}
						</button>
					))}
				</motion.div>
			)}
		</AnimatePresence>
	);
}
