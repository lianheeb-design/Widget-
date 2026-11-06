import { type FormEvent, useEffect, useState } from "react";
import { Button, LinkButton } from "../../../components/ui/button";
import { Block, Desc, Divider, Row } from "../../../components/ui/card";
import { Input, Select } from "../../../components/ui/form";
import { command } from "../../../core/bridge";
import { useT } from "../../../core/i18n";
import { setSetting, useSetting } from "../../../core/settings";
import { tools } from "../../tools/bridge";
import { chatError, chatModel, hasKey, refreshKey } from "../store";

/** API key (kept in the Credential Manager) and the model. */
export function ChatSettings() {
	const t = useT();
	const keySaved = hasKey.use();
	const model = useSetting(chatModel);
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
	const [models, setModels] = useState<string[]>([]);

	useEffect(() => {
		refreshKey();
	}, []);

	useEffect(() => {
		if (!keySaved) {
			setModels([]);
			return;
		}
		tools<string[]>("openai_models")
			.then(setModels)
			.catch(() => setModels([]));
	}, [keySaved]);

	const save = async (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setMessage(null);
		try {
			await tools("openai_set_key", { key });
			setKey("");
			setMessage({ text: t("chatgpt.key.stored"), error: false });
			await refreshKey();
		} catch (err) {
			setMessage({ text: chatError(t, err), error: true });
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		await tools("openai_clear_key").catch(() => undefined);
		setMessage(null);
		refreshKey();
	};

	const options = models.includes(model) || !model ? models : [model, ...models];

	return (
		<>
			<Block>
				<Row label={t("chatgpt.key.title")} desc={t("chatgpt.key.desc")}>
					{keySaved ? (
						<Button onClick={remove}>{t("chatgpt.key.remove")}</Button>
					) : (
						<LinkButton onClick={() => command("open_external", { url: "https://platform.openai.com/api-keys" })}>
							{t("chatgpt.key.create")}
						</LinkButton>
					)}
				</Row>
				{!keySaved && (
					<form className="flex gap-2" onSubmit={save}>
						<Input
							className="flex-1"
							type="password"
							value={key}
							placeholder={t("chatgpt.key.placeholder")}
							spellCheck={false}
							autoComplete="off"
							onChange={(e) => setKey(e.target.value)}
						/>
						<Button type="submit" variant="primary" disabled={busy || !key.trim()}>
							{busy ? t("chatgpt.key.checking") : t("chatgpt.key.save")}
						</Button>
					</form>
				)}
				{message && <Desc tone={message.error ? "error" : undefined}>{message.text}</Desc>}
			</Block>
			<Divider />
			<Row label={t("chatgpt.model.label")} desc={t("chatgpt.model.desc")}>
				{options.length > 0 ? (
					<Select value={model} onChange={(e) => setSetting(chatModel, e.target.value)}>
						{options.map((m) => (
							<option key={m} value={m}>
								{m}
							</option>
						))}
					</Select>
				) : (
					<Input
						className="w-44"
						value={model}
						spellCheck={false}
						onChange={(e) => setSetting(chatModel, e.target.value.trim())}
					/>
				)}
			</Row>
		</>
	);
}
