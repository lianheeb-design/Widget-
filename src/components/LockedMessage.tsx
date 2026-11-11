import { DownloadIcon, LockIcon, type LucideIcon, WifiOffIcon } from "lucide-react";
import { useState } from "react";
import { command, useProvider } from "../core/bridge";
import { type MessageKey, useT } from "../core/i18n";
import { type LicenseState, type LicenseStatus, refreshLicense } from "../core/license";

type LockedState = Exclude<LicenseState, "unmanaged" | "pending" | "active">;

/** How each locked state looks and reads. */
export const LOCKED: Record<
	LockedState,
	{
		icon: LucideIcon;
		color: string;
		tint: string;
		short: MessageKey;
		title: MessageKey;
		body: MessageKey;
		hint: MessageKey;
	}
> = {
	blocked: {
		icon: LockIcon,
		color: "#FF6961",
		tint: "rgba(255,69,58,0.15)",
		short: "license.blocked.short",
		title: "license.blocked.title",
		body: "license.blocked.body",
		hint: "license.blocked.hint",
	},
	expired: {
		icon: WifiOffIcon,
		color: "#FFB340",
		tint: "rgba(255,159,10,0.15)",
		short: "license.expired.short",
		title: "license.expired.title",
		body: "license.expired.body",
		hint: "license.expired.hint",
	},
	outdated: {
		icon: DownloadIcon,
		color: "#64B5FF",
		tint: "rgba(10,132,255,0.16)",
		short: "license.outdated.short",
		title: "license.outdated.title",
		body: "license.outdated.body",
		hint: "license.outdated.hint",
	},
};

export function lockedLook(status: LicenseStatus) {
	return LOCKED[status.state as LockedState] ?? LOCKED.expired;
}

/**
 * The action under a lock message: install a ready update (an outdated
 * version), otherwise ask the server again.
 */
export function LockedAction({ status, className }: { status: LicenseStatus; className: string }) {
	const t = useT();
	const update = useProvider<{ version: string }>("update");
	const [busy, setBusy] = useState(false);

	if (status.state === "outdated" && update?.version) {
		return (
			<button
				type="button"
				className={className}
				disabled={busy}
				data-no-drag
				onClick={(e) => {
					e.stopPropagation();
					setBusy(true);
					command("install_update");
				}}
			>
				{busy ? t("update.installing") : t("license.install")}
			</button>
		);
	}

	const checking = busy || status.checking;
	return (
		<button
			type="button"
			className={className}
			disabled={checking}
			data-no-drag
			onClick={(e) => {
				e.stopPropagation();
				setBusy(true);
				refreshLicense()
					.catch(() => undefined)
					.finally(() => setBusy(false));
			}}
		>
			{checking ? t("license.checking") : t("license.check")}
		</button>
	);
}
