import type { NoteGroup } from './shared/types';

/**
 * Represents a single step in the playback sequence
 */
export interface PlaybackStep {
  noteGroupIndex: number; // Index into the original linear noteGroups array
  measureIndex: number;   // Visual measure number
  repetitionIteration: number; // Which iteration of a repeat (0 = first time, 1 = second time, etc.)
}

interface RepeatSection {
  startMeasure: number;
  endMeasure: number;
  repeatCount: number;
  endings: VoltaEnding[];
}

interface VoltaEnding {
  startMeasure: number;
  endMeasure: number;
  iterations: number[]; // Which iterations this ending is for (1-indexed)
}

/**
 * Handles repeat logic for music playback
 * Parses OSMD repetition data and creates an expanded playback order
 */
export class RepeatHandler {
  private playbackSequence: PlaybackStep[] = [];
  private noteGroups: NoteGroup[] = [];
  
  /**
   * Build the playback sequence from OSMD repetition data
   * @param osmd - OpenSheetMusicDisplay instance
   * @param noteGroups - Linear array of note groups from score
   */
  buildPlaybackSequence(osmd: any, noteGroups: NoteGroup[]): void {
    this.noteGroups = noteGroups;
    this.playbackSequence = [];
    
    const sheet = osmd.Sheet;
    const sourceMeasures = sheet.SourceMeasures;
    
    // Parse repetition instructions from source measures
    const repeatInfo = this.parseRepetitionInstructions(sourceMeasures);
    
    if (repeatInfo.length === 0) {
      // No repeats - simple linear playback
      this.buildLinearSequence();
      return;
    }
    
    // Build sequence with repeats
    this.buildSequenceFromRepeatInfo(repeatInfo);
    
    // Log the measure sequence for debugging
    const measureSequence: number[] = [];
    let lastMeasure = -1;
    for (const step of this.playbackSequence) {
      if (step.measureIndex !== lastMeasure) {
        measureSequence.push(step.measureIndex + 1); // +1 for 1-indexed display
        lastMeasure = step.measureIndex;
      }
    }
    console.log('Measure playback order:', measureSequence.join(' -> '));
  }
  
  /**
   * Parse repetition instructions from source measures
   */
  private parseRepetitionInstructions(sourceMeasures: any[]): RepeatSection[] {
    const sections: RepeatSection[] = [];
    
    for (let i = 0; i < sourceMeasures.length; i++) {
      const measure = sourceMeasures[i];
      
      // Check for repeat start (forward repeat barline)
      if (measure.beginsWithLineRepetition && measure.beginsWithLineRepetition()) {
        // Find the matching end
        let endMeasure = -1;
        let endings: VoltaEnding[] = [];
        
        for (let j = i + 1; j < sourceMeasures.length; j++) {
          // Check for volta brackets
          if (sourceMeasures[j].beginsRepetitionEnding && sourceMeasures[j].beginsRepetitionEnding()) {
            // Find which volta number(s) this is
            const firstInstructions = sourceMeasures[j].FirstRepetitionInstructions;
            
            if (firstInstructions && firstInstructions.length > 0) {
              const endingIndices = firstInstructions[0].endingIndices || [];
              
              // Find where this ending ends (look for backward repeat or next ending)
              let endingEnd = j;
              for (let k = j + 1; k < sourceMeasures.length; k++) {
                // Check if this measure has a backward repeat - that's where the ending ends
                if (sourceMeasures[k].endsWithLineRepetition && sourceMeasures[k].endsWithLineRepetition()) {
                  endingEnd = k;
                  break;
                }
                // Check if next measure starts a new ending
                if (sourceMeasures[k].beginsRepetitionEnding && sourceMeasures[k].beginsRepetitionEnding()) {
                  endingEnd = k - 1;
                  break;
                }
              }
              
              endings.push({
                startMeasure: j,
                endMeasure: endingEnd,
                iterations: endingIndices
              });
            }
          }
          
          if (sourceMeasures[j].endsWithLineRepetition && sourceMeasures[j].endsWithLineRepetition()) {
            endMeasure = j;
            
            // Check if this measure is also a volta ending (volta 2)
            if (sourceMeasures[j].beginsRepetitionEnding && sourceMeasures[j].beginsRepetitionEnding()) {
              const firstInstructions = sourceMeasures[j].FirstRepetitionInstructions;
              if (firstInstructions && firstInstructions.length > 0) {
                const endingIndices = firstInstructions[0].endingIndices || [];
                
                endings.push({
                  startMeasure: j,
                  endMeasure: j,
                  iterations: endingIndices
                });
              }
            }
            
            break;
          }
        }
        
        if (endMeasure === -1) {
          // No explicit end, repeat to end of piece
          endMeasure = sourceMeasures.length - 1;
        }
        
        sections.push({
          startMeasure: i,
          endMeasure: endMeasure,
          repeatCount: 2,
          endings: endings
        });
      } else if (measure.endsWithLineRepetition && measure.endsWithLineRepetition()) {
        // Backward repeat without explicit start - repeat from beginning or last section
        const lastSection = sections[sections.length - 1];
        if (!lastSection || lastSection.endMeasure < i) {
          const startMeasure = lastSection ? lastSection.endMeasure + 1 : 0;
          sections.push({
            startMeasure: startMeasure,
            endMeasure: i,
            repeatCount: 2,
            endings: []
          });
        }
      }
    }
    
    return sections;
  }
  
