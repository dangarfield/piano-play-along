import { MidiHandler } from './midi-handler';
import { ScoreRenderer } from './score-renderer';
import { PracticeEngine } from './practice-engine';
import { UIController } from './ui-controller';
import { SoundHandler } from './sound-handler';
import { PlaybackEngine } from './playback-engine';
import type { PracticeMode } from './shared/types';
import { SimpleKeyboard } from './simple-keyboard';
import * as Tone from 'tone';

interface AppConfig {
  practiceMode: PracticeMode;
  zoomLevel: number;
  voiceCommandsEnabled: boolean;
  keyboardSize: number;
  showNoteNames: boolean;
  tempoMultiplier: number;
}

class App {
  private midiHandler: MidiHandler;
  private scoreRenderer: ScoreRenderer;
  private practiceEngine: PracticeEngine;
  private uiController: UIController;
  private soundHandler: SoundHandler;
  private playbackEngine!: PlaybackEngine;
  private keyboard!: SimpleKeyboard;
  private readonly CONFIG_KEY = 'piano-play-along-config';
  private readonly SCORE_KEY = 'piano-play-along-saved-score';

  constructor() {
    this.midiHandler = new MidiHandler();
    this.scoreRenderer = new ScoreRenderer();
    this.practiceEngine = new PracticeEngine();
    this.uiController = new UIController();
    this.soundHandler = new SoundHandler();

    this.initialize();
  }

