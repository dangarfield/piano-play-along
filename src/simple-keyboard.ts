export class SimpleKeyboard {
  private container: HTMLElement;
  private keys = new Map<number, HTMLElement>();
  private pressedKeys = new Set<number>();
  private highlightedKeys = new Set<number>();
  private useFlats: boolean = false;
  private onNoteClickCallback: ((note: number) => void) | null = null;
  
  private readonly MIN_NOTE = 21; // A0
  private readonly MAX_NOTE = 108; // C8

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
  }

  setUseFlats(useFlats: boolean): void {
    this.useFlats = useFlats;
  }

  onNoteClick(callback: (note: number) => void): void {
    console.log('Setting onNoteClick callback');
    this.onNoteClickCallback = callback;
  }

  private isBlackKey(note: number): boolean {
    const noteInOctave = note % 12;
    return [1, 3, 6, 8, 10].includes(noteInOctave); // C#, D#, F#, G#, A#
  }

  private getNoteLabel(note: number): string {
    const sharpNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const flatNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    const noteNames = this.useFlats ? flatNames : sharpNames;
    const noteName = noteNames[note % 12];
    
    // Add line break between note and accidental
    if (noteName.length > 1) {
      return noteName[0] + '\n' + noteName[1];
    }
    return noteName;
  }

  private render(): void {
    this.container.innerHTML = '';
    this.container.className = 'simple-keyboard';
    
    const whiteKeyPositions = new Map<number, number>();
    let whiteKeyIndex = 0;
    
    // Create white keys first and track positions
    for (let note = this.MIN_NOTE; note <= this.MAX_NOTE; note++) {
      if (!this.isBlackKey(note)) {
        const key = document.createElement('div');
        key.className = 'key white';
        key.dataset.note = note.toString();
        
        // Add click handler
        key.addEventListener('mousedown', () => {
          console.log('White key clicked:', note, 'callback exists:', !!this.onNoteClickCallback);
          if (this.onNoteClickCallback) {
            this.onNoteClickCallback(note);
          }
        });
        
        this.container.appendChild(key);
        this.keys.set(note, key);
        whiteKeyPositions.set(note, whiteKeyIndex);
        whiteKeyIndex++;
      }
    }
    
    // Calculate the offset from centering
    setTimeout(() => {
      const firstWhiteKey = this.container.querySelector('.key.white') as HTMLElement;
      if (!firstWhiteKey) return;
      
      const containerRect = this.container.getBoundingClientRect();
      const keyRect = firstWhiteKey.getBoundingClientRect();
      const offset = keyRect.left - containerRect.left;
      const whiteKeyWidth = keyRect.width;
      
      // Create black keys on top with correct positioning
      for (let note = this.MIN_NOTE; note <= this.MAX_NOTE; note++) {
        if (this.isBlackKey(note)) {
          const key = document.createElement('div');
          key.className = 'key black';
          key.dataset.note = note.toString();
          
          // Add click handler
          key.addEventListener('mousedown', () => {
            console.log('Black key clicked:', note);
            if (this.onNoteClickCallback) {
              this.onNoteClickCallback(note);
            }
          });
          
          // Find the white key to the left
          let whiteKeyBefore = note - 1;
          while (this.isBlackKey(whiteKeyBefore) && whiteKeyBefore >= this.MIN_NOTE) {
            whiteKeyBefore--;
          }
          
          const whiteKeyIndex = whiteKeyPositions.get(whiteKeyBefore);
          if (whiteKeyIndex !== undefined) {
            this.container.appendChild(key);
            // Position between white keys using actual measured width
            const leftPos = offset + whiteKeyIndex * whiteKeyWidth + (whiteKeyWidth * 0.7);
            key.style.left = `${leftPos}px`;
          }
          
          this.keys.set(note, key);
        }
      }
    }, 0);
  }

  keyDown(note: number, correct: boolean = true): void {
    const key = this.keys.get(note);
    if (!key) return;
    
    this.pressedKeys.add(note);
    key.classList.remove('highlighted'); // Remove highlight when pressed
    key.classList.add('pressed');
    
    if (correct) {
      key.classList.add('correct');
      key.classList.remove('incorrect');
    } else {
      key.classList.add('incorrect');
      key.classList.remove('correct');
    }
    
    // Add note label if not already present
    if (!key.querySelector('.note-label')) {
      const label = document.createElement('span');
      label.className = 'note-label';
      label.style.whiteSpace = 'pre-line';
      label.textContent = this.getNoteLabel(note);
      key.appendChild(label);
    }
  }

  keyUp(note: number): void {
    const key = this.keys.get(note);
    if (!key) return;
    
    this.pressedKeys.delete(note);
    key.classList.remove('pressed', 'correct', 'incorrect');
    
    // Restore highlight if this note is still expected
    if (this.highlightedKeys.has(note)) {
      key.classList.add('highlighted');
      // Keep the label since it's still highlighted
    } else {
      // Only remove label if not highlighted
      const label = key.querySelector('.note-label');
      if (label) {
        label.remove();
      }
    }
  }

  highlightNote(note: number): void {
    const key = this.keys.get(note);
    if (!key) return;
    
    this.highlightedKeys.add(note);
    if (!this.pressedKeys.has(note)) {
      key.classList.add('highlighted');
      
      // Add note label if not already present
      if (!key.querySelector('.note-label')) {
        const label = document.createElement('span');
        label.className = 'note-label';
        label.style.whiteSpace = 'pre-line';
        label.textContent = this.getNoteLabel(note);
        key.appendChild(label);
      }
    }
  }

  clearHighlights(): void {
    this.highlightedKeys.forEach(note => {
      const key = this.keys.get(note);
      if (key) {
        key.classList.remove('highlighted');
        
        // Only remove label if key is not pressed
        if (!this.pressedKeys.has(note)) {
          const label = key.querySelector('.note-label');
          if (label) {
            label.remove();
          }
        }
      }
    });
    this.highlightedKeys.clear();
  }

  destroy(): void {
    this.container.innerHTML = '';
    this.keys.clear();
  }
}
