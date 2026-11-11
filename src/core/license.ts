/**
 * Whether this installation may be used (see `src-tauri/src/license`). The
 * backend publishes the `license` snapshot; while it isn't usable, the island
 * shows a lock message instead of its modules (`LockedIsland`) and the
 * settings window shows the same (`LockedSettings`). The backend enforces it
 * too: locked, none of the app's features run.
 */
import { command, isTauri, useProvider } from "./bridge";

export const LICENSE_ID = "license";

/**
 * - unmanaged: the license check is off in this build
 * - pending: new installation, not confirmed by the server yet (runs)
 * - active: confirmed (runs)
 * - blocked: blocked by the developer
 * - outdated: this version is too old for the server
 * - expired: no confirmation for too long (offline)
 */
export type LicenseState = "unmanaged" | "pending" | "active" | "blocked" | "outdated" | "expired";

export interface LicenseStatus {
	state: LicenseState;
	usable: boolean;
	installationId: string | null;
	/** A check is running. */
	checking: boolean;
	/** The app just started and no check has settled yet. */
	initial: boolean;
	/** Last answer from the server (ms). */
	lastCheck: number | null;
	/** When the island stops without a new answer (ms). */
	validUntil: number | null;
	/** Why the last check failed. */
	problem: "offline" | "server" | "rejected" | "invalid" | null;
}

/** Outside the app (browser preview without the mock): nothing to check. */
const PREVIEW: LicenseStatus = {
	state: "unmanaged",
	usable: true,
	installationId: null,
	checking: false,
	initial: false,
	lastCheck: null,
	validUntil: null,
	problem: null,
};

/** The license state; `undefined` until the backend's first snapshot arrived. */
export function useLicense(): LicenseStatus | undefined {
	const status = useProvider<LicenseStatus>(LICENSE_ID);
	return status ?? (isTauri ? undefined : PREVIEW);
}

/** Asks the server right away; resolves with the new state when the check is done. */
export function refreshLicense(): Promise<LicenseStatus | undefined> {
	return command<LicenseStatus>("license_refresh");
}