  private getConfig(): AppConfig {
    const stored = localStorage.getItem(this.CONFIG_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.error('Failed to parse config:', e);
      }
    }
    return {
      practiceMode: 'both',
      zoomLevel: 1.25,
      voiceCommandsEnabled: true,
      keyboardSize: 135,
      showNoteNames: false,
      tempoMultiplier: 1.0,
    };
  }

  private saveConfig(updates: Partial<AppConfig>): void {
    const config = { ...this.getConfig(), ...updates };
    localStorage.setItem(this.CONFIG_KEY, JSON.stringify(config));
  }

  private getSavedScore(): string | null {
    return localStorage.getItem(this.SCORE_KEY);
  }

  private saveScore(content: string): void {
    localStorage.setItem(this.SCORE_KEY, content);
  }

  private clearSavedScore(): void {
    localStorage.removeItem(this.SCORE_KEY);
  }

  private async initialize(): Promise<void> {
    await this.initializeMidi();
    await this.initializeSound();
    this.initializeKeyboard();
    this.setupEventListeners();
    this.setupVoiceCommands();
    
    // Setup score library click handlers
    this.setupScoreLibrary();
    
    // Try to load saved score
    await this.loadSavedScore();
    
    // Re-render on window resize
    window.addEventListener('resize', () => {
      this.scoreRenderer.render();
      this.scoreRenderer.scrollCursorIntoView();
      
      // Re-render keyboard to recalculate black key positions
      if (this.keyboard) {
        const container = document.getElementById('piano-keyboard-container');
        if (container) {
          this.keyboard.destroy();
          this.keyboard = new SimpleKeyboard(container);
          this.keyboard.setUseFlats(this.scoreRenderer.getUseFlats());
          
          // Restore highlighted notes
          const expectedNotes = this.practiceEngine.getCurrentExpectedNotes();
          expectedNotes.forEach(note => {
            this.keyboard.highlightNote(note);
          });
        }
      }
    });
  }

  private initializeKeyboard(): void {
    const container = document.getElementById('piano-keyboard-container');
    if (!container) return;

    this.keyboard = new SimpleKeyboard(container);
    
    // Ensure keyboard container is hidden on init
    const keyboardContainer = document.querySelector('.keyboard-container') as HTMLElement;
    if (keyboardContainer) {
      keyboardContainer.style.display = 'none';
      console.log('initializeKeyboard: Set keyboard display to none');
    }
    
    // Set up keyboard click handler to emulate MIDI
    this.keyboard.onNoteClick((note) => {
      console.log('Keyboard note click callback:', note);
      
      // Play the sound
      const tempo = 120;
      const msPerQuarterNote = 60000 / tempo;
      const duration = 0.5 * msPerQuarterNote * 4 / 1000; // Quarter note duration
      this.soundHandler.playNote(note, duration, 0.7);
      
      // Only handle as MIDI input if playback is not active
      if (this.playbackEngine && !this.playbackEngine.getIsPlaying()) {
        // Emulate MIDI note on
        this.practiceEngine.handleNoteOn(note);
        
        const expectedNotes = this.practiceEngine.getCurrentExpectedNotes();
        const isCorrect = expectedNotes.includes(note);
        this.keyboard.keyDown(note, isCorrect);
        
        // Auto release after 200ms
        setTimeout(() => {
          this.practiceEngine.handleNoteOff(note);
          this.keyboard.keyUp(note);
        }, 200);
      }
    });
  }

  private async initializeMidi(): Promise<void> {
    try {
      // Set up callbacks BEFORE initializing
      this.midiHandler.onDeviceChange((devices) => {
        console.log('MIDI devices detected:', devices);
        this.updateMidiDeviceList(devices);
        
        // Show toast notification
        if (devices.length > 0) {
          this.showToast(`✓ MIDI device connected: ${devices[0].name}`);
        } else {
          this.showToast('⚠ No MIDI devices found');
        }
      });

      this.midiHandler.onNoteOn((note, velocity) => {
        console.log('Note ON:', note, velocity);
        
        // Only handle MIDI input if playback is not active
        if (!this.playbackEngine.getIsPlaying()) {
          this.practiceEngine.handleNoteOn(note);
        }
        
        const expectedNotes = this.practiceEngine.getCurrentExpectedNotes();
        const isCorrect = expectedNotes.includes(note);
        this.keyboard.keyDown(note, isCorrect);
      });

      this.midiHandler.onNoteOff((note) => {
        console.log('Note OFF:', note);
        
        // Only handle MIDI input if playback is not active
        if (!this.playbackEngine.getIsPlaying()) {
          this.practiceEngine.handleNoteOff(note);
        }
        this.keyboard.keyUp(note);
      });

      // Now initialize MIDI
      await this.midiHandler.initialize();
      console.log('MIDI initialized, checking for devices...');

      this.practiceEngine.onProgress((state) => {
        const expectedNotes = this.practiceEngine.getCurrentExpectedNotes();
        this.uiController.updatePianoKeys(state, expectedNotes);
        
        // Get current tempo from note group
        const currentGroup = state.score[state.currentNoteGroupIndex];
        const tempo = currentGroup?.tempo || 120;
        
        // Update header info
        const headerRightNotes = document.getElementById('header-right-notes');
        const headerLeftNotes = document.getElementById('header-left-notes');
        
        if (headerRightNotes && headerLeftNotes) {
          const currentGroup = state.score[state.currentNoteGroupIndex];
          if (currentGroup && currentGroup.notes.length > 0) {
            const sharpNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            const flatNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
            const useFlats = this.scoreRenderer.getUseFlats();
            const noteNames = useFlats ? flatNames : sharpNames;
            
            // Split notes by hand property
            const rightHandNotes = currentGroup.notes.filter(n => n.hand === 'right' && !n.isRest).map(n => n.pitch);
            const leftHandNotes = currentGroup.notes.filter(n => n.hand === 'left' && !n.isRest).map(n => n.pitch);
            
            const formatNotes = (notes: number[]) => {
              if (notes.length === 0) return '-';
              return notes.sort((a, b) => a - b).map(n => {
                const octave = Math.floor(n / 12) - 1;
                const noteName = noteNames[n % 12];
                return `${noteName}${octave}`;
              }).join(', ');
            };
            
            headerRightNotes.textContent = formatNotes(rightHandNotes);
            headerLeftNotes.textContent = formatNotes(leftHandNotes);
          } else {
            headerRightNotes.textContent = '-';
            headerLeftNotes.textContent = '-';
          }
        }
        
        // Move cursor to current position
        this.scoreRenderer.moveCursorToNoteGroup(state.currentNoteGroupIndex);
        
        // Update highlighted notes
        this.keyboard.clearHighlights();
        expectedNotes.forEach(note => {
          this.keyboard.highlightNote(note);
        });
      });

      // Setup auto-play for other hand
      this.practiceEngine.onAutoPlay((notes, tempo) => {
        console.log('Auto-play callback triggered:', notes.length, 'notes');
        notes.forEach(note => {
          const msPerQuarterNote = 60000 / tempo;
          const duration = note.duration * msPerQuarterNote * 4 / 1000; // Same calculation as playback
          console.log(`Playing auto note ${note.pitch} for ${duration}s`);
          this.soundHandler.playNote(note.pitch, duration, note.velocity);
        });
      });

    } catch (error) {
      console.error('Failed to initialize MIDI:', error);
      alert('MIDI is not supported in this browser or permission was denied. Please use Chrome, Edge, or Opera.');
    }
  }

  private async initializeSound(): Promise<void> {
    try {
      await this.soundHandler.initialize();
      this.scoreRenderer.setSoundHandler(this.soundHandler);
      this.playbackEngine = new PlaybackEngine(this.soundHandler);
      
      // Setup playback callbacks
      this.playbackEngine.onProgress((index) => {
        this.scoreRenderer.moveCursorToNoteGroup(index);
        this.practiceEngine.jumpToNoteGroup(index);
      });
      
      this.playbackEngine.onComplete(() => {
        this.uiController.updatePlayButton(false);
      });
      
      console.log('Sound initialized');
    } catch (error) {
      console.error('Failed to initialize sound:', error);
    }
  }

  private setupEventListeners(): void {
    const config = this.getConfig();
    
    // Header: Close button
    document.getElementById('close-score-btn')?.addEventListener('click', () => {
      if (this.playbackEngine.getIsPlaying()) {
        this.playbackEngine.stop();
      }
      this.clearScore();
    });
    
    // List header: Upload button
    const uploadScoreBtn = document.getElementById('upload-score-btn');
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    uploadScoreBtn?.addEventListener('click', () => {
      fileInput?.click();
    });
    
    fileInput?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        await this.loadScore(file);
        // Reset file input so same file can be selected again
        fileInput.value = '';
      }
    });
    
    // Header: Play/Stop button
    const headerPlayBtn = document.getElementById('header-play-btn');
    headerPlayBtn?.addEventListener('click', () => {
      if (this.playbackEngine.getIsPlaying()) {
        this.playbackEngine.stop();
        if (headerPlayBtn) {
          headerPlayBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3l14 9-14 9V3z"/></svg>';
          headerPlayBtn.classList.remove('active');
        }
        this.practiceEngine.start();
      } else {
        const currentIndex = this.practiceEngine.getState().currentNoteGroupIndex;
        this.practiceEngine.pause();
        this.playbackEngine.play(currentIndex);
        if (headerPlayBtn) {
          headerPlayBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
          headerPlayBtn.classList.add('active');
        }
      }
    });
    
    // Header: Reset button
    document.getElementById('header-reset-btn')?.addEventListener('click', () => {
      this.practiceEngine.reset();
      this.scoreRenderer.resetCursor();
      this.practiceEngine.start();
      if (this.playbackEngine.getIsPlaying()) {
        this.playbackEngine.stop();
        const headerPlayBtn = document.getElementById('header-play-btn');
        if (headerPlayBtn) {
          headerPlayBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3l14 9-14 9V3z"/></svg>';
          headerPlayBtn.classList.remove('active');
        }
      }
    });
    
    // Header: Tempo slider
    const headerTempoSlider = document.getElementById('header-tempo-slider') as HTMLInputElement;
    const headerTempoValue = document.getElementById('header-tempo-value');
    if (headerTempoSlider && headerTempoValue) {
      headerTempoSlider.value = config.tempoMultiplier.toString();
      headerTempoValue.textContent = config.tempoMultiplier === 1.0 ? '1x' : `${config.tempoMultiplier.toFixed(1)}x`;
      this.playbackEngine.setTempoMultiplier(config.tempoMultiplier);
      
      headerTempoSlider.addEventListener('input', (e) => {
        const multiplier = parseFloat((e.target as HTMLInputElement).value);
        if (headerTempoValue) {
          headerTempoValue.textContent = multiplier === 1.0 ? '1x' : `${multiplier.toFixed(1)}x`;
        }
        this.playbackEngine.setTempoMultiplier(multiplier);
        this.saveConfig({ tempoMultiplier: multiplier });
      });
    }
    
    // Header: Practice mode
    const headerPracticeMode = document.getElementById('header-practice-mode') as HTMLSelectElement;
    if (headerPracticeMode) {
      headerPracticeMode.value = config.practiceMode;
      this.practiceEngine.setPracticeMode(config.practiceMode);
      
      headerPracticeMode.addEventListener('change', (e) => {
        const mode = (e.target as HTMLSelectElement).value as PracticeMode;
        this.practiceEngine.setPracticeMode(mode);
        this.saveConfig({ practiceMode: mode });
      });
    }
    
    // Header: Show note names button
    const headerShowNotesBtn = document.getElementById('header-show-notes-btn');
    if (headerShowNotesBtn) {
      if (config.showNoteNames) {
        headerShowNotesBtn.classList.add('active');
      }
      this.scoreRenderer.setShowNoteNames(config.showNoteNames);
      
      headerShowNotesBtn.addEventListener('click', () => {
        const show = !this.getConfig().showNoteNames;
        this.scoreRenderer.setShowNoteNames(show);
        this.saveConfig({ showNoteNames: show });
        headerShowNotesBtn.classList.toggle('active', show);
        this.showToast(show ? 'Note names shown' : 'Note names hidden');
      });
    }
    
    // Header: Voice toggle button
    const voiceToggleBtn = document.getElementById('voice-toggle-btn');
    if (voiceToggleBtn) {
      voiceToggleBtn.classList.toggle('active', config.voiceCommandsEnabled);
      
      voiceToggleBtn.addEventListener('click', () => {
        const enabled = !this.getConfig().voiceCommandsEnabled;
        this.saveConfig({ voiceCommandsEnabled: enabled });
        voiceToggleBtn.classList.toggle('active', enabled);
        this.showToast(enabled ? 'Voice commands enabled' : 'Voice commands disabled');
      });
    }
    
    // Header: Settings toggle button
    const settingsToggleBtn = document.getElementById('settings-toggle-btn');
    const settingsPanel = document.getElementById('settings-panel');
    settingsToggleBtn?.addEventListener('click', () => {
      const isOpen = settingsPanel?.classList.toggle('open');
      settingsToggleBtn.classList.toggle('active', isOpen);
    });
    
    // Settings panel: MIDI device
    const midiSelect = document.getElementById('midi-device-select') as HTMLSelectElement;
    midiSelect?.addEventListener('change', (e) => {
      const deviceId = (e.target as HTMLSelectElement).value;
      if (deviceId) {
        this.midiHandler.selectDevice(deviceId);
        const devices = this.midiHandler.getAvailableDevices();
        const device = devices.find(d => d.id === deviceId);
        this.showToast(`MIDI: ${device?.name}`);
      }
    });
    
    // Settings panel: Zoom
    const zoomSelect = document.getElementById('zoom-select') as HTMLSelectElement;
    if (zoomSelect) {
      zoomSelect.value = config.zoomLevel.toString();
      
      zoomSelect.addEventListener('change', (e) => {
        const zoom = parseFloat((e.target as HTMLSelectElement).value);
        this.scoreRenderer.setZoom(zoom);
        this.saveConfig({ zoomLevel: zoom });
      });
    }
    
    // Settings panel: Keyboard size
    const keyboardSizeSelect = document.getElementById('keyboard-size-select') as HTMLSelectElement;
    
    if (keyboardSizeSelect) {
      keyboardSizeSelect.value = config.keyboardSize.toString();
      // Don't call setKeyboardSize on init - keyboard should only show when score is loaded
      
      keyboardSizeSelect.addEventListener('change', (e) => {
        const size = parseInt((e.target as HTMLSelectElement).value);
        this.setKeyboardSize(size);
        this.saveConfig({ keyboardSize: size });
      });
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      
      if (e.key === ' ') {
        e.preventDefault();
        if (this.playbackEngine.getIsPlaying()) {
          this.playbackEngine.stop();
          const headerPlayBtn = document.getElementById('header-play-btn');
          if (headerPlayBtn) {
            headerPlayBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3l14 9-14 9V3z"/></svg>';
            headerPlayBtn.classList.remove('active');
          }
          this.practiceEngine.start();
        } else {
          const currentIndex = this.practiceEngine.getState().currentNoteGroupIndex;
          this.practiceEngine.pause();
          this.playbackEngine.play(currentIndex);
          const headerPlayBtn = document.getElementById('header-play-btn');
          if (headerPlayBtn) {
            headerPlayBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
            headerPlayBtn.classList.add('active');
          }
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const state = this.practiceEngine.getState();
        
        if (e.ctrlKey || e.metaKey) {
          const currentMeasure = state.score[state.currentNoteGroupIndex]?.measureIndex;
          if (currentMeasure !== undefined) {
            const nextMeasure = currentMeasure + 1;
            const targetIndex = state.score.findIndex(group => group.measureIndex === nextMeasure);
            if (targetIndex !== -1) {
              this.practiceEngine.jumpToNoteGroup(targetIndex);
              const noteGroup = state.score[targetIndex];
              if (noteGroup) {
                this.soundHandler.playNoteGroup(noteGroup);
              }
            }
          }
        } else {
          const nextIndex = state.currentNoteGroupIndex + 1;
          if (nextIndex < state.score.length) {
            this.practiceEngine.jumpToNoteGroup(nextIndex);
            const noteGroup = state.score[nextIndex];
            if (noteGroup) {
              this.soundHandler.playNoteGroup(noteGroup);
            }
          }
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const state = this.practiceEngine.getState();
        
        if (e.ctrlKey || e.metaKey) {
          const currentMeasure = state.score[state.currentNoteGroupIndex]?.measureIndex;
          if (currentMeasure !== undefined) {
            const currentMeasureStart = state.score.findIndex(group => group.measureIndex === currentMeasure);
            
            if (state.currentNoteGroupIndex === currentMeasureStart) {
              const prevMeasure = currentMeasure - 1;
              if (prevMeasure >= 0) {
                const targetIndex = state.score.findIndex(group => group.measureIndex === prevMeasure);
                if (targetIndex !== -1) {
                  this.practiceEngine.jumpToNoteGroup(targetIndex);
                  const noteGroup = state.score[targetIndex];
                  if (noteGroup) {
                    this.soundHandler.playNoteGroup(noteGroup);
                  }
                }
              }
            } else {
              this.practiceEngine.jumpToNoteGroup(currentMeasureStart);
              const noteGroup = state.score[currentMeasureStart];
              if (noteGroup) {
                this.soundHandler.playNoteGroup(noteGroup);
              }
            }
          }
        } else {
          const prevIndex = state.currentNoteGroupIndex - 1;
          if (prevIndex >= 0) {
            this.practiceEngine.jumpToNoteGroup(prevIndex);
            const noteGroup = state.score[prevIndex];
            if (noteGroup) {
              this.soundHandler.playNoteGroup(noteGroup);
            }
          }
        }
      }
    });
  }

  private updateMidiDeviceList(devices: any[]): void {
    const select = document.getElementById('midi-device-select') as HTMLSelectElement;
    if (!select) return;

    // Clear existing options except the first one
    select.innerHTML = '<option value="">Select MIDI device</option>';

    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = device.name;
      select.appendChild(option);
    });

    select.disabled = devices.length === 0;
    
    // Auto-select first device
    if (devices.length > 0) {
      select.value = devices[0].id;
      this.midiHandler.selectDevice(devices[0].id);
      this.uiController.updateMidiStatus(true, devices[0].name);
    }
  }

  private async loadScore(file: File): Promise<void> {
    try {
      console.log('loadScore: Starting...');
      
      // Hide score library
      const loadingMessage = document.getElementById('loading-message');
      if (loadingMessage) loadingMessage.style.display = 'none';
      console.log('loadScore: Hidden loading message');
      
      // Show header
      const header = document.getElementById('score-header');
      if (header) header.style.display = 'flex';
      console.log('loadScore: Shown header');
      
      // Show loading message in score container (parent of score-display)
      let scoreContainer = document.querySelector('.score-container') as HTMLElement;
      console.log('loadScore: scoreContainer element:', scoreContainer);
      if (scoreContainer) {
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'score-loading-overlay';
        loadingDiv.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; background: #ffffff; color: #999; font-size: 1.2rem; z-index: 1000;';
        loadingDiv.textContent = 'Loading score...';
        scoreContainer.appendChild(loadingDiv);
        console.log('loadScore: Added loading overlay');
      }
      
      // Wait for UI to update
      await new Promise(resolve => setTimeout(resolve, 100));
      console.log('loadScore: Waited 100ms for UI update');
      
      // For .mxl files, we need to store the binary data
      let content: string;
      if (file.name.toLowerCase().endsWith('.mxl')) {
        // Store as base64 for binary data
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        content = 'MXL:' + btoa(String.fromCharCode(...bytes));
      } else {
        // Store as text for XML
        content = await file.text();
      }
      
      // Save score
      this.saveScore(content);
      
      // Apply saved zoom level before loading
      const config = this.getConfig();
      this.scoreRenderer.setZoom(config.zoomLevel);
      this.scoreRenderer.setShowNoteNames(config.showNoteNames);
      
      console.log('loadScore: About to call scoreRenderer.loadScore');
      await this.scoreRenderer.loadScore(file);
      console.log('loadScore: scoreRenderer.loadScore completed');
      
      // Remove loading overlay
      const loadingOverlay = document.getElementById('score-loading-overlay');
      if (loadingOverlay) {
        loadingOverlay.remove();
        console.log('loadScore: Removed loading overlay');
      }
      
      const noteGroups = this.scoreRenderer.getNoteGroups();
      const tempo = this.scoreRenderer.getTempo();
      
      this.practiceEngine.loadScore(noteGroups);
      this.playbackEngine.loadScore(noteGroups);
      this.playbackEngine.setTempo(tempo);
      
      // Set up note click handler
      this.scoreRenderer.onNoteClick((index) => {
        this.practiceEngine.jumpToNoteGroup(index);
      });
      
      // Update keyboard to use flats or sharps based on key signature
      this.keyboard.setUseFlats(this.scoreRenderer.getUseFlats());
      this.uiController.setUseFlats(this.scoreRenderer.getUseFlats());
      
      // Update header title
      const headerTitle = document.getElementById('header-score-title');
      if (headerTitle) {
        const title = this.scoreRenderer.getTitle();
        headerTitle.textContent = title || file.name.replace(/\.(xml|musicxml|mxl)$/i, '');
      }
      
      // Show keyboard after successful load with saved size
      this.setKeyboardSize(config.keyboardSize);
      
      scoreContainer = document.querySelector('.score-container') as HTMLElement;
      if (scoreContainer && config.keyboardSize > 0) scoreContainer.classList.add('with-keyboard');
      
      this.uiController.hideMessage();
      
      // Auto-start
      this.practiceEngine.start();
      
      console.log('Score loaded successfully');
    } catch (error) {
      console.error('Failed to load score:', error);
      this.uiController.showMessage('Failed to load score. Please check the file format.');
    }
  }

  private async loadSavedScore(): Promise<void> {
    const savedScore = this.getSavedScore();
    
    if (savedScore) {
      try {
        // Check if audio context needs to be started (only for auto-load)
        const audioOverlay = document.getElementById('audio-init-overlay');
        if (Tone.getContext().state !== 'running') {
          if (audioOverlay) {
            audioOverlay.style.display = 'flex';
            // Wait for user to click anywhere
            await new Promise<void>((resolve) => {
              const handler = async () => {
                await Tone.start();
                console.log('Audio context started');
                audioOverlay.style.display = 'none';
                audioOverlay.removeEventListener('click', handler);
                resolve();
              };
              audioOverlay.addEventListener('click', handler);
            });
          }
        }
        
        // Hide score library
        const loadingMessage = document.getElementById('loading-message');
        if (loadingMessage) loadingMessage.style.display = 'none';
        
        // Hide list header and show score header
        const listHeader = document.getElementById('list-header');
        if (listHeader) listHeader.style.display = 'none';
        
        const scoreHeader = document.getElementById('score-header');
        if (scoreHeader) scoreHeader.style.display = 'flex';
        
        const scoreContainer = document.querySelector('.score-container') as HTMLElement;
        if (scoreContainer) {
          // Show loading message in score container (parent of score-display)
          const loadingDiv = document.createElement('div');
          loadingDiv.id = 'score-loading-overlay';
          loadingDiv.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; background: #ffffff; color: #999; font-size: 1.2rem; z-index: 1000;';
          loadingDiv.textContent = 'Loading score...';
          scoreContainer.appendChild(loadingDiv);
        }
        
        // Wait for UI to update
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Create a File object from saved content
        let file: File;
        if (savedScore.startsWith('MXL:')) {
          // Restore binary MXL file
          const base64 = savedScore.substring(4);
          const binaryString = atob(base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: 'application/vnd.recordare.musicxml' });
          file = new File([blob], 'saved-score.mxl', { type: 'application/vnd.recordare.musicxml' });
        } else {
          // Restore XML file
          const blob = new Blob([savedScore], { type: 'application/xml' });
          file = new File([blob], 'saved-score.xml', { type: 'application/xml' });
        }
        
        // Apply saved zoom level before loading
        const config = this.getConfig();
        this.scoreRenderer.setZoom(config.zoomLevel);
        this.scoreRenderer.setShowNoteNames(config.showNoteNames);
        
        await this.scoreRenderer.loadScore(file);
        const noteGroups = this.scoreRenderer.getNoteGroups();
        const tempo = this.scoreRenderer.getTempo();
        
        // Remove loading overlay
        const loadingOverlay = document.getElementById('score-loading-overlay');
        if (loadingOverlay) {
          loadingOverlay.remove();
        }
        
        // Show keyboard after successful load with saved size
        this.setKeyboardSize(config.keyboardSize);
        
        if (scoreContainer && config.keyboardSize > 0) scoreContainer.classList.add('with-keyboard');
        
        this.practiceEngine.loadScore(noteGroups);
        this.playbackEngine.loadScore(noteGroups);
        this.playbackEngine.setTempo(tempo);
        
        // Update keyboard to use flats or sharps based on key signature
        this.keyboard.setUseFlats(this.scoreRenderer.getUseFlats());
        this.uiController.setUseFlats(this.scoreRenderer.getUseFlats());
        
        // Update header title
        const headerTitle = document.getElementById('header-score-title');
        if (headerTitle) {
          const title = this.scoreRenderer.getTitle();
          headerTitle.textContent = title || 'Saved Score';
        }
        
        this.uiController.hideMessage();
        
        // Set up note click handler
        this.scoreRenderer.onNoteClick((index) => {
          this.practiceEngine.jumpToNoteGroup(index);
        });
        
        // Auto-start practice
        this.practiceEngine.start();
        
        console.log('Saved score loaded successfully');
      } catch (error) {
        console.error('Failed to load saved score:', error);
        this.clearSavedScore();
      }
    }
  }

  private clearScore(): void {
    // Clear saved score
    this.clearSavedScore();
    
    // Clear UI
    this.scoreRenderer.dispose();
    this.practiceEngine.reset();
    this.uiController.enableControls(false);
    this.keyboard.clearHighlights();
    
    // Hide score header and show list header
    const scoreHeader = document.getElementById('score-header');
    if (scoreHeader) scoreHeader.style.display = 'none';
    
    const listHeader = document.getElementById('list-header');
    if (listHeader) listHeader.style.display = 'flex';
    
    // Hide keyboard
    this.setKeyboardSize(0);
    
    const scoreContainer = document.querySelector('.score-container') as HTMLElement;
    if (scoreContainer) scoreContainer.classList.remove('with-keyboard');
    
    const settingsPanel = document.getElementById('settings-panel');
    if (settingsPanel) settingsPanel.classList.remove('open');
    
    // Show score library
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage) loadingMessage.style.display = 'block';
    
    console.log('Score cleared');
  }

  private showToast(message: string, duration: number = 3000): void {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    toast.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  private setupScoreLibrary(): void {
    const scoreItems = document.querySelectorAll('.score-item');
    scoreItems.forEach(item => {
      item.addEventListener('click', async () => {
        const path = item.getAttribute('data-path');
        if (path) {
          await this.loadScoreFromUrl(path);
        }
      });
    });
  }

  private async loadScoreFromUrl(url: string): Promise<void> {
    try {
      // Hide score library
      const loadingMessage = document.getElementById('loading-message');
      if (loadingMessage) loadingMessage.style.display = 'none';
      
      // Hide list header and show score header
      const listHeader = document.getElementById('list-header');
      if (listHeader) listHeader.style.display = 'none';
      
      const scoreHeader = document.getElementById('score-header');
      if (scoreHeader) scoreHeader.style.display = 'flex';
      
      // Show loading message in score display
      const scoreDisplay = document.getElementById('score-display');
      if (scoreDisplay) {
        scoreDisplay.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #999; font-size: 1.2rem;">Loading score...</div>';
      }
      
      // Wait for UI to update
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load score: ${response.statusText}`);
      }
      
      const blob = await response.blob();
      const filename = url.split('/').pop() || 'score.mxl';
      const file = new File([blob], filename, { type: blob.type });
      
      await this.loadScore(file);
    } catch (error) {
      console.error('Failed to load score from URL:', error);
      this.uiController.showMessage('Failed to load score. Please try another.');
    }
  }

  private setupVoiceCommands(): void {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      console.log('Speech recognition not supported');
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    let restartAttempts = 0;
    const maxRestartAttempts = 3;

    recognition.onstart = () => {
      console.log('Speech recognition started');
      restartAttempts = 0;
    };

    recognition.onend = () => {
      console.log('Speech recognition ended, restarting...');
      
      // Prevent infinite restart loop
      if (restartAttempts < maxRestartAttempts) {
        restartAttempts++;
        try {
          recognition.start();
        } catch (e) {
          console.error('Failed to restart recognition:', e);
        }
      } else {
        console.log('Max restart attempts reached, stopping voice recognition');
      }
    };

    recognition.onresult = (event: any) => {
      const last = event.results.length - 1;
      const command = event.results[last][0].transcript.toLowerCase().trim();
      
      console.log('Voice command:', command);
      
      // Check if voice commands are enabled
      if (!this.getConfig().voiceCommandsEnabled) {
        return;
      }
      
      this.handleVoiceCommand(command);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      
      // Don't restart on certain errors
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        console.log('Speech recognition not allowed, disabling');
        restartAttempts = maxRestartAttempts;
      }
    };

    try {
      recognition.start();
      console.log('Voice commands enabled');
    } catch (e) {
      console.error('Failed to start voice recognition:', e);
    }
  }

  private handleVoiceCommand(command: string): void {
    // Match "measure X" or "bar X"
    const measureMatch = command.match(/(?:measure|bar)\s+(\d+)/);
    if (measureMatch) {
      const measureNumber = parseInt(measureMatch[1]);
      this.goToMeasure(measureNumber);
      return;
    }

    // Match "back to the start" or "start"
    if (command.includes('back to the start') || command === 'start') {
      this.goToStart();
      return;
    }

    // Match "back"
    if (command === 'back') {
      this.goBack();
      return;
    }

    // Match "forward" or "next"
    if (command === 'forward' || command === 'next') {
      this.goForward();
      return;
    }

    // Match hand selection
    if (command.includes('both hands') || command === 'both') {
      this.setPracticeMode('both');
      return;
    }

    if (command.includes('right hand') || command === 'right') {
      this.setPracticeMode('right');
      return;
    }

    if (command.includes('left hand') || command === 'left') {
      this.setPracticeMode('left');
      return;
    }

    // Match play/stop
    if (command === 'play') {
      if (!this.playbackEngine.getIsPlaying()) {
        const currentIndex = this.practiceEngine.getState().currentNoteGroupIndex;
        this.practiceEngine.pause();
        this.playbackEngine.play(currentIndex);
        const headerPlayBtn = document.getElementById('header-play-btn');
        if (headerPlayBtn) {
          headerPlayBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
          headerPlayBtn.classList.add('active');
        }
        console.log('Playback started');
      }
      return;
    }

    if (command === 'stop') {
      if (this.playbackEngine.getIsPlaying()) {
        this.playbackEngine.stop();
        const headerPlayBtn = document.getElementById('header-play-btn');
        if (headerPlayBtn) {
          headerPlayBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3l14 9-14 9V3z"/></svg>';
          headerPlayBtn.classList.remove('active');
        }
        this.practiceEngine.start();
        console.log('Playback stopped');
      }
      return;
    }
  }

  private goToMeasure(measureNumber: number): void {
    const noteGroups = this.practiceEngine.getState().score;
    
    // Find first note group in the target measure
    const targetIndex = noteGroups.findIndex(group => group.measureIndex === measureNumber - 1);
    
    if (targetIndex !== -1) {
      this.practiceEngine.jumpToNoteGroup(targetIndex);
      console.log(`Jumped to measure ${measureNumber}`);
    } else {
      console.log(`Measure ${measureNumber} not found`);
    }
  }

  private goToStart(): void {
    this.practiceEngine.reset();
    console.log('Jumped to start');
  }

  private goBack(): void {
    const state = this.practiceEngine.getState();
    const currentMeasure = state.score[state.currentNoteGroupIndex]?.measureIndex;
    
    if (currentMeasure === undefined) return;
    
    // If already in first measure, go to start
    if (currentMeasure === 0) {
      this.goToStart();
      return;
    }
    
    // Find first note group in previous measure
    const targetMeasure = currentMeasure - 1;
    const targetIndex = state.score.findIndex(group => group.measureIndex === targetMeasure);
    
    if (targetIndex !== -1) {
      this.practiceEngine.jumpToNoteGroup(targetIndex);
      console.log(`Jumped back to measure ${targetMeasure + 1}`);
    }
  }

  private goForward(): void {
    const state = this.practiceEngine.getState();
    const currentMeasure = state.score[state.currentNoteGroupIndex]?.measureIndex;
    
    if (currentMeasure === undefined) return;
    
    // Find first note group in next measure
    const targetMeasure = currentMeasure + 1;
    const targetIndex = state.score.findIndex(group => group.measureIndex === targetMeasure);
    
    if (targetIndex !== -1) {
      this.practiceEngine.jumpToNoteGroup(targetIndex);
      console.log(`Jumped forward to measure ${targetMeasure + 1}`);
    }
  }

  private setPracticeMode(mode: PracticeMode): void {
    this.practiceEngine.setPracticeMode(mode);
    this.saveConfig({ practiceMode: mode });
    
    // Update UI select
    const select = document.getElementById('header-practice-mode') as HTMLSelectElement;
    if (select) {
      select.value = mode;
    }
    
    console.log(`Practice mode set to: ${mode}`);
  }

  private setKeyboardSize(size: number): void {
    const container = document.querySelector('.keyboard-container') as HTMLElement;
    const mainContainer = document.querySelector('.main') as HTMLElement;
    const keyboardInner = document.getElementById('piano-keyboard-container') as HTMLElement;
    
    if (!container || !mainContainer) return;
    
    if (size === 0) {
      // Hide keyboard
      container.style.display = 'none';
      mainContainer.style.paddingBottom = '0';
    } else {
      // Show keyboard with specified height
      container.style.display = 'flex';
      container.style.height = `${size}px`;
      mainContainer.style.paddingBottom = `${size}px`;
      
      // Set CSS variables for key sizes
      if (keyboardInner) {
        if (size === 135) {
          // Large: 1/52 of viewport width, 120px tall
          keyboardInner.style.setProperty('--white-key-width', 'calc(100vw / 52)');
          keyboardInner.style.setProperty('--white-key-height', '120px');
          keyboardInner.style.setProperty('--black-key-width', 'calc(100vw / 52 * 0.6)');
          keyboardInner.style.setProperty('--black-key-height', '75px');
        } else {
          // Normal: default sizes
          keyboardInner.style.setProperty('--white-key-width', '20px');
          keyboardInner.style.setProperty('--white-key-height', '85px');
          keyboardInner.style.setProperty('--black-key-width', '12px');
          keyboardInner.style.setProperty('--black-key-height', '50px');
        }
        keyboardInner.style.transform = 'none';
        
        // Re-render keyboard to apply new sizes
        if (this.keyboard) {
          this.keyboard.destroy();
          this.keyboard = new SimpleKeyboard(keyboardInner);
          this.keyboard.setUseFlats(this.scoreRenderer.getUseFlats());
          
          // Restore highlighted notes
          const expectedNotes = this.practiceEngine.getCurrentExpectedNotes();
          expectedNotes.forEach(note => {
            this.keyboard.highlightNote(note);
          });
        }
      }
    }
  }
}
// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new App());
} else {
  new App();
}
