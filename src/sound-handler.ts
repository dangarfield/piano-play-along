import * as Tone from 'tone';
import type { NoteGroup } from './shared/types';

export class SoundHandler {
  private sampler: Tone.Sampler | null = null;
  private isLoaded: boolean = false;
  private activeNotes: Set<string> = new Set();

  async initialize(): Promise<void> {
    // Create sampler with piano samples
    this.sampler = new Tone.Sampler({
      urls: {
        A0: "A0.mp3",
        C1: "C1.mp3",
        "D#1": "Ds1.mp3",
        "F#1": "Fs1.mp3",
        A1: "A1.mp3",
        C2: "C2.mp3",
        "D#2": "Ds2.mp3",
        "F#2": "Fs2.mp3",
        A2: "A2.mp3",
        C3: "C3.mp3",
        "D#3": "Ds3.mp3",
        "F#3": "Fs3.mp3",
        A3: "A3.mp3",
        C4: "C4.mp3",
        "D#4": "Ds4.mp3",
        "F#4": "Fs4.mp3",
        A4: "A4.mp3",
        C5: "C5.mp3",
        "D#5": "Ds5.mp3",
        "F#5": "Fs5.mp3",
        A5: "A5.mp3",
        C6: "C6.mp3",
        "D#6": "Ds6.mp3",
        "F#6": "Fs6.mp3",
        A6: "A6.mp3",
        C7: "C7.mp3",
        "D#7": "Ds7.mp3",
        "F#7": "Fs7.mp3",
        A7: "A7.mp3",
        C8: "C8.mp3"
      },
      release: 1,
      baseUrl: "https://tonejs.github.io/audio/salamander/"
    }).toDestination();

    await Tone.loaded();
    this.isLoaded = true;
    console.log('Piano sampler loaded');
  }

  private midiToNoteName(midiNote: number): string {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(midiNote / 12) - 1;
    const noteName = noteNames[midiNote % 12];
    return `${noteName}${octave}`;
  }

  async playNoteGroup(noteGroup: NoteGroup): Promise<void> {
    if (!this.sampler || !this.isLoaded) {
      console.warn('Sampler not loaded yet');
      return;
    }

    // Ensure audio context is running
    if (Tone.context.state !== 'running') {
      await Tone.start();
    }

    console.log('Playing note group:', noteGroup.notes.map(n => ({
      pitch: n.pitch,
      noteName: this.midiToNoteName(n.pitch),
      hand: n.hand,
      duration: n.duration,
      velocity: n.velocity,
      isTied: n.isTied
    })));

    // Play all notes in the group
    noteGroup.notes.forEach(note => {
      const noteName = this.midiToNoteName(note.pitch);
      const duration = note.duration * 2; // Scale duration for playback

      this.sampler!.triggerAttackRelease(noteName, duration, undefined, note.velocity);
      this.activeNotes.add(noteName);

      // Remove from active notes after release
      setTimeout(() => {
        this.activeNotes.delete(noteName);
      }, duration * 1000);
    });
  }

  stopAllNotes(): void {
    if (!this.sampler || !this.isLoaded) return;

    this.sampler.releaseAll();
    this.activeNotes.clear();
  }
}
