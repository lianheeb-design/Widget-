import {
	ArrowDownIcon,
	ArrowUpIcon,
	CloudUploadIcon,
	ExternalLinkIcon,
	FolderPlusIcon,
	GitBranchIcon,
	PlusIcon,
	RefreshCwIcon,
} from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { command } from "../../../core/bridge";
import { cn } from "../../../core/cn";
import { useT } from "../../../core/i18n";
import { useIsland } from "../../../core/island";
import { setSetting, useSetting } from "../../../core/settings";
import { type GitFile, type GitStatus, git, gitError } from "../api";
import { GIT_ACCENT, gitCurrent, gitRepos, repoName } from "../settings";

const POLL_MS = 15_000;
const SHOWN_FILES = 3;

const KIND: Record<GitFile["kind"], { letter: string; color: string }> = {
	added: { letter: "A", color: "#30D158" },
	untracked: { letter: "U", color: "#30D158" },
	modified: { letter: "M", color: "#FFD60A" },
	renamed: { letter: "R", color: "#64D2FF" },
	deleted: { letter: "D", color: "#FF453A" },
	conflict: { letter: "!", color: "#FF453A" },
};

const btn =
	"flex h-7.5 items-center gap-1.25 rounded-[13px] bg-white/9 px-2.75 text-[12px] font-bold text-text-dim transition-[filter,background] duration-150 hover:bg-white/13 hover:text-text disabled:opacity-40 disabled:hover:bg-white/9";

type Busy = "add" | "commit" | "push" | "pull" | "sync" | "status" | null;

