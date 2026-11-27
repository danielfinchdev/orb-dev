// Records the microphone for the dictation button and gives the speech as a mono 16 kHz WAV in base64 (what the engine's
// Whisper reads). MediaRecorder captures; the browser decodes and resamples, so no audio worklet is needed.
import { quiet } from './quiet.js';
import { downmix, encodeWav, WAV_RATE, MAX_SECONDS } from '../../shared/wav.mjs';

const toBase64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// → { stop(): Promise<base64 WAV>, cancel() }. onLimit runs when MAX_SECONDS pass (the caller then stops it).
export async function startRecording({ onLimit } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  const release = () => stream.getTracks().forEach((t) => t.stop());
  const limit = setTimeout(() => onLimit?.(), MAX_SECONDS * 1000);
  recorder.start(1000);
  return {
    stop: () => new Promise((resolve, reject) => {
      clearTimeout(limit);
      recorder.onstop = async () => {
        release();
        let ctx;
        try {
          ctx = new AudioContext({ sampleRate: WAV_RATE });
          const audio = await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer());
          const mono = downmix(Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i)));
          resolve(toBase64(encodeWav(mono.subarray(0, MAX_SECONDS * WAV_RATE))));
        } catch (error) { reject(error); } finally { ctx?.close().catch(quiet); }
      };
      if (recorder.state === 'inactive') recorder.onstop(); else recorder.stop();
    }),
    cancel: () => { clearTimeout(limit); recorder.onstop = null; try { recorder.stop(); } catch { /* already stopped */ } release(); }
  };
}
