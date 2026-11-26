// Mono 16 kHz 16-bit WAV: what the local speech engines read. Pure, so the window and the tests share it.
export const WAV_RATE = 16000;
// Two minutes of speech: the longest a dictation may be (the window stops there, the engine refuses more).
export const MAX_SECONDS = 120;
export const MAX_WAV_BYTES = 44 + MAX_SECONDS * WAV_RATE * 2;

// Averages the channels of a decoded recording into one (an array of Float32Array).
export function downmix(channels) {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

export function encodeWav(samples, rate = WAV_RATE) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return bytes;
}

// The header must say exactly what the engine expects, and the data must fill the file; anything else is refused.
export function checkWav(buf) {
  if (!buf || buf.length < 44 || buf.length > MAX_WAV_BYTES) return false;
  const tag = (at) => buf.toString('latin1', at, at + 4);
  return tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(12) === 'fmt ' && tag(36) === 'data'
    && buf.readUInt16LE(20) === 1 && buf.readUInt16LE(22) === 1 && buf.readUInt32LE(24) === WAV_RATE && buf.readUInt16LE(34) === 16
    && buf.readUInt32LE(40) === buf.length - 44;
}
