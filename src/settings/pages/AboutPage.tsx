import { useEffect, useState } from "react";
import { AppLogo } from "../../components/icons";
import { Button } from "../../components/ui/button";
import { Card, Row } from "../../components/ui/card";
import { command, providerAction } from "../../core/bridge";
import { useT } from "../../core/i18n";
import { notesVersion, ReleaseNotes } from "../../modules/whatsnew";

type UpdateStatus =
	| { state: "idle" | "checking" | "latest" | "dev" | "portable" | "store" | "error" | "hidden" }
	| { state: "ready"; version: string };

/**
 * Update check, run once when the page opens and again on demand; a found
 * update is downloaded and installed on click. Hidden while updates aren't
 * set up for this fork (and in dev builds), where it would only say so.
 */
function UpdateRow() {
	const t = useT();
	const [status, setStatus] = useState<UpdateStatus>({ state: "checking" });

	const check = async () => {
		setStatus({ state: "checking" });
		try {
			const version = await command<string | null>("check_update");
			setStatus(version ? { state: "ready", version } : { state: "latest" });
		} catch (e) {
			if (e === "notConfigured" || e === "dev") setStatus({ state: "hidden" });
			else setStatus({ state: e === "portable" || e === "store" ? e : "error" });
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: once, when the page opens
	useEffect(() => {
		check();
	}, []);

	if (status.state === "hidden") return null;

	const desc =
		status.state === "ready"
			? t("settings.about.updates.ready", { version: status.version })
			: t(`settings.about.updates.${status.state as Exclude<UpdateStatus["state"], "ready" | "hidden">}`);

	return (
		<Row label={t("settings.about.updates.label")} desc={desc}>
			{status.state === "ready" ? (
				<Button variant="primary" onClick={() => command("install_update")}>
					{t("settings.about.updates.install")}
				</Button>
			) : (
				<Button onClick={check} disabled={status.state === "checking"}>
					{t("settings.about.updates.check")}
				</Button>
			)}
		</Row>
	);
}

/** Back up all settings to a file, or bring them back from one. */
function BackupRows() {
	const t = useT();
	const [note, setNote] = useState<string | null>(null);
	const run = (cmd: "export_settings" | "import_settings") =>
		command<boolean>(cmd)
			.then((ok) => ok && setNote(t(cmd === "export_settings" ? "backup.saved" : "backup.restored")))
			.catch((e) => setNote(e === "notBackup" ? t("backup.notBackup") : t("backup.failed")));
	return (
		<Row label={t("backup.label")} desc={note ?? t("backup.desc")}>
			<div className="flex gap-2">
				<Button onClick={() => run("export_settings")}>{t("backup.save")}</Button>
				<Button onClick={() => run("import_settings")}>{t("backup.restore")}</Button>
			</div>
		</Row>
	);
}

/** Problems: the log folder opens, and a prefilled report on GitHub (version only, nothing personal). */
function ReportRow() {
	const t = useT();
	const report = () => {
		providerAction("tools", "open_log").catch(() => undefined);
		const title = encodeURIComponent(t("report.issueTitle"));
		const body = encodeURIComponent(t("report.issueBody", { version: __APP_VERSION__ }));
		command("open_external", {
			url: `https://github.com/lianheeb-design/Widget-/issues/new?title=${title}&body=${body}`,
		}).catch(() => undefined);
	};
	return (
		<Row label={t("report.label")} desc={t("report.desc")}>
			<Button onClick={report}>{t("report.button")}</Button>
		</Row>
	);
}

export function AboutPage() {
	const t = useT();

	return (
		<>
			<div className="flex flex-col items-center gap-2.5 pt-4.5 pb-2.5 [&_svg]:drop-shadow-[0_8px_24px_rgba(143,148,255,0.18)]">
				<AppLogo size={72} />
				<div className="mt-1 text-[22px] font-bold tracking-[-0.015em]">Island for Windows</div>
				<span className="rounded-full bg-white/6 px-2.5 py-0.75 text-[12px] font-semibold text-text-dim tabular-nums">
					{t("settings.about.version", { version: __APP_VERSION__ })}
				</span>
			</div>
			<Card>
				<UpdateRow />
				<Row label={t("settings.about.log.label")} desc={t("settings.about.log.desc")}>
					<Button onClick={() => providerAction("tools", "open_log").catch(() => undefined)}>
						{t("settings.about.log.open")}
					</Button>
				</Row>
				<ReportRow />
				<Row label={t("settings.about.license")} desc="GNU GPL v3.0"></Row>
			</Card>
			<Card>
				<BackupRows />
			</Card>
			<Card>
				<div className="flex flex-col gap-2.5 px-4 py-3.5">
					<strong className="text-[13.5px]">
						{t("whatsnew.heading", { version: notesVersion() ?? __APP_VERSION__ })}
					</strong>
					<ReleaseNotes version={notesVersion() ?? __APP_VERSION__} className="flex flex-col gap-2" />
				</div>
			</Card>
		</>
	);
}
