import type { NoteGroup, PracticeMode, PracticeState, Note } from './shared/types';
import type { RepeatHandler } from './repeat-handler';

export class PracticeEngine {
  private state: PracticeState = {
    isPlaying: false,
    currentNoteGroupIndex: 0,
    pressedNotes: new Set(),
    correctNotesPressed: new Set(),
    score: [],
  };
  
  private practiceMode: PracticeMode = 'both';
  private repeatHandler: RepeatHandler | null = null;
  private currentPlaybackPosition: number = 0; // Position in playback sequence
  private onProgressCallback: ((state: PracticeState) => void) | null = null;
  private onAutoPlayCallback: ((notes: Note[], tempo: number) => void) | null = null;
  private onCompleteCallback: (() => void) | null = null;

  loadScore(noteGroups: NoteGroup[], repeatHandler?: RepeatHandler): void {
    this.state.score = noteGroups;
    this.repeatHandler = repeatHandler || null;
    this.currentPlaybackPosition = 0;
    this.state.currentNoteGroupIndex = this.getCurrentNoteGroupIndex();
    this.state.pressedNotes.clear();
    this.state.correctNotesPressed.clear();
    console.log(`Loaded score with ${noteGroups.length} note groups`);
    
    // Debug: log first few note groups
    console.log('First 5 note groups:', noteGroups.slice(0, 5).map(g => ({
      timestamp: g.timestamp,
      measure: g.measureIndex,
      notes: g.notes.map(n => ({ pitch: n.pitch, hand: n.hand }))
    })));
  }

  setPracticeMode(mode: PracticeMode): void {
    this.practiceMode = mode;
    this.reset();
    // Skip empty groups at the start
    this.skipEmptyGroups();
  }

  start(): void {
    this.state.isPlaying = true;
    // Skip empty groups when starting
    this.skipEmptyGroups();
    this.notifyProgress();
  }

  pause(): void {
    this.state.isPlaying = false;
    this.notifyProgress();
  }

  reset(): void {
    this.currentPlaybackPosition = 0;
    this.state.currentNoteGroupIndex = this.getCurrentNoteGroupIndex();
    this.state.pressedNotes.clear();
    this.state.correctNotesPressed.clear();
    this.notifyProgress();
  }

  jumpToNoteGroup(index: number): void {
    if (index >= 0 && index < this.state.score.length) {
      // Find the playback position for this note group index
      if (this.repeatHandler) {
        const position = this.repeatHandler.getPositionForNoteGroupIndex(index);
        if (position >= 0) {
          this.currentPlaybackPosition = position;
        }
      } else {
        this.currentPlaybackPosition = index;
      }
      this.state.currentNoteGroupIndex = index;
      this.state.pressedNotes.clear();
      this.state.correctNotesPressed.clear();
      // Skip empty groups after jumping
      this.skipEmptyGroups();
      this.notifyProgress();
    }
  }

  private getCurrentNoteGroupIndex(): number {
    if (this.repeatHandler) {
      return this.repeatHandler.getNoteGroupIndexForPosition(this.currentPlaybackPosition);
    }
    return this.currentPlaybackPosition;
  }

  private skipEmptyGroups(): void {
    const sequenceLength = this.repeatHandler 
      ? this.repeatHandler.getSequenceLength() 
      : this.state.score.length;
    
    while (this.currentPlaybackPosition < sequenceLength) {
      const noteGroupIndex = this.getCurrentNoteGroupIndex();
      if (noteGroupIndex < 0 || noteGroupIndex >= this.state.score.length) {
        this.currentPlaybackPosition++;
        continue;
      }
      
      const currentGroup = this.state.score[noteGroupIndex];
      const expectedNotes = this.getExpectedNotes(currentGroup);
      
      if (expectedNotes.length > 0) {
        this.state.currentNoteGroupIndex = noteGroupIndex;
        break; // Found a group with notes for this hand
      }
      
      this.currentPlaybackPosition++;
    }
    
    // Update state with current note group index
    this.state.currentNoteGroupIndex = this.getCurrentNoteGroupIndex();
  }

