import type { NoteGroup } from './shared/types';
import { SoundHandler } from './sound-handler';
import type { RepeatHandler } from './repeat-handler';

export class PlaybackEngine {
  private soundHandler: SoundHandler;
  private isPlaying: boolean = false;
  private currentPlaybackPosition: number = 0; // Position in playback sequence
  private noteGroups: NoteGroup[] = [];
  private repeatHandler: RepeatHandler | null = null;
  private timeoutId: number | null = null;
  private onProgressCallback: ((index: number) => void) | null = null;
  private onCompleteCallback: (() => void) | null = null;
  private tempo: number = 120; // BPM, default to 120
  private tempoMultiplier: number = 1.0; // Speed multiplier
  private activeNotes: Map<number, number> = new Map(); // pitch -> 1 (just tracking presence)
  private startTime: number = 0;
  private pausedTime: number = 0;

  constructor(soundHandler: SoundHandler) {
    this.soundHandler = soundHandler;
  }

  loadScore(noteGroups: NoteGroup[], repeatHandler?: RepeatHandler): void {
    this.noteGroups = noteGroups;
    this.repeatHandler = repeatHandler || null;
    this.currentPlaybackPosition = 0;
    
    // Try to extract tempo from the score (would need to be passed in)
    // For now, use default 120 BPM
    this.tempo = 120;
  }

  setTempo(bpm: number): void {
    this.tempo = bpm;
  }

  setTempoMultiplier(multiplier: number): void {
    this.tempoMultiplier = multiplier;
  }

  async play(startIndex: number = 0): Promise<void> {
    if (this.isPlaying) return;
    
    this.isPlaying = true;
    this.currentPlaybackPosition = startIndex;
    this.activeNotes.clear();
    this.startTime = performance.now();
    this.pausedTime = 0;
    
    // Pre-calculate total durations for tied notes
    this.calculateTiedNoteDurations();
    
    await this.playNextGroup();
  }

  private calculateTiedNoteDurations(): void {
    // Mark which notes are tie continuations and calculate total durations
    const activeTies = new Map<number, number>(); // pitch -> group index where tie started
    
    for (let i = 0; i < this.noteGroups.length; i++) {
      const group = this.noteGroups[i];
      
      for (const note of group.notes) {
        if (note.isTied) {
          // Check if this pitch is already in an active tie
          if (activeTies.has(note.pitch)) {
            // This is a continuation
            (note as any).isTieContinuation = true;
          } else {
            // This is the start of a new tie
            activeTies.set(note.pitch, i);
            
            // Calculate total duration by looking through ALL subsequent groups
            let totalDuration = note.duration;
            
            for (let j = i + 1; j < this.noteGroups.length; j++) {
              const nextGroup = this.noteGroups[j];
              const tiedNote = nextGroup.notes.find(n => n.pitch === note.pitch);
              
              if (tiedNote && tiedNote.isTied) {
                // Found a continuation
                totalDuration += tiedNote.duration;
              } else if (tiedNote && !tiedNote.isTied) {
                // Found the end of the tie (note exists but not tied)
                break;
              }
              // If note doesn't exist in this group, keep looking
            }
            
            (note as any).totalDuration = totalDuration;
          }
        } else {
          // Not tied - clear this pitch from active ties
          activeTies.delete(note.pitch);
        }
      }
    }
  }

