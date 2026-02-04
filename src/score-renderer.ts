import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { Note, NoteGroup } from './shared/types';

export class ScoreRenderer {
  private osmd: OpenSheetMusicDisplay | null = null;
  private noteGroups: NoteGroup[] = [];
  private useFlats: boolean = false;
  private zoomLevel: number = 1.25;
  private showNoteNames: boolean = false;
  private noteElementToGroupIndex: Map<Element, number> = new Map();

  async loadScore(file: File): Promise<void> {
    const container = document.getElementById('score-display');
    if (!container) throw new Error('Score container not found');

    // Clear previous score
    container.innerHTML = '';

    // Create new OSMD instance
    this.osmd = new OpenSheetMusicDisplay(container, {
      autoResize: false,
      backend: 'svg',
      drawTitle: true,
      drawingParameters: 'default',
    });

    // Enable note names in noteheads
    this.osmd.setOptions({
      drawPartNames: true,
    });

    // Load the file - OSMD expects string content
    const text = await file.text();
    await this.osmd.load(text);
    
    // Parse key signature from OSMD after loading (before rendering)
    this.parseKeySignatureFromOSMD();
    
    // Apply zoom before rendering
    this.osmd.zoom = this.zoomLevel;
    this.osmd.render();

    // Initialize cursor
    this.osmd.cursor.show();
    this.currentCursorIndex = 0;
    
    // Draw note names on top of notes (after rendering and cursor)
    setTimeout(() => {
      this.drawNoteNames();
    }, 50);

    // Parse notes from the score
    this.parseNotes();
    
    // Setup click handlers after everything is ready
    setTimeout(() => {
      this.setupNoteClickHandlers();
    }, 100);
  }

  private setupNoteClickHandlers(): void {
    if (!this.osmd) return;
    
    const scoreContainer = document.getElementById('score-display');
    if (!scoreContainer) return;
    
    // Add CSS for measure hover
    const style = document.createElement('style');
    style.textContent = '.vf-measure { cursor: pointer; }';
    document.head.appendChild(style);
    
    scoreContainer.addEventListener('click', (e) => {
      if (!this.osmd || !this.onNoteClickCallback) {
        return;
      }
      
      // Find the clicked measure element
      const target = e.target as Element;
      const measureElement = target.closest('.vf-measure');
      
      if (!measureElement) {
        return;
      }
      
      // Get measure ID (it's just a number like "12")
      const measureId = measureElement.id;
      if (!measureId) {
        return;
      }
      
      // Parse the measure number (ID is 1-indexed, measureIndex is 0-indexed)
      const measureNumber = parseInt(measureId, 10) - 1;
      if (isNaN(measureNumber) || measureNumber < 0) {
        return;
      }
      
      // Find first note group with this measure index
      const targetIndex = this.noteGroups.findIndex(group => group.measureIndex === measureNumber);
      
      if (targetIndex !== -1) {
        this.onNoteClickCallback(targetIndex);
      }
    });
  }

  private onNoteClickCallback: ((index: number) => void) | null = null;

  onNoteClick(callback: (index: number) => void): void {
    this.onNoteClickCallback = callback;
  }

