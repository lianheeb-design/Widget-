import type { MessageKey, Translate } from "../../core/i18n";
import { createStore } from "../../core/island";
import type { SettingDef } from "../../core/settings";
import { errorText, tools } from "../tools/bridge";

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	error?: boolean;
}

export const CHATGPT_GREEN = "#10A37F";

export const chatModel: SettingDef<string> = {
	key: "chatgpt.model",
	label: "chatgpt.model.label",
	description: "chatgpt.model.desc",
	default: "gpt-5-mini",
};

/** The conversation, kept while the island runs (switching tabs keeps it). */
export const chat = createStore<ChatMessage[]>([]);
export const chatRunning = createStore(false);
/** Whether a key is saved; `null` until asked. */
export const hasKey = createStore<boolean | null>(null);

export function refreshKey() {
	return tools<{ hasKey: boolean }>("openai_status")
		.then((r) => hasKey.set(r.hasKey))
		.catch(() => hasKey.set(false));
}

const CODES = ["badKey", "quota", "rateLimited", "model", "network", "empty", "noKey", "invalidKey"] as const;

export function chatError(t: Translate, e: unknown): string {
	const text = errorText(e);
	return (CODES as readonly string[]).includes(text)
		? t(`chatgpt.error.${text as (typeof CODES)[number]}` as MessageKey)
		: text;
}

export async function send(text: string, model: string, t: Translate) {
	const question = text.trim();
	if (!question || chatRunning.get()) return;
	const history = [...chat.get().filter((m) => !m.error), { role: "user" as const, content: question }];
	chat.set((prev) => [...prev, { role: "user", content: question }]);
	chatRunning.set(true);
	try {
		const { text: answer } = await tools<{ text: string }>("openai_chat", { model, messages: history });
		chat.set((prev) => [...prev, { role: "assistant", content: answer }]);
	} catch (e) {
		chat.set((prev) => [...prev, { role: "assistant", content: chatError(t, e), error: true }]);
		if (errorText(e) === "noKey" || errorText(e) === "badKey") refreshKey();
	} finally {
		chatRunning.set(false);
	}
}
