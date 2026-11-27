export function prepareTtsText(rawText, maxChars = 900) {
  if (!rawText) return '';
  let res = String(rawText)
    .replaceAll('**', '')
    .replaceAll('__', '')
    .replaceAll('`', '')
    .replaceAll('*', '')
    .replaceAll('_', '')
    .replaceAll('<center>', '')
    .replaceAll('</center>', '')
    .replaceAll('<large>', '')
    .replaceAll('</large>', '');
  res = res.replace(/[\r\n\t]+/g, ' ').replace(/\p{C}/gu, '');
  res = res.replace(/https?:\/\/\S+/g, '').replace(/[‑–—]/g, '-').replace(/\s+/g, ' ').trim();
  if (res.length <= maxChars) return res;
  const sliced = res.slice(0, maxChars);
  const idx = sliced.lastIndexOf(' ');
  return (idx > 0 ? sliced.slice(0, idx) : sliced).trim() || sliced.trim();
}

export function decodeBase64ToUint8(base64) {
  const clean = String(base64 || '').trim();
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function rateStringToFloat(rateStr = '+0%') {
  const m = String(rateStr || '+0%').trim().match(/^([+-]?)(\d{1,3})%?$/);
  if (!m) return 1.0;
  const val = Number(m[2]) * (m[1] === '-' ? -1 : 1);
  return Math.max(0.5, Math.min(2.0, 1.0 + val / 100));
}

export function normalizeRateString(rateStr = '+0%') {
  const m = String(rateStr || '+0%').trim().match(/^([+-]?)(\d{1,3})%?$/);
  if (!m) return '+0%';
  const raw = Number(m[2]) * (m[1] === '-' ? -1 : 1);
  const clamped = Math.max(-50, Math.min(100, raw));
  return `${clamped >= 0 ? '+' : ''}${clamped}%`;
}

/**
 * Wrap raw PCM16 frames (e.g. Gemini TTS 24kHz mono L16) into a valid RIFF WAVE container (>= 128 bytes).
 */
export function wrapPcm16ToWavBytes(pcmBytes, sampleRate = 24000, channels = 1) {
  if (!(pcmBytes instanceof Uint8Array) || pcmBytes.length === 0 || pcmBytes.length % (channels * 2) !== 0) {
    throw new Error('TTS вернул некорректные PCM-данные');
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
    throw new Error(`Некорректная частота дискретизации PCM: ${sampleRate}`);
  }
  // inspectMediaBytes requires at least 128 total bytes (44 header + >= 84 bytes payload).
  const minPcmLen = 84;
  const paddedPcmLen = Math.max(pcmBytes.length, minPcmLen);
  const wav = new Uint8Array(44 + paddedPcmLen);
  const view = new DataView(wav.buffer);
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;

  wav.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  view.setUint32(4, 36 + paddedPcmLen, true);
  wav.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
  wav.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  wav.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  view.setUint32(40, paddedPcmLen, true);
  wav.set(pcmBytes, 44);
  return wav;
}
