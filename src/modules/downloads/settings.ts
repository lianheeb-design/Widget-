import type { SettingDef } from "../../core/settings";

export const downloadsSettings = {
	peekOnNew: {
		key: "downloads.peekOnNew",
		label: "downloads.peekOnNew.label",
		description: "downloads.peekOnNew.desc",
		default: true,
	},
} satisfies Record<string, SettingDef>;
