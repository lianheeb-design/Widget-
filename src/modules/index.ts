import type { IslandModule } from "../core/types";
import { activitiesModule } from "./activities";
import { aiAgentsModule } from "./ai-agents";
import { askModule } from "./ask";
import { calculatorModule } from "./calculator";
import { chatgptModule } from "./chatgpt";
import { clipboardModule } from "./clipboard";
import { clockModule } from "./clock";
import { controlsModule } from "./controls";
import { countdownModule } from "./countdown";
import { findModule } from "./find";
import { gitModule } from "./git";
import { githubModule } from "./github";
import { hydrationModule } from "./hydration";
import { monitorModule } from "./monitor";
import { musicModule } from "./music";
import { notesModule } from "./notes";
import { notificationsModule } from "./notifications";
import { quickLaunchModule } from "./quicklaunch";
import { reactionModule } from "./reaction";
import { shelfModule } from "./shelf";
import { timerModule } from "./timer";
import { transitModule } from "./transit";
import { translateModule } from "./translate";
import { updateModule } from "./update";
import { weatherModule } from "./weather";
import { webAppsModule } from "./webapps";

/**
 * Every module the island knows about, in tab order.
 *
 * Each module is a self-contained folder (`src/modules/<name>/`) with its own
 * components, hooks and CSS, exporting an `IslandModule` (see `core/types.ts`).
 * If it needs data from the OS, add a matching provider in
 * `src-tauri/src/providers/<name>/`.
 */
export const modules: IslandModule[] = [
	musicModule,
	aiAgentsModule,
	askModule,
	findModule,
	notificationsModule,
	activitiesModule,
	shelfModule,
	clipboardModule,
	timerModule,
	weatherModule,
	controlsModule,
	quickLaunchModule,
	calculatorModule,
	translateModule,
	webAppsModule,
	notesModule,
	countdownModule,
	transitModule,
	chatgptModule,
	gitModule,
	reactionModule,
	updateModule,
	githubModule,
	hydrationModule,
	monitorModule,
	clockModule,
];
