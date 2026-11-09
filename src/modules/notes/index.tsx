import { CheckIcon, NotebookPenIcon, XIcon } from "lucide-react";
/**
 * Notes & to-dos: one quick note and a short to-do list, saved with the
 * settings so they survive restarts.
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "../../core/cn";
import { useT } from "../../core/i18n";
import { type SettingDef, setSetting, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { newId, useKeyboard } from "../shared";

const ACCENT = "#FFD60A";
const SAVE_DELAY = 500;

interface Todo {
	id: string;
	text: string;
	done: boolean;
}

const noteText: SettingDef<string> = { key: "notes.text", label: "notes.note", default: "" };
const todoList: SettingDef<Todo[]> = { key: "notes.todos", label: "notes.todos", default: [] };

export const notesSettings = {
	showBubble: {
		key: "notes.showBubble",
		label: "notes.showBubble.label",
		description: "notes.showBubble.desc",
		default: false,
	},
} satisfies Record<string, SettingDef>;

function NotesPanel() {
	const t = useT();
	const saved = useSetting(noteText);
	const todos = useSetting(todoList);
	const [note, setNote] = useState(saved);
	const [draft, setDraft] = useState("");
	const timer = useRef<number | undefined>(undefined);
	const pending = useRef<string | null>(null);
	const noteKeys = useKeyboard("notes.note");
	const todoKeys = useKeyboard("notes.todo");

	// Settings changed elsewhere (another window): follow, unless typing.
	useEffect(() => {
		if (pending.current === null) setNote(saved);
	}, [saved]);

	// Save on a pause in typing, and whatever is left when the panel closes.
	useEffect(
		() => () => {
			window.clearTimeout(timer.current);
			if (pending.current !== null) setSetting(noteText, pending.current);
		},
		[],
	);

	const editNote = (value: string) => {
		setNote(value);
		pending.current = value;
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			if (pending.current !== null) setSetting(noteText, pending.current);
			pending.current = null;
		}, SAVE_DELAY);
	};

	const saveTodos = (next: Todo[]) => setSetting(todoList, next);
	const add = () => {
		const text = draft.trim();
		if (!text) return;
		saveTodos([...todos, { id: newId(), text, done: false }]);
		setDraft("");
	};

	const open = todos.filter((x) => !x.done).length;
	const done = todos.length - open;

	return (
		<div className="flex h-full gap-3 px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
			<section className="flex min-w-0 flex-1 flex-col gap-1.5">
				<span className="text-[11px] font-bold tracking-[0.06em] text-text-faint uppercase">{t("notes.note")}</span>
				<textarea
					className="min-h-0 flex-1 resize-none rounded-[14px] bg-[rgba(255,214,10,0.07)] p-2.5 text-[13px]/[1.45] text-text outline-none select-text placeholder:text-text-faint focus:bg-[rgba(255,214,10,0.1)] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/14"
					value={note}
					placeholder={t("notes.notePlaceholder")}
					spellCheck={false}
					data-scroll
					onChange={(e) => editNote(e.target.value)}
					{...noteKeys}
				/>
			</section>

			<section className="flex w-60 flex-none flex-col gap-1.5">
				<span className="text-[11px] font-bold tracking-[0.06em] text-text-faint uppercase">{t("notes.todos")}</span>
				<input
					className="h-8 rounded-[12px] bg-white/7 px-2.5 text-[13px] text-text outline-none select-text placeholder:text-text-faint focus:bg-white/10"
					value={draft}
					placeholder={t("notes.todoPlaceholder")}
					spellCheck={false}
					onChange={(e) => setDraft(e.target.value)}
					{...todoKeys}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							add();
						} else todoKeys.onKeyDown(e);
					}}
				/>
				<ul
					className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/14"
					data-scroll
				>
					{todos.length === 0 && <li className="px-1 py-1 text-[12px] text-text-faint">{t("notes.empty")}</li>}
					{todos.map((todo) => (
						<li key={todo.id} className="group flex min-h-7 items-center gap-2 rounded-[9px] px-1 hover:bg-white/5">
							<button
								type="button"
								className={cn(
									"grid size-4.5 flex-none place-items-center rounded-full border-[1.5px] transition-[background,border-color] duration-150",
									todo.done ? "border-transparent bg-[#30D158] text-black" : "border-white/35 hover:border-[#FFD60A]",
								)}
								aria-label={todo.text}
								aria-pressed={todo.done}
								onClick={() => saveTodos(todos.map((x) => (x.id === todo.id ? { ...x, done: !x.done } : x)))}
							>
								{todo.done && <CheckIcon size={11} strokeWidth={3} />}
							</button>
							<span
								className={cn("min-w-0 flex-1 truncate text-[13px]", todo.done && "text-text-faint line-through")}
								title={todo.text}
							>
								{todo.text}
							</span>
							<button
								type="button"
								className="grid size-5.5 flex-none place-items-center rounded-full text-text-faint opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-text"
								title={t("notes.remove")}
								onClick={() => saveTodos(todos.filter((x) => x.id !== todo.id))}
							>
								<XIcon size={12} />
							</button>
						</li>
					))}
				</ul>
				<div className="flex h-4.5 items-center justify-between px-1 text-[11px] text-text-faint">
					<span>{todos.length === 0 ? "" : open === 0 ? t("notes.allDone") : t("notes.open", { n: open })}</span>
					{done > 0 && (
						<button type="button" className="hover:text-text" onClick={() => saveTodos(todos.filter((x) => !x.done))}>
							{t("notes.clearDone")}
						</button>
					)}
				</div>
			</section>
		</div>
	);
}

function TodoBubble({ open }: { open: number }) {
	return (
		<>
			<NotebookPenIcon size={17} color={ACCENT} />
			<span className="absolute -right-1.5 -bottom-1 z-3 grid h-4.5 min-w-4.5 place-items-center rounded-[9px] bg-[#b38f00] px-1.25 text-[10.5px] font-[750] text-white tabular-nums shadow-[0_0_0_2px_var(--island)]">
				{open}
			</span>
		</>
	);
}

export const notesModule: IslandModule = {
	id: "notes",
	title: "notes.title",
	settingsIcon: <NotebookPenIcon size={15} />,
	settings: Object.values(notesSettings),
	useView(): ModuleView {
		const todos = useSetting(todoList);
		const showBubble = useSetting(notesSettings.showBubble);
		const open = todos.filter((x) => !x.done).length;
		return {
			active: false,
			priority: 0,
			accent: ACCENT,
			icon: <NotebookPenIcon size={15} color={ACCENT} />,
			ambient: showBubble && open > 0 ? <TodoBubble open={open} /> : undefined,
			expanded: <NotesPanel />,
			expandedSize: { width: 560, height: 240 },
		};
	},
};
