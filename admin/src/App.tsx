import type { Session } from "@supabase/supabase-js";
import { ShieldAlertIcon, WrenchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { Login } from "./components/Login";
import { Button, Spinner } from "./components/ui";
import { isAdmin } from "./lib/api";
import { configured, supabase } from "./lib/supabase";

export function App() {
	return configured ? <AuthGate /> : <SetupNeeded />;
}

/**
 * Signed out → login; signed in but not an admin → refused (the database
 * would refuse every call anyway); admin → the dashboard.
 */
function AuthGate() {
	const [session, setSession] = useState<Session | null | undefined>(undefined);
	const [admin, setAdmin] = useState<boolean | undefined>(undefined);
	const userId = session?.user.id;

	useEffect(() => {
		if (!supabase) return;
		supabase.auth.getSession().then(({ data }) => setSession(data.session));
		const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
		return () => data.subscription.unsubscribe();
	}, []);

	useEffect(() => {
		setAdmin(undefined);
		if (!userId) return;
		let cancelled = false;
		isAdmin()
			.then((ok) => !cancelled && setAdmin(ok))
			.catch(() => !cancelled && setAdmin(false));
		return () => {
			cancelled = true;
		};
	}, [userId]);

	const signOut = () => supabase?.auth.signOut();

	if (session === undefined || (session && admin === undefined)) return <Spinner label="Wird geladen…" />;
	if (!session) return <Login />;
	if (!admin) {
		return (
			<Centered icon={<ShieldAlertIcon size={22} />} title="Kein Admin-Zugang">
				<p>
					Das Konto <strong>{session.user.email}</strong> ist angemeldet, aber nicht als Admin eingetragen.
				</p>
				<Button onClick={signOut}>Abmelden</Button>
			</Centered>
		);
	}
	return <Dashboard email={session.user.email ?? ""} onSignOut={signOut} />;
}

function SetupNeeded() {
	return (
		<Centered icon={<WrenchIcon size={22} />} title="Noch nicht eingerichtet">
			<p>
				Kopiere <code>admin/.env.example</code> nach <code>admin/.env.local</code> und trage die Supabase-URL und den
				öffentlichen Schlüssel (anon / publishable) ein. Danach den Dashboard-Server neu starten.
			</p>
			<p className="text-text-faint">Anleitung: docs/licensing/EINRICHTEN.md</p>
		</Centered>
	);
}

function Centered({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
	return (
		<main className="grid min-h-screen place-items-center px-4">
			<div className="flex max-w-110 flex-col items-center gap-3 text-center text-[13.5px]/[1.55] text-text-dim [&_code]:font-mono [&_code]:text-text">
				<span className="grid size-12 place-items-center rounded-2xl bg-warn/15 text-[#ffb340]">{icon}</span>
				<h1 className="text-[19px] font-bold text-text">{title}</h1>
				{children}
			</div>
		</main>
	);
}
