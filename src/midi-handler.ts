import { WebMidi, Input } from 'webmidi';
import type { MidiDevice } from './shared/types';

export class MidiHandler {
  private currentInput: Input | null = null;
  private pressedNotes = new Set<number>();
  private onNoteOnCallback: ((note: number, velocity: number) => void) | null = null;
  private onNoteOffCallback: ((note: number) => void) | null = null;
  private onDeviceChangeCallback: ((devices: MidiDevice[]) => void) | null = null;

  async initialize(): Promise<void> {
    try {
      await WebMidi.enable();
      console.log('WebMidi enabled');
      
      WebMidi.addListener('connected', () => {
        console.log('MIDI device connected');
        this.notifyDeviceChange();
      });
      
      WebMidi.addListener('disconnected', () => {
        console.log('MIDI device disconnected');
        this.notifyDeviceChange();
      });
      
      // Immediately notify about existing devices
      this.notifyDeviceChange();
    } catch (err) {
      console.error('Failed to enable WebMidi:', err);
      throw new Error('MIDI not supported or permission denied');
    }
  }

  getAvailableDevices(): MidiDevice[] {
    return WebMidi.inputs.map(input => ({
      id: input.id,
      name: input.name,
      manufacturer: input.manufacturer || 'Unknown',
    }));
  }

  selectDevice(deviceId: string): void {
    if (this.currentInput) {
      this.currentInput.removeListener();
    }

    const input = WebMidi.getInputById(deviceId);
    if (!input) {
      console.error('Device not found:', deviceId);
      return;
    }

    this.currentInput = input;
    
    input.addListener('noteon', (e) => {
      const note = e.note.number;
      this.pressedNotes.add(note);
      if (this.onNoteOnCallback) {
        this.onNoteOnCallback(note, e.rawVelocity || 127);
      }
    });

    input.addListener('noteoff', (e) => {
      const note = e.note.number;
      this.pressedNotes.delete(note);
      if (this.onNoteOffCallback) {
        this.onNoteOffCallback(note);
      }
    });

    console.log('Selected MIDI device:', input.name);
  }

  getPressedNotes(): Set<number> {
    return new Set(this.pressedNotes);
  }

  onNoteOn(callback: (note: number, velocity: number) => void): void {
    this.onNoteOnCallback = callback;
  }

  onNoteOff(callback: (note: number) => void): void {
    this.onNoteOffCallback = callback;
  }

  onDeviceChange(callback: (devices: MidiDevice[]) => void): void {
    this.onDeviceChangeCallback = callback;
  }

  private notifyDeviceChange(): void {
    if (this.onDeviceChangeCallback) {
      this.onDeviceChangeCallback(this.getAvailableDevices());
    }
  }

  dispose(): void {
    if (this.currentInput) {
      this.currentInput.removeListener();
    }
    this.pressedNotes.clear();
  }
}
