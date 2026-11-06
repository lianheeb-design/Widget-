import { BatteryChargingIcon, BatteryIcon, CalendarIcon, ThermometerIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { useProvider } from "../core/bridge";
import { currentTemperature, type IdleItem, useDesktop, useExtras } from "../core/extras";
import { useLocale } from "../core/i18n";
import { useNow } from "../modules/ai-agents/common/format";
import { CALENDAR_PROVIDER, type CalendarState } from "../modules/clock/types";

const HOUR = 3_600_000;

/** What the resting Windows Island pill shows: the items picked in Appearance. */
export function IdleInfo() {
	const locale = useLocale();
	const now = useNow(5_000);
	const { idle } = useExtras();
	const desktop = useDesktop();
	const temperature = currentTemperature.use();
	const calendar = useProvider<CalendarState>(CALENDAR_PROVIDER);
	const items: IdleItem[] = idle.length ? idle : ["clock"];

	const render = (item: IdleItem): ReactNode => {
		switch (item) {
			case "clock":
				return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(now);
			case "date":
				return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(now);
			case "weather":
				return temperature === null ? null : (
					<span className="flex items-center gap-0.5">
						<ThermometerIcon size={12} className="opacity-70" />
						{Math.round(temperature)}°
					</span>
				);
			case "battery":
				return desktop?.battery == null ? null : (
					<span className="flex items-center gap-1">
						{desktop.charging ? (
							<BatteryChargingIcon size={13} color="#30D158" />
						) : (
							<BatteryIcon size={13} className="opacity-70" />
						)}
						{desktop.battery}%
					</span>
				);
			case "event": {
				const next = calendar?.events.find((e) => !e.allDay && e.start > now && e.start - now < 12 * HOUR);
				if (!next) return null;
				const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(next.start);
				return (
					<span className="flex min-w-0 items-center gap-1">
						<CalendarIcon size={12} className="flex-none opacity-70" />
						<span className="flex-none">{time}</span>
						<span className="max-w-26 truncate font-[550] text-white/80">{next.title}</span>
					</span>
				);
			}
		}
	};

	const shown = items.map((item) => ({ item, node: render(item) })).filter((x) => x.node !== null);
	return (
		<div className="flex h-full items-center justify-center gap-2.5 px-3 text-[13.5px] font-[650] tracking-[0.01em] whitespace-nowrap tabular-nums">
			{shown.map(({ item, node }, i) => (
				<Fragment key={item}>
					{i > 0 && <span className="size-1 flex-none rounded-full bg-white/30" />}
					{node}
				</Fragment>
			))}
		</div>
	);
}
