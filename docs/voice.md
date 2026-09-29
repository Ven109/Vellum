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

## Speech providers

Voice mode uses your own keys, the same way the writing assistant does. Choose providers in
**Settings → Voice mode**. Keys go into the same key vault as your AI provider keys (the OS keychain in
the desktop app) and are sent only to the provider they belong to.

**Speech recognition**

| Provider            | How                                                                                                                      | Key      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| OpenAI (Whisper)    | Each turn is sent as a WAV file when you stop speaking (`gpt-4o-mini-transcribe` by default)                             | Required |
| Deepgram            | Streams while you speak over one WebSocket; words appear as you say them. Only speech is sent, never the silence between | Required |
| whisper.cpp (local) | Each turn goes to `whisper-server` on your machine (default `http://127.0.0.1:8080`). Audio never leaves it              | None     |

Each turn includes 300 ms of audio from before speech was detected, so first syllables aren't clipped.

**Voice** (how the agent talks back)

| Provider     | Voices                                                            | Key      |
| ------------ | ----------------------------------------------------------------- | -------- |
| System voice | Your device's built-in voices (Web Speech API); the default       | None     |
| OpenAI       | Alloy, Ash, Ballad, Coral, Echo, Fable, Nova, Onyx, Sage, Shimmer | Required |
| ElevenLabs   | Your voice library, including cloned voices                       | Required |

**Preview** plays a short sample in the chosen voice.

Every provider is an adapter behind one interface in `packages/voice/src/speech`: `createRecognizer()`
for speech-to-text and `createSynthesizer()` for text-to-speech. Adding a provider is a new adapter plus
a preset; nothing else in the app changes.

## The conversation loop

Each turn you speak is sorted before anything touches the document (`packages/voice/src/conversation`):

| What you said                                        | Kind       | What happens                                                                             |
| ---------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| "Every workshop has one tool nobody talks about."    | content    | Drafted into the piece. Your points are kept, and the wording is smoothed where it helps |
| "Start with: every workshop has one tool…"           | content    | Those exact words go in, at the start                                                    |
| "Keep it under 800 words." "Make it warmer."         | constraint | Becomes a chip you can edit or remove, and applies to all writing from then on           |
| "Make the opening punchier." "Add a bit on pricing." | steering   | The agent revises or writes as asked                                                     |
| "I'm writing an essay for new woodworkers."          | brief      | Sets what the piece is and who it's for. The first brief starts the draft                |
| "Hmm, where was I."                                  | thinking   | Nothing is written                                                                       |

A turn can mix kinds, and each sentence is handled on its own. A new constraint replaces an earlier one
of the same kind: "under 600 words" replaces "under 800 words".

Sorting uses your own AI provider when one is set up. If it takes longer than 2.5 s, fails, or returns
something unusable, local rules take over. Those rules also run on their own when there's no provider.
Either way, constraints are read locally, so a chip always shows the same thing for the same words.

## A voice session

Open a document and choose **Voice** in the top bar, or run "Talk it through" from the command palette.
Then choose **Start talking**. The screen has three parts:

- **Voice stack**: the microphone, the speech recognition provider, the writing model and the voice, and
  how quickly Vellum reacted to your turns (95th percentile, against the 300 ms budget).
- **Conversation**: your turns and Vellum's replies, each labelled with what it was taken as (for the
  page, constraint, instruction, brief, thinking aloud). A line shows the words being heard while you
  talk. Constraints appear as chips at the top: click one to correct it, or × to drop it.
- **The document**, writing itself. **Agent writing** shows while text is going in.
  - **Pause writing** stops writing but keeps listening. **Resume writing** carries on.
  - **Take over** stops writing and puts your cursor at the end, so you can type.

If you give an instruction while the agent is writing, a card asks what to do: **Apply now**,
**Queue it** or **Ignore**.

Without an AI provider, voice mode still writes down what you say, but it can't draft or revise.

## Writing into the live document

The agent writes into the real document, word by word as the model streams, and you can keep typing
anywhere else in it at the same time.

