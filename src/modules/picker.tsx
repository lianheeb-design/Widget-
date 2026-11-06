/**
 * A search-as-you-type list for choosing a place (weather) or a stop
 * (departures): type a few letters, pick one of the matches. With an empty
 * field it offers the recently used ones. Used in the island panels and in
 * the settings window.
 */
import { ClockIcon, MapPinIcon, SearchIcon, XIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { command } from "../core/bridge";
import { cn } from "../core/cn";
import { useT } from "../core/i18n";
import { fieldClass, useKeyboard } from "./shared";

export interface PickerItem<T> {
	key: string;
	title: string;
	subtitle?: string;
	value: T;
}

interface PickerProps<T> {
	/** Matches for a query; throws when offline. */
	search: (query: string) => Promise<PickerItem<T>[]>;
	recent: PickerItem<T>[];
	onPick: (value: T) => void;
	onCancel?: () => void;
	placeholder: string;
	notFound: string;
	failed: string;
	accent: string;
	icon?: ReactNode;
	/** Extra input props (the island's keyboard focus handling). */
	inputProps?: {
		onMouseDown?: () => void;
		onFocus?: () => void;
		onBlur?: () => void;
		onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
	};
	autoFocus?: boolean;
	className?: string;
}

const DEBOUNCE = 300;

export function PlacePicker<T>({
	search,
	recent,
	onPick,
	onCancel,
	placeholder,
	notFound,
	failed,
	accent,
	icon,
	inputProps,
	autoFocus,
	className,
}: PickerProps<T>) {
	const t = useT();
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<PickerItem<T>[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [active, setActive] = useState(0);
	const input = useRef<HTMLInputElement>(null);
	const searchRef = useRef(search);
	searchRef.current = search;

	useEffect(() => {
		if (autoFocus) window.setTimeout(() => input.current?.focus(), 30);
	}, [autoFocus]);

	// Searches shortly after typing stops; a newer query cancels an older one.
	useEffect(() => {
		const q = query.trim();
		setActive(0);
		if (q.length < 2) {
			setResults(null);
			setError(null);
			setBusy(false);
			return;
		}
		let cancelled = false;
		setBusy(true);
		const timer = window.setTimeout(async () => {
			try {
				const found = await searchRef.current(q);
				if (cancelled) return;
				setResults(found);
				setError(found.length ? null : notFound);
			} catch {
				if (!cancelled) {
					setResults(null);
					setError(failed);
				}
			} finally {
				if (!cancelled) setBusy(false);
			}
		}, DEBOUNCE);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [query, notFound, failed]);

	const list = query.trim().length >= 2 ? (results ?? []) : recent;
	const showingRecent = query.trim().length < 2 && recent.length > 0;

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActive((a) => Math.min(list.length - 1, a + 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActive((a) => Math.max(0, a - 1));
		} else if (e.key === "Enter") {
			e.preventDefault();
			const item = list[active];
			if (item) onPick(item.value);
		} else if (e.key === "Escape" && onCancel) {
			e.preventDefault();
			onCancel();
		} else inputProps?.onKeyDown?.(e);
	};

	return (
		<div className={cn("flex min-h-0 flex-col gap-1.5", className)} onClick={(e) => e.stopPropagation()}>
			<div className="flex items-center gap-1.5">
				<span className="relative flex min-w-0 flex-1 items-center">
					<SearchIcon size={13} className="pointer-events-none absolute left-2.5 text-text-faint" />
					<input
						ref={input}
						className={cn(fieldClass, "w-full pl-8")}
						value={query}
						placeholder={placeholder}
						spellCheck={false}
						autoComplete="off"
						onChange={(e) => setQuery(e.target.value)}
						onMouseDown={inputProps?.onMouseDown}
						onFocus={inputProps?.onFocus}
						onBlur={inputProps?.onBlur}
						onKeyDown={onKeyDown}
					/>
				</span>
				{onCancel && (
					<button
						type="button"
						className="grid size-8 flex-none place-items-center rounded-[11px] bg-white/9 text-text-dim hover:bg-white/13 hover:text-text"
						title={t("picker.cancel")}
						onClick={onCancel}
					>
						<XIcon size={14} />
					</button>
				)}
			</div>
			{showingRecent && (
				<span className="px-1 text-[10.5px] font-bold tracking-[0.05em] text-text-faint uppercase">
					{t("picker.recent")}
				</span>
			)}
			<div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" data-scroll>
				{busy && <p className="px-1 py-1 text-[12px] text-text-dim">{t("picker.searching")}</p>}
				{!busy && error && <p className="px-1 py-1 text-[12px] text-warn">{error}</p>}
				{!busy && !error && list.length === 0 && (
					<p className="px-1 py-1 text-[12px] text-text-dim">{t("picker.hint")}</p>
				)}
				{!busy &&
					list.map((item, i) => (
						<button
							type="button"
							key={item.key}
							className={cn(
								"flex min-h-8 flex-none items-center gap-2 rounded-[10px] px-2 text-left transition-[background]",
								i === active ? "bg-white/10" : "hover:bg-white/7",
							)}
							onMouseEnter={() => setActive(i)}
							onClick={() => onPick(item.value)}
						>
							{showingRecent ? (
								<ClockIcon size={13} className="flex-none text-text-faint" />
							) : (
								(icon ?? <MapPinIcon size={13} className="flex-none" color={accent} />)
							)}
							<span className="min-w-0 truncate text-[13px] font-[650]">{item.title}</span>
							{item.subtitle && <span className="min-w-0 truncate text-[11.5px] text-text-faint">{item.subtitle}</span>}
						</button>
					))}
			</div>
		</div>
	);
}

/** The picker inside the island: asks the window for keyboard focus while it is open. */
export function IslandPlacePicker<T>(props: Omit<PickerProps<T>, "inputProps" | "autoFocus"> & { owner: string }) {
	const { owner, onPick, onCancel, ...rest } = props;
	const keys = useKeyboard(owner);
	// Opening the picker is a click: take the keyboard right away so typing works.
	// biome-ignore lint/correctness/useExhaustiveDependencies: once, when the picker opens
	useEffect(() => {
		keys.onMouseDown();
	}, []);
	const done = () => command("restore_focus");
	return (
		<PlacePicker
			{...rest}
			autoFocus
			inputProps={keys}
			onPick={(value) => {
				onPick(value);
				done();
			}}
			onCancel={
				onCancel &&
				(() => {
					onCancel();
					done();
				})
			}
		/>
	);
}

/** `item` first, without duplicates, at most `max`. */
export function remember<T>(list: T[], item: T, same: (a: T, b: T) => boolean, max = 5): T[] {
	return [item, ...list.filter((x) => !same(x, item))].slice(0, max);
}
