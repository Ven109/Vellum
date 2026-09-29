# Voice mode

Voice mode lets you talk a piece through while Vellum writes it into the document. This page covers how
audio is captured and how quickly Vellum reacts. Speech providers, the conversation loop and privacy
controls are described in their own sections as they land.

## Audio capture

- The microphone is opened with the browser's **echo cancellation, noise suppression and automatic gain
  control** on, so the agent's own voice from your speakers isn't heard as you.
- An `AudioWorklet` (`apps/web/public/voice-capture-worklet.js`) forwards samples from the audio thread
  in ~5 ms batches. On the page they're mixed to mono, low-pass filtered and **resampled to 16 kHz**,
  cut into **20 ms frames**, and converted to 16-bit PCM, which is what speech providers expect.
- Pick the input in **Settings → Voice mode**. The choice is remembered on this device. Unplugging the
  microphone ends the check (or session) with a message rather than failing silently.
- If the browser blocks the microphone, Vellum says how to allow it. In the desktop app only Vellum's
  own page may use the microphone, and only for audio: camera and screen capture are always refused.
  On macOS the system asks the first time.

## Knowing when you've stopped

Turn boundaries come from voice activity detection (`packages/voice/src/vad.ts`), which runs on every
frame:

- For the first 200 ms it learns how loud the room is, and keeps adapting to it between turns.
- A turn starts after 60 ms of sound at least 12 dB above that noise floor (clicks and taps are
  ignored). Nothing quieter than −52 dBFS ever counts.
- A turn ends after **180 ms** without voice. Short pauses between words don't end it.

## The latency budget

From the moment you stop speaking to the moment the agent reacts: **300 ms**, held at the 95th
percentile. End-of-turn detection accounts for about 180–200 ms of that, which leaves roughly 100 ms for
everything after it.

Every turn is measured. **Settings → Voice mode → Test microphone** shows the time for each turn and
the 95th percentile. The end-to-end tests play recorded speech through a fake microphone and fail if a
turn takes longer than the budget.

## Streaming

Audio goes to streaming speech providers over one persistent WebSocket per session
(`packages/voice/src/transport.ts`):

- While the connection opens, audio is queued. Only the last two seconds are kept, so a stall never
  replays stale speech.
- A dropped connection is reopened with backoff (250 ms, doubling up to 5 s).
- Idle connections are kept alive with pings.
- The session closes cleanly when you end it.
