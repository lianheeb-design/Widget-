import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Both settings are there (see `.env.example`). */
export const configured = !!url && !!key && !url.includes("YOUR-PROJECT-REF");

/**
 * The Supabase client with the public (anon / publishable) key only: what the
 * signed-in user may do is decided by the database (`admin_*` functions check
 * `licensing.admins`). The session lives in sessionStorage, so closing the
 * browser signs out.
 */
export const supabase: SupabaseClient | null = configured
	? createClient(url as string, key as string, {
			auth: {
				storage: window.sessionStorage,
				persistSession: true,
				autoRefreshToken: true,
				detectSessionInUrl: false,
			},
		})
	: null;