  handleNoteOn(midiNote: number): void {
    if (!this.state.isPlaying) return;

    this.state.pressedNotes.add(midiNote);
    this.checkProgress();
    this.notifyProgress();
  }

  handleNoteOff(midiNote: number): void {
    this.state.pressedNotes.delete(midiNote);
    this.state.correctNotesPressed.delete(midiNote);
    this.notifyProgress();
  }

  private checkProgress(): void {
    if (this.state.currentNoteGroupIndex >= this.state.score.length || this.state.currentNoteGroupIndex < 0) {
      return; // Finished or invalid index
    }

    const currentGroup = this.state.score[this.state.currentNoteGroupIndex];
    if (!currentGroup) {
      return; // Invalid group
    }
    
    const expectedNotes = this.getExpectedNotes(currentGroup);

    // If no notes for this hand, skip to next group
    if (expectedNotes.length === 0) {
      // Auto-play the other hand's notes
      this.autoPlayOtherHand(currentGroup);
      
      this.currentPlaybackPosition++;
      this.state.currentNoteGroupIndex = this.getCurrentNoteGroupIndex();
      this.notifyProgress();
      // Recursively check next group with timing
      this.scheduleNextAutoPlay();
      return;
    }

    // Check if all expected notes are pressed
    const allCorrect = expectedNotes.every(note => 
      this.state.pressedNotes.has(note)
    );

    if (allCorrect && expectedNotes.length > 0) {
      // Mark these notes as correct
      expectedNotes.forEach(note => this.state.correctNotesPressed.add(note));
      
      // Auto-play the other hand's notes
      this.autoPlayOtherHand(currentGroup);
      
      // Advance to next note group
      this.currentPlaybackPosition++;
      this.state.currentNoteGroupIndex = this.getCurrentNoteGroupIndex();
      this.state.correctNotesPressed.clear();
      
      console.log(`Advanced to playback position ${this.currentPlaybackPosition}, note group ${this.state.currentNoteGroupIndex}`);
      
      const sequenceLength = this.repeatHandler 
        ? this.repeatHandler.getSequenceLength() 
        : this.state.score.length;
      
      if (this.currentPlaybackPosition >= sequenceLength) {
        console.log('Score completed!');
        this.state.isPlaying = false;
        this.notifyProgress();
        
        // Trigger completion callback
        if (this.onCompleteCallback) {
          this.onCompleteCallback();
        }
        return;
      }
      
      // Check if next group should be auto-played OR if it's a tied continuation
      this.notifyProgress();
      
      // Check if next group is a tied continuation of currently held notes
      const nextNoteGroupIndex = this.getCurrentNoteGroupIndex();
      if (nextNoteGroupIndex >= 0 && nextNoteGroupIndex < this.state.score.length) {
        const nextGroup = this.state.score[nextNoteGroupIndex];
        const nextExpectedNotes = this.getExpectedNotes(nextGroup);
        
        // Schedule next check (either for auto-play or tied continuation)
        this.scheduleNextAutoPlay();
      }
    }
  }

  private autoPlayOtherHand(noteGroup: NoteGroup): void {
    if (this.practiceMode === 'both') return;
    
    // Get notes for the other hand
    const otherHandNotes = noteGroup.notes.filter(note => {
      if (this.practiceMode === 'left') return note.hand === 'right';
      if (this.practiceMode === 'right') return note.hand === 'left';
      return false;
    });
    
    console.log(`Auto-playing other hand: ${otherHandNotes.length} notes`, otherHandNotes.map(n => n.pitch));
    
    if (otherHandNotes.length > 0 && this.onAutoPlayCallback) {
      this.onAutoPlayCallback(otherHandNotes, noteGroup.tempo || 120);
    }
  }

