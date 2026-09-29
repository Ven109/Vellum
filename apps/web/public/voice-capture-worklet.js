// Runs on the audio thread: forwards the microphone's samples (mixed to mono) to the page in small
// batches. Resampling, framing and voice detection happen on the page (see src/voice/capture.ts).
class VellumCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batch = [];
    this.size = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (channels && channels.length) {
      const n = channels[0].length;
      const mono = new Float32Array(n);
      for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / channels.length;
      this.batch.push(mono);
      this.size += n;
      // ~5 ms at 48 kHz: small enough to keep end-of-turn detection quick.
      if (this.size >= 256) {
        const out = new Float32Array(this.size);
        let at = 0;
        for (const b of this.batch) {
          out.set(b, at);
          at += b.length;
        }
        this.port.postMessage({ samples: out, time: currentTime }, [out.buffer]);
        this.batch = [];
        this.size = 0;
      }
    }
    return true;
  }
}

registerProcessor("vellum-capture", VellumCapture);
