import type { NoteGroup, PracticeMode, PracticeState } from './shared/types';

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
      this.state.currentNoteGroupIndex++;
      this.notifyProgress();
      // Recursively check next group
      this.checkProgress();
      return;
    }

    // Check if all expected notes are pressed
    const allCorrect = expectedNotes.every(note => 
      this.state.pressedNotes.has(note)
    );

    if (allCorrect && expectedNotes.length > 0) {
      // Mark these notes as correct
      expectedNotes.forEach(note => this.state.correctNotesPressed.add(note));
      
      // Advance to next note group
      this.state.currentNoteGroupIndex++;
      this.state.correctNotesPressed.clear();
      
      console.log(`Advanced to note group ${this.state.currentNoteGroupIndex}`);
      
      if (this.state.currentNoteGroupIndex >= this.state.score.length) {
        console.log('Score completed!');
        this.pause();
      } else {
        // Check if next group should be skipped
        this.notifyProgress();
        this.checkProgress();
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

  private notifyProgress(): void {
    if (this.onProgressCallback) {
      this.onProgressCallback(this.getState());
    }
  }
}
