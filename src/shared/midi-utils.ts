export const MIDI_NOTE_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'
];

export function midiNoteToName(midiNote: number): string {
  const octave = Math.floor(midiNote / 12) - 1;
  const noteName = MIDI_NOTE_NAMES[midiNote % 12];
  return `${noteName}${octave}`;
}

export function midiNoteToFrequency(midiNote: number): number {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

export function isNoteOn(status: number, velocity: number): boolean {
  return status === 0x90 && velocity > 0;
}

export function isNoteOff(status: number, velocity: number): boolean {
  return status === 0x80 || (status === 0x90 && velocity === 0);
}

export function getChannel(status: number): number {
  return status & 0x0f;
}

export function getMessageType(status: number): number {
  return status & 0xf0;
}
