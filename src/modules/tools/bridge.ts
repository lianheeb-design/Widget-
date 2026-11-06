/** Calls into the backend's `tools` provider (`src-tauri/src/providers/tools`). */
import { providerAction } from "../../core/bridge";

export const TOOLS_PROVIDER = "tools";

export function tools<T = unknown>(action: string, payload?: unknown) {
	return providerAction<T>(TOOLS_PROVIDER, action, payload);
}

/** Backend errors arrive as strings: a short code or a message. */
export function errorText(e: unknown): string {
	if (typeof e === "string") return e;
	if (e instanceof Error) return e.message;
	return "failed";
}
