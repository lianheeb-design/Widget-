import { GitBranchIcon } from "lucide-react";
/**
 * Git: status of a local repository and one-click add, commit, push and pull,
 * through the `git` command line (Git for Windows).
 */
import type { IslandModule, ModuleView } from "../../core/types";
import { GitPanel } from "./components/GitPanel";
import { GitSettings } from "./components/GitSettings";
import { GIT_ACCENT } from "./settings";

export const gitModule: IslandModule = {
	id: "git",
	title: "git.title",
	// Off on new installs since 1.0 (see `core/migrate.ts`).
	enabledByDefault: false,
	settingsIcon: <GitBranchIcon size={15} />,
	SettingsSection: GitSettings,
	useView(): ModuleView {
		return {
			active: false,
			priority: 0,
			accent: GIT_ACCENT,
			icon: <GitBranchIcon size={15} color={GIT_ACCENT} />,
			expanded: <GitPanel />,
			expandedSize: { width: 560, height: 220 },
		};
	},
};
