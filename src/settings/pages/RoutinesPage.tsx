/**
 * Profiles and routines: which modules each profile shows and when it
 * switches itself on, plus the ready-made routines (morning briefing, the
 * way to school or work followed live, calmer evenings).
 */
import { Card, Collapsible, Row } from "../../components/ui/card";
import { Input, Segmented, Select } from "../../components/ui/form";
import { cn } from "../../core/cn";
import { useLocale, useT } from "../../core/i18n";
import {
	PROFILE_EMOJI,
	PROFILE_IDS,
	type ProfileId,
	profileActive,
	profileModules,
	profileQuiet,
	profileSchedule,
	type Schedule,
} from "../../core/profiles";
import { moduleEnabled, readSetting, type SettingDef, setSetting } from "../../core/settings";
import { modules } from "../../modules";
import { BRIEFING_NOW, briefingModule } from "../../modules/briefing";
import { type CommuteRoutine, routineCommute, routineEvening } from "../../modules/routines/engine";
import type { Station } from "../../modules/transit/common";
import { Lead, Title } from "../components/Heading";
import { Toggle } from "../components/Toggle";

const favorites: SettingDef<{ from: Station; to: Station }[]> = {
	key: "transit.favorites",
	label: "transit.favorites",
	default: [],
};
const currentRoute: SettingDef<{ from: Station | null; to: Station | null }> = {
	key: "transit.route",
	label: "transit.view.connections",
	default: { from: null, to: null },
};

/** Mo … So, in the UI language, Monday first. */
function useWeekdays() {
	const locale = useLocale();
	const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
	// 2024-01-01 was a Monday.
	return [1, 2, 3, 4, 5, 6, 0].map((day) => ({ day, label: fmt.format(new Date(2024, 0, day === 0 ? 7 : day)) }));
}

