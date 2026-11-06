import type { SettingDef } from "../../core/settings";

/** Local folders with a Git repository; the first is the one shown. */
export const gitRepos: SettingDef<string[]> = {
	key: "git.repos",
	label: "git.repos.title",
	description: "git.repos.desc",
	default: [],
};

/** The repository picked in the panel (a path from `gitRepos`). */
export const gitCurrent: SettingDef<string> = {
	key: "git.current",
	label: "git.repos.title",
	default: "",
};

export const GIT_ACCENT = "#F05032";

/** Last folder name of a path, for labels. */
export const repoName = (path: string) =>
	path
		.replace(/[\\/]+$/, "")
		.split(/[\\/]/)
		.pop() || path;
