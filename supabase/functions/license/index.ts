/**
 * Supabase entry point of the `license` Edge Function (Deno). The logic lives
 * in `handler.ts`; see there for the protocol.
 *
 * Secrets (`npx supabase secrets set …`):
 *   LICENSE_SIGNING_KEY                  required, from `bun scripts/license-keygen.ts`
 *   LICENSE_KEY_ID                       optional, default "main"
 *   LICENSE_GRACE_HOURS                  optional, default 24
 *   LICENSE_CHECK_MINUTES                optional, default 10
 *   LICENSE_MIN_VERSION                  optional, e.g. 1.2.0
 *   LICENSE_MAX_REGISTRATIONS_PER_MINUTE optional, default 30
 * SUPABASE_URL and the service role key are provided by Supabase itself.
 */

import { createHandler, type LicenseConfig, loadConfig, postgrestStore, serviceKeyFrom } from "./handler.ts";

declare const Deno: {
	env: { toObject(): Record<string, string> };
	serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};

const env = Deno.env.toObject();

let config: LicenseConfig | null = null;
try {
	config = await loadConfig(env);
} catch (e) {
	console.error(`license: not configured: ${e instanceof Error ? e.message : String(e)}`);
}

const serviceKey = serviceKeyFrom(env);
if (!env.SUPABASE_URL || !serviceKey) {
	console.error("license: SUPABASE_URL or the service role key is missing");
	config = null;
}

Deno.serve(
	createHandler({
		config,
		store: postgrestStore(env.SUPABASE_URL ?? "", serviceKey ?? ""),
	}),
);
