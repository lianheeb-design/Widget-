import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { LockedAction, lockedLook } from "../components/LockedMessage";
import { button } from "../components/ui/button";
import { useSyncLocale, useT } from "../core/i18n";
import type { LicenseStatus } from "../core/license";
import { TitleBar } from "./components/TitleBar";

/**
 * The settings window of a locked installation: the same message as the
 * island, the installation id to give the developer, and nothing else.
 */
export function LockedSettings({ status }: { status: LicenseStatus }) {
	const t = useT();
	useSyncLocale();
	const style = lockedLook(status);
	const Icon = style.icon;

	return (
		<div className="flex h-full flex-col" data-settings>
			<TitleBar />
			<main className="flex min-h-0 flex-1 items-center justify-center rounded-tl-xl bg-[#121217] shadow-[inset_1px_1px_0_var(--hairline)]">
				<div className="flex max-w-115 flex-col items-center gap-3 px-8 pb-6 text-center">
					<span
						className="mb-1 grid size-15 place-items-center rounded-[20px]"
						style={{ background: style.tint, color: style.color }}
					>
						<Icon size={28} />
					</span>
					<h1 className="text-[21px] font-bold tracking-[-0.01em]">{t(style.title)}</h1>
					<p className="text-[14px]/[1.5] text-text-dim">{t(style.body)}</p>
					<p className="text-[13px]/[1.5] text-text-faint">{t(style.hint)}</p>
					<LockedAction status={status} className={button({ variant: "soft", class: "mt-2" })} />
					{status.installationId && <InstallationId id={status.installationId} />}
				</div>
			</main>
		</div>
	);
}

/** The id the developer finds the installation by, with a copy button. */
function InstallationId({ id }: { id: string }) {
	const t = useT();
	const [copied, setCopied] = useState(false);
	return (
		<div className="mt-5 flex flex-col items-center gap-1.5">
			<span className="text-[11.5px] font-semibold tracking-wide text-text-faint uppercase">
				{t("license.installationId")}
			</span>
			<div className="flex items-center gap-2 rounded-xl bg-white/5 py-1.5 pr-1.5 pl-3 shadow-[inset_0_0_0_1px_var(--hairline)]">
				<code className="font-[Cascadia_Code,Consolas,monospace] text-[12px] text-text-dim select-all">{id}</code>
				<button
					type="button"
					className="grid size-7 place-items-center rounded-lg text-text-dim hover:bg-white/10 hover:text-text"
					aria-label={copied ? t("license.copied") : t("license.copy")}
					title={copied ? t("license.copied") : t("license.copy")}
					onClick={() =>
						navigator.clipboard
							.writeText(id)
							.then(() => setCopied(true))
							.catch(() => undefined)
					}
				>
					{copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
				</button>
			</div>
		</div>
	);
}
