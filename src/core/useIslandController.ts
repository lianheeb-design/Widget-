import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { command, isTauri, useTauriEvent } from "./bridge";
import { openDelay } from "./extras";
import { profileAllows } from "./profiles";
import {
	generalSettings,
	ISLAND_HIDDEN_KEY,
	inOrder,
	layoutSettings,
	moduleEnabled,
	readSetting,
	type Values as Settings,
	setSetting,
	today,
	usedRecently,
	useSettings,
} from "./settings";
import type { IslandMode, IslandModule, ModuleEntry } from "./types";
import { useIslandHover } from "./useIslandHover";
import { usePeek } from "./usePeek";
import { useTabMemory } from "./useTabMemory";

export type { ModuleEntry } from "./types";

/** Mouse wheel switches tabs at most this often. */
const WHEEL_STEP_MS = 260;

/** Pseudo tab: the grid with every module. */
export const LAUNCHER = "launcher";

export type IslandController = ReturnType<typeof useIslandController>;

/**
 * Decides what the island shows: which modules are active, which one owns the
 * main slot, and whether the island is idle, compact, peeking or expanded.
 */
export function useIslandController(modules: IslandModule[]) {
	const settings = useSettings();
	const entries = useModuleEntries(modules, settings);
	const fullscreen = useFullscreen();

	// Required actions (such as a hydration reminder at zero) take precedence
	// over ordinary attention requests when deciding which tab opens.
	const forcedId = entries.find((e) => e.view.forceExpanded)?.module.id ?? null;
	const attentionId = forcedId ?? entries.find((e) => e.view.attention)?.module.id ?? null;
	const tabMemory = useTabMemory(attentionId);
	const { peekId, peek, endPeek } = usePeek(entries);
	const hover = useIslandHover({
		expandOnHover: readSetting(settings, generalSettings.expandOnHover),
		openDelay: readSetting(settings, openDelay),
		onOpen: tabMemory.onIslandOpen,
		onClose: tabMemory.onIslandClose,
	});

	// Which activity the collapsed island shows first, when several run (a train and a
	// timer): the one last looked at in the open island, or picked with the wheel.
	const [front, setFront] = useState<string | null>(null);
	const { primary, secondary, activeIds } = useBusiest(entries, front);
	const forceExpanded = forcedId !== null;
	const mode = islandMode({
		swallowed: settings[ISLAND_HIDDEN_KEY] === true,
		// Games and presentations: the island keeps out of the way, except for what
		// can't wait (a ringing alarm, a finished timer).
		hidden: fullscreen && readSetting(settings, generalSettings.hideInFullscreen) && !forceExpanded,
		expanded: hover.open,
		forceExpanded,
		peeking: peekId !== null,
		busy: primary !== undefined,
	});

	// A remembered tab whose module was turned off meanwhile doesn't count.
	const { tab } = tabMemory;
	const openTab =
		tab === LAUNCHER || entries.some((e) => e.module.id === tab && e.view.openable !== false) ? tab : null;
	const focusedId =
		forcedId ??
		(mode === "peek"
			? peekId
			: (openTab ?? primary?.module.id ?? entries.find((e) => !e.view.hidden)?.module.id ?? null));
	const focused = entries.find((e) => e.module.id === focusedId);
	const tabs = tabBar(entries, settings, focusedId);
	const launcherEntries = entries.filter((e) => !e.module.partOf && !e.module.system);

	// Remember when each tab was last looked at: tabs left alone for two weeks tidy themselves away.
	const lookedAt = mode === "expanded" && focusedId && focusedId !== LAUNCHER ? focusedId : null;
	useEffect(() => {
		if (!lookedAt) return;
		const opened = readSetting(settings, layoutSettings.lastOpened);
		if (opened[lookedAt] !== today()) setSetting(layoutSettings.lastOpened, { ...opened, [lookedAt]: today() });
	}, [lookedAt, settings]);

	/** A tab picked by the user: the island may shrink away from the pointer. */
	const selectTab = useCallback(
		(id: string | null) => {
			hover.expectResize();
			tabMemory.setTab(id);
		},
		[hover.expectResize, tabMemory.setTab],
	);

	const expand = useCallback(
		(moduleId?: string) => {
			if (moduleId) tabMemory.openOn(moduleId);
			endPeek();
			hover.expand();
		},
		[tabMemory.openOn, endPeek, hover.expand],
	);

	const collapse = useCallback(() => {
		endPeek();
		hover.collapse();
	}, [endPeek, hover.collapse]);

	// The pinned video went back to the island: show the player for a moment.
	useTauriEvent("pip://return", () => peek("music"));
	// Global shortcuts (`core/shortcuts.ts`) open "Ask Claude" and "Find on screen".
	const enabled = (id: string) => entries.some((e) => e.module.id === id);
	useTauriEvent("island://ask", () => enabled("ask") && expand("ask"));
	useTauriEvent("island://find", () => enabled("find") && expand("find"));
	useTauriEvent<string>("island://open-module", (id) => enabled(id) && expand(id));
	useTauriEvent<boolean>("island://hover", hover.onPointer);

	const wheelTabs = useWheelTabs(
		mode === "expanded",
		tabs.map((e) => e.module.id),
		focusedId,
		selectTab,
	);

	// Looking at a running activity in the open island brings it to the front.
	const focusedActive = mode === "expanded" && focusedId !== null && activeIds.includes(focusedId);
	useEffect(() => {
		if (focusedActive) setFront(focusedId);
	}, [focusedActive, focusedId]);

	// The wheel over the collapsed island flips through the running activities.
	const lastFlip = useRef(0);
	const primaryId = primary?.module.id;
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the joined ids so a new array with the same activities keeps the callback
	const onWheel = useCallback(
		(e: WheelEvent) => {
			if (mode !== "compact" || activeIds.length < 2) return wheelTabs(e);
			if (Math.abs(e.deltaY) < 4 || performance.now() - lastFlip.current < WHEEL_STEP_MS) return;
			lastFlip.current = performance.now();
			const i = Math.max(0, activeIds.indexOf(primaryId ?? ""));
			setFront(activeIds[(i + Math.sign(e.deltaY) + activeIds.length) % activeIds.length]);
		},
		[mode, activeIds.join(), primaryId, wheelTabs],
	);

	return {
		entries,
		launcherEntries,
		tabs,
		launcher: mode === "expanded" && focusedId === LAUNCHER,
		mode,
		primary,
		secondary,
		focused,
		tab: focusedId,
		setTab: selectTab,
		expand,
		peek,
		collapse,
		keepOpen: hover.keepOpen,
		lockHover: hover.lockHover,
		onWheel,
		/** Browser-only hover handlers (Tauri uses the backend hit-test). */
		domHover: isTauri ? {} : { onMouseEnter: () => hover.onPointer(true), onMouseLeave: () => hover.onPointer(false) },
	};
}