  /**
   * Build playback sequence from parsed repeat information
   */
  private buildSequenceFromRepeatInfo(repeatInfo: RepeatSection[]): void {
    const measureToNoteGroups = this.buildMeasureMap();
    const maxMeasure = Math.max(...this.noteGroups.map(ng => ng.measureIndex));
    
    let currentMeasure = 0;
    
    while (currentMeasure <= maxMeasure) {
      // Check if we're at the start of a repeat section
      const repeatSection = repeatInfo.find(r => r.startMeasure === currentMeasure);
      
      if (repeatSection) {
        // Find the measure before any endings start
        let commonEndMeasure = repeatSection.endMeasure;
        if (repeatSection.endings.length > 0) {
          // Common section ends just before the first ending
          commonEndMeasure = Math.min(...repeatSection.endings.map(e => e.startMeasure)) - 1;
        }
        
        // Play the repeat section multiple times
        for (let iteration = 1; iteration <= repeatSection.repeatCount; iteration++) {
          // Play common section (before endings)
          for (let m = repeatSection.startMeasure; m <= commonEndMeasure; m++) {
            this.addMeasureToSequence(m, measureToNoteGroups, iteration - 1);
          }
          
          // Play the appropriate ending for this iteration
          if (repeatSection.endings.length > 0) {
            const ending = repeatSection.endings.find(e => 
              e.iterations.includes(iteration)
            );
            
            if (ending) {
              for (let m = ending.startMeasure; m <= ending.endMeasure; m++) {
                this.addMeasureToSequence(m, measureToNoteGroups, iteration - 1);
              }
            }
          } else {
            // No endings, play up to the end measure (the one with backward repeat)
            // But don't play it twice - it's already in the common section
            // Only play if commonEndMeasure < endMeasure
            for (let m = commonEndMeasure + 1; m <= repeatSection.endMeasure; m++) {
              this.addMeasureToSequence(m, measureToNoteGroups, iteration - 1);
            }
          }
        }
        
        // Move past this repeat section
        if (repeatSection.endings.length > 0) {
          // Jump to after the last ending
          currentMeasure = Math.max(...repeatSection.endings.map(e => e.endMeasure)) + 1;
        } else {
          currentMeasure = repeatSection.endMeasure + 1;
        }
      } else {
        // Check if this measure is inside a repeat we've already processed
        const insideRepeat = repeatInfo.some(r => {
          if (currentMeasure >= r.startMeasure && currentMeasure <= r.endMeasure) {
            return true;
          }
          // Also check if inside any ending
          return r.endings.some(e => 
            currentMeasure >= e.startMeasure && currentMeasure <= e.endMeasure
          );
        });
        
        if (!insideRepeat) {
          // Normal measure, not part of any repeat
          this.addMeasureToSequence(currentMeasure, measureToNoteGroups, 0);
        }
        
        currentMeasure++;
      }
    }
  }
  
