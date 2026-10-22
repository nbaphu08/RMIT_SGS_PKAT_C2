// Sinh audio tổng hợp (dữ liệu giả, plan mục 3.1): WAV 16-bit mono, ~6 giây, < 1 MB.
// Mỗi track một vòng hợp âm khác nhau để nghe ra ngay là track nào.

const SAMPLE_RATE = 16000;
const SECONDS_PER_CHORD = 1.5;

// Tần số (Hz) của từng hợp âm, 4 hợp âm mỗi track.
const PROGRESSIONS = {
  t1: [[220, 277, 330], [196, 247, 294], [247, 311, 370], [165, 220, 262]],
  t2: [[262, 330, 392], [294, 370, 440], [330, 415, 494], [262, 330, 392]],
  t3: [[147, 185, 220], [165, 196, 247], [131, 165, 196], [110, 147, 175]],
};

/** @returns {Uint8Array} file WAV hoàn chỉnh cho track. */
export function synthTrackWav(trackId) {
  const chords = PROGRESSIONS[trackId] ?? PROGRESSIONS.t1;
  const perChord = Math.round(SAMPLE_RATE * SECONDS_PER_CHORD);
  const samples = new Int16Array(chords.length * perChord);

  chords.forEach((chord, index) => {
    for (let i = 0; i < perChord; i++) {
      const t = i / SAMPLE_RATE;
      // Gảy một nốt: to ngay rồi tắt dần.
      const envelope = Math.exp(-2.2 * t) * (1 - Math.exp(-200 * t));
      let value = 0;
      for (const freq of chord) value += Math.sin(2 * Math.PI * freq * t);
      samples[index * perChord + i] = Math.round((value / chord.length) * envelope * 28000);
    }
  });

  return wavFile(samples);
}

function wavFile(samples) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true); // kích thước khối fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte/giây
  view.setUint16(32, 2, true); // byte/khung
  view.setUint16(34, 16, true); // bit/mẫu
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);
  return bytes;
}
