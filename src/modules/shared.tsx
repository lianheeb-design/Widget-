/** Small helpers shared by this fork's modules. */
import { type KeyboardEvent, useEffect } from "react";
import { command } from "../core/bridge";
import { useIsland } from "../core/island";

/** Text fields in the island need the keyboard: ask the window for focus. */
export function useKeyboard(owner: string) {
	const island = useIsland();
	useEffect(() => () => island.keepOpen(false, owner), [island, owner]);
	return {
		onMouseDown: () => {
			island.keepOpen(true, owner);
			command("focus_island");
		},
		onFocus: () => island.keepOpen(true, owner),
		onBlur: () => island.keepOpen(false, owner),
		onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
			if (e.key === "Escape") {
				e.preventDefault();
				(e.target as HTMLElement).blur();
				command("restore_focus");
			}
		},
	};
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const fieldClass =
	"h-8 min-w-0 rounded-[11px] bg-white/7 px-2.5 text-[13px] text-text outline-none select-text placeholder:text-text-faint focus:bg-white/10";
export const smallButton =
	"flex h-8 flex-none items-center gap-1.5 rounded-[11px] bg-white/9 px-3 text-[12px] font-bold text-text-dim transition-[background] hover:bg-white/13 hover:text-text disabled:opacity-40";
