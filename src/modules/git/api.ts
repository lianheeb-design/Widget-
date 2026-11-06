/** Mirrors `Status` in `src-tauri/src/providers/tools/git.rs`. */
import type { MessageKey, Translate } from "../../core/i18n";
import { errorText, tools } from "../tools/bridge";

export interface GitFile {
	path: string;
	kind: "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflict";
	staged: boolean;
}

export interface GitStatus {
	root: string;
	branch: string | null;
	upstream: string | null;
	ahead: number;
	behind: number;
	github: string | null;
	files: GitFile[];
	staged: number;
}

export const git = <T = unknown>(action: string, payload?: unknown) => tools<T>(`git_${action}`, payload);

const CODES = [
	"noGit",
	"notRepo",
	"notFound",
	"identity",
	"nothingToCommit",
	"noMessage",
	"noUpstream",
	"rejected",
	"auth",
	"diverged",
	"network",
	"badUrl",
	"exists",
	"identityMissing",
	"failed",
] as const;

/** A backend error code in words; git's own message otherwise. */
export function gitError(t: Translate, e: unknown): string {
	const text = errorText(e);
	return (CODES as readonly string[]).includes(text)
		? t(`git.error.${text as (typeof CODES)[number]}` as MessageKey)
		: text;
}