function Days({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
	const days = useWeekdays();
	return (
		<div className="flex gap-1">
			{days.map(({ day, label }) => {
				const on = value.includes(day);
				return (
					<button
						type="button"
						key={day}
						className={cn(
							"h-7 min-w-9 rounded-[8px] px-1.5 text-[12px] font-semibold transition-[background]",
							on ? "bg-white/16 text-text" : "bg-white/4 text-text-faint hover:bg-white/8",
						)}
						onClick={() => onChange(on ? value.filter((d) => d !== day) : [...value, day])}
					>
						{label}
					</button>
				);
			})}
		</div>
	);
}

function Time({ value, onChange }: { value: string; onChange: (v: string) => void }) {
	return (
		<Input
			type="time"
			className="w-28 [color-scheme:dark]"
			value={value}
			onChange={(e) => e.target.value && onChange(e.target.value)}
		/>
	);
}

/** Modules that can be picked for a profile (not the island's own parts). */
const pickable = modules.filter((m) => !m.partOf && !m.system);

function ProfileCard({ id, values }: { id: ProfileId; values: Record<string, unknown> }) {
	const t = useT();
	const all = readSetting(values, profileModules);
	const shown = all[id] ?? [];
	const schedules = readSetting(values, profileSchedule);
	const schedule = schedules[id];
	const quiet = readSetting(values, profileQuiet);
	const setSchedule = (next: Schedule | undefined) => setSetting(profileSchedule, { ...schedules, [id]: next });

	return (
		<Collapsible title={t(`profiles.name.${id}`)} icon={<span className="text-[15px]">{PROFILE_EMOJI[id]}</span>}>
			<Row label={t("profiles.modules")} desc={t("profiles.modulesDesc")} />
			<div className="flex flex-wrap gap-1.5 pb-3">
				{pickable.map((m) => {
					const on = shown.includes(m.id);
					return (
						<button
							type="button"
							key={m.id}
							className={cn(
								"flex h-7.5 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold transition-[background]",
								on ? "bg-white/14 text-text" : "bg-white/4 text-text-faint hover:bg-white/8",
							)}
							onClick={() =>
								setSetting(profileModules, { ...all, [id]: on ? shown.filter((x) => x !== m.id) : [...shown, m.id] })
							}
						>
							<span className={cn("grid place-items-center", !on && "opacity-50")}>{m.settingsIcon}</span>
							{t(m.title)}
						</button>
					);
				})}
			</div>
			<Row as="label" label={t("profiles.quiet")} desc={t("profiles.quietDesc")}>
				<Toggle
					checked={quiet.includes(id)}
					onChange={(on) => setSetting(profileQuiet, on ? [...quiet, id] : quiet.filter((x) => x !== id))}
				/>
			</Row>
			<Row as="label" label={t("profiles.auto")} desc={t("profiles.autoDesc")}>
				<Toggle
					checked={!!schedule}
					onChange={(on) =>
						setSchedule(
							on
								? {
										days: [1, 2, 3, 4, 5],
										from: id === "school" ? "07:00" : "18:00",
										to: id === "school" ? "17:00" : "22:00",
									}
								: undefined,
						)
					}
				/>
			</Row>
			{schedule && (
				<div className="flex flex-wrap items-center gap-2 pb-3">
					<Days value={schedule.days} onChange={(days) => setSchedule({ ...schedule, days })} />
					<Time value={schedule.from} onChange={(from) => setSchedule({ ...schedule, from })} />
					<span className="text-text-faint">–</span>
					<Time value={schedule.to} onChange={(to) => setSchedule({ ...schedule, to })} />
				</div>
			)}
		</Collapsible>
	);
}

function CommuteCard({ values }: { values: Record<string, unknown> }) {
	const t = useT();
	const commute = readSetting(values, routineCommute);
	const set = (next: Partial<CommuteRoutine>) => setSetting(routineCommute, { ...commute, ...next });
	const current = readSetting(values, currentRoute);
	const routes = [
		...(current.from && current.to ? [{ from: current.from, to: current.to }] : []),
		...readSetting(values, favorites),
		...(commute.route ? [commute.route] : []),
	].filter((r, i, list) => list.findIndex((x) => x.from.id === r.from.id && x.to.id === r.to.id) === i);
	const key = (r: { from: Station; to: Station }) => `${r.from.id}>${r.to.id}`;

	return (
		<>
			<Row as="label" label={`🚆 ${t("routines.commute.label")}`} desc={t("routines.commute.desc")}>
				<Toggle checked={commute.on} onChange={(on) => set({ on, route: commute.route ?? routes[0] ?? null })} />
			</Row>
			{commute.on && (
				<div className="flex flex-col gap-2 pb-3">
					{routes.length === 0 ? (
						<span className="text-[12.5px] text-warn">{t("routines.commute.noRoute")}</span>
					) : (
						<Select
							value={commute.route ? key(commute.route) : ""}
							onChange={(e) => set({ route: routes.find((r) => key(r) === e.target.value) ?? null })}
						>
							{routes.map((r) => (
								<option key={key(r)} value={key(r)}>
									{r.from.name} → {r.to.name}
								</option>
							))}
						</Select>
					)}
					<div className="flex flex-wrap items-center gap-2">
						<Days value={commute.days} onChange={(days) => set({ days })} />
						<Time value={commute.time} onChange={(time) => set({ time })} />
					</div>
				</div>
			)}
		</>
	);
}

export function RoutinesPage({ values }: { values: Record<string, unknown> }) {
	const t = useT();
	const active = readSetting(values, profileActive);
	const evening = readSetting(values, routineEvening);
	const briefing = moduleEnabled(briefingModule);

	return (
		<>
			<Title>{t("profiles.page")}</Title>
			<Lead>{t("profiles.lead")}</Lead>
			<Card>
				<Row label={t("profiles.title")} desc={t("profiles.activeDesc")}>
					<Segmented
						options={[
							{ value: "all", label: t("profiles.all") },
							...PROFILE_IDS.map((id) => ({ value: id, label: `${PROFILE_EMOJI[id]} ${t(`profiles.name.${id}`)}` })),
						]}
						value={active ?? "all"}
						onChange={(v) => setSetting(profileActive, v === "all" ? null : (v as ProfileId))}
					/>
				</Row>
			</Card>
			{PROFILE_IDS.map((id) => (
				<ProfileCard key={id} id={id} values={values} />
			))}

			<Title>{t("routines.title")}</Title>
			<Card>
				<Row label={`☀️ ${t("briefing.label")}`} desc={t("briefing.desc")}>
					<div className="flex flex-none items-center gap-3">
						<button
							type="button"
							className="rounded-[9px] bg-white/8 px-3 py-1.5 text-[12px] font-semibold hover:bg-white/12"
							onClick={(e) => {
								e.preventDefault();
								setSetting(BRIEFING_NOW, Date.now());
							}}
						>
							{t("briefing.showNow")}
						</button>
						<Toggle checked={readSetting(values, briefing)} onChange={(on) => setSetting(briefing, on)} />
					</div>
				</Row>
				<CommuteCard values={values} />
				<Row as="label" label={`🌙 ${t("routines.evening.label")}`} desc={t("routines.evening.desc")}>
					<Toggle checked={evening.on} onChange={(on) => setSetting(routineEvening, { ...evening, on })} />
				</Row>
				{evening.on && (
					<div className="flex items-center gap-2 pb-3">
						<Time value={evening.from} onChange={(from) => setSetting(routineEvening, { ...evening, from })} />
						<span className="text-text-faint">–</span>
						<Time value={evening.to} onChange={(to) => setSetting(routineEvening, { ...evening, to })} />
					</div>
				)}
			</Card>
		</>
	);
}
