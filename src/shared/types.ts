export type Hand = 'left' | 'right' | 'both';

export type PracticeMode = 'left' | 'right' | 'both';

export interface Note {
  pitch: number; // MIDI note number (0-127)
  hand: 'left' | 'right';
  duration: number;
  measureIndex: number;
  timestamp: number; // Position in score
}

export interface NoteGroup {
  notes: Note[];
  timestamp: number;
  measureIndex: number;
}

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
}

export interface AppSettings {
  practiceMode: PracticeMode;
  selectedMidiDevice: string | null;
  theme: 'light' | 'dark';
  highlightColors: {
    next: string;
    correct: string;
    incorrect: string;
    pressed: string;
  };
  recentFiles: string[];
}

export interface PracticeState {
  isPlaying: boolean;
  currentNoteGroupIndex: number;
  pressedNotes: Set<number>;
  correctNotesPressed: Set<number>;
  score: NoteGroup[];
}