  private drawNoteNames(): void {
    if (!this.osmd || !this.showNoteNames) return;
    
    this.noteElementToGroupIndex.clear();
    
    try {
      this.osmd.GraphicSheet.MeasureList.forEach((measureList: any) => {
        measureList.forEach((measure: any) => {
          measure.staffEntries.forEach((staffEntry: any) => {
            staffEntry.graphicalVoiceEntries.forEach((graphicalVoiceEntry: any) => {
              graphicalVoiceEntry.notes.forEach((graphicalNote: any) => {
                const pitch = graphicalNote.sourceNote.Pitch;
                if (pitch === undefined) return;
                
                // Get the actual MIDI note number
                const midiNote = pitch.getHalfTone() + 12;
                
                // Convert MIDI to note name with proper accidentals
                const noteNames = this.useFlats 
                  ? ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']
                  : ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
                const pitchName = noteNames[midiNote % 12];
                
                if (!pitchName) return;
                
                // Check if note is hollow (minim, breve, etc.) - these have longer durations
                const noteLength = graphicalNote.sourceNote.Length.RealValue;
                const isHollow = noteLength >= 0.5; // Half note or longer
                const textColor = isHollow ? '#000000' : '#ffffff';
                const fontSize = isHollow ? '8' : '9';
                const accidentalSize = isHollow ? '6' : '7';
                
                // Get the note's position
                const position = graphicalNote.PositionAndShape.AbsolutePosition;
                const x = position.x * 10; // OSMD units to pixels
                const y = position.y * 10 + 3;
                
                // Find the SVG container
                const svgElement = document.querySelector('#score-display svg');
                if (!svgElement) return;
                
                // Split note name into letter and accidental
                const noteLetter = pitchName[0];
                const accidental = pitchName.slice(1);
                
                if (accidental) {
                  // Create text with tspan for superscript accidental
                  const textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                  textElement.setAttribute('x', x.toString());
                  textElement.setAttribute('y', y.toString());
                  textElement.setAttribute('font-weight', 'bold');
                  textElement.setAttribute('fill', textColor);
                  textElement.setAttribute('text-anchor', 'middle');
                  textElement.setAttribute('pointer-events', 'none');
                  
                  // Main note letter
                  const letterSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                  letterSpan.setAttribute('font-size', fontSize);
                  letterSpan.textContent = noteLetter;
                  
                  // Superscript accidental
                  const accidentalSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                  accidentalSpan.setAttribute('font-size', accidentalSize);
                  accidentalSpan.setAttribute('dx', '-0.5');
                  accidentalSpan.setAttribute('dy', '-2');
                  accidentalSpan.textContent = accidental;
                  
                  textElement.appendChild(letterSpan);
                  textElement.appendChild(accidentalSpan);
                  svgElement.appendChild(textElement);
                } else {
                  // No accidental, just the letter
                  const textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                  textElement.setAttribute('x', x.toString());
                  textElement.setAttribute('y', y.toString());
                  textElement.setAttribute('font-size', fontSize);
                  textElement.setAttribute('font-weight', 'bold');
                  textElement.setAttribute('fill', textColor);
                  textElement.setAttribute('text-anchor', 'middle');
                  textElement.setAttribute('pointer-events', 'none');
                  textElement.textContent = pitchName;
                  svgElement.appendChild(textElement);
                }
              });
            });
          });
        });
      });
    } catch (error) {
      console.error('Error drawing note names:', error);
    }
  }

  private parseKeySignatureFromOSMD(): void {
    if (!this.osmd) return;
    
    try {
      const firstMeasure = this.osmd.Sheet.SourceMeasures[0];
      
      // @ts-ignore - accessing private property
      if (firstMeasure.firstInstructionsStaffEntries) {
        // @ts-ignore - accessing private property
        for (const staffEntry of firstMeasure.firstInstructionsStaffEntries) {
          if (staffEntry?.Instructions) {
            for (const instruction of staffEntry.Instructions) {
              const keyType = (instruction as any).keyType;
              if (keyType !== undefined) {
                this.useFlats = keyType < 0;
                return;
              }
            }
          }
        }
      }
      
      this.useFlats = false;
    } catch (error) {
      console.error('Error parsing key signature:', error);
      this.useFlats = false;
    }
  }

  getUseFlats(): boolean {
    return this.useFlats;
  }

