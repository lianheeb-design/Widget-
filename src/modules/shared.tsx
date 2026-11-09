/** Small helpers shared by this fork's modules. */
import { type KeyboardEvent, useEffect } from "react";
import { command } from "../core/bridge";
import { cn } from "../core/cn";
import { useIsland } from "../core/island";

/**
 * Text fields in the island need the keyboard: ask the window for focus.
 * While a field has it, the island stays open; it lets go as soon as the
 * keyboard is elsewhere (another app clicked, focus refused), or the island
 * would stay open for good.
 */
export function useKeyboard(owner: string) {
	const island = useIsland();
	useEffect(() => {
		const away = () => island.keepOpen(false, owner);
		window.addEventListener("blur", away);
		return () => {
			window.removeEventListener("blur", away);
			island.keepOpen(false, owner);
		};
	}, [island, owner]);
	return {
		onMouseDown: () => {
			island.keepOpen(true, owner);
			command("focus_island")
				.catch(() => undefined)
				.finally(() =>
					// Windows may refuse the focus: then no blur ever comes to end the hold.
					window.setTimeout(() => {
						if (!document.hasFocus()) island.keepOpen(false, owner);
					}, 400),
				);
		},
		// Only while the island really has the keyboard: a field focused from code
		// (a keypad press, a picker opening) while another app is in use must not hold it.
		onFocus: () => {
			if (document.hasFocus()) island.keepOpen(true, owner);
		},
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

/** Small tabs inside a module's panel (Notes | Clipboard), in the module's color. */
export function SubTabs<T extends string>({
	options,
	value,
	onChange,
	accent,
}: {
	options: { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
	accent: string;
}) {
	return (
		<div className="flex flex-none gap-1">
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					className={cn(
						"rounded-full px-2 py-0.5 text-[11px] font-bold tracking-[0.04em] uppercase transition-[background,color] duration-150",
						o.value === value ? "" : "text-text-faint hover:text-text-dim",
					)}
					style={
						o.value === value
							? { color: accent, background: `color-mix(in srgb, ${accent} 20%, transparent)` }
							: undefined
					}
					onClick={() => onChange(o.value)}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}
