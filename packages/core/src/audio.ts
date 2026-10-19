/**
 * The three sounds the product is allowed to make.
 *
 * Scoped to cues rather than filenames or URLs: which asset plays is an
 * adapter concern, and the domain should be able to say "the focus block just
 * finished" without knowing whether that is an mp3, a data URI, or nothing on
 * a platform with no audio.
 */
export type AudioCue = 'start' | 'focusEnd' | 'breakEnd'

/**
 * Sound, as a port.
 */
export interface Audio {
  /**
   * Releases the audio context from its suspended state.
   *
   * Browsers refuse to start audio before a user gesture, so this must be
   * called from a real interaction (the first tap on Start) or every later
   * `play()` fails silently — the timer would appear to run with the user
   * waiting for a sound that can never arrive.
   *
   * Adapters must treat an inability to unlock as success, not failure.
   */
  unlock(): Promise<void>

  /** Plays a cue. Resolves without throwing where audio is unavailable. */
  play(cue: AudioCue): Promise<void>
}
