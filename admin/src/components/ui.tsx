import { CheckIcon, CopyIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { type ComponentProps, useState } from "react";
import type { InstallationStatus } from "../lib/api";
import { isOnline } from "../lib/format";

const VARIANTS = {
	primary: "bg-accent text-white hover:brightness-110",
	danger: "bg-danger/15 text-[#ff6961] hover:bg-danger/25",
	ok: "bg-ok/15 text-[#4ee67a] hover:bg-ok/25",
	soft: "bg-white/8 text-text shadow-[inset_0_0_0_1px_var(--color-hairline)] hover:bg-white/12",
	ghost: "text-text-dim hover:bg-white/8 hover:text-text",
} as const;

export function Button({
	variant = "soft",
	busy = false,
	className = "",
	children,
	disabled,
	...rest
}: ComponentProps<"button"> & { variant?: keyof typeof VARIANTS; busy?: boolean }) {
	return (
		<button
			type="button"
			className={`inline-flex h-8.5 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[13px] font-semibold transition-[filter,background-color,opacity] disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
			disabled={disabled || busy}
			{...rest}
		>
			{busy && <LoaderCircleIcon size={14} className="animate-spin" />}
			{children}
		</button>
	);
}

export function StatusBadge({ status }: { status: InstallationStatus }) {
	const blocked = status === "BLOCKED";
	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
				blocked ? "bg-danger/15 text-[#ff6961]" : "bg-ok/12 text-[#4ee67a]"
			}`}
		>
			<span className={`size-1.5 rounded-full ${blocked ? "bg-danger" : "bg-ok"}`} />
			{blocked ? "Gesperrt" : "Aktiv"}
		</span>
	);
}

/** A green dot while the installation checks in regularly. */
export function OnlineDot({ lastSeen }: { lastSeen: string | null }) {
	const online = isOnline(lastSeen);
	return (
		<span
			title={online ? "Gerade in Betrieb" : "Kein Kontakt in den letzten 15 Minuten"}
			className={`inline-block size-2 flex-none rounded-full ${online ? "bg-ok shadow-[0_0_0_3px_rgba(48,209,88,0.18)]" : "bg-white/15"}`}
		/>
	);
}

export function CopyButton({ text, label = "Kopieren" }: { text: string; label?: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			title={copied ? "Kopiert" : label}
			aria-label={copied ? "Kopiert" : label}
			className="grid size-7 flex-none place-items-center rounded-lg text-text-dim hover:bg-white/10 hover:text-text"
			onClick={(e) => {
				e.stopPropagation();
				navigator.clipboard
					.writeText(text)
					.then(() => {
						setCopied(true);
						window.setTimeout(() => setCopied(false), 1500);
					})
					.catch(() => undefined);
			}}
		>
			{copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
		</button>
	);
}

export function ErrorBanner({ message, onClose }: { message: string; onClose?: () => void }) {
	return (
		<div
			role="alert"
			className="flex items-start gap-2.5 rounded-xl bg-danger/12 px-3.5 py-2.5 text-[13px] text-[#ff8a82] shadow-[inset_0_0_0_1px_rgba(255,69,58,0.25)]"
		>
			<TriangleAlertIcon size={16} className="mt-px flex-none" />
			<span className="flex-1">{message}</span>
			{onClose && (
				<button type="button" className="text-[12px] font-semibold hover:underline" onClick={onClose}>
					Schliessen
				</button>
			)}
		</div>
	);
}

export function Spinner({ label }: { label?: string }) {
	return (
		<div className="flex items-center justify-center gap-2 py-10 text-[13px] text-text-dim">
			<LoaderCircleIcon size={16} className="animate-spin" />
			{label}
		</div>
	);
}
