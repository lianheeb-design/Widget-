import { useCallback, useEffect, useRef, useState } from "react";
import { focusQuiet, QUIET_ALLOWED } from "./extras";
import { calm } from "./profiles";
import type { ModuleEntry } from "./types";

const PEEK_DURATION = 3800;

/**
 * Briefly shows a module when it reports new activity (its `activityKey`
 * changes), or on demand with `peek`.
 */
export function usePeek(entries: ModuleEntry[]) {
	const [peekId, setPeekId] = useState<string | null>(null);
	const timer = useRef<number | undefined>(undefined);

	const peek = useCallback((moduleId: string, ms = PEEK_DURATION) => {
		setPeekId(moduleId);
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setPeekId(null), ms);
	}, []);

	const endPeek = useCallback(() => {
		window.clearTimeout(timer.current);
		setPeekId(null);
	}, []);

	useEffect(() => () => window.clearTimeout(timer.current), []);

	const lastKeys = useRef(new Map<string, string | undefined>());
	const keySignature = entries.map((e) => `${e.module.id}=${e.view.activityKey ?? ""}`).join("|");
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs only when an activity key changes, not on every new entries array
	useEffect(() => {
		for (const { module, view } of entries) {
			const seen = lastKeys.current.has(module.id);
			const prev = lastKeys.current.get(module.id);
			lastKeys.current.set(module.id, view.activityKey);
			if (
				seen &&
				view.activityKey &&
				view.activityKey !== prev &&
				((!focusQuiet.get() && !calm.get()) || QUIET_ALLOWED.has(module.id))
			)
				peek(module.id, view.peekMs);
		}
	}, [keySignature]);

	return { peekId, peek, endPeek };
}
