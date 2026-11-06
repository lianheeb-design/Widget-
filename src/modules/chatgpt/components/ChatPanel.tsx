import { ArrowUpIcon } from "lucide-react";
import { motion } from "motion/react";
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LinkButton, TextButton } from "../../../components/ui/button";
import { command } from "../../../core/bridge";
import { cn } from "../../../core/cn";
import { useT } from "../../../core/i18n";
import { useIsland } from "../../../core/island";
import { useSetting } from "../../../core/settings";
import { Formatted } from "../../ask/components/Formatted";
import { CHATGPT_GREEN, chat, chatModel, chatRunning, hasKey, refreshKey, send } from "../store";
import { ChatIcon } from "./ChatGptIcon";

const userBubble =
	"max-w-[85%] self-end rounded-[16px_16px_4px_16px] bg-[#10A37F]/25 px-3 py-1.75 text-[13px]/normal whitespace-pre-wrap text-white";

export function ChatPanel() {
	const t = useT();
	const island = useIsland();
	const messages = chat.use();
	const running = chatRunning.use();
	const keySaved = hasKey.use();
	const model = useSetting(chatModel);
	const [draft, setDraft] = useState("");
	const [copied, setCopied] = useState(false);
	const input = useRef<HTMLTextAreaElement>(null);
	const scroller = useRef<HTMLDivElement>(null);

	useEffect(() => {
		refreshKey();
		return () => island.keepOpen(false, "chatgpt");
	}, [island]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: follow the newest message
	useLayoutEffect(() => {
		const el = scroller.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [messages.length, running]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: grow with the question
	useLayoutEffect(() => {
		const el = input.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
	}, [draft]);

	function takeKeyboard() {
		island.keepOpen(true, "chatgpt");
		command("focus_island");
		window.setTimeout(() => input.current?.focus(), 30);
	}

	function submit() {
		if (running || !draft.trim()) return;
		send(draft, model, t);
		setDraft("");
		setCopied(false);
	}

	function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			submit();
		} else if (e.key === "Escape") {
			e.preventDefault();
			input.current?.blur();
			command("restore_focus");
			island.collapse();
		}
	}

	if (keySaved === false) {
		return (
			<div
				className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
				onClick={(e) => e.stopPropagation()}
			>
				<ChatIcon size={26} color={CHATGPT_GREEN} />
				<p className="max-w-100 text-[12.5px]/[1.45] text-text-dim">{t("chatgpt.noKey")}</p>
				<LinkButton onClick={() => command("open_settings")}>{t("chatgpt.openSettings")}</LinkButton>
			</div>
		);
	}

	const last = messages[messages.length - 1];
	const lastAnswer = !running && last && last.role === "assistant" && !last.error ? last.content : null;

	return (
		<div className="flex h-full flex-col gap-2" onClick={(e) => e.stopPropagation()}>
			<div className="flex items-center gap-2">
				<motion.span
					className="grid"
					animate={running ? { rotate: 360 } : { rotate: 0 }}
					transition={running ? { duration: 2.4, repeat: Infinity, ease: "linear" } : { duration: 0.3 }}
				>
					<ChatIcon size={16} color={CHATGPT_GREEN} />
				</motion.span>
				<span className="text-[14px] font-[650]">ChatGPT</span>
				<span className="truncate text-[12px] text-text-faint">{running ? t("chatgpt.thinking") : model}</span>
				<span className="flex-1" />
				{messages.length > 0 && !running && <TextButton onClick={() => chat.set([])}>{t("chatgpt.new")}</TextButton>}
			</div>

			{messages.length === 0 ? (
				<p className="text-[12.5px]/[1.45] text-text-dim">{t("chatgpt.hint")}</p>
			) : (
				<div
					ref={scroller}
					className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1 select-text [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/14"
					data-scroll
				>
					{messages.map((m, i) =>
						m.role === "user" ? (
							// biome-ignore lint/suspicious/noArrayIndexKey: messages are append-only and have no id
							<div key={i} className={userBubble}>
								{m.content}
							</div>
						) : (
							// biome-ignore lint/suspicious/noArrayIndexKey: messages are append-only and have no id
							<div key={i} className={cn("text-[13px]/normal text-white/92", m.error && "text-[#ff8a80]")}>
								<Formatted text={m.content} />
							</div>
						),
					)}
					{running && <span className="text-[13px] text-text-dim">…</span>}
					{lastAnswer && (
						<TextButton
							className="-ml-2 self-start"
							onClick={() => navigator.clipboard.writeText(lastAnswer).then(() => setCopied(true))}
						>
							{copied ? t("chatgpt.copied") : t("chatgpt.copy")}
						</TextButton>
					)}
				</div>
			)}

			<div className="mt-auto flex items-end gap-1.5 rounded-[18px] bg-white/7 p-1.25 pl-2.5" data-no-drag>
				<textarea
					ref={input}
					rows={1}
					className="min-h-6.5 flex-1 resize-none bg-transparent p-1 text-[13px]/[18px] text-text outline-none select-text placeholder:text-text-faint"
					value={draft}
					placeholder={t("chatgpt.placeholder")}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={onKeyDown}
					onMouseDown={takeKeyboard}
					onFocus={() => island.keepOpen(true, "chatgpt")}
					onBlur={() => island.keepOpen(false, "chatgpt")}
				/>
				<button
					type="button"
					className="grid size-7 flex-none place-items-center rounded-full text-white disabled:opacity-35"
					style={{ background: CHATGPT_GREEN }}
					title={t("chatgpt.send")}
					disabled={running || !draft.trim()}
					onClick={submit}
				>
					<ArrowUpIcon size={13} />
				</button>
			</div>
		</div>
	);
}
