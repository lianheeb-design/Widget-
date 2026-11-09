/**
 * One-time changes to the saved settings when a new version brings new
 * defaults. Runs in the island window once the settings are loaded.
 *
 * 1.0: tidier island.
 * - Rarely used modules start turned off on new installs; existing installs
 *   keep them on (they were on by default there).
 * - "Always in the bar" now means pinned for good (never tidied away), so the
 *   old "always" list becomes a normal one, which tidies itself.
 * - A new install gets the welcome tour instead of "What's new".
 */
import { currentSettings, layoutSettings, readSetting, setSetting, startSettings, today } from "./settings";

const MIGRATED = "app.migratedTo";
/** Modules whose default went from on to off in 1.0. */
export const OFF_BY_DEFAULT_SINCE_1_0 = ["reaction", "git", "github", "chatgpt"];
export const TOUR_PENDING = "tour.pending";

/** Keys a brand-new install may already have (written before the island shows). */
const FRESH_KEYS = new Set(["island.hidden", "island.monitor", "island.offset", "appearance.size"]);

export async function migrateSettings() {
	await startSettings();
	const values = currentSettings();
	if (values[MIGRATED] === "1.0") return;
	const existing = Object.keys(values).some((k) => !FRESH_KEYS.has(k));

	if (existing) {
		for (const id of OFF_BY_DEFAULT_SINCE_1_0) {
			const key = `module.${id}.enabled`;
			if (!(key in values)) setSetting(key, true);
		}
		const always = readSetting(values, layoutSettings.pinnedAlways);
		if (always.length) {
			const pinned = readSetting(values, layoutSettings.pinned);
			setSetting(layoutSettings.pinned, [...new Set([...pinned, ...always])]);
			setSetting(layoutSettings.pinnedAlways, []);
		}
	} else {
		setSetting(TOUR_PENDING, true);
		// The tour shows what's there; no "What's new" on top of it.
		setSetting("whatsnew.seen", __APP_VERSION__);
	}
	setSetting(layoutSettings.usageSince, today());
	setSetting(MIGRATED, "1.0");
}