- Text the agent is still writing is highlighted. The highlight comes off once the text settles.
- **If you type in the paragraph the agent is writing, it yields**: it stops there, keeps what it had
  written, and says so. Say "carry on" when you want it to continue. A collaborator editing that
  paragraph has the same effect.
- History records your work and the agent's separately. Before each piece of agent writing, your own
  changes are saved as a checkpoint. Afterwards, the agent's writing is saved as an **Assistant edit**
  that names the model and who asked for it. Agent writing never ends up in your own autosaves, and
  never in your undo history.

## Interrupting

You can cut in at any time, and you'll be obeyed.

- **Talking over the agent** stops its voice at once. Writing pauses at the end of the word it's on,
  never mid-word. Whatever the model sends meanwhile is held.
- If what you said was just talk or thinking aloud, writing picks up where it paused.
- **A new instruction while it's writing** brings up a card: **Apply now**, **Queue it** or **Ignore**.
  - If you don't choose, the instruction is applied **after the current sentence**: the sentence is
    finished, the rest of that draft is dropped, and your instruction runs. A thought is never left
    half-written.
  - **Apply now** stops at the next word boundary and runs your instruction.
  - **Queue it** lets the current writing finish first.
  - **Ignore** carries on as if you hadn't said it.
- **Pause writing** and **Take over** hand control back without ending the session. The agent keeps
  listening.

## The transcript

Each document keeps its voice transcript with it. The transcript lives in the document's CRDT (a
`voice` map next to the text), so it syncs, works offline, and goes wherever the document goes.

- It holds every turn, yours and the agent's, with the time it was said, plus the brief and the
  constraints as they stand.
- Opening the voice screen shows the conversation so far, even before you start talking. A new session
  picks up the brief and constraints from last time.
- Paragraphs the agent writes remember the turn that produced them. On the voice screen, clicking one
  highlights that turn, and clicking a turn highlights its paragraphs. In the editor, hovering one shows
  what you said, and when. A revised paragraph points to the instruction that changed it.
- None of this goes into Markdown exports. The text stays plain.

## Privacy

Voice raises questions text doesn't, so here are the plain answers. **Settings → Voice mode → Privacy**
shows them for the providers you've chosen.

- **Vellum never records or stores audio.** Audio goes from your microphone straight to the speech
  recognition provider you chose, and nowhere else. Only the text of the conversation is kept, with the
  document. **Delete transcript** on the voice screen removes it; the text written from it stays.
- **Where audio goes** is shown before you start, and in the voice stack while a session runs:
  - OpenAI: one clip per turn to `api.openai.com`.
  - Deepgram: streamed to `api.deepgram.com` while you speak.
  - whisper.cpp: your own machine.

  Reply voices get the text of replies, never your audio.

- **What providers keep**:
  - OpenAI doesn't train on API audio. It may keep requests for up to 30 days for abuse monitoring,
    unless your organisation has zero data retention.
  - **No retention is the default** where a provider offers it. Every Deepgram session opts out of its
    model improvement programme (`mip_opt_out`).
  - ElevenLabs zero-retention mode (`enable_logging=false`) is available as a switch, but only works
    on its enterprise plans.
- **Local only**: whisper.cpp for recognition and your device's voices for replies. No audio leaves the
  machine. A session with a cloud provider selected refuses to start rather than quietly using it.
  Self-hosters can require this for everyone by setting `VELLUM_VOICE_LOCAL_ONLY=true` on the server.
- **Mic on is unmistakable.** A red **Mic on** pill is shown and the tab title starts with "● Mic on"
  whenever the microphone is live. Muting says **Mic muted**.
- **Sessions end cleanly.** By default the session ends as soon as Vellum isn't the window in front, and
  it always ends when the tab closes or the app quits. The microphone never stays open behind your back.
- **Keyboard and screen readers**:
  - **Ctrl/⌘ Shift Space** starts and ends a session.
  - The transcript is a live log that screen readers follow, with speakers labelled.
  - The agent's state ("Listening.", "Vellum is writing.") and any errors are announced.
