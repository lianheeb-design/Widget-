/**
 * A short three-note chime made with Web Audio, so the timer needs no sound
 * file and no backend command. The context is created on the click that
 * starts a timer: WebView2 only lets audio start after a user gesture.
 */
let context: AudioContext | null = null;

export function primeChime() {
	try {
		context ??= new AudioContext();
		if (context.state === "suspended") void context.resume();
	} catch {
		context = null;
	}
}

export function playChime() {
	if (!context) return;
	const start = context.currentTime + 0.02;
	// A rising major triad, each note a soft sine with a quick decay.
	[659.25, 830.61, 987.77].forEach((frequency, i) => {
		if (!context) return;
		const at = start + i * 0.16;
		const osc = context.createOscillator();
		const gain = context.createGain();
		osc.type = "sine";
		osc.frequency.value = frequency;
		gain.gain.setValueAtTime(0, at);
		gain.gain.linearRampToValueAtTime(0.22, at + 0.015);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
		osc.connect(gain).connect(context.destination);
		osc.start(at);
		osc.stop(at + 0.95);
	});
}
