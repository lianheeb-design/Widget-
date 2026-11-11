import { LockKeyholeIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { supabase } from "../lib/supabase";
import { Button, ErrorBanner } from "./ui";

/** Sign-in with the admin's Supabase Auth account (no sign-up here). */
export function Login() {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (!supabase) return;
		setBusy(true);
		setError(null);
		const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
		setBusy(false);
		// The same message for a wrong address or password.
		if (error) setError(error.status === 400 ? "E-Mail oder Passwort ist falsch." : error.message);
	};

	return (
		<main className="grid min-h-screen place-items-center px-4">
			<form
				onSubmit={submit}
				className="flex w-full max-w-90 flex-col gap-4 rounded-2xl bg-panel p-7 shadow-[inset_0_0_0_1px_var(--color-hairline),0_30px_80px_-30px_rgba(0,0,0,0.8)]"
			>
				<div className="flex flex-col items-center gap-2 pb-1 text-center">
					<span className="grid size-12 place-items-center rounded-2xl bg-accent/15 text-[#64b5ff]">
						<LockKeyholeIcon size={22} />
					</span>
					<h1 className="text-[19px] font-bold">Zugangsverwaltung</h1>
					<p className="text-[13px] text-text-dim">Nur für den Entwickler. Melde dich mit deinem Admin-Konto an.</p>
				</div>
				{error && <ErrorBanner message={error} />}
				<label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-text-dim">
					E-Mail
					<input
						type="email"
						autoComplete="username"
						required
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						className="h-10 rounded-xl bg-white/6 px-3 text-[14px] font-normal text-text outline-none shadow-[inset_0_0_0_1px_var(--color-hairline)] focus:shadow-[inset_0_0_0_1.5px_var(--color-accent)]"
					/>
				</label>
				<label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-text-dim">
					Passwort
					<input
						type="password"
						autoComplete="current-password"
						required
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						className="h-10 rounded-xl bg-white/6 px-3 text-[14px] font-normal text-text outline-none shadow-[inset_0_0_0_1px_var(--color-hairline)] focus:shadow-[inset_0_0_0_1.5px_var(--color-accent)]"
					/>
				</label>
				<Button type="submit" variant="primary" busy={busy} className="mt-1 h-10">
					Anmelden
				</Button>
			</form>
		</main>
	);
}
