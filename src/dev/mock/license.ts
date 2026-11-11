import { LICENSE_ID, type LicenseState, type LicenseStatus } from "../../core/license";
import { defineMock, provider } from "./kit";

const STATES: LicenseState[] = ["active", "pending", "blocked", "expired", "outdated", "unmanaged"];

const state = provider<LicenseStatus>(LICENSE_ID, {
	state: "active",
	usable: true,
	installationId: "6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b",
	checking: false,
	initial: false,
	lastCheck: Date.now() - 4 * 60_000,
	validUntil: Date.now() + 23 * 3_600_000,
	problem: null,
});

function setState(next: LicenseState) {
	state.set((s) => ({ ...s, state: next, usable: next === "active" || next === "pending" || next === "unmanaged" }));
}

/** The access check: switch between running and the lock messages. */
export const licenseMock = defineMock({
	label: "Access",
	start: () => state.publish(),
	controls: [
		{
			kind: "select",
			label: "State",
			options: STATES,
			value: () => state.get().state,
			set: (s) => setState(s as LicenseState),
		},
		{
			kind: "toggle",
			label: "Offline",
			value: () => state.get().problem === "offline",
			set: (offline) => state.set((s) => ({ ...s, problem: offline ? "offline" : null })),
		},
		{
			kind: "toggle",
			label: "Just started",
			value: () => state.get().initial,
			set: (initial) => state.set((s) => ({ ...s, initial })),
		},
	],
});
