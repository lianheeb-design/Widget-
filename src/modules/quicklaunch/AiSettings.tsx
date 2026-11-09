import { RefreshCwIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Block, Desc, Row } from "../../components/ui/card";
import { Segmented } from "../../components/ui/form";
import { useT } from "../../core/i18n";
import { setSetting, useSetting } from "../../core/settings";
import { AI_APPS, type AiMode, aiModes, modeOf, useInstalledApps } from "./ai";

const MODES: AiMode[] = ["off", "auto", "web", "app"];

/** Per AI app: off, automatic, website or desktop app, with whether the app is installed. */
export function AiSettings() {
	const t = useT();
	const modes = useSetting(aiModes);
	const { installed, busy, refresh } = useInstalledApps();

	return (
		<Block>
			<Row label={t("quick.ai.title")} desc={t("quick.ai.desc")}>
				<Button onClick={refresh} disabled={busy || installed === null}>
					<RefreshCwIcon size={12} className={busy ? "animate-spin" : undefined} />
					{t("quick.ai.refresh")}
				</Button>
			</Row>
			{AI_APPS.map((app) => {
				const mode = modeOf(modes, app.id);
				const has = !!installed?.[app.id];
				const status =
					installed === null
						? t("quick.ai.status.checking")
						: has
							? t("quick.ai.status.installed")
							: t("quick.ai.status.missing");
				return (
					<div key={app.id} className="flex items-center gap-3">
						<span className="w-6 flex-none text-center text-[18px]">{app.emoji}</span>
						<div className="flex min-w-0 flex-1 flex-col">
							<span className="text-[13px] font-[650]">{app.name}</span>
							<span className={has ? "text-[11.5px] text-ok" : "text-[11.5px] text-text-faint"}>{status}</span>
						</div>
						<Segmented<AiMode>
							value={mode}
							options={MODES.map((m) => ({ value: m, label: t(`quick.ai.mode.${m}`) }))}
							onChange={(value) => setSetting(aiModes, { ...modes, [app.id]: value })}
						/>
					</div>
				);
			})}
			<Desc>{t("quick.ai.hint")}</Desc>
		</Block>
	);
}
