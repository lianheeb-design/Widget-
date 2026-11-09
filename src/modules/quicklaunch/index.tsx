import { FileIcon, FolderIcon, GlobeIcon, PlusIcon, RocketIcon, Trash2Icon } from "lucide-react";
/**
 * Quick launch: the person's own buttons that open a program, file, folder or
 * web page (through the `tools` provider's `open_target`).
 */
import { type FormEvent, useState } from "react";
import { Button } from "../../components/ui/button";
import { Block, Desc, Divider, Row } from "../../components/ui/card";
import { Input } from "../../components/ui/form";
import { command } from "../../core/bridge";
import { useT } from "../../core/i18n";
import { type SettingDef, setSetting, useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { newId } from "../shared";
import { errorText, tools } from "../tools/bridge";
import { AiSettings } from "./AiSettings";
import { alternative, openAi, resolve, useAiButtons, useInstalledApps } from "./ai";

const ACCENT = "#BF5AF2";

interface QuickButton {
	id: string;
	name: string;
	target: string;
	emoji: string;
}

const buttons: SettingDef<QuickButton[]> = { key: "quick.buttons", label: "quick.title", default: [] };

const isWeb = (target: string) => /^https?:\/\//i.test(target);
const guessEmoji = (target: string) =>
	isWeb(target) ? "🌐" : /\.(exe|lnk|bat|cmd)$/i.test(target) ? "🚀" : /\.[a-z0-9]{1,5}$/i.test(target) ? "📄" : "📁";

const tile =
	"relative flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-[18px] bg-white/7 px-1.5 transition-[background,transform] hover:bg-white/12 active:scale-95";

function QuickPanel() {
	const t = useT();
	const list = useSetting(buttons);
	const ai = useAiButtons();
	const { installed } = useInstalledApps();
	const [error, setError] = useState<string | null>(null);
	if (!list.length && !ai.length) {
		return (
			<div
				className="flex h-full flex-col items-center justify-center gap-2 text-center"
				onClick={(e) => e.stopPropagation()}
			>
				<RocketIcon size={24} color={ACCENT} />
				<p className="max-w-100 text-[12.5px] text-text-dim">{t("quick.empty")}</p>
				<button
					type="button"
					className="text-[12.5px] font-bold text-[#d49cf5] hover:underline"
					onClick={() => command("open_settings")}
				>
					{t("quick.openSettings")}
				</button>
			</div>
		);
	}
	return (
		<div className="flex h-full flex-col gap-1.5 px-1" onClick={(e) => e.stopPropagation()}>
			<div className="grid min-h-0 flex-1 grid-cols-5 content-start gap-2 overflow-y-auto" data-scroll>
				{ai.map(({ app, mode }) => {
					const target = resolve(app, mode, installed);
					const where = target.kind;
					const other = alternative(target).kind;
					return (
						<button
							type="button"
							key={`ai-${app.id}`}
							title={t("quick.ai.tooltipSwap", {
								where: t(`quick.ai.where.${where}`),
								other: t(`quick.ai.where.${other}`),
							})}
							className={tile}
							onClick={() =>
								openAi(app, mode, installed)
									.then(() => setError(null))
									.catch(() => setError(t("quick.failed")))
							}
							onContextMenu={(e) => {
								e.preventDefault();
								openAi(app, mode, installed, true)
									.then(() => setError(null))
									.catch(() => setError(t("quick.failed")));
							}}
						>
							<span className="text-[24px] leading-none">{app.emoji}</span>
							<span className="max-w-full truncate text-[11.5px] font-[650] text-text-dim">{app.name}</span>
							<span className="absolute top-1.5 right-2 text-[9px] font-bold tracking-[0.04em] text-text-faint uppercase">
								{t(`quick.ai.badge.${where}`)}
							</span>
						</button>
					);
				})}
				{list.map((b) => (
					<button
						type="button"
						key={b.id}
						title={b.target}
						className={tile}
						onClick={() =>
							tools("open_target", { target: b.target })
								.then(() => setError(null))
								.catch((e) => setError(errorText(e) === "notFound" ? t("quick.notFound") : t("quick.failed")))
						}
					>
						<span className="text-[24px] leading-none">{b.emoji || guessEmoji(b.target)}</span>
						<span className="max-w-full truncate text-[11.5px] font-[650] text-text-dim">{b.name}</span>
					</button>
				))}
			</div>
			<span className="h-4 truncate px-1 text-[11.5px] text-[#ff8a80]">{error}</span>
		</div>
	);
}

function QuickSettings() {
	const t = useT();
	const list = useSetting(buttons);
	const [name, setName] = useState("");
	const [target, setTarget] = useState("");
	const [emoji, setEmoji] = useState("");

	const pick = async (kind: "pick_file" | "pick_folder") => {
		const path = await tools<string | null>(kind).catch(() => null);
		if (!path) return;
		setTarget(path);
		if (!name)
			setName(
				path
					.replace(/[\\/]+$/, "")
					.split(/[\\/]/)
					.pop()
					?.replace(/\.(exe|lnk)$/i, "") ?? "",
			);
	};

	const add = (e: FormEvent) => {
		e.preventDefault();
		const tg = target.trim();
		if (!name.trim() || !tg) return;
		setSetting(buttons, [
			...list,
			{ id: newId(), name: name.trim(), target: tg, emoji: emoji.trim() || guessEmoji(tg) },
		]);
		setName("");
		setTarget("");
		setEmoji("");
	};

	const move = (index: number, by: number) => {
		const next = [...list];
		const [item] = next.splice(index, 1);
		next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item);
		setSetting(buttons, next);
	};

	return (
		<>
			<AiSettings />
			<Divider />
			<Block>
				<Row label={t("quick.list")} desc={t("quick.listDesc")} />
				{list.map((b, i) => (
					<div key={b.id} className="flex items-center gap-2 text-[13px]">
						<span className="w-6 text-center text-[17px]">{b.emoji}</span>
						<span className="font-[650]">{b.name}</span>
						<span className="min-w-0 flex-1 truncate text-text-faint" title={b.target}>
							{b.target}
						</span>
						<button
							type="button"
							className="px-1 text-text-faint hover:text-text"
							onClick={() => move(i, -1)}
							disabled={i === 0}
						>
							↑
						</button>
						<button
							type="button"
							className="px-1 text-text-faint hover:text-text"
							onClick={() => move(i, 1)}
							disabled={i === list.length - 1}
						>
							↓
						</button>
						<button
							type="button"
							className="grid size-7 place-items-center rounded-full text-text-faint hover:bg-white/10 hover:text-text"
							title={t("quick.remove")}
							onClick={() =>
								setSetting(
									buttons,
									list.filter((x) => x.id !== b.id),
								)
							}
						>
							<Trash2Icon size={13} />
						</button>
					</div>
				))}
			</Block>
			<Divider />
			<Block>
				<Row label={t("quick.add")} desc={t("quick.addDesc")} />
				<form className="flex flex-col gap-2" onSubmit={add}>
					<div className="flex gap-2">
						<Input
							className="w-16"
							value={emoji}
							placeholder="🚀"
							maxLength={4}
							onChange={(e) => setEmoji(e.target.value)}
						/>
						<Input
							className="flex-1"
							value={name}
							placeholder={t("quick.name")}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>
					<div className="flex gap-2">
						<Input
							className="flex-1"
							value={target}
							placeholder={t("quick.target")}
							spellCheck={false}
							onChange={(e) => setTarget(e.target.value)}
						/>
						<Button onClick={() => pick("pick_file")}>
							<FileIcon size={13} />
							{t("quick.file")}
						</Button>
						<Button onClick={() => pick("pick_folder")}>
							<FolderIcon size={13} />
							{t("quick.folder")}
						</Button>
					</div>
					<div className="flex items-center justify-between gap-2">
						<Desc>
							<GlobeIcon size={11} className="mr-1 inline" />
							{t("quick.webHint")}
						</Desc>
						<Button type="submit" variant="primary" disabled={!name.trim() || !target.trim()}>
							<PlusIcon size={13} />
							{t("quick.addButton")}
						</Button>
					</div>
				</form>
			</Block>
		</>
	);
}

export const quickLaunchModule: IslandModule = {
	id: "quicklaunch",
	title: "quick.title",
	settingsIcon: <RocketIcon size={15} />,
	SettingsSection: QuickSettings,
	useView(): ModuleView {
		const count = useSetting(buttons).length + useAiButtons().length;
		return {
			active: false,
			priority: 0,
			accent: ACCENT,
			icon: <RocketIcon size={15} color={ACCENT} />,
			expanded: <QuickPanel />,
			expandedSize: { width: 560, height: count > 5 ? 196 : 120 },
		};
	},
};
