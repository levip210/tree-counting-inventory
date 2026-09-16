let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  audioCtx ||= new AC();
  return audioCtx;
}

export function beep(ok: boolean) {
  const ac = ctx();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = ok ? 880 : 196;
  gain.gain.value = 0.05;
  osc.connect(gain);
  gain.connect(ac.destination);
  const now = ac.currentTime;
  osc.start(now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (ok ? 0.09 : 0.22));
  osc.stop(now + (ok ? 0.1 : 0.24));
}

export function vibrate(ok: boolean) {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  navigator.vibrate(ok ? 25 : [70, 40, 70]);
}

export function playFeedback(ok: boolean, sound: boolean, vibe: boolean) {
  if (sound) beep(ok);
  if (vibe) vibrate(ok);
}
