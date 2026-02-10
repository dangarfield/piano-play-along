import type { NoteGroup, PracticeMode, PracticeState, Note } from './shared/types';

export class PracticeEngine {
  private state: PracticeState = {
    isPlaying: false,
    currentNoteGroupIndex: 0,
    pressedNotes: new Set(),
    correctNotesPressed: new Set(),
    score: [],
  };
  
  private practiceMode: PracticeMode = 'both';
  private onProgressCallback: ((state: PracticeState) => void) | null = null;
  private onAutoPlayCallback: ((notes: Note[], tempo: number) => void) | null = null;

  loadScore(noteGroups: NoteGroup[]): void {
    this.state.score = noteGroups;
    this.state.currentNoteGroupIndex = 0;
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
    this.state.currentNoteGroupIndex = 0;
    this.state.pressedNotes.clear();
    this.state.correctNotesPressed.clear();
    this.notifyProgress();
  }

  jumpToNoteGroup(index: number): void {
    if (index >= 0 && index < this.state.score.length) {
      this.state.currentNoteGroupIndex = index;
      this.state.pressedNotes.clear();
      this.state.correctNotesPressed.clear();
      // Skip empty groups after jumping
      this.skipEmptyGroups();
      this.notifyProgress();
    }
  }

  private skipEmptyGroups(): void {
    while (this.state.currentNoteGroupIndex < this.state.score.length) {
      const currentGroup = this.state.score[this.state.currentNoteGroupIndex];
      const expectedNotes = this.getExpectedNotes(currentGroup);
      
      if (expectedNotes.length > 0) {
        break; // Found a group with notes for this hand
      }
      
      this.state.currentNoteGroupIndex++;
    }
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
    if (this.state.currentNoteGroupIndex >= this.state.score.length) {
      return; // Finished
    }

    const currentGroup = this.state.score[this.state.currentNoteGroupIndex];
    const expectedNotes = this.getExpectedNotes(currentGroup);

    // If no notes for this hand, skip to next group
    if (expectedNotes.length === 0) {
      // Auto-play the other hand's notes
      this.autoPlayOtherHand(currentGroup);
      
      this.state.currentNoteGroupIndex++;
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
      this.state.currentNoteGroupIndex++;
      this.state.correctNotesPressed.clear();
      
      console.log(`Advanced to note group ${this.state.currentNoteGroupIndex}`);
      
      if (this.state.currentNoteGroupIndex >= this.state.score.length) {
        console.log('Score completed!');
        this.pause();
      } else {
        // Check if next group should be auto-played OR if it's a tied continuation
        this.notifyProgress();
        
        // Check if next group is a tied continuation of currently held notes
        const nextGroup = this.state.score[this.state.currentNoteGroupIndex];
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
    if (this.state.currentNoteGroupIndex >= this.state.score.length) {
      return;
    }
    
    const nextGroup = this.state.score[this.state.currentNoteGroupIndex];
    const expectedNotes = this.getExpectedNotes(nextGroup);
    
    // Check if next notes are already held (tied continuation)
    const allNextNotesHeld = expectedNotes.length > 0 && expectedNotes.every(note => 
      this.state.pressedNotes.has(note)
    );
    
    if (expectedNotes.length === 0 || allNextNotesHeld) {
      // Calculate delay to next group
      const currentGroup = this.state.score[this.state.currentNoteGroupIndex - 1];
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
      } else {
        // Fallback: immediate
        setTimeout(() => {
          if (this.state.isPlaying) {
            this.checkProgress();
          }
        }, 0);
      }
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
    if (this.state.currentNoteGroupIndex >= this.state.score.length) {
      return [];
    }
    const currentGroup = this.state.score[this.state.currentNoteGroupIndex];
    return this.getExpectedNotes(currentGroup);
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

  private notifyProgress(): void {
    if (this.onProgressCallback) {
      this.onProgressCallback(this.getState());
    }
  }
}
