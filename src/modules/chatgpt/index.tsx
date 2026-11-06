/**
 * ChatGPT: a chat with OpenAI's models, using the person's own API key
 * (stored by the backend's `tools` provider in the Credential Manager).
 */
import { useT } from "../../core/i18n";
import type { IslandModule, ModuleView } from "../../core/types";
import { ChatIcon } from "./components/ChatGptIcon";
import { ChatPanel } from "./components/ChatPanel";
import { ChatSettings } from "./components/ChatSettings";
import { CHATGPT_GREEN, chat, chatRunning } from "./store";

export const chatgptModule: IslandModule = {
	id: "chatgpt",
	title: "chatgpt.title",
	settingsIcon: <ChatIcon size={15} />,
	SettingsSection: ChatSettings,
	useView(): ModuleView {
		const t = useT();
		const messages = chat.use();
		const running = chatRunning.use();
		return {
			active: running,
			priority: 45,
			accent: CHATGPT_GREEN,
			icon: <ChatIcon size={15} color={CHATGPT_GREEN} />,
			compact: running
				? {
						left: (
							<span className="flex items-center gap-2 text-[13px] font-[650]">
								<ChatIcon size={15} color={CHATGPT_GREEN} />
								ChatGPT
							</span>
						),
						right: <span className="text-[12px] text-text-dim">{t("chatgpt.thinking")}</span>,
						width: 250,
					}
				: undefined,
			expanded: <ChatPanel />,
			expandedSize: { width: 560, height: messages.length ? 340 : 150 },
		};
	},
};
