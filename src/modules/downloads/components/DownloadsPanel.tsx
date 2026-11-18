import { DownloadIcon, FolderIcon, FolderOpenIcon, MessageCircleIcon } from "lucide-react";
import { type PointerEvent, type ReactNode, useRef, useState } from "react";
import { TextButton } from "../../../components/ui/button";
import { type Translate, useLocale, useT } from "../../../core/i18n";
import { useIsland } from "../../../core/island";
import { formatAgo, useNow } from "../../ai-agents/common/format";
import { attachFiles, requestAskFocus, useAskEnabled } from "../../ask/store";
import { addToShelf } from "../../shelf/actions";
import { formatSize } from "../format";
import {
	DOWNLOADS_GREEN,
	type DownloadItem,
	type DownloadsState,
	downloadsAction,
	openDownloadsFolder,
} from "../types";

const DRAG_THRESHOLD = 5;
/** How long "On the shelf" stays on a row. */
const FEEDBACK_MS = 1400;
/** A finished download is marked "new" this long. */
const NEW_MS = 60_000;

function hint(t: Translate, state: DownloadsState | undefined) {
	if (state?.items.length) return t("downloads.hint");
	return state && !state.folder ? t("downloads.noFolder") : t("downloads.empty");
}

/** The newest files in the Downloads folder: click opens, drag out to use. */
export function DownloadsPanel({ state }: { state: DownloadsState | undefined }) {
	const t = useT();
	const items = state?.items ?? [];
	const latest = state?.latest;
	const now = useNow(10_000, !!latest);
	const newPath = latest && now - latest.seenAt < NEW_MS ? latest.path : null;

	return (
		<div className="flex h-full flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
			<div className="flex items-center justify-between gap-3">
				<span className="truncate text-[12px] text-text-dim">{hint(t, state)}</span>
				{state?.folder && <TextButton onClick={openDownloadsFolder}>{t("downloads.openFolder")}</TextButton>}
			</div>
			<ul className="min-h-0 flex-1 list-none overflow-y-auto [scrollbar-width:none]" data-scroll>
				{items.map((item) => (
					<Row key={item.path} item={item} isNew={item.path === newPath} />
				))}
				{!items.length && (
					<li className="grid h-full place-items-center text-text-faint">
						<DownloadIcon size={22} />
					</li>
				)}
			</ul>
		</div>
	);
}

/** Drag a download out of the island to any app. */
function useDragOut(path: string) {
	const press = useRef<{ x: number; y: number; id: number } | null>(null);
	return {
		onPointerDown: (e: PointerEvent) => {
			if (e.button !== 0 || (e.target as Element).closest("button")) return;
			press.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
		},
		onPointerMove: (e: PointerEvent) => {
			const p = press.current;
			if (!p || p.id !== e.pointerId || (e.buttons & 1) === 0) return;
			if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
			press.current = null;
			downloadsAction("drag", path);
		},
		onPointerUp: () => (press.current = null),
	};
}

function Row({ item, isNew }: { item: DownloadItem; isNew: boolean }) {
	const t = useT();
	const locale = useLocale();
	const island = useIsland();
	const askEnabled = useAskEnabled();
	const now = useNow(30_000);
	const drag = useDragOut(item.path);
	const [kept, setKept] = useState(false);
	const timer = useRef<number | undefined>(undefined);

	const keep = async () => {
		await addToShelf([item.path]);
		setKept(true);
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setKept(false), FEEDBACK_MS);
	};
	const ask = async () => {
		await attachFiles([item.path]);
		requestAskFocus();
		island.expand("ask");
	};
	const meta = [item.isDir ? t("downloads.folder") : formatSize(item.size, locale), formatAgo(t, item.at, now)];

	return (
		<li
			className="group relative flex h-12 cursor-pointer items-center gap-2.5 rounded-xl px-2 hover:bg-white/6"
			title={item.path}
			data-no-drag
			onClick={() => downloadsAction("open", item.path)}
			{...drag}
		>
			<Visual item={item} />
			<div className="flex min-w-0 flex-1 flex-col gap-px">
				<span className="flex min-w-0 items-center gap-1.5">
					<span className="truncate text-[13px] font-semibold">{item.name}</span>
					{isNew && (
						<span
							className="flex-none rounded-full px-1.5 py-px text-[10px] font-bold"
							style={{ color: DOWNLOADS_GREEN, background: `${DOWNLOADS_GREEN}2e` }}
						>
							{t("downloads.new")}
						</span>
					)}
				</span>
				{kept ? (
					<span className="truncate text-[11.5px] font-semibold text-[#30d158]">✓ {t("downloads.kept")}</span>
				) : (
					<span className="truncate text-[11.5px] text-text-dim">{meta.join(" · ")}</span>
				)}
			</div>
			<div className="hidden gap-1 group-hover:flex">
				{askEnabled && <RowAction icon={<MessageCircleIcon size={11} />} label={t("downloads.ask")} onClick={ask} />}
				<RowAction icon={<FolderIcon size={11} />} label={t("downloads.keep")} onClick={keep} />
				<RowAction
					icon={<FolderOpenIcon size={11} />}
					label={t("downloads.reveal")}
					onClick={() => downloadsAction("reveal", item.path)}
				/>
			</div>
		</li>
	);
}

/** Windows' preview (a picture, an app's icon…), or the extension on a plain tile. */
function Visual({ item }: { item: DownloadItem }) {
	if (item.thumb) {
		return <img className="size-9 flex-none rounded-[7px] object-contain" src={item.thumb} alt="" draggable={false} />;
	}
	return (
		<span className="grid size-9 flex-none place-items-center rounded-[9px] bg-white/7">
			{item.isDir ? (
				<FolderIcon size={15} color="#64D2FF" />
			) : (
				<span className="text-[8.5px] font-[750] text-text-dim uppercase">{item.ext.slice(0, 4) || "?"}</span>
			)}
		</span>
	);
}

function RowAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
	return (
		<button
			type="button"
			className="grid size-6 place-items-center rounded-full bg-[#3a3a3c] text-[14px] leading-none hover:bg-[#4a4a4e]"
			title={label}
			onClick={(e) => {
				e.stopPropagation();
				onClick();
			}}
		>
			{icon}
		</button>
	);
}