/**
 * Every enabled module with its current view, in the order chosen in the
 * settings. The registry is static, so calling each module's hook in order is
 * stable; disabled modules still run their hook (rules of hooks) but are dropped.
 */
function useModuleEntries(modules: IslandModule[], settings: Settings): ModuleEntry[] {
	return inOrder(
		modules
			// biome-ignore lint/correctness/useHookAtTopLevel: the module registry is static, so the hook order is stable
			.map((module) => ({ module, view: module.useView() }))
			.filter(({ module, view }) => view.showWhenOff || readSetting(settings, moduleEnabled(module)))
			// The active profile shows its modules only, but never hides what can't wait.
			.filter(
				({ module, view }) =>
					module.system ||
					view.forceExpanded ||
					view.showWhenOff ||
					profileAllows(settings, module.partOf ?? module.id),
			),
		(e) => e.module.id,
		readSetting(settings, layoutSettings.order),
	);
}

/** The two active modules with the highest priority (`front` first, while it is active). */
function useBusiest(entries: ModuleEntry[], front: string | null) {
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on a signature so a new entries array with the same views keeps the memo
	const active = useMemo(
		() => entries.filter((e) => e.view.active).sort((a, b) => b.view.priority - a.view.priority),
		[entries.map((e) => `${e.module.id}:${e.view.active}:${e.view.priority}`).join()],
	);
	// Looked up again so the views are this render's, not the memoized ones.
	const fresh = (e?: ModuleEntry) => (e ? entries.find((x) => x.module.id === e.module.id) : undefined);
	const first = active.find((e) => e.module.id === front);
	const ordered = first ? [first, ...active.filter((e) => e !== first)] : active;
	return { primary: fresh(ordered[0]), secondary: fresh(ordered[1]), activeIds: active.map((e) => e.module.id) };
}

/** Fullscreen apps hide the island. */
function useFullscreen() {
	const [fullscreen, setFullscreen] = useState(false);
	useTauriEvent<boolean>("island://fullscreen", setFullscreen);
	useEffect(() => {
		command<boolean>("is_fullscreen_active").then((v) => setFullscreen(!!v));
	}, []);
	return fullscreen;
}

function islandMode(s: {
	swallowed: boolean;
	hidden: boolean;
	expanded: boolean;
	forceExpanded: boolean;
	peeking: boolean;
	busy: boolean;
}): IslandMode {
	if (s.swallowed) return "swallowed";
	if (s.hidden) return "hidden";
	if (s.expanded || s.forceExpanded) return "expanded";
	if (s.peeking) return "peek";
	if (s.busy) return "compact";
	return "idle";
}

/**
 * Tab bar: the pinned modules that aren't hidden (empty) and were used lately
 * (unless tidying is off), those pinned for good, any busy one, and the
 * focused one. Everything enabled is in the launcher; modules living in
 * another one's tab (`partOf`) never get their own.
 */
function tabBar(entries: ModuleEntry[], settings: Settings, focusedId: string | null) {
	const pinned = readSetting(settings, layoutSettings.pinned);
	const pinnedAlways = readSetting(settings, layoutSettings.pinnedAlways);
	const tidy = readSetting(settings, layoutSettings.autoTidy);
	return entries.filter(
		(e) =>
			e.module.id === focusedId ||
			(!e.module.partOf &&
				!e.module.system &&
				(pinnedAlways.includes(e.module.id) ||
					(!e.view.hidden &&
						(e.view.active || (pinned.includes(e.module.id) && (!tidy || usedRecently(settings, e.module.id))))))),
	);
}

/** Mouse wheel over the open island flips through the tabs. */
function useWheelTabs(enabled: boolean, tabIds: string[], current: string | null, select: (id: string) => void) {
	const lastWheel = useRef(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the joined ids so a new array with the same tabs keeps the callback
	return useCallback(
		(e: WheelEvent) => {
			if (!enabled || Math.abs(e.deltaY) < 4) return;
			// Scrollable content (chat, lists) keeps the wheel for itself.
			if ((e.target as Element).closest("[data-scroll]")) return;
			const now = performance.now();
			if (now - lastWheel.current < WHEEL_STEP_MS) return;
			lastWheel.current = now;
			const i = tabIds.indexOf(current ?? "");
			const next = tabIds[Math.min(tabIds.length - 1, Math.max(0, i + Math.sign(e.deltaY)))];
			if (next && next !== current) select(next);
		},
		[enabled, current, tabIds.join(), select],
	);
}
