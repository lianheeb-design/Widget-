/** A speech-bubble-like circle with two text lines: an original, neutral chat mark. */
export function ChatIcon({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" />
			<path d="M8 10.5h8M8 14h5" stroke={color} strokeWidth="2" strokeLinecap="round" />
		</svg>
	);
}
