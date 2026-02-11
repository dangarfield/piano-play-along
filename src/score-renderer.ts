import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { Note, NoteGroup } from './shared/types';
import JSZip from 'jszip';
import type { SoundHandler } from './sound-handler';

export class ScoreRenderer {
  private osmd: OpenSheetMusicDisplay | null = null;
  private noteGroups: NoteGroup[] = [];
  private tempo: number = 120; // Default fallback
  private tempoChanges: Map<number, number> = new Map(); // measureIndex -> tempo
  private noteGroupToCursorPosition: Map<number, number> = new Map();
  private sourceNoteToGroupIndex: Map<any, number> = new Map();
  private useFlats: boolean = false;
  private zoomLevel: number = 1.25;
  private showNoteNames: boolean = false;
  private noteElementToGroupIndex: Map<Element, number> = new Map();
  private currentCursorPosition: number = 0;
  private soundHandler: SoundHandler | null = null;
  private noteDynamics: Map<string, number> = new Map(); // key: measure-staff-voice-timestamp-pitch

  setSoundHandler(soundHandler: SoundHandler): void {
    this.soundHandler = soundHandler;
  }

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
      cursorsOptions: [{
        type: 0,
        color: '#4a9eff',
        alpha: 0.5,
        follow: false
      }]
    });

    // Enable note names in noteheads
    this.osmd.setOptions({
      drawPartNames: true,
    });

    // Load the file - handle both .xml and .mxl
    let xmlContent: string;
    
    if (file.name.toLowerCase().endsWith('.mxl')) {
      // Compressed MusicXML - unzip and extract
      const arrayBuffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);
      
      // Find the main XML file (usually META-INF/container.xml points to it, but we'll just find any .xml)
      const xmlFiles = Object.keys(zip.files).filter(name => 
        name.toLowerCase().endsWith('.xml') && !name.includes('META-INF')
      );
      
      if (xmlFiles.length === 0) {
        throw new Error('No XML file found in MXL archive');
      }
      
      // Use the first XML file found (usually there's only one)
      xmlContent = await zip.files[xmlFiles[0]].async('text');
    } else {
      // Uncompressed MusicXML
      xmlContent = await file.text();
    }
    
    // Parse MusicXML to extract dynamics before OSMD processes it
    this.extractDynamicsFromMusicXML(xmlContent);
    
    // Extract tempo from MusicXML
    this.extractTempoFromMusicXML(xmlContent);
    
    await this.osmd.load(xmlContent);
    
    // Parse key signature from OSMD after loading (before rendering)
    this.parseKeySignatureFromOSMD();
    
    // Apply zoom before rendering
    this.osmd.zoom = this.zoomLevel;
    this.osmd.render();

    // Initialize cursor
    this.osmd.cursor.show();
    this.osmd.cursor.CursorOptions = {
      type: 0,
      color: '#4a9eff',
      alpha: 0.5,
      follow: false
    };
    this.osmd.cursor.update();
    
    // Draw note names on top of notes (after rendering and cursor)
    this.drawNoteNames();

    // Parse notes from the score
    this.parseNotes();
    
    // Setup click handlers after everything is ready
    this.setupNoteClickHandlers();
  }

  private setupNoteClickHandlers(): void {
    if (!this.osmd) return;
    
    const scoreContainer = document.getElementById('score-display');
    if (!scoreContainer) return;
    
    // Build a map from SVG elements to note group indices using source notes
    const svgElementToGroupIndex = new Map<Element, number>();
    
    this.osmd.GraphicSheet.MeasureList.forEach((measureList: any) => {
      measureList.forEach((measure: any) => {
        if (!measure?.staffEntries) return;
        measure.staffEntries.forEach((staffEntry: any) => {
          if (!staffEntry?.graphicalVoiceEntries) return;
          staffEntry.graphicalVoiceEntries.forEach((graphicalVoiceEntry: any) => {
            if (!graphicalVoiceEntry?.notes) return;
            graphicalVoiceEntry.notes.forEach((graphicalNote: any) => {
              const sourceNote = graphicalNote.sourceNote;
              if (!sourceNote) return;
              
              // Look up the note group index using the source note object
              const groupIndex = this.sourceNoteToGroupIndex.get(sourceNote);
              if (groupIndex !== undefined) {
                const svgElement = graphicalNote.getSVGGElement?.();
                if (svgElement) {
                  // Map the main note element and all its children
                  svgElementToGroupIndex.set(svgElement, groupIndex);
                  
                  // Also map all child elements (notehead, stem, flag, etc.)
                  const children = svgElement.querySelectorAll('*');
                  children.forEach((child: Element) => {
                    svgElementToGroupIndex.set(child, groupIndex);
                  });
                }
              }
            });
          });
        });
      });
    });
    
    // Add CSS for note hover
    const style = document.createElement('style');
    style.textContent = '.vf-notehead, .vf-stem, .vf-flag { cursor: pointer; }';
    document.head.appendChild(style);
    
    scoreContainer.addEventListener('click', (e) => {
      if (!this.osmd || !this.onNoteClickCallback) {
        return;
      }
      
      const target = e.target as Element;
      
      // Check if the clicked element itself is mapped
      let groupIndex = svgElementToGroupIndex.get(target);
      
      if (groupIndex === undefined) {
        // Try parent elements
        let parent = target.parentElement;
        while (parent && groupIndex === undefined) {
          groupIndex = svgElementToGroupIndex.get(parent);
          parent = parent.parentElement;
        }
      }
      
      if (groupIndex !== undefined) {
        // Play the note group
        const noteGroup = this.noteGroups[groupIndex];
        if (noteGroup && this.soundHandler) {
          this.soundHandler.playNoteGroup(noteGroup);
        }
        
        // Jump to the note group
        this.onNoteClickCallback(groupIndex);
        return;
      }
      
      // Fallback: click on measure goes to first note in measure
      const measureElement = target.closest('.vf-measure');
      if (measureElement) {
        const measureId = measureElement.id;
        if (measureId) {
          const measureNumber = parseInt(measureId, 10) - 1;
          if (!isNaN(measureNumber) && measureNumber >= 0) {
            const targetIndex = this.noteGroups.findIndex(group => group.measureIndex === measureNumber);
            if (targetIndex !== -1) {
              this.onNoteClickCallback(targetIndex);
            }
          }
        }
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
          if (!measure?.staffEntries) return;
          measure.staffEntries.forEach((staffEntry: any) => {
            if (!staffEntry?.graphicalVoiceEntries) return;
            staffEntry.graphicalVoiceEntries.forEach((graphicalVoiceEntry: any) => {
              if (!graphicalVoiceEntry?.notes) return;
              graphicalVoiceEntry.notes.forEach((graphicalNote: any) => {
                const sourceNote = graphicalNote.sourceNote;
                const pitch = sourceNote?.Pitch;
                if (pitch === undefined) return;
                
                // Skip rests and notes that shouldn't be printed (same as parseNotes)
                // @ts-ignore - accessing private properties
                if (sourceNote.isRestFlag === true) return;
                // @ts-ignore - accessing private properties
                if (sourceNote.printObject === false) return;
                
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
                const isMinim = noteLength >= 0.5 && noteLength < 1.0; // Half note only
                const circleRadius = isMinim ? 4 : 5;
                const textColor = isHollow ? '#000000' : '#ffffff';
                const fontSize = isHollow ? '8' : '9';
                const accidentalSize = isHollow ? '6' : '7';
                
                // Find the specific notehead path element for this note
                const noteElement = graphicalNote.getSVGGElement?.();
                if (!noteElement) return;
                
                // Find all notehead groups and paths
                const noteheadGroups = noteElement.querySelectorAll('.vf-notehead');
                if (noteheadGroups.length === 0) return;
                
                // For chords, we need to match by Y position
                const position = graphicalNote.PositionAndShape.AbsolutePosition;
                const noteY = position.y * 10;
                
                let targetNoteheadGroup: Element | null = null;
                let minDistance = Infinity;
                
                // Find the notehead group closest to this note's Y position
                noteheadGroups.forEach((group: Element) => {
                  const path = group.querySelector('path');
                  if (path) {
                    const bbox = (path as SVGGraphicsElement).getBBox();
                    const distance = Math.abs(bbox.y + bbox.height / 2 - noteY);
                    if (distance < minDistance) {
                      minDistance = distance;
                      targetNoteheadGroup = group;
                    }
                  }
                });
                
                if (!targetNoteheadGroup) return;
                
                // Get the bounding box to center the text
                const path = (targetNoteheadGroup as Element).querySelector('path');
                if (!path) return;
                const bbox = (path as SVGGraphicsElement).getBBox();
                const centerX = bbox.x + bbox.width / 2;
                const centerY = bbox.y + bbox.height / 2 + 3;
                
                // Split note name into letter and accidental
                const noteLetter = pitchName[0];
                const accidental = pitchName.slice(1);
                
                if (accidental) {
                  // Add white circle background for hollow notes
                  if (isHollow) {
                    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    circle.setAttribute('cx', centerX.toString());
                    circle.setAttribute('cy', (centerY - 3).toString());
                    circle.setAttribute('r', circleRadius.toString());
                    circle.setAttribute('fill', 'white');
                    circle.setAttribute('pointer-events', 'none');
                    circle.setAttribute('class', 'note-name-bg');
                    (targetNoteheadGroup as Element).appendChild(circle);
                  }
                  
                  // Create text with tspan for superscript accidental
                  const textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                  textElement.setAttribute('x', centerX.toString());
                  textElement.setAttribute('y', centerY.toString());
                  textElement.setAttribute('font-weight', 'bold');
                  textElement.setAttribute('fill', textColor);
                  textElement.setAttribute('text-anchor', 'middle');
                  textElement.setAttribute('pointer-events', 'none');
                  textElement.setAttribute('class', 'note-name-text');
                  
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
                  (targetNoteheadGroup as Element).appendChild(textElement);
                } else {
                  // Add white circle background for hollow notes
                  if (isHollow) {
                    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    circle.setAttribute('cx', centerX.toString());
                    circle.setAttribute('cy', (centerY - 3).toString());
                    circle.setAttribute('r', circleRadius.toString());
                    circle.setAttribute('fill', 'white');
                    circle.setAttribute('pointer-events', 'none');
                    (targetNoteheadGroup as Element).appendChild(circle);
                  }
                  
                  // No accidental, just the letter
                  const textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                  textElement.setAttribute('x', centerX.toString());
                  textElement.setAttribute('y', centerY.toString());
                  textElement.setAttribute('font-size', fontSize);
                  textElement.setAttribute('font-weight', 'bold');
                  textElement.setAttribute('fill', textColor);
                  textElement.setAttribute('text-anchor', 'middle');
                  textElement.setAttribute('pointer-events', 'none');
                  textElement.textContent = pitchName;
                  (targetNoteheadGroup as Element).appendChild(textElement);
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

  getTitle(): string {
    if (!this.osmd || !this.osmd.sheet) return '';
    return this.osmd.sheet.TitleString || '';
  }

  private midiToNoteName(midiNote: number): string {
    const noteNames = this.useFlats 
      ? ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']
      : ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
    const octave = Math.floor(midiNote / 12) - 1;
    const noteName = noteNames[midiNote % 12];
    return `${noteName}${octave}`;
  }

  private extractTempoFromMusicXML(xmlContent: string): void {
    this.tempoChanges.clear();
    
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');
      
      const parts = xmlDoc.querySelectorAll('part');
      if (parts.length === 0) return;
      
      // Only process first part to avoid duplicates
      const part = parts[0];
      const measures = part.querySelectorAll('measure');
      
      measures.forEach((measure, index) => {
        // Look for tempo in sound element
        const soundElement = measure.querySelector('sound[tempo]');
        if (soundElement) {
          const tempoAttr = soundElement.getAttribute('tempo');
          if (tempoAttr) {
            const tempo = parseFloat(tempoAttr);
            this.tempoChanges.set(index, tempo);
            console.log(`Tempo change at measure ${index + 1}: ${tempo} BPM`);
          }
        }
        
        // Look for metronome marking
        const metronome = measure.querySelector('metronome');
        if (metronome) {
          const beatUnit = metronome.querySelector('beat-unit')?.textContent;
          const perMinute = metronome.querySelector('per-minute')?.textContent;
          
          if (beatUnit && perMinute) {
            let tempo = parseFloat(perMinute);
            
            // Adjust for beat unit (if not quarter note)
            if (beatUnit === 'half') {
              tempo = tempo * 2;
            } else if (beatUnit === 'eighth') {
              tempo = tempo / 2;
            } else if (beatUnit === 'whole') {
              tempo = tempo * 4;
            }
            
            this.tempoChanges.set(index, tempo);
            console.log(`Tempo change at measure ${index + 1}: ${tempo} BPM (from metronome)`);
          }
        }
        
        // Look for direction with tempo words
        const directions = measure.querySelectorAll('direction');
        Array.from(directions).forEach((direction) => {
          const words = direction.querySelector('words')?.textContent?.toLowerCase();
          if (words) {
            let tempo = 0;
            if (words.includes('grave')) tempo = 40;
            else if (words.includes('largo')) tempo = 50;
            else if (words.includes('lento')) tempo = 60;
            else if (words.includes('adagio')) tempo = 70;
            else if (words.includes('andante')) tempo = 90;
            else if (words.includes('moderato')) tempo = 110;
            else if (words.includes('allegretto')) tempo = 115;
            else if (words.includes('allegro')) tempo = 140;
            else if (words.includes('vivace')) tempo = 160;
            else if (words.includes('presto')) tempo = 180;
            else if (words.includes('prestissimo')) tempo = 200;
            
            if (tempo > 0) {
              this.tempoChanges.set(index, tempo);
              console.log(`Tempo change at measure ${index + 1}: ${tempo} BPM (from ${words})`);
            }
          }
        });
      });
      
      // Set initial tempo
      if (this.tempoChanges.has(0)) {
        this.tempo = this.tempoChanges.get(0)!;
      } else {
        this.tempo = 120;
        console.log('No initial tempo found, using default: 120 BPM');
      }
      
    } catch (error) {
      console.error('Failed to extract tempo:', error);
      this.tempo = 120;
    }
  }

  private extractDynamicsFromMusicXML(xmlContent: string): void {
    this.noteDynamics.clear();
    
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');
      
      // Get divisions to convert duration to beats
      const firstDivisions = xmlDoc.querySelector('divisions');
      const divisionsPerQuarter = firstDivisions ? parseInt(firstDivisions.textContent || '1') : 1;
      
      const parts = xmlDoc.querySelectorAll('part');
      parts.forEach((part, partIndex) => {
        const measures = part.querySelectorAll('measure');
        measures.forEach((measure) => {
          const measureNumber = measure.getAttribute('number') || '0';
          const notes = measure.querySelectorAll('note');
          
          // Track timestamp in beats (quarter notes)
          let timestampInBeats = 0;
          
          notes.forEach((noteEl) => {
            // Skip if it's a chord note (doesn't advance time)
            const isChord = noteEl.querySelector('chord') !== null;
            
            const dynamics = noteEl.getAttribute('dynamics');
            const pitch = noteEl.querySelector('pitch');
            const staff = noteEl.querySelector('staff')?.textContent || '1';
            const voice = noteEl.querySelector('voice')?.textContent || '1';
            const duration = noteEl.querySelector('duration')?.textContent || '0';
            const durationInBeats = parseInt(duration) / divisionsPerQuarter;
            
            if (pitch && dynamics) {
              const step = pitch.querySelector('step')?.textContent || '';
              const octave = pitch.querySelector('octave')?.textContent || '';
              const alter = pitch.querySelector('alter')?.textContent || '0';
              
              // Convert to MIDI note
              const stepToMidi: { [key: string]: number } = {
                'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
              };
              const midiNote = (parseInt(octave) + 1) * 12 + stepToMidi[step] + parseInt(alter);
              
              // Create unique key using beats as timestamp
              const timestampKey = Math.round(timestampInBeats * 1000); // Use milliseconds precision
              const key = `${measureNumber}-${staff}-${voice}-${timestampKey}-${midiNote}`;
              const dynamicsValue = parseFloat(dynamics);
              this.noteDynamics.set(key, dynamicsValue);
            }
            
            if (!isChord) {
              timestampInBeats += durationInBeats;
            }
          });
        });
      });
      
    } catch (error) {
      console.error('Failed to extract dynamics:', error);
    }
  }

  private parseNotes(): void {
    if (!this.osmd) return;

    this.noteGroups = [];
    this.noteGroupToCursorPosition.clear();
    this.sourceNoteToGroupIndex.clear();
    const sheet = this.osmd.Sheet;
    
    const notesByTimestamp = new Map<number, Note[]>();
    const timestampToCursorPosition = new Map<number, number>();
    const timestampToSourceNotes = new Map<number, any[]>();
    let globalTimestamp = 0;
    let cursorPosition = 0;

    try {
      // First, build a map of graphical notes to their visual measure index
      const graphicalNoteToMeasureIndex = new Map<any, number>();
      
      this.osmd.GraphicSheet.MeasureList.forEach((measureList: any, visualMeasureIndex: number) => {
        measureList.forEach((measure: any) => {
          if (!measure?.staffEntries) return;
          measure.staffEntries.forEach((staffEntry: any) => {
            if (!staffEntry?.graphicalVoiceEntries) return;
            staffEntry.graphicalVoiceEntries.forEach((graphicalVoiceEntry: any) => {
              if (!graphicalVoiceEntry?.notes) return;
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
      
      // Track all entries (notes and rests) by timestamp to calculate proper delays
      const timestampToAbsoluteTime = new Map<number, number>(); // timestamp -> localTimestamp (absolute position)
      let cumulativeTime = 0; // Track absolute time across entire piece
      
      // Now parse notes using the visual measure index
      for (let measureIndex = 0; measureIndex < sheet.SourceMeasures.length; measureIndex++) {
        const measure = sheet.SourceMeasures[measureIndex];
        const measureTimestamps = new Map<number, number>();
        const measureStartTime = cumulativeTime;
        
        for (const verticalContainer of measure.VerticalSourceStaffEntryContainers) {
          const localTimestamp = verticalContainer.Timestamp.RealValue;
          
          // Check if this container has any actual notes (not just rests)
          let hasNotes = false;
          
          for (let staffIndex = 0; staffIndex < verticalContainer.StaffEntries.length; staffIndex++) {
            const entry = verticalContainer.StaffEntries[staffIndex];
            if (!entry) continue;
            
            const hand = staffIndex === 0 ? 'right' : 'left';
            const voiceEntries = entry.VoiceEntries;
            if (!voiceEntries) continue;
            
            for (const voiceEntry of voiceEntries) {
              if (!voiceEntry?.Notes) continue;
              
              for (const note of voiceEntry.Notes) {
                // Skip rests and notes that shouldn't be printed for note groups
                if (!note?.Pitch) continue;
                // @ts-ignore
                const isRest = note.isRestFlag === true;
                if (isRest) continue;
                // @ts-ignore - accessing private properties
                if (note.printObject === false) continue;
                
                // This container has at least one note
                hasNotes = true;
                
                // Assign timestamp only when we find the first note at this position
                if (!measureTimestamps.has(localTimestamp)) {
                  measureTimestamps.set(localTimestamp, globalTimestamp);
                  timestampToCursorPosition.set(globalTimestamp, cursorPosition);
                  // Store absolute time across entire piece
                  timestampToAbsoluteTime.set(globalTimestamp, measureStartTime + localTimestamp);
                  globalTimestamp++;
                }
                
                const timestamp = measureTimestamps.get(localTimestamp)!;
                
                try {
                  const midiNote = note.Pitch.getHalfTone() + 12;
                  
                  // Get visual measure index from graphical note mapping
                  const visualMeasureIndex = graphicalNoteToMeasureIndex.get(note) ?? measureIndex;
                  
                  // Get velocity from extracted dynamics
                  let velocity = 0.7; // Default
                  
                  // Try to find dynamics using measure/staff/voice/timestamp/pitch
                  const measureNum = (visualMeasureIndex + 1).toString();
                  const staffNum = (staffIndex + 1).toString();
                  const voiceNum = voiceEntry.ParentVoice?.VoiceId?.toString() || '1';
                  
                  // Convert localTimestamp (in beats) to milliseconds precision
                  const timestampKey = Math.round(localTimestamp * 1000);
                  
                  // Try a small range around the timestamp
                  for (let offset = -2; offset <= 2; offset++) {
                    const key = `${measureNum}-${staffNum}-${voiceNum}-${timestampKey + offset}-${midiNote}`;
                    const dynamicsValue = this.noteDynamics.get(key);
                    if (dynamicsValue !== undefined) {
                      velocity = Math.max(0.1, Math.min(1.0, dynamicsValue / 127));
                      break;
                    }
                  }
                  
                  // Check for ties
                  const isTied = !!note.NoteTie;
                  
                  const duration = note.Length.RealValue;
                  
                  const noteData: Note = {
                    pitch: midiNote,
                    hand,
                    duration,
                    measureIndex: visualMeasureIndex,
                    timestamp,
                    velocity,
                    isTied,
                  };

                  if (!notesByTimestamp.has(timestamp)) {
                    notesByTimestamp.set(timestamp, []);
                  }
                  notesByTimestamp.get(timestamp)!.push(noteData);
                  
                  // Store source note for click mapping
                  if (!timestampToSourceNotes.has(timestamp)) {
                    timestampToSourceNotes.set(timestamp, []);
                  }
                  timestampToSourceNotes.get(timestamp)!.push(note);
                } catch (e) {
                  console.warn('Failed to parse note:', e);
                }
              }
            }
          }
          
          // Increment cursor position for every container (including rests)
          cursorPosition++;
        }
        
        // Update cumulative time for next measure
        // Get the measure length from the last timestamp + its duration
        const measureLength = measure.Duration.RealValue;
        cumulativeTime += measureLength;
      }

      const sortedTimestamps = Array.from(notesByTimestamp.keys()).sort((a, b) => a - b);
      
      for (const timestamp of sortedTimestamps) {
        const notes = notesByTimestamp.get(timestamp)!;
        if (notes.length > 0) {
          const noteGroupIndex = this.noteGroups.length;
          const measureIndex = notes[0].measureIndex;
          
          // Find the tempo for this measure (use most recent tempo change)
          let tempo = this.tempo;
          for (let m = measureIndex; m >= 0; m--) {
            if (this.tempoChanges.has(m)) {
              tempo = this.tempoChanges.get(m)!;
              break;
            }
          }
          
          // Get absolute time position
          const absoluteTime = timestampToAbsoluteTime.get(timestamp) || 0;
          
          this.noteGroups.push({
            notes,
            timestamp,
            measureIndex,
            tempo,
            absoluteTime,
          });
          
          // Log first measure (index 0)
          if (measureIndex === 0) {
            const durations = notes.map(n => `${n.duration}${n.isRest ? 'R' : ''}${n.isTied ? 'T' : ''}`).join(', ');
            console.log(`Measure ${measureIndex + 1}, Group ${noteGroupIndex}, Timestamp ${timestamp}, AbsTime ${absoluteTime}: notes=[${durations}]`);
          }
          
          // Map note group index to cursor position
          const cursorPos = timestampToCursorPosition.get(timestamp);
          if (cursorPos !== undefined) {
            this.noteGroupToCursorPosition.set(noteGroupIndex, cursorPos);
          }
          
          // Map all source notes in this group to the note group index
          const sourceNotes = timestampToSourceNotes.get(timestamp);
          if (sourceNotes) {
            sourceNotes.forEach(sourceNote => {
              this.sourceNoteToGroupIndex.set(sourceNote, noteGroupIndex);
            });
          }
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

  getTempo(): number {
    return this.tempo;
  }

  moveCursorToNoteGroup(index: number): void {
    if (!this.osmd || index < 0 || index >= this.noteGroups.length) return;
    
    // Get the actual cursor position for this note group
    const targetPosition = this.noteGroupToCursorPosition.get(index);
    if (targetPosition === undefined) return;
    
    // Calculate the difference from current position
    const diff = targetPosition - this.currentCursorPosition;
    
    if (diff === 0) {
      // Already at the right position
      this.scrollCursorIntoView();
      return;
    }
    
    if (diff > 0) {
      // Move forward
      for (let i = 0; i < diff && !this.osmd.cursor.iterator.EndReached; i++) {
        this.osmd.cursor.next();
      }
    } else {
      // Moving backward - need to reset and move forward
      // But only if the distance backward is significant
      if (Math.abs(diff) > targetPosition / 2) {
        // If we're going back more than halfway, just reset and go forward
        this.osmd.cursor.reset();
        this.currentCursorPosition = 0;
        for (let i = 0; i < targetPosition && !this.osmd.cursor.iterator.EndReached; i++) {
          this.osmd.cursor.next();
        }
      } else {
        // Otherwise reset and move forward (no backward movement in OSMD cursor)
        this.osmd.cursor.reset();
        this.currentCursorPosition = 0;
        for (let i = 0; i < targetPosition && !this.osmd.cursor.iterator.EndReached; i++) {
          this.osmd.cursor.next();
        }
      }
    }
    
    this.currentCursorPosition = targetPosition;
    
    // Auto-scroll to keep cursor in view
    this.scrollCursorIntoView();
  }

  scrollCursorIntoView(): void {
    if (!this.osmd) return;
    
    const scoreContainer = document.querySelector('.score-container');
    if (!scoreContainer) return;
    
    // Find the cursor image element
    const cursorImg = document.querySelector('[id^="cursorImg-"]') as HTMLElement;
    if (!cursorImg) {
      return;
    }
    
    // Get the top position from the style attribute
    const topStyle = cursorImg.style.top;
    if (!topStyle) {
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
  }

  resetCursor(): void {
    if (!this.osmd) return;
    this.osmd.cursor.reset();
    this.currentCursorPosition = 0;
    
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
