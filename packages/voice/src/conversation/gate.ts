/**
 * Decides how much of the model's streamed text reaches the page, so writing never stops mid-word or
 * mid-thought:
 * - open: everything goes straight in
 * - word: finish the current word, then hold the rest (you started talking over the agent)
 * - sentence: finish the current sentence, then stop (a new instruction takes over after it)
 */
export type GateMode = "open" | "word" | "sentence";

const WORD_END = /[\s.,;:!?…)\]"”’]/;
const SENTENCE_END = /[.!?…]["”’)\]]*(?=\s|$)/;

export class BoundaryGate {
  private mode: GateMode = "open";
  private held = "";
  /** In word mode: the boundary has been reached and everything after it is held. */
  private parked = false;
  /** In sentence mode: the sentence finished; nothing more is written. */
  done = false;
  /** Whether anything has been written since the gate last opened (a new stream starts at a boundary). */
  private midWord = false;

  get state(): GateMode {
    return this.mode;
  }

  /** Text held back while paused. */
  get pending(): string {
    return this.held;
  }

  /** Holding: the current word is finished and nothing more is being written. */
  get holding(): boolean {
    return this.mode === "word" && this.parked;
  }

  set(mode: GateMode) {
    if (this.done) return;
    this.mode = mode;
    if (mode === "word") this.parked = !this.midWord;
  }

  /** Feed a chunk; returns what to write now and whether the stream should stop. */
  feed(chunk: string): { write: string; stop: boolean } {
    if (this.done) return { write: "", stop: true };
    this.held += chunk;
    let write = "";
    if (this.mode === "open") {
      write = this.held;
      this.held = "";
    } else if (this.mode === "word") {
      if (!this.parked) {
        const i = this.held.search(WORD_END);
        if (i >= 0) {
          write = this.held.slice(0, i);
          this.held = this.held.slice(i);
          this.parked = true;
        } else {
          write = this.held;
          this.held = "";
        }
      }
    } else {
      const m = SENTENCE_END.exec(this.held);
      if (m) {
        write = this.held.slice(0, m.index + m[0].length);
        this.held = "";
        this.done = true;
      } else {
        write = this.held;
        this.held = "";
      }
    }
    if (write) this.midWord = !WORD_END.test(write.at(-1)!);
    return { write, stop: this.done };
  }

  /** Back to writing: returns the held text to write now. */
  release(): string {
    const out = this.held;
    this.held = "";
    this.mode = "open";
    this.parked = false;
    if (out) this.midWord = !WORD_END.test(out.at(-1)!);
    return out;
  }
}