  /**
   * Build a simple linear playback sequence (no repeats)
   */
  private buildLinearSequence(): void {
    for (let i = 0; i < this.noteGroups.length; i++) {
      this.playbackSequence.push({
        noteGroupIndex: i,
        measureIndex: this.noteGroups[i].measureIndex,
        repetitionIteration: 0
      });
    }
  }
  
  /**
   * Build playback sequence with repeat logic
   */
  private buildSequenceWithRepeats(repetitions: any[]): void {
    // Create a map of measure indices to note group ranges
    const measureToNoteGroups = this.buildMeasureMap();
    
    // Track which measures have been processed
    const processedMeasures = new Set<number>();
    let currentMeasure = 0;
    const maxMeasure = Math.max(...this.noteGroups.map(ng => ng.measureIndex));
    
    while (currentMeasure <= maxMeasure) {
      // Check if this measure is part of a repetition
      const repetition = this.findRepetitionForMeasure(currentMeasure, repetitions);
      
      if (repetition && !processedMeasures.has(currentMeasure)) {
        // Process the entire repetition
        this.processRepetition(repetition, measureToNoteGroups, processedMeasures);
        currentMeasure = repetition.EndIndex + 1;
      } else if (!processedMeasures.has(currentMeasure)) {
        // Add this measure normally
        this.addMeasureToSequence(currentMeasure, measureToNoteGroups, 0);
        processedMeasures.add(currentMeasure);
        currentMeasure++;
      } else {
        currentMeasure++;
      }
    }
  }
  
  /**
   * Build a map from measure index to note group indices
   */
  private buildMeasureMap(): Map<number, number[]> {
    const map = new Map<number, number[]>();
    
    for (let i = 0; i < this.noteGroups.length; i++) {
      const measureIndex = this.noteGroups[i].measureIndex;
      if (!map.has(measureIndex)) {
        map.set(measureIndex, []);
      }
      map.get(measureIndex)!.push(i);
    }
    
    return map;
  }
  
  /**
   * Find the repetition that contains the given measure
   */
  private findRepetitionForMeasure(measureIndex: number, repetitions: any[]): any | null {
    for (const rep of repetitions) {
      if (measureIndex >= rep.StartIndex && measureIndex <= rep.EndIndex) {
        return rep;
      }
    }
    return null;
  }
  
  /**
   * Process a repetition and add it to the playback sequence
   */
  private processRepetition(
    repetition: any,
    measureToNoteGroups: Map<number, number[]>,
    processedMeasures: Set<number>
  ): void {
    const startMeasure = repetition.StartIndex;
    const endMeasure = repetition.EndIndex;
    const numRepetitions = repetition.UserNumberOfRepetitions || repetition.DefaultNumberOfRepetitions || 2;
    const endings = repetition.EndingParts || [];
    
    console.log(`Processing repetition: measures ${startMeasure}-${endMeasure}, ${numRepetitions} times, ${endings.length} endings`);
    
    // Handle simple repeats (no endings)
    if (endings.length === 0) {
      for (let iteration = 0; iteration < numRepetitions; iteration++) {
        for (let m = startMeasure; m <= endMeasure; m++) {
          this.addMeasureToSequence(m, measureToNoteGroups, iteration);
          processedMeasures.add(m);
        }
      }
      return;
    }
    
    // Handle repeats with endings (voltas)
    this.processRepetitionWithEndings(
      repetition,
      startMeasure,
      endMeasure,
      numRepetitions,
      endings,
      measureToNoteGroups,
      processedMeasures
    );
  }
  
