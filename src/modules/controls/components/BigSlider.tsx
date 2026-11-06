import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../../../core/cn";
import { useIsland } from "../../../core/island";

const KEY_STEP = 5;

/**
 * A wide pill slider, like the ones in a phone's control center: the fill is
 * the value, with the icon and the percentage on top of it.
 */
export function BigSlider({
	label,
	value,
	icon,
	color,
	disabled,
	note,
	onIconClick,
	iconTitle,
	onChange,
}: {
	label: string;
	/** 0–100. */
	value: number;
	icon: ReactNode;
	color: string;
	disabled?: boolean;
	/** Shown instead of the percentage (unsupported, muted…). */
	note?: string;
	onIconClick?: () => void;
	iconTitle?: string;
	/** Called while dragging (throttle on the caller's side if needed) and on release. */
	onChange: (value: number, final: boolean) => void;
}) {
	const island = useIsland();
	const [drag, setDrag] = useState<number | null>(null);
	const track = useRef<HTMLDivElement>(null);
	useEffect(() => () => island.keepOpen(false, label), [island, label]);
	const shown = drag ?? value;

	const at = (clientX: number) => {
		const r = track.current?.getBoundingClientRect();
		if (!r) return shown;
		return Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * 100);
	};

	return (
		<div className="flex min-w-0 flex-col gap-1">
			<div
				ref={track}
				className={cn(
					"relative h-11 cursor-pointer touch-none overflow-hidden rounded-[16px] bg-white/8 outline-none select-none",
					disabled && "cursor-default opacity-50",
				)}
				role="slider"
				// The island itself can be dragged sideways; not from here.
				data-no-drag
				tabIndex={disabled ? -1 : 0}
				aria-label={label}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={shown}
				aria-disabled={disabled || undefined}
				onPointerDown={(e) => {
					if (disabled) return;
					e.currentTarget.setPointerCapture(e.pointerId);
					island.keepOpen(true, label);
					const next = at(e.clientX);
					setDrag(next);
					onChange(next, false);
				}}
				onPointerMove={(e) => {
					if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
					const next = at(e.clientX);
					if (next === drag) return;
					setDrag(next);
					onChange(next, false);
				}}
				onPointerUp={(e) => {
					if (drag === null) return;
					onChange(at(e.clientX), true);
				}}
				onLostPointerCapture={() => {
					island.keepOpen(false, label);
					// Keep showing the value until the backend reports it back.
					window.setTimeout(() => setDrag(null), 900);
				}}
				onKeyDown={(e) => {
					if (disabled) return;
					const step = { ArrowRight: KEY_STEP, ArrowUp: KEY_STEP, ArrowLeft: -KEY_STEP, ArrowDown: -KEY_STEP }[e.key];
					if (step === undefined) return;
					e.preventDefault();
					onChange(Math.min(100, Math.max(0, shown + step)), true);
				}}
			>
				<div
					className="absolute inset-y-0 left-0 rounded-[16px]"
					style={{
						width: `${disabled ? 0 : Math.max(shown, 9)}%`,
						background: `linear-gradient(90deg, ${color}cc, ${color})`,
						transition: drag === null ? "width 220ms ease" : undefined,
					}}
				/>
				<div className="relative flex h-full items-center gap-2.5 px-3.5">
					<button
						type="button"
						className="grid size-6 place-items-center rounded-full text-white transition-transform duration-150 active:scale-88 disabled:cursor-default"
						title={iconTitle}
						disabled={!onIconClick}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={(e) => {
							e.stopPropagation();
							onIconClick?.();
						}}
					>
						{icon}
					</button>
					<span className="min-w-0 flex-1 truncate text-[13px] font-[650] text-white">{label}</span>
					<span className="flex-none text-[12.5px] font-bold text-white/85 tabular-nums">{note ?? `${shown}%`}</span>
				</div>
			</div>
		</div>
	);
}