export function GitPanel() {
	const t = useT();
	const island = useIsland();
	const repos = useSetting(gitRepos);
	const current = useSetting(gitCurrent);
	const repo = repos.includes(current) ? current : repos[0];
	const [status, setStatus] = useState<GitStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const [busy, setBusy] = useState<Busy>(null);
	const [message, setMessage] = useState("");
	const input = useRef<HTMLInputElement>(null);
	// undefined: still checking; null: Git isn't installed. Asked on each open,
	// so installing Git while the island runs is noticed.
	const [version, setVersion] = useState<string | null | undefined>(undefined);

	useEffect(() => {
		git<{ version: string | null } | undefined>("available")
			.then((r) => setVersion(r ? r.version : undefined))
			.catch(() => setVersion(null));
	}, []);

	// The translator may be a new function each render; keep the poll stable.
	const tRef = useRef(t);
	tRef.current = t;

	const refresh = useCallback(() => {
		if (!repo) return;
		git<GitStatus>("status", { repo })
			.then((s) => {
				setStatus(s ?? null);
				setError(null);
			})
			.catch((e) => {
				setStatus(null);
				setError(gitError(tRef.current, e));
			});
	}, [repo]);

	useEffect(() => {
		setStatus(null);
		refresh();
		const id = window.setInterval(refresh, POLL_MS);
		return () => window.clearInterval(id);
	}, [refresh]);

	useEffect(() => () => island.keepOpen(false, "git"), [island]);

	if (version === null) return <Message text={t("git.noGit")} />;
	if (!repo) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2.5" onClick={(e) => e.stopPropagation()}>
				<span className="text-[13px] text-text-dim">{t("git.noRepo")}</span>
				<button
					type="button"
					className={cn(btn, "bg-[#F05032] text-white hover:bg-[#ff6a4d] hover:text-white")}
					onClick={addRepo}
				>
					<FolderPlusIcon size={14} />
					{t("git.addRepo")}
				</button>
			</div>
		);
	}

	async function addRepo() {
		const path = await git<string | null>("pick").catch(() => null);
		if (!path) return;
		const list = repos.includes(path) ? repos : [...repos, path];
		setSetting(gitRepos, list);
		setSetting(gitCurrent, path);
	}

	async function run(kind: Exclude<Busy, null | "status">) {
		if (busy) return;
		if ((kind === "commit" || kind === "sync") && !message.trim()) {
			setNote(null);
			setError(t("git.error.noMessage"));
			takeKeyboard();
			return;
		}
		setBusy(kind);
		setError(null);
		setNote(null);
		try {
			if (kind === "add") await git("add", { repo });
			if (kind === "commit" || kind === "sync") await git("commit", { repo, message, all: true });
			if (kind === "push" || kind === "sync") await git("push", { repo });
			if (kind === "pull") await git("pull", { repo });
			if (kind === "commit" || kind === "sync") setMessage("");
			setNote(t(`git.done.${kind}`));
		} catch (e) {
			setError(gitError(t, e));
		} finally {
			setBusy(null);
			refresh();
		}
	}

	function takeKeyboard() {
		island.keepOpen(true, "git");
		command("focus_island");
		window.setTimeout(() => input.current?.focus(), 30);
	}

	function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
		if (e.key === "Enter") {
			e.preventDefault();
			run(e.ctrlKey ? "sync" : "commit");
		} else if (e.key === "Escape") {
			e.preventDefault();
			input.current?.blur();
			command("restore_focus");
		}
	}

	const files = status?.files ?? [];
	const changes = files.length;

	return (
		<div className="flex h-full flex-col gap-2 px-1.5 py-0.5" onClick={(e) => e.stopPropagation()}>
			{/* Repository, branch, ahead/behind. */}
			<div className="flex items-center gap-2">
				{repos.length > 1 ? (
					<select
						className="h-7 max-w-44 cursor-pointer truncate rounded-[10px] bg-white/8 px-2 text-[13px] font-[650] text-text outline-none"
						value={repo}
						onChange={(e) => setSetting(gitCurrent, e.target.value)}
					>
						{repos.map((r) => (
							<option key={r} value={r}>
								{repoName(r)}
							</option>
						))}
					</select>
				) : (
					<span className="truncate text-[14px] font-[650]" title={repo}>
						{repoName(repo)}
					</span>
				)}
				{status && (
					<span className="flex min-w-0 items-center gap-1 rounded-full bg-white/7 px-2 py-0.5 text-[12px] font-[650] text-text-dim">
						<GitBranchIcon size={12} color={GIT_ACCENT} />
						<span className="truncate">{status.branch ?? t("git.noBranch")}</span>
						{status.ahead > 0 && (
							<span className="flex items-center text-[#64D2FF]">
								<ArrowUpIcon size={11} />
								{status.ahead}
							</span>
						)}
						{status.behind > 0 && (
							<span className="flex items-center text-[#FFD60A]">
								<ArrowDownIcon size={11} />
								{status.behind}
							</span>
						)}
					</span>
				)}
				<span className="flex-1" />
				{status?.github && (
					<button
						type="button"
						className="grid size-7 place-items-center rounded-full text-text-faint hover:bg-white/10 hover:text-text"
						title={t("git.openGithub")}
						onClick={() => command("open_external", { url: `https://github.com/${status.github}` })}
					>
						<ExternalLinkIcon size={14} />
					</button>
				)}
				<button
					type="button"
					className="grid size-7 place-items-center rounded-full text-text-faint hover:bg-white/10 hover:text-text"
					title={t("git.refresh")}
					onClick={refresh}
				>
					<RefreshCwIcon size={14} />
				</button>
			</div>

			{/* Changed files. */}
			<div className="flex min-h-0 flex-1 flex-col gap-0.75">
				{status && changes === 0 && <span className="py-1 text-[12.5px] text-text-dim">✓ {t("git.clean")}</span>}
				{files.slice(0, SHOWN_FILES).map((f) => (
					<div key={f.path} className="flex min-w-0 items-center gap-2 text-[12.5px]">
						<span
							className="grid size-4.5 flex-none place-items-center rounded-[5px] text-[10px] font-[800]"
							style={{ color: KIND[f.kind].color, background: `${KIND[f.kind].color}22` }}
						>
							{KIND[f.kind].letter}
						</span>
						<span className={cn("truncate", f.staged ? "text-text" : "text-text-dim")} title={f.path}>
							{f.path}
						</span>
					</div>
				))}
				{changes > SHOWN_FILES && (
					<span className="pl-6.5 text-[11.5px] text-text-faint">{t("git.more", { n: changes - SHOWN_FILES })}</span>
				)}
			</div>

			{/* Message + actions. */}
			<input
				ref={input}
				className="h-8 w-full rounded-[12px] bg-white/7 px-3 text-[13px] text-text outline-none select-text placeholder:text-text-faint focus:bg-white/10"
				value={message}
				placeholder={t("git.placeholder")}
				spellCheck={false}
				onChange={(e) => setMessage(e.target.value)}
				onKeyDown={onKeyDown}
				onMouseDown={takeKeyboard}
				onBlur={() => island.keepOpen(false, "git")}
			/>
			<div className="flex items-center gap-1.5">
				<button
					type="button"
					className={btn}
					title={t("git.addTitle")}
					disabled={!!busy || changes === 0}
					onClick={() => run("add")}
				>
					<PlusIcon size={13} />
					{t("git.add")}
				</button>
				<button
					type="button"
					className={btn}
					title={t("git.commitTitle")}
					disabled={!!busy || changes === 0}
					onClick={() => run("commit")}
				>
					{t("git.commit")}
				</button>
				<button type="button" className={btn} disabled={!!busy} onClick={() => run("push")}>
					<ArrowUpIcon size={13} />
					{t("git.push")}
					{status && status.ahead > 0 ? ` ${status.ahead}` : ""}
				</button>
				<button type="button" className={btn} disabled={!!busy} onClick={() => run("pull")}>
					<ArrowDownIcon size={13} />
					{t("git.pull")}
					{status && status.behind > 0 ? ` ${status.behind}` : ""}
				</button>
				<span
					className={cn(
						"min-w-0 flex-1 truncate px-1 text-[11.5px] font-[650]",
						error ? "text-[#ff8a80]" : "text-text-dim",
					)}
					title={error ?? note ?? undefined}
				>
					{busy ? t("git.working") : (error ?? note)}
				</span>
				<button
					type="button"
					className={cn(btn, "bg-[#F05032] text-white hover:bg-[#ff6a4d] hover:text-white")}
					title={t("git.syncTitle")}
					disabled={!!busy || changes === 0}
					onClick={() => run("sync")}
				>
					<CloudUploadIcon size={14} />
					{t("git.sync")}
				</button>
			</div>
		</div>
	);
}

function Message({ text }: { text: string }) {
	return (
		<div
			className="m-auto max-w-110 px-3 text-center text-[12.5px]/[1.45] text-text-dim select-text"
			onClick={(e) => e.stopPropagation()}
		>
			{text}
		</div>
	);
}