  /**
   * Process a repetition with volta endings
   */
  private processRepetitionWithEndings(
    repetition: any,
    startMeasure: number,
    endMeasure: number,
    numRepetitions: number,
    endings: any[],
    measureToNoteGroups: Map<number, number[]>,
    processedMeasures: Set<number>
  ): void {
    // Find the earliest ending start
    let earliestEndingStart = endMeasure + 1;
    for (const ending of endings) {
      const endingStart = ending.part?.AbsoluteTimestamp?.RealValue || 0;
      // Convert timestamp to measure index (approximate)
      const endingMeasure = this.findMeasureForTimestamp(endingStart);
      if (endingMeasure < earliestEndingStart) {
        earliestEndingStart = endingMeasure;
      }
    }
    
    // Play the common section before endings for each iteration
    for (let iteration = 0; iteration < numRepetitions; iteration++) {
      // Play measures before the endings
      for (let m = startMeasure; m < earliestEndingStart; m++) {
        this.addMeasureToSequence(m, measureToNoteGroups, iteration);
        processedMeasures.add(m);
      }
      
      // Play the appropriate ending for this iteration
      const endingForIteration = this.findEndingForIteration(iteration, endings, repetition);
      if (endingForIteration) {
        this.playEnding(endingForIteration, measureToNoteGroups, iteration, processedMeasures);
      }
    }
  }
  
  /**
   * Find which ending should be played for a given iteration
   */
  private findEndingForIteration(iteration: number, endings: any[], repetition: any): any | null {
    // Iteration is 0-indexed, but ending indices are 1-indexed
    const iterationNumber = iteration + 1;
    
    for (const ending of endings) {
      if (ending.endingIndices && ending.endingIndices.includes(iterationNumber)) {
        return ending;
      }
    }
    
    // Fallback: use the last ending
    return endings[endings.length - 1] || null;
  }
  
  /**
   * Play an ending section
   */
  private playEnding(
    ending: any,
    measureToNoteGroups: Map<number, number[]>,
    iteration: number,
    processedMeasures: Set<number>
  ): void {
    // Get the measure range for this ending
    // This is approximate - OSMD's ending structure is complex
    const endingDict = ending.parentRepetition?.EndingIndexDict || {};
    
    // For now, use a simple approach: find measures that match this ending
    // This may need refinement based on actual OSMD data structure
    for (const [measureIndex, noteGroupIndices] of measureToNoteGroups.entries()) {
      // Check if this measure is part of the ending
      // (This is a simplified check - may need adjustment)
      if (endingDict[measureIndex]) {
        this.addMeasureToSequence(measureIndex, measureToNoteGroups, iteration);
        processedMeasures.add(measureIndex);
      }
    }
  }
  
  /**
   * Find the measure index for a given timestamp
   */
  private findMeasureForTimestamp(timestamp: number): number {
    // Find the note group closest to this timestamp
    for (let i = 0; i < this.noteGroups.length; i++) {
      const ng = this.noteGroups[i];
      if (ng.absoluteTime !== undefined && ng.absoluteTime >= timestamp) {
        return ng.measureIndex;
      }
    }
    return this.noteGroups.length > 0 ? this.noteGroups[this.noteGroups.length - 1].measureIndex : 0;
  }
  
  /**
   * Add all note groups from a measure to the playback sequence
   */
  private addMeasureToSequence(
    measureIndex: number,
    measureToNoteGroups: Map<number, number[]>,
    iteration: number
  ): void {
    const noteGroupIndices = measureToNoteGroups.get(measureIndex) || [];
    for (const ngIndex of noteGroupIndices) {
      this.playbackSequence.push({
        noteGroupIndex: ngIndex,
        measureIndex,
        repetitionIteration: iteration
      });
    }
  }
  
  /**
   * Get the playback sequence
   */
  getPlaybackSequence(): PlaybackStep[] {
    return this.playbackSequence;
  }
  
  /**
   * Get the total number of steps in the playback sequence
   */
  getSequenceLength(): number {
    return this.playbackSequence.length;
  }
  
  /**
   * Get the note group index for a given playback position
   */
  getNoteGroupIndexForPosition(position: number): number {
    if (position < 0 || position >= this.playbackSequence.length) {
      return -1;
    }
    return this.playbackSequence[position].noteGroupIndex;
  }
  
  /**
   * Find the playback position for a given note group index
   * Returns the first occurrence in the playback sequence
   */
  getPositionForNoteGroupIndex(noteGroupIndex: number): number {
    return this.playbackSequence.findIndex(step => step.noteGroupIndex === noteGroupIndex);
  }
}
