export type Hand = 'left' | 'right' | 'both';

export type PracticeMode = 'left' | 'right' | 'both';

export interface Note {
  pitch: number; // MIDI note number (0-127)
  hand: 'left' | 'right';
  duration: number;
  measureIndex: number;
  timestamp: number; // Position in score
  velocity: number; // 0-1
  isTied: boolean; // Is this note tied to the next
  isRest?: boolean; // Is this a rest
}

export interface NoteGroup {
  notes: Note[];
  timestamp: number;
  measureIndex: number;
  tempo?: number; // BPM at this point in the score
  absoluteTime?: number; // Absolute time position in quarter notes from start of piece
}

export interface ScoreData {
  noteGroups: NoteGroup[];
  tempo: number; // BPM
}

export interface TempoChange {
  measureIndex: number;
  tempo: number;
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