  private parseNotes(): void {
    if (!this.osmd) return;

    this.noteGroups = [];
    const sheet = this.osmd.Sheet;
    
    const notesByTimestamp = new Map<number, Note[]>();
    let globalTimestamp = 0;

    try {
      // First, build a map of graphical notes to their visual measure index
      const graphicalNoteToMeasureIndex = new Map<any, number>();
      
      this.osmd.GraphicSheet.MeasureList.forEach((measureList: any, visualMeasureIndex: number) => {
        measureList.forEach((measure: any) => {
          measure.staffEntries.forEach((staffEntry: any) => {
            staffEntry.graphicalVoiceEntries.forEach((graphicalVoiceEntry: any) => {
              graphicalVoiceEntry.notes.forEach((graphicalNote: any) => {
                const sourceNote = graphicalNote.sourceNote;
                if (sourceNote) {
                  graphicalNoteToMeasureIndex.set(sourceNote, visualMeasureIndex);
                }
              });
            });
          });
        });
      });
      
      // Now parse notes using the visual measure index
      for (let measureIndex = 0; measureIndex < sheet.SourceMeasures.length; measureIndex++) {
        const measure = sheet.SourceMeasures[measureIndex];
        const measureTimestamps = new Map<number, number>();
        
        for (const verticalContainer of measure.VerticalSourceStaffEntryContainers) {
          const localTimestamp = verticalContainer.Timestamp.RealValue;
          
          if (!measureTimestamps.has(localTimestamp)) {
            measureTimestamps.set(localTimestamp, globalTimestamp);
            globalTimestamp++;
          }
          
          const timestamp = measureTimestamps.get(localTimestamp)!;
          
          for (let staffIndex = 0; staffIndex < verticalContainer.StaffEntries.length; staffIndex++) {
            const entry = verticalContainer.StaffEntries[staffIndex];
            if (!entry) continue;
            
            const hand = staffIndex === 0 ? 'right' : 'left';
            const voiceEntries = entry.VoiceEntries;
            if (!voiceEntries) continue;
            
            for (const voiceEntry of voiceEntries) {
              if (!voiceEntry?.Notes) continue;
              
              for (const note of voiceEntry.Notes) {
                if (!note?.Pitch) continue;
                
                try {
                  const midiNote = note.Pitch.getHalfTone() + 12;
                  
                  // Get visual measure index from graphical note mapping
                  const visualMeasureIndex = graphicalNoteToMeasureIndex.get(note) ?? measureIndex;
                  
                  const noteData: Note = {
                    pitch: midiNote,
                    hand,
                    duration: note.Length.RealValue,
                    measureIndex: visualMeasureIndex,
                    timestamp,
                  };

                  if (!notesByTimestamp.has(timestamp)) {
                    notesByTimestamp.set(timestamp, []);
                  }
                  notesByTimestamp.get(timestamp)!.push(noteData);
                } catch (e) {
                  console.warn('Failed to parse note:', e);
                }
              }
            }
          }
        }
      }

      const sortedTimestamps = Array.from(notesByTimestamp.keys()).sort((a, b) => a - b);
      
      for (const timestamp of sortedTimestamps) {
        const notes = notesByTimestamp.get(timestamp)!;
        if (notes.length > 0) {
          this.noteGroups.push({
            notes,
            timestamp,
            measureIndex: notes[0].measureIndex,
          });
        }
      }
    } catch (error) {
      console.error('Error parsing notes:', error);
      throw error;
    }
  }

  getNoteGroups(): NoteGroup[] {
    return this.noteGroups;
  }

  moveCursorToNoteGroup(index: number): void {
    if (!this.osmd || index < 0 || index >= this.noteGroups.length) return;
    
    // Reset cursor to beginning
    this.osmd.cursor.reset();
    
    // Move cursor forward index times
    for (let i = 0; i < index && !this.osmd.cursor.iterator.EndReached; i++) {
      this.osmd.cursor.next();
    }
    
    // Auto-scroll to keep cursor in view
    this.scrollCursorIntoView();
  }

  scrollCursorIntoView(): void {
    if (!this.osmd) return;
    
    setTimeout(() => {
      const scoreContainer = document.querySelector('.score-container');
      if (!scoreContainer) return;
      
      // Find the cursor image element
      const cursorImg = document.querySelector('[id^="cursorImg-"]') as HTMLElement;
      if (!cursorImg) {
        console.log('Cursor image not found');
        return;
      }
      
      // Get the top position from the style attribute
      const topStyle = cursorImg.style.top;
      if (!topStyle) {
        console.log('Cursor top position not found');
        return;
      }
      
      // Parse the pixel value
      const cursorTop = parseFloat(topStyle);
      const cursorHeight = parseFloat(cursorImg.style.height || '180');
      
      const containerRect = scoreContainer.getBoundingClientRect();
      
      // Position cursor at top 1/4 of the viewport
      const targetScroll = cursorTop + (cursorHeight / 2) - (containerRect.height / 4);
      
      scoreContainer.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: 'smooth'
      });
    }, 100);
  }

  resetCursor(): void {
    if (!this.osmd) return;
    this.osmd.cursor.reset();
    
    // Scroll to top
    const scoreContainer = document.querySelector('.score-container');
    if (scoreContainer) {
      scoreContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  render(): void {
    if (this.osmd) {
      this.osmd.render();
      this.drawNoteNames();
    }
  }

  setZoom(level: number): void {
    this.zoomLevel = level;
    if (this.osmd) {
      this.osmd.zoom = level;
      this.osmd.render();
      this.drawNoteNames();
    }
  }

  setShowNoteNames(show: boolean): void {
    this.showNoteNames = show;
    if (this.osmd) {
      this.osmd.render();
      this.drawNoteNames();
    }
  }

  dispose(): void {
    if (this.osmd) {
      const container = document.getElementById('score-display');
      if (container) {
        container.innerHTML = '';
      }
      this.osmd = null;
    }
  }
}
