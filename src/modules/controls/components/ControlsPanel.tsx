import {
	CameraIcon,
	FolderOpenIcon,
	LockIcon,
	PipetteIcon,
	ScissorsIcon,
	SunIcon,
	Volume2Icon,
	VolumeXIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../../../core/i18n";
import { useIsland } from "../../../core/island";
import { useSetting } from "../../../core/settings";
import { tools } from "../../tools/bridge";
import { inkOn, recentColors } from "../picker";
import { BigSlider } from "./BigSlider";

interface ControlsState {
	brightness: number | null;
	volume: { level: number; muted: boolean } | null;
}

const POLL_MS = 4000;
/** Brightness goes through DDC/CI or PowerShell: slow, so not on every pixel. */
const BRIGHTNESS_THROTTLE = 350;

export function ControlsPanel() {
	const t = useT();
	const island = useIsland();
	const [state, setState] = useState<ControlsState | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const lastBrightness = useRef(0);
	const noteTimer = useRef<number | undefined>(undefined);

	const refresh = useCallback(() => {
		tools<ControlsState>("state")
			.then(setState)
			.catch(() => setState({ brightness: null, volume: null }));
	}, []);

	useEffect(() => {
		refresh();
		const id = window.setInterval(refresh, POLL_MS);
		return () => {
			window.clearInterval(id);
			window.clearTimeout(noteTimer.current);
		};
	}, [refresh]);

	const flash = (text: string) => {
		setNote(text);
		window.clearTimeout(noteTimer.current);
		noteTimer.current = window.setTimeout(() => setNote(null), 3500);
	};

	const setBrightness = (level: number, final: boolean) => {
		const now = Date.now();
		if (!final && now - lastBrightness.current < BRIGHTNESS_THROTTLE) return;
		lastBrightness.current = now;
		setState((s) => (s ? { ...s, brightness: level } : s));
		tools("brightness", { level }).catch(() => final && flash(t("controls.failed")));
	};

	const setVolume = (change: { level?: number; muted?: boolean }) => {
		setState((s) => (s?.volume ? { ...s, volume: { ...s.volume, ...change } } : s));
		tools("volume", change).catch(() => flash(t("controls.failed")));
	};

	/** Screenshots: fold the island away first so it isn't in the picture. */
	const capture = (action: "screenclip" | "screenshot") => {
		island.collapse();
		tools(action)
			.then(() => action === "screenshot" && flash(t("controls.screenshotSaved")))
			.catch(() => flash(t("controls.failed")));
	};

	const colors = useSetting(recentColors);
	const lastColor = colors[0];

	const pickColor = () => {
		island.collapse();
		tools("pick_color").catch(() => flash(t("controls.failed")));
	};

	const copyColor = (hex: string) =>
		tools("copy_text", { text: hex })
			.then(() => flash(`${t("controls.pipetteCopied")}: ${hex}`))
			.catch(() => flash(t("controls.failed")));

	const volume = state?.volume;
	const volumeLevel = volume ? Math.round(volume.level * 100) : 0;

	return (
		<div className="flex h-full gap-3 px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
			<div className="flex min-w-0 flex-1 flex-col justify-center gap-2.5">
				<BigSlider
					label={t("controls.brightness")}
					value={state?.brightness ?? 0}
					color="#FFB340"
					disabled={state !== null && state.brightness === null}
					note={state !== null && state.brightness === null ? t("controls.brightnessUnsupported") : undefined}
					icon={<SunIcon size={17} />}
					onChange={setBrightness}
				/>
				<BigSlider
					label={t("controls.volume")}
					value={volume?.muted ? 0 : volumeLevel}
					color="#0A84FF"
					disabled={state !== null && !volume}
					note={volume?.muted ? t("controls.mute") : undefined}
					icon={volume?.muted ? <VolumeXIcon size={17} /> : <Volume2Icon size={17} />}
					iconTitle={volume?.muted ? t("controls.unmute") : t("controls.mute")}
					onIconClick={volume ? () => setVolume({ muted: !volume.muted }) : undefined}
					onChange={(level) =>
						setVolume(volume?.muted && level > 0 ? { level: level / 100, muted: false } : { level: level / 100 })
					}
				/>
				<span className="h-3.5 truncate px-1 text-[11.5px] font-[650] text-text-dim" aria-live="polite">
					{note}
				</span>
			</div>
			<div className="grid flex-none grid-cols-3 gap-2 self-center">
				<Tile
					label={t("controls.lock")}
					tint="#FF453A"
					onClick={() => tools("lock").catch(() => flash(t("controls.failed")))}
				>
					<LockIcon size={18} />
				</Tile>
				<Tile label={t("controls.screenclip")} tint="#BF5AF2" onClick={() => capture("screenclip")}>
					<ScissorsIcon size={18} />
				</Tile>
				<Tile label={t("controls.screenshot")} tint="#64D2FF" onClick={() => capture("screenshot")}>
					<CameraIcon size={18} />
				</Tile>
				<Tile
					label={t("controls.screenshots")}
					tint="#30D158"
					onClick={() => tools("open_screenshots").catch(() => flash(t("controls.failed")))}
				>
					<FolderOpenIcon size={18} />
				</Tile>
				<Tile label={t("controls.pipette")} tint="#FF9F0A" onClick={pickColor}>
					<PipetteIcon size={18} />
				</Tile>
				<button
					type="button"
					className="flex h-[66px] w-[76px] flex-col items-center justify-center gap-1.25 rounded-[18px] bg-white/8 text-[11px] font-[650] text-text-dim transition-[background,transform] duration-150 hover:bg-white/12 active:scale-94 disabled:opacity-50"
					title={lastColor ? `${t("controls.lastColor")}: ${lastColor}` : t("controls.noColor")}
					disabled={!lastColor}
					onClick={() => lastColor && copyColor(lastColor)}
				>
					<span
						className="size-8 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]"
						style={{ background: lastColor ?? "transparent", color: lastColor ? inkOn(lastColor) : undefined }}
					/>
					<span className="max-w-full truncate px-1 font-mono text-[10.5px]">{lastColor ?? "–"}</span>
				</button>
			</div>
		</div>
	);
}

/** A square button with a colored icon and a caption. */
function Tile({
	label,
	tint,
	onClick,
	children,
}: {
	label: string;
	tint: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			className="group flex h-[66px] w-[76px] flex-col items-center justify-center gap-1.25 rounded-[18px] bg-white/8 text-[11px] font-[650] text-text-dim transition-[background,transform] duration-150 hover:bg-white/12 active:scale-94"
			onClick={onClick}
		>
			<span
				className="grid size-8 place-items-center rounded-full transition-[background] duration-150"
				style={{ background: `${tint}26`, color: tint }}
			>
				{children}
			</span>
			<span className="max-w-full truncate px-1 group-hover:text-text">{label}</span>
		</button>
	);
}
