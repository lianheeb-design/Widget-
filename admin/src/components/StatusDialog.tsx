import { BanIcon, CircleCheckIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, type Installation, setInstallationStatus } from "../lib/api";
import { Button, ErrorBanner } from "./ui";

const MAX_REASON = 500;

/**
 * Confirms blocking (with a reason, kept in the audit log) or unblocking (with
 * an optional note). The change takes effect at the installation's next
 * check, within about 10 minutes while it runs.
 */
export function StatusDialog({
	installation,
	onClose,
	onDone,
}: {
	installation: Installation;
	onClose: () => void;
	onDone: (updated: Installation) => void;
}) {
	const blocking = installation.status === "ACTIVE";
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const dialog = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		dialog.current?.showModal();
	}, []);

	const confirm = async () => {
		setBusy(true);
		setError(null);
		try {
			const result = await setInstallationStatus(installation.installation_id, blocking ? "BLOCKED" : "ACTIVE", reason);
			onDone(result.installation);
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "Das hat nicht geklappt.");
			setBusy(false);
		}
	};

	return (
		<dialog
			ref={dialog}
			onClose={onClose}
			className="m-auto w-full max-w-115 rounded-2xl bg-panel p-0 text-text shadow-[inset_0_0_0_1px_var(--color-hairline),0_40px_100px_-30px_rgba(0,0,0,0.9)] backdrop:bg-black/60 backdrop:backdrop-blur-sm"
		>
			<form
				method="dialog"
				className="flex flex-col gap-4 p-6"
				onSubmit={(e) => {
					e.preventDefault();
					confirm();
				}}
			>
				<div className="flex items-start gap-3">
					<span
						className={`grid size-10 flex-none place-items-center rounded-xl ${
							blocking ? "bg-danger/15 text-[#ff6961]" : "bg-ok/15 text-[#4ee67a]"
						}`}
					>
						{blocking ? <BanIcon size={19} /> : <CircleCheckIcon size={19} />}
					</span>
					<div className="flex flex-col gap-1">
						<h2 className="text-[17px] font-bold">{blocking ? "Installation sperren?" : "Installation freigeben?"}</h2>
						<p className="text-[13px]/[1.5] text-text-dim">
							{blocking
								? "Die Insel zeigt «Zugriff deaktiviert» und schaltet ihre Funktionen ab, sobald sie das nächste Mal prüft (während sie läuft innert etwa 10 Minuten, sonst beim nächsten Start)."
								: "Die Insel läuft wieder normal, sobald sie das nächste Mal prüft."}
						</p>
						<code className="mt-1 font-mono text-[12px] text-text-faint">{installation.installation_id}</code>
					</div>
				</div>

				<label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-text-dim">
					{blocking ? "Sperrgrund (nur für dich, im Protokoll)" : "Notiz (optional, im Protokoll)"}
					<textarea
						rows={3}
						maxLength={MAX_REASON}
						value={reason}
						onChange={(e) => setReason(e.target.value)}
						placeholder={blocking ? "z. B. Schlüssel öffentlich geteilt" : "z. B. Missverständnis geklärt"}
						className="resize-none rounded-xl bg-white/6 px-3 py-2 text-[13.5px] font-normal text-text outline-none shadow-[inset_0_0_0_1px_var(--color-hairline)] placeholder:text-text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-accent)]"
					/>
					<span className="self-end text-[11px] font-normal text-text-faint tabular-nums">
						{reason.length}/{MAX_REASON}
					</span>
				</label>

				{error && <ErrorBanner message={error} />}

				<div className="flex justify-end gap-2">
					<Button variant="ghost" onClick={() => dialog.current?.close()} disabled={busy}>
						Abbrechen
					</Button>
					<Button type="submit" variant={blocking ? "danger" : "ok"} busy={busy}>
						{blocking ? "Sperren" : "Freigeben"}
					</Button>
				</div>
			</form>
		</dialog>
	);
}
