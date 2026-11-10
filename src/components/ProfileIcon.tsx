import { BackpackIcon, Gamepad2Icon, HouseIcon } from "lucide-react";
import type { ProfileId } from "../core/profiles";

const ICONS = { school: BackpackIcon, free: HouseIcon, gaming: Gamepad2Icon } satisfies Record<ProfileId, unknown>;

/** The symbol of a profile (school, free time, gaming). */
export function ProfileIcon({ id, size = 14 }: { id: ProfileId; size?: number }) {
	const Icon = ICONS[id];
	return <Icon size={size} />;
}