  private scheduleNextAutoPlay(): void {
    // Check if next group should be auto-played (no notes for practicing hand)
    const sequenceLength = this.repeatHandler 
      ? this.repeatHandler.getSequenceLength() 
      : this.state.score.length;
    
    if (this.currentPlaybackPosition >= sequenceLength) {
      return;
    }
    
    const nextNoteGroupIndex = this.getCurrentNoteGroupIndex();
    if (nextNoteGroupIndex < 0 || nextNoteGroupIndex >= this.state.score.length) {
      return;
    }
    
    const nextGroup = this.state.score[nextNoteGroupIndex];
    const expectedNotes = this.getExpectedNotes(nextGroup);
    
    // Check if next notes are already held (tied continuation)
    const allNextNotesHeld = expectedNotes.length > 0 && expectedNotes.every(note => 
      this.state.pressedNotes.has(note)
    );
    
    if (expectedNotes.length === 0 || allNextNotesHeld) {
      // Calculate delay to next group
      const prevPlaybackPosition = this.currentPlaybackPosition - 1;
      if (prevPlaybackPosition >= 0) {
        const prevNoteGroupIndex = this.repeatHandler
          ? this.repeatHandler.getNoteGroupIndexForPosition(prevPlaybackPosition)
          : prevPlaybackPosition;
        
        if (prevNoteGroupIndex >= 0 && prevNoteGroupIndex < this.state.score.length) {
          const currentGroup = this.state.score[prevNoteGroupIndex];
          if (currentGroup && nextGroup && currentGroup.absoluteTime !== undefined && nextGroup.absoluteTime !== undefined) {
            const timeDiff = nextGroup.absoluteTime - currentGroup.absoluteTime;
            const tempo = nextGroup.tempo || 120;
            const msPerQuarterNote = 60000 / tempo;
            const delay = timeDiff * msPerQuarterNote * 4; // Use same slowdown as playback
            
            setTimeout(() => {
              if (this.state.isPlaying) {
                this.checkProgress();
              }
            }, delay);
            return;
          }
        }
      }
      
      // Fallback: immediate
      setTimeout(() => {
        if (this.state.isPlaying) {
          this.checkProgress();
        }
      }, 0);
    }
  }

  private getExpectedNotes(noteGroup: NoteGroup): number[] {
    return noteGroup.notes
      .filter(note => {
        if (this.practiceMode === 'both') return true;
        if (this.practiceMode === 'left') return note.hand === 'left';
        if (this.practiceMode === 'right') return note.hand === 'right';
        return false;
      })
      .map(note => note.pitch);
  }

  getCurrentExpectedNotes(): number[] {
    if (this.state.currentNoteGroupIndex >= this.state.score.length || this.state.currentNoteGroupIndex < 0) {
      return [];
    }
    const currentGroup = this.state.score[this.state.currentNoteGroupIndex];
    if (!currentGroup) {
      return [];
    }
    return this.getExpectedNotes(currentGroup);
  }

  getCurrentPlaybackPosition(): number {
    return this.currentPlaybackPosition;
  }

  getState(): PracticeState {
    return { ...this.state };
  }

  getProgress(): number {
    if (this.state.score.length === 0) return 0;
    return Math.round((this.state.currentNoteGroupIndex / this.state.score.length) * 100);
  }

  getCurrentMeasure(): number {
    if (this.state.currentNoteGroupIndex >= this.state.score.length) {
      return this.state.score.length > 0 
        ? this.state.score[this.state.score.length - 1].measureIndex + 1
        : 0;
    }
    return this.state.score[this.state.currentNoteGroupIndex].measureIndex + 1;
  }

  onProgress(callback: (state: PracticeState) => void): void {
    this.onProgressCallback = callback;
  }

  onAutoPlay(callback: (notes: Note[], tempo: number) => void): void {
    this.onAutoPlayCallback = callback;
  }

  onComplete(callback: () => void): void {
    this.onCompleteCallback = callback;
  }

  private notifyProgress(): void {
    if (this.onProgressCallback) {
      this.onProgressCallback(this.getState());
    }
  }
}
