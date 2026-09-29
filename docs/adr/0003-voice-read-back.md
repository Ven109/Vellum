# ADR 0003 — Reading the draft aloud when the screen is off

- **Status:** Accepted
- **Work item:** VEL-47 (voice on mobile and hands-free sessions)

## Context

The obvious use for voice mode is talking a piece through while walking, with the phone in a pocket and
the screen off. In a normal session you watch the draft write itself and steer it. With the screen off
you can't see it, so you can't tell whether the agent understood you, or what to say next.

The options were:

1. Never read the draft aloud. You'd have to take the phone out to check anything.
2. Always read it aloud. That's noisy and slow when you can see the screen, and it would talk over you
   at a desk.
3. Read new writing aloud only in a hands-free session, and only while the screen is off.

## Decision

**Option 3.** In a hands-free session:

- While the screen is **on**, the agent only speaks its short replies ("Under 800 words, noted."). You
  read the draft.
- While the screen is **off** (the page is hidden), each piece of writing is **read aloud when it lands
  in the document**, in the chosen voice. Only what's new is read: your paragraph lands and you hear it.
- **Talking over it stops it at once.** This is the same barge-in as the rest of voice mode, so
  listening back never blocks steering.
- It can be turned off (Settings → Voice mode → "Read new writing aloud when the screen is off"). Then
  the session still carries on and writes, but silently.

Hands-free is on automatically for phones and tablets (coarse pointers). It can be set to Always or
Never, and switched from the voice screen. Outside hands-free, sessions end when Vellum loses focus
(ADR-level privacy default; see docs/voice.md). Hands-free is the explicit exception: the lock-screen
controls and the wake lock make it obvious the microphone is still live.

## Consequences

- Hands-free needs a working reply voice. The system voice works with no setup and speaks on the device.
- Read-back uses the reply voice's provider, which gets the text of new writing. The privacy panel says
  so. In local-only mode the system voice is used, so nothing leaves the device.
- Platforms decide whether a hidden page may keep the microphone. Where the OS suspends it (iOS may, on
  a phone call or after a long lock), the session reports that the microphone was paused and picks up
  again when it can, rather than failing silently.
