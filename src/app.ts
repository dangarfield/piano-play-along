import { MidiHandler } from './midi-handler';
import { ScoreRenderer } from './score-renderer';
import { PracticeEngine } from './practice-engine';
import { UIController } from './ui-controller';
import { SoundHandler } from './sound-handler';
import type { PracticeMode } from './shared/types';
import { SimpleKeyboard } from './simple-keyboard';

interface AppConfig {
  practiceMode: PracticeMode;
  zoomLevel: number;
  voiceCommandsMuted: boolean;
  keyboardSize: number;
  showNoteNames: boolean;
}

class App {
  private midiHandler: MidiHandler;
  private scoreRenderer: ScoreRenderer;
  private practiceEngine: PracticeEngine;
  private uiController: UIController;
  private soundHandler: SoundHandler;
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
      voiceCommandsMuted: false,
      keyboardSize: 100,
      showNoteNames: false,
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
    this.setupEventListeners();
    this.initializeKeyboard();
    this.setupVoiceCommands();
    await this.initializeMidi();
    await this.initializeSound();
    
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
  }

  private async initializeMidi(): Promise<void> {
    try {
      // Set up callbacks BEFORE initializing
      this.midiHandler.onDeviceChange((devices) => {
        console.log('MIDI devices detected:', devices);
        this.updateMidiDeviceList(devices);
      });

      this.midiHandler.onNoteOn((note, velocity) => {
        console.log('Note ON:', note, velocity);
        this.practiceEngine.handleNoteOn(note);
        
        const expectedNotes = this.practiceEngine.getCurrentExpectedNotes();
        const isCorrect = expectedNotes.includes(note);
        this.keyboard.keyDown(note, isCorrect);
      });

      this.midiHandler.onNoteOff((note) => {
        console.log('Note OFF:', note);
        this.practiceEngine.handleNoteOff(note);
        this.keyboard.keyUp(note);
      });

      // Now initialize MIDI
      await this.midiHandler.initialize();
      console.log('MIDI initialized, checking for devices...');

      this.practiceEngine.onProgress((state) => {
        const expectedNotes = this.practiceEngine.getCurrentExpectedNotes();
        this.uiController.updatePianoKeys(state, expectedNotes);
        this.uiController.updateStatus(
          this.practiceEngine.getCurrentMeasure(),
          this.practiceEngine.getProgress(),
          expectedNotes
        );
        this.uiController.updatePlayPauseButtons(state.isPlaying);
        
        // Move cursor to current position
        this.scoreRenderer.moveCursorToNoteGroup(state.currentNoteGroupIndex);
        
        // Update highlighted notes
        this.keyboard.clearHighlights();
        expectedNotes.forEach(note => {
          this.keyboard.highlightNote(note);
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
      console.log('Sound initialized');
    } catch (error) {
      console.error('Failed to initialize sound:', error);
    }
  }

  private setupEventListeners(): void {
    // Panel toggle
    const togglePanelBtn = document.getElementById('toggle-panel-btn');
    const practicePanel = document.querySelector('.practice-panel');
    
    togglePanelBtn?.addEventListener('click', () => {
      const isCollapsed = practicePanel?.classList.toggle('collapsed');
      if (togglePanelBtn) {
        togglePanelBtn.textContent = isCollapsed ? '▶' : '◀';
      }
      
      // Re-render score after panel animation completes
      setTimeout(() => {
        this.scoreRenderer.render();
        this.scoreRenderer.scrollCursorIntoView();
      }, 300);
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ignore if typing in an input/select
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const state = this.practiceEngine.getState();
        
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+Right: Next measure
          const currentMeasure = state.score[state.currentNoteGroupIndex]?.measureIndex;
          if (currentMeasure !== undefined) {
            const nextMeasure = currentMeasure + 1;
            const targetIndex = state.score.findIndex(group => group.measureIndex === nextMeasure);
            if (targetIndex !== -1) {
              this.practiceEngine.jumpToNoteGroup(targetIndex);
              // Play the note group
              const noteGroup = state.score[targetIndex];
              if (noteGroup) {
                this.soundHandler.playNoteGroup(noteGroup);
              }
            }
          }
        } else {
          // Right: Next note group
          const nextIndex = state.currentNoteGroupIndex + 1;
          if (nextIndex < state.score.length) {
            this.practiceEngine.jumpToNoteGroup(nextIndex);
            // Play the note group
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
          // Ctrl+Left: Start of current measure or previous measure
          const currentMeasure = state.score[state.currentNoteGroupIndex]?.measureIndex;
          if (currentMeasure !== undefined) {
            // Find first note group in current measure
            const currentMeasureStart = state.score.findIndex(group => group.measureIndex === currentMeasure);
            
            // If already at start of measure, go to previous measure
            if (state.currentNoteGroupIndex === currentMeasureStart) {
              const prevMeasure = currentMeasure - 1;
              if (prevMeasure >= 0) {
                const targetIndex = state.score.findIndex(group => group.measureIndex === prevMeasure);
                if (targetIndex !== -1) {
                  this.practiceEngine.jumpToNoteGroup(targetIndex);
                  // Play the note group
                  const noteGroup = state.score[targetIndex];
                  if (noteGroup) {
                    this.soundHandler.playNoteGroup(noteGroup);
                  }
                }
              }
            } else {
              // Go to start of current measure
              this.practiceEngine.jumpToNoteGroup(currentMeasureStart);
              // Play the note group
              const noteGroup = state.score[currentMeasureStart];
              if (noteGroup) {
                this.soundHandler.playNoteGroup(noteGroup);
              }
            }
          }
        } else {
          // Left: Previous note group
          const prevIndex = state.currentNoteGroupIndex - 1;
          if (prevIndex >= 0) {
            this.practiceEngine.jumpToNoteGroup(prevIndex);
            // Play the note group
            const noteGroup = state.score[prevIndex];
            if (noteGroup) {
              this.soundHandler.playNoteGroup(noteGroup);
            }
          }
        }
      }
    });
    
    // Load file button
    const loadFileBtn = document.getElementById('load-file-btn');
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    
    loadFileBtn?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        await this.loadScore(file);
      }
    });

    // MIDI device selector
    const midiSelect = document.getElementById('midi-device-select') as HTMLSelectElement;
    midiSelect?.addEventListener('change', (e) => {
      const deviceId = (e.target as HTMLSelectElement).value;
      if (deviceId) {
        this.midiHandler.selectDevice(deviceId);
        const devices = this.midiHandler.getAvailableDevices();
        const device = devices.find(d => d.id === deviceId);
        this.uiController.updateMidiStatus(true, device?.name);
      } else {
        this.uiController.updateMidiStatus(false);
      }
    });

    // Practice mode selector
    const practiceModeSelect = document.getElementById('practice-mode-select') as HTMLSelectElement;
    
    // Load saved practice mode
    const config = this.getConfig();
    if (practiceModeSelect) {
      practiceModeSelect.value = config.practiceMode;
      this.practiceEngine.setPracticeMode(config.practiceMode);
    }
    
    practiceModeSelect?.addEventListener('change', (e) => {
      const mode = (e.target as HTMLSelectElement).value as PracticeMode;
      this.practiceEngine.setPracticeMode(mode);
      this.saveConfig({ practiceMode: mode });
    });

    // Zoom selector
    const zoomSelect = document.getElementById('zoom-select') as HTMLSelectElement;
    
    // Load saved zoom level - ensure it matches option values
    if (zoomSelect) {
      const zoomValue = config.zoomLevel.toString();
      zoomSelect.value = zoomValue;
    }
    
    zoomSelect?.addEventListener('change', (e) => {
      const zoom = parseFloat((e.target as HTMLSelectElement).value);
      this.scoreRenderer.setZoom(zoom);
      this.saveConfig({ zoomLevel: zoom });
    });

    // Keyboard size selector
    const keyboardSizeSelect = document.getElementById('keyboard-size-select') as HTMLSelectElement;
    
    // Load saved keyboard size
    const keyboardSize = config.keyboardSize ?? 100;
    if (keyboardSizeSelect) {
      keyboardSizeSelect.value = keyboardSize.toString();
      this.setKeyboardSize(keyboardSize);
    }
    
    keyboardSizeSelect?.addEventListener('change', (e) => {
      const size = parseInt((e.target as HTMLSelectElement).value);
      this.setKeyboardSize(size);
      this.saveConfig({ keyboardSize: size });
    });

    // Show note names checkbox
    const showNoteNamesCheckbox = document.getElementById('show-note-names') as HTMLInputElement;
    
    // Load saved setting
    if (showNoteNamesCheckbox) {
      showNoteNamesCheckbox.checked = config.showNoteNames;
      this.scoreRenderer.setShowNoteNames(config.showNoteNames);
    }
    
    showNoteNamesCheckbox?.addEventListener('change', (e) => {
      const show = (e.target as HTMLInputElement).checked;
      this.scoreRenderer.setShowNoteNames(show);
      this.saveConfig({ showNoteNames: show });
    });

    // Control buttons
    document.getElementById('pause-btn')?.addEventListener('click', () => {
      const state = this.practiceEngine.getState();
      if (state.isPlaying) {
        this.practiceEngine.pause();
      } else {
        this.practiceEngine.start();
      }
    });

    document.getElementById('reset-btn')?.addEventListener('click', () => {
      this.practiceEngine.reset();
      this.scoreRenderer.resetCursor();
      this.practiceEngine.start();
    });

    // Clear score button
    document.getElementById('clear-file-btn')?.addEventListener('click', () => {
      this.clearScore();
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
      this.uiController.showMessage('Loading score...');
      
      // Hide score library
      const loadingMessage = document.getElementById('loading-message');
      if (loadingMessage) loadingMessage.style.display = 'none';
      
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
      
      await this.scoreRenderer.loadScore(file);
      const noteGroups = this.scoreRenderer.getNoteGroups();
      
      this.practiceEngine.loadScore(noteGroups);
      
      // Set up note click handler
      this.scoreRenderer.onNoteClick((index) => {
        this.practiceEngine.jumpToNoteGroup(index);
      });
      
      // Update keyboard to use flats or sharps based on key signature
      this.keyboard.setUseFlats(this.scoreRenderer.getUseFlats());
      this.uiController.setUseFlats(this.scoreRenderer.getUseFlats());
      
      this.uiController.hideMessage();
      this.uiController.enableControls(true);
      this.uiController.updateStatus(1, 0, []);
      
      // Show clear button
      const clearBtn = document.getElementById('clear-file-btn');
      if (clearBtn) clearBtn.style.display = 'block';
      
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
        this.uiController.showMessage('Loading saved score...');
        
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
        
        this.practiceEngine.loadScore(noteGroups);
        
        // Update keyboard to use flats or sharps based on key signature
        this.keyboard.setUseFlats(this.scoreRenderer.getUseFlats());
        this.uiController.setUseFlats(this.scoreRenderer.getUseFlats());
        
        this.uiController.hideMessage();
        this.uiController.enableControls(true);
        this.uiController.updateStatus(1, 0, []);
        
        // Show clear button
        const clearBtn = document.getElementById('clear-file-btn');
        if (clearBtn) clearBtn.style.display = 'block';
        
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
    this.uiController.showMessage('Load a MusicXML file to begin');
    this.uiController.enableControls(false);
    this.keyboard.clearHighlights();
    
    // Hide clear button
    const clearBtn = document.getElementById('clear-file-btn');
    if (clearBtn) clearBtn.style.display = 'none';
    
    // Show score library
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage) loadingMessage.style.display = 'block';
    
    console.log('Score cleared');
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
      this.uiController.showMessage('Loading score...');
      
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

    // Load saved mute state
    const config = this.getConfig();
    let isMuted = config.voiceCommandsMuted;
    this.updateVoiceStatus(isMuted);

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
        this.updateVoiceStatus(true);
      }
    };

    recognition.onresult = (event: any) => {
      const last = event.results.length - 1;
      const command = event.results[last][0].transcript.toLowerCase().trim();
      
      console.log('Voice command:', command);
      
      // Always listen for mute/unmute
      if (command === 'mute') {
        isMuted = true;
        this.saveConfig({ voiceCommandsMuted: true });
        this.updateVoiceStatus(true);
        console.log('Voice commands muted');
        return;
      }
      
      if (command === 'unmute') {
        isMuted = false;
        this.saveConfig({ voiceCommandsMuted: false });
        this.updateVoiceStatus(false);
        console.log('Voice commands unmuted');
        return;
      }
      
      // Ignore other commands if muted
      if (isMuted) {
        return;
      }
      
      this.handleVoiceCommand(command);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      
      // Don't restart on certain errors
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        console.log('Speech recognition not allowed, disabling');
        this.updateVoiceStatus(true);
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

  private updateVoiceStatus(muted: boolean): void {
    const statusEl = document.getElementById('voice-status');
    const textEl = document.getElementById('voice-status-text');
    
    if (statusEl && textEl) {
      if (muted) {
        statusEl.classList.remove('connected');
        textEl.textContent = 'Voice: Muted';
      } else {
        statusEl.classList.add('connected');
        textEl.textContent = 'Voice: Listening...';
      }
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

    // Match "forward"
    if (command === 'forward') {
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
    const select = document.getElementById('practice-mode-select') as HTMLSelectElement;
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
