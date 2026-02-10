import type { PracticeState } from './shared/types';

export class UIController {
  private useFlats: boolean = false;

  setUseFlats(useFlats: boolean): void {
    this.useFlats = useFlats;
  }

  updatePianoKeys(state: PracticeState, expectedNotes: number[]): void {
    // Keyboard visualization now handled by minikeys in app.ts
  }

  updateStatus(measure: number, progress: number, nextNotes: number[], tempo: number): void {
    const measureEl = document.getElementById('current-measure');
    const progressEl = document.getElementById('progress');
    const nextNotesEl = document.getElementById('next-notes');
    const tempoEl = document.getElementById('current-tempo');
    
    if (measureEl) measureEl.textContent = measure.toString();
    if (progressEl) progressEl.textContent = `${progress}%`;
    if (tempoEl) tempoEl.textContent = `${tempo} BPM`;
    if (nextNotesEl) {
      if (nextNotes.length > 0) {
        const noteNames = nextNotes.map(n => this.midiNoteToName(n)).join(', ');
        nextNotesEl.textContent = noteNames;
      } else {
        nextNotesEl.textContent = '-';
      }
    }
  }

  private midiNoteToName(midiNote: number): string {
    const sharpNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const flatNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    const noteNames = this.useFlats ? flatNames : sharpNames;
    const octave = Math.floor(midiNote / 12) - 1;
    const noteName = noteNames[midiNote % 12];
    return `${noteName}${octave}`;
  }

  updateMidiStatus(connected: boolean, deviceName?: string): void {
    const statusEl = document.getElementById('midi-status');
    const textEl = document.getElementById('midi-status-text');
    
    if (statusEl && textEl) {
      if (connected) {
        statusEl.classList.add('connected');
        textEl.textContent = `MIDI: ${deviceName || 'Connected'}`;
      } else {
        statusEl.classList.remove('connected');
        textEl.textContent = 'MIDI: Not connected';
      }
    }
  }

  showMessage(message: string): void {
    const messageEl = document.getElementById('loading-message');
    if (messageEl) {
      // Only update the h2 text, not the entire content
      const h2 = messageEl.querySelector('h2');
      if (h2) {
        h2.textContent = message;
      } else {
        messageEl.textContent = message;
      }
      messageEl.style.display = 'block';
    }
  }

  hideMessage(): void {
    const messageEl = document.getElementById('loading-message');
    if (messageEl) {
      messageEl.style.display = 'none';
    }
  }

  enableControls(enabled: boolean): void {
    const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
    const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
    
    if (playBtn) playBtn.disabled = !enabled;
    if (resetBtn) resetBtn.disabled = !enabled;
  }

  updatePlayPauseButtons(isPlaying: boolean): void {
    // No longer needed - practice mode always active
  }

  updatePlayButton(isPlaying: boolean): void {
    const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
    
    if (playBtn) {
      playBtn.textContent = isPlaying ? 'Stop' : 'Play';
      
      if (isPlaying) {
        playBtn.classList.remove('btn-primary');
        playBtn.classList.add('btn-danger');
      } else {
        playBtn.classList.remove('btn-danger');
        playBtn.classList.add('btn-primary');
      }
    }
  }
}
