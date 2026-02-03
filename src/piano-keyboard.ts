export class PianoKeyboard {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private keys: Map<number, KeyInfo> = new Map();
  private pressedKeys = new Set<number>();
  private highlightedKeys = new Map<number, string>();
  
  private readonly MIN_NOTE = 21; // A0
  private readonly MAX_NOTE = 108; // C8
  private readonly WHITE_KEY_WIDTH = 23;
  private readonly WHITE_KEY_HEIGHT = 90;
  private readonly BLACK_KEY_WIDTH = 14;
  private readonly BLACK_KEY_HEIGHT = 55;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');
    this.ctx = ctx;

    this.setupCanvas();
    this.calculateKeyPositions();
    this.draw();
    
    window.addEventListener('resize', () => this.handleResize());
  }

  private setupCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    
    this.ctx.scale(dpr, dpr);
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
  }

  private handleResize(): void {
    this.setupCanvas();
    this.calculateKeyPositions();
    this.draw();
  }

  private isBlackKey(note: number): boolean {
    const noteInOctave = note % 12;
    return [1, 3, 6, 8, 10].includes(noteInOctave); // C#, D#, F#, G#, A#
  }

  private calculateKeyPositions(): void {
    this.keys.clear();
    
    // First pass: calculate white keys
    let whiteKeyIndex = 0;
    for (let note = this.MIN_NOTE; note <= this.MAX_NOTE; note++) {
      if (!this.isBlackKey(note)) {
        this.keys.set(note, {
          note,
          x: whiteKeyIndex * this.WHITE_KEY_WIDTH,
          y: 0,
          width: this.WHITE_KEY_WIDTH,
          height: this.WHITE_KEY_HEIGHT,
          isBlack: false,
        });
        whiteKeyIndex++;
      }
    }

    // Second pass: calculate black keys positioned between white keys
    for (let note = this.MIN_NOTE; note <= this.MAX_NOTE; note++) {
      if (this.isBlackKey(note)) {
        // Find the white key to the left
        let whiteKeyBefore = note - 1;
        while (this.isBlackKey(whiteKeyBefore)) {
          whiteKeyBefore--;
        }
        
        const whiteKeyInfo = this.keys.get(whiteKeyBefore);
        if (whiteKeyInfo) {
          this.keys.set(note, {
            note,
            x: whiteKeyInfo.x + this.WHITE_KEY_WIDTH - (this.BLACK_KEY_WIDTH / 2),
            y: 0,
            width: this.BLACK_KEY_WIDTH,
            height: this.BLACK_KEY_HEIGHT,
            isBlack: true,
          });
        }
      }
    }
  }

  private draw(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);

    // Calculate total keyboard width
    const whiteKeyCount = Array.from(this.keys.values()).filter(k => !k.isBlack).length;
    const totalWidth = whiteKeyCount * this.WHITE_KEY_WIDTH;
    
    // Center the keyboard horizontally
    const offsetX = Math.max(0, (rect.width - totalWidth) / 2);
    
    // Align to bottom with small padding
    const offsetY = rect.height - this.WHITE_KEY_HEIGHT - 5;

    // Draw white keys first
    this.keys.forEach((key) => {
      if (!key.isBlack) {
        this.drawKey(key, offsetX, offsetY);
      }
    });

    // Draw black keys on top
    this.keys.forEach((key) => {
      if (key.isBlack) {
        this.drawKey(key, offsetX, offsetY);
      }
    });
  }

  private drawKey(key: KeyInfo, offsetX: number, offsetY: number): void {
    const isPressed = this.pressedKeys.has(key.note);
    const highlight = this.highlightedKeys.get(key.note);

    // Determine color
    let fillColor = key.isBlack ? '#2a2a2a' : '#ffffff';
    
    if (isPressed) {
      if (highlight === 'correct') {
        fillColor = '#a5d6a7'; // Subtle light green
      } else if (highlight === 'incorrect') {
        fillColor = '#f44336'; // Red
      } else {
        fillColor = '#4a9eff'; // Blue
      }
    } else if (highlight === 'next') {
      fillColor = '#ffeb3b'; // Yellow
    }

    // Draw key with offset
    const x = key.x + offsetX;
    const y = key.y + offsetY;
    
    this.ctx.fillStyle = fillColor;
    this.ctx.fillRect(x, y, key.width, key.height);

    // Draw border
    this.ctx.strokeStyle = '#1a1a1a';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x, y, key.width, key.height);
  }

  pressKey(note: number, type: 'correct' | 'incorrect' = 'correct'): void {
    this.pressedKeys.add(note);
    this.highlightedKeys.set(note, type);
    this.drawSingleKey(note);
  }

  releaseKey(note: number): void {
    this.pressedKeys.delete(note);
    this.highlightedKeys.delete(note);
    this.drawSingleKey(note);
  }

  highlightKey(note: number, type: 'next'): void {
    // Only highlight if not already pressed
    if (!this.pressedKeys.has(note)) {
      this.highlightedKeys.set(note, type);
    }
  }

  clearHighlights(): void {
    // Clear only the 'next' highlights, keep pressed key highlights
    const toRedraw: number[] = [];
    this.highlightedKeys.forEach((type, note) => {
      if (type === 'next' && !this.pressedKeys.has(note)) {
        toRedraw.push(note);
      }
    });
    toRedraw.forEach(note => {
      this.highlightedKeys.delete(note);
      this.drawSingleKey(note);
    });
  }

  private drawSingleKey(note: number): void {
    const key = this.keys.get(note);
    if (!key) return;

    const rect = this.canvas.getBoundingClientRect();
    const whiteKeyCount = Array.from(this.keys.values()).filter(k => !k.isBlack).length;
    const totalWidth = whiteKeyCount * this.WHITE_KEY_WIDTH;
    const offsetX = Math.max(0, (rect.width - totalWidth) / 2);
    const offsetY = rect.height - this.WHITE_KEY_HEIGHT - 5;

    // Clear the key area (including overlap for black keys)
    const clearX = key.x + offsetX - 2;
    const clearY = key.y + offsetY - 2;
    const clearWidth = key.width + 4;
    const clearHeight = key.height + 4;
    
    this.ctx.clearRect(clearX, clearY, clearWidth, clearHeight);

    // If this is a white key, redraw it
    if (!key.isBlack) {
      this.drawKey(key, offsetX, offsetY);
    }

    // Redraw any black keys that might overlap
    this.keys.forEach((k) => {
      if (k.isBlack) {
        const blackX = k.x + offsetX;
        const blackY = k.y + offsetY;
        // Check if this black key overlaps with the cleared area
        if (blackX < clearX + clearWidth && blackX + k.width > clearX &&
            blackY < clearY + clearHeight && blackY + k.height > clearY) {
          this.drawKey(k, offsetX, offsetY);
        }
      }
    });

    // If this is a black key, redraw it on top
    if (key.isBlack) {
      this.drawKey(key, offsetX, offsetY);
    }
  }
}

interface KeyInfo {
  note: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isBlack: boolean;
}