  private async playNextGroup(): Promise<void> {
    const sequenceLength = this.repeatHandler 
      ? this.repeatHandler.getSequenceLength() 
      : this.noteGroups.length;
    
    if (!this.isPlaying || this.currentPlaybackPosition >= sequenceLength) {
      this.stop();
      if (this.onCompleteCallback) {
        this.onCompleteCallback();
      }
      return;
    }

    // Get the actual note group index from the playback sequence
    const noteGroupIndex = this.repeatHandler
      ? this.repeatHandler.getNoteGroupIndexForPosition(this.currentPlaybackPosition)
      : this.currentPlaybackPosition;
    
    if (noteGroupIndex < 0 || noteGroupIndex >= this.noteGroups.length) {
      this.currentPlaybackPosition++;
      await this.playNextGroup();
      return;
    }
    
    const currentGroup = this.noteGroups[noteGroupIndex];
    
    // Use tempo from the note group if available
    const tempo = currentGroup.tempo || this.tempo;
    
    // Notify progress with the note group index (for cursor positioning)
    if (this.onProgressCallback) {
      this.onProgressCallback(noteGroupIndex);
    }

    // Play notes in the current group, handling ties
    await this.playNoteGroupWithTies(currentGroup, tempo);

    // Calculate when the next group should play using absolute time positions
    let delay = 0;
    const nextPlaybackPosition = this.currentPlaybackPosition + 1;
    
    if (nextPlaybackPosition < sequenceLength) {
      const nextNoteGroupIndex = this.repeatHandler
        ? this.repeatHandler.getNoteGroupIndexForPosition(nextPlaybackPosition)
        : nextPlaybackPosition;
      
      if (nextNoteGroupIndex >= 0 && nextNoteGroupIndex < this.noteGroups.length) {
        const nextGroup = this.noteGroups[nextNoteGroupIndex];
        
        // Calculate delay based on absolute time difference
        if (currentGroup.absoluteTime !== undefined && nextGroup.absoluteTime !== undefined) {
          // Check if we're jumping (non-sequential note group indices or going backward)
          const isJump = (nextNoteGroupIndex !== noteGroupIndex + 1);
          
          if (isJump) {
            // We're jumping (repeat or volta skip) - use the longest duration of the current note group
            // to ensure all notes finish playing before jumping
            let longestDuration = 0;
            for (const note of currentGroup.notes) {
              const noteDuration = (note as any).totalDuration || note.duration;
              longestDuration = Math.max(longestDuration, noteDuration);
            }
            const msPerQuarterNote = 60000 / tempo;
            delay = longestDuration * msPerQuarterNote * 4 / this.tempoMultiplier;
          } else {
            // Normal sequential progression
            const timeDiff = nextGroup.absoluteTime - currentGroup.absoluteTime;
            const msPerQuarterNote = 60000 / tempo;
            delay = timeDiff * msPerQuarterNote * 4 / this.tempoMultiplier; // Apply tempo multiplier
          }
        } else {
          // Fallback to shortest duration
          let shortestDuration = Infinity;
          for (const note of currentGroup.notes) {
            if (!note.isTied || !this.activeNotes.has(note.pitch)) {
              shortestDuration = Math.min(shortestDuration, note.duration);
            }
          }
          
          if (shortestDuration === Infinity) {
            shortestDuration = 0.01;
          }
          
          const msPerQuarterNote = 60000 / tempo;
          delay = shortestDuration * msPerQuarterNote * 4 / this.tempoMultiplier;
        }
      }
    }

    this.currentPlaybackPosition++;

    // Schedule next group
    this.timeoutId = window.setTimeout(() => {
      this.playNextGroup();
    }, delay);
  }

  private async playNoteGroupWithTies(noteGroup: NoteGroup, tempo: number): Promise<void> {
    const msPerQuarterNote = 60000 / tempo;

    for (const note of noteGroup.notes) {
      // Skip if this is a tie continuation
      if ((note as any).isTieContinuation) {
        continue;
      }
      
      // Play the note
      const playDuration = (note as any).totalDuration || note.duration;
      const duration = playDuration * msPerQuarterNote * 4 / this.tempoMultiplier / 1000; // Apply tempo multiplier, convert to seconds
      await this.soundHandler.playNote(note.pitch, duration, note.velocity);
    }
  }

  stop(): void {
    this.isPlaying = false;
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    
    // Clear all active tied notes
    this.activeNotes.clear();
    
    this.soundHandler.stopAllNotes();
  }

  pause(): void {
    this.isPlaying = false;
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  resume(): void {
    if (!this.isPlaying && this.currentPlaybackPosition < (this.repeatHandler ? this.repeatHandler.getSequenceLength() : this.noteGroups.length)) {
      this.play(this.currentPlaybackPosition);
    }
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  getCurrentIndex(): number {
    // Return the note group index for compatibility
    if (this.repeatHandler) {
      return this.repeatHandler.getNoteGroupIndexForPosition(this.currentPlaybackPosition);
    }
    return this.currentPlaybackPosition;
  }

  onProgress(callback: (index: number) => void): void {
    this.onProgressCallback = callback;
  }

  onComplete(callback: () => void): void {
    this.onCompleteCallback = callback;
  }
}
