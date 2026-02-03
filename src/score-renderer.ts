import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { Note, NoteGroup } from './shared/types';

export class ScoreRenderer {
  private osmd: OpenSheetMusicDisplay | null = null;
  private noteGroups: NoteGroup[] = [];
  private currentCursorIndex: number = 0;
  private useFlats: boolean = false;
  private zoomLevel: number = 1.0;

  async loadScore(file: File): Promise<void> {
    const container = document.getElementById('score-display');
    if (!container) throw new Error('Score container not found');

    // Clear previous score
    container.innerHTML = '';

    // Create new OSMD instance
    this.osmd = new OpenSheetMusicDisplay(container, {
      autoResize: true,
      backend: 'svg',
      drawTitle: true,
      drawingParameters: 'default',
    });

    // Enable note names in noteheads
    this.osmd.setOptions({
      drawPartNames: true,
    });
    
    // Access drawing parameters to show note names
    // @ts-ignore - accessing protected property
    if (this.osmd.drawingParameters) {
      // @ts-ignore - accessing protected property
      this.osmd.drawingParameters.drawNoteNames = true;
    }

    // Load the file - OSMD expects string content
    const text = await file.text();
    await this.osmd.load(text);
    
    // Apply zoom before rendering
    this.osmd.zoom = this.zoomLevel;
    this.osmd.render();

    // Initialize cursor
    this.osmd.cursor.show();
    this.currentCursorIndex = 0;

    // Parse key signature from OSMD after loading
    this.parseKeySignatureFromOSMD();

    // Parse notes from the score
    this.parseNotes();
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
                  
                  const noteData: Note = {
                    pitch: midiNote,
                    hand,
                    duration: note.Length.RealValue,
                    measureIndex,
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
    
    this.currentCursorIndex = index;
    
    // Reset cursor to beginning
    this.osmd.cursor.reset();
    
    // Move cursor forward index times
    for (let i = 0; i < index && !this.osmd.cursor.iterator.EndReached; i++) {
      this.osmd.cursor.next();
    }
    
    // Auto-scroll to keep cursor in view
    this.scrollCursorIntoView();
  }

  private scrollCursorIntoView(): void {
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
    this.currentCursorIndex = 0;
    
    // Scroll to top
    const scoreContainer = document.querySelector('.score-container');
    if (scoreContainer) {
      scoreContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  render(): void {
    if (this.osmd) {
      this.osmd.render();
    }
  }

  setZoom(level: number): void {
    this.zoomLevel = level;
    if (this.osmd) {
      this.osmd.zoom = level;
      this.osmd.render();
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
