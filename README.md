# Music Practice App

Browser-based piano practice app with MIDI keyboard support and real-time sheet music feedback.

## Quick Start

```bash
pnpm install
pnpm dev
```

Open in Chrome, Edge, or Opera (Web MIDI API required). Connect MIDI keyboard, load a MusicXML file, and start practicing.

## Features

- **Real-time MIDI tracking** - Automatically advances when correct notes are played
- **Practice modes** - Left hand, right hand, or both hands
- **Voice commands** - Hands-free navigation (measure jumping, mode switching)
- **Auto-scroll** - Score follows cursor at top 1/4 of viewport
- **Key signature detection** - Automatically displays flats or sharps based on score
- **Keyboard shortcuts** - Arrow keys to navigate between note groups
- **Configurable UI** - Adjustable score zoom and keyboard size
- **Auto-save** - Restores last loaded score on page reload

## Tech Stack

- **TypeScript + Vite** - Build tooling
- **OpenSheetMusicDisplay** - MusicXML rendering to SVG
- **WebMidi.js** - MIDI device handling
- **Web Speech API** - Voice command recognition

## Architecture

```
src/
├── app.ts                    # Main orchestrator, component coordination
├── midi-handler.ts           # MIDI device connection & message parsing
├── score-renderer.ts         # OSMD wrapper, MusicXML parsing
├── practice-engine.ts        # Note matching & progression logic
├── ui-controller.ts          # UI state updates
├── simple-keyboard.ts        # Piano keyboard visualization
└── shared/
    ├── types.ts              # TypeScript interfaces
    └── midi-utils.ts         # MIDI utilities
```

## Component Details

### app.ts
Main entry point. Initializes all components, manages state, handles user interactions.

**Responsibilities:**
- Component initialization and event wiring
- File loading (MusicXML files)
- MIDI device selection and connection
- Practice mode switching (left/right/both)
- Voice command setup and handling
- Keyboard shortcuts (arrow keys for navigation)
- Settings persistence (localStorage)
- Auto-save/restore score

**Key event handlers:**
- File input change → load score
- MIDI device select → connect device
- Practice mode select → filter notes by hand
- Zoom select → adjust score size
- Keyboard size select → adjust keyboard display
- Arrow keys → navigate note groups
- Voice commands → hands-free control

### midi-handler.ts
MIDI device management using WebMidi.js.

**Key methods:**
- `initialize()` - Request MIDI access, enumerate devices
- `selectDevice(id)` - Connect to specific MIDI input
- `onNoteOn(callback)` - Register note on event handler
- `onNoteOff(callback)` - Register note off event handler
- `onDeviceChange(callback)` - Register device connection handler

**MIDI message handling:**
- Note On: Status 144 + velocity > 0
- Note Off: Status 128 or (144 + velocity 0)
- Tracks currently pressed keys in Set

### score-renderer.ts
OpenSheetMusicDisplay wrapper for MusicXML parsing and rendering.

**Key methods:**
- `loadScore(file)` - Load MusicXML, parse notes, render score
- `getNoteGroups()` - Extract note groups with timing/pitch/hand
- `moveCursorToNoteGroup(index)` - Move cursor, auto-scroll to position
- `getUseFlats()` - Get key signature preference (flats vs sharps)
- `setZoom(level)` - Adjust score zoom level
- `parseKeySignatureFromOSMD()` - Extract key signature from OSMD data

**Key signature detection:**
- Reads `firstInstructionsStaffEntries[].Instructions[].keyType` from first measure
- Negative values = flats, positive = sharps
- Updates keyboard and UI to display correct accidentals

**Auto-scroll behavior:**
- Finds cursor image element by ID pattern `cursorImg-*`
- Reads cursor top position from inline style
- Scrolls to position cursor at top 1/4 of viewport
- Smooth scrolling animation

**Note extraction:**
- Iterates through `SourceMeasures` → `VerticalSourceStaffEntryContainers`
- Groups notes by timestamp (for chords)
- Assigns hand based on staff index (0=right, 1=left)
- Returns `NoteGroup[]` with measure index, timestamp, notes

### practice-engine.ts
Core practice logic. Compares played notes against expected notes, manages progression.

**State:**
- `currentNoteGroupIndex` - Current position in score
- `pressedNotes` - Set of currently held MIDI notes
- `correctNotesPressed` - Set of correctly played notes in current group
- `isPlaying` - Whether practice session is active
- `score` - Array of note groups from score

**Key methods:**
- `loadScore(noteGroups)` - Initialize with parsed score
- `handleNoteOn(midiNote)` - Process MIDI note on, check progress
- `handleNoteOff(midiNote)` - Process MIDI note off
- `checkProgress()` - Compare pressed vs expected, advance if match
- `setPracticeMode(mode)` - Filter notes by hand (left/right/both)
- `jumpToNoteGroup(index)` - Navigate to specific position
- `skipEmptyGroups()` - Auto-skip groups with no notes for selected hand
- `start()` - Begin practice session
- `pause()` - Pause practice session
- `reset()` - Return to beginning

**Progression logic:**
1. Filter expected notes by practice mode
2. Check if all expected notes are currently pressed
3. If match, advance to next note group
4. Skip groups with no notes for active hand(s)
5. Emit progress event to update UI

### ui-controller.ts
Updates UI elements based on practice state.

**Key methods:**
- `setUseFlats(useFlats)` - Set sharp/flat display preference
- `updateStatus(measure, progress, nextNotes)` - Update status panel
- `updateMidiStatus(connected, deviceName)` - Update MIDI indicator
- `updatePlayPauseButtons(isPlaying)` - Toggle pause/resume button
- `enableControls(enabled)` - Enable/disable control buttons
- `showMessage(text)` / `hideMessage()` - Show/hide loading messages

**Note name conversion:**
- Uses sharp or flat names based on key signature
- Converts MIDI note number to note name + octave
- Example: 60 → "C4" or "C4" depending on key

### simple-keyboard.ts
Piano keyboard visualization with 88 keys (A0 to C8).

**Features:**
- White keys: 20px width (normal) or 1/52 viewport width (large)
- Black keys: Positioned dynamically based on white key width
- Color coding: Yellow (next), Green (correct), Red (incorrect), White (pressed)
- Note labels: Show note names on highlighted/pressed keys
- Sharp/flat display: Adapts to key signature

**Key methods:**
- `keyDown(note, isCorrect)` - Highlight pressed key with color
- `keyUp(note)` - Remove highlight from key
- `highlightNote(note)` - Show next expected note (yellow)
- `clearHighlights()` - Clear all highlighted notes
- `setUseFlats(useFlats)` - Toggle sharp/flat display
- `destroy()` - Clean up keyboard elements

**Rendering:**
- Creates white keys first in flex layout
- Positions black keys absolutely between white keys
- Uses CSS variables for key dimensions (responsive sizing)
- Re-renders on size change to apply new dimensions

## Data Flow

### Score Loading
1. User selects MusicXML file via file input
2. `app.ts` reads file content, saves to localStorage
3. `score-renderer.ts` loads file via OSMD
4. OSMD parses MusicXML, renders to SVG
5. `score-renderer.ts` extracts note groups from OSMD data
6. `practice-engine.ts` receives note groups, initializes state
7. Key signature detected, keyboard updated to use flats/sharps
8. Auto-starts practice session

### MIDI Input Processing
1. MIDI device sends note on/off message
2. `midi-handler.ts` parses message, emits event
3. `app.ts` receives event, forwards to `practice-engine.ts`
4. `practice-engine.ts` updates pressed notes Set
5. Checks if pressed notes match expected notes
6. If match, advances to next note group
7. Emits progress event with new state
8. `app.ts` receives progress event, updates UI

### Visual Updates
1. `app.ts` receives progress event from practice engine
2. Updates `simple-keyboard.ts`:
   - Clears previous highlights
   - Highlights new expected notes (yellow)
   - Shows pressed keys (green/red)
3. Updates `ui-controller.ts`:
   - Current measure number
   - Progress percentage
   - Next notes to play
4. Updates `score-renderer.ts`:
   - Moves OSMD cursor to current position
   - Auto-scrolls to keep cursor at top 1/4

## Key Types

```typescript
interface NoteGroup {
  timestamp: number;        // Position in score (sequential)
  measureIndex: number;     // Measure number (0-indexed)
  notes: Note[];           // Notes in this group (chord or single)
}

interface Note {
  pitch: number;           // MIDI note number (0-127)
  hand: 'left' | 'right'; // Staff assignment (treble/bass)
  duration: number;        // Note length (not currently used)
  measureIndex: number;    // Measure number
  timestamp: number;       // Position in score
}

interface PracticeState {
  isPlaying: boolean;
  currentNoteGroupIndex: number;
  pressedNotes: Set<number>;
  correctNotesPressed: Set<number>;
  score: NoteGroup[];
}

type PracticeMode = 'left' | 'right' | 'both';

interface AppConfig {
  practiceMode: PracticeMode;
  zoomLevel: number;           // 0.8, 1.0, 1.5
  voiceCommandsMuted: boolean;
  keyboardSize: number;        // 0 (hide), 100 (normal), 150 (large)
}
```

## User Controls

### UI Controls
- **Load MusicXML** - Open file picker to load score
- **Clear Score** - Remove current score, reset state
- **MIDI Device** - Select connected MIDI input device
- **Practice Mode** - Left hand / Right hand / Both hands
- **Score Zoom** - Small (0.8x) / Normal (1.0x) / Large (1.5x)
- **Keyboard Size** - Normal (100px) / Large (150px) / Hide
- **Pause/Resume** - Toggle practice session
- **Back to Start** - Reset to beginning of score

### Keyboard Shortcuts
- **Arrow Right** - Next note group
- **Arrow Left** - Previous note group

### Voice Commands
Speech recognition enabled for hands-free navigation (Chrome only):

- **"measure X"** / **"bar X"** - Jump to measure number
- **"back to the start"** / **"start"** - Reset to beginning
- **"back"** - Previous measure
- **"forward"** - Next measure
- **"left hand"** / **"right hand"** / **"both hands"** - Change practice mode
- **"mute"** - Disable voice commands
- **"unmute"** - Enable voice commands

Voice status indicator shows: "Listening..." (active) or "Muted" (disabled)

## Settings Persistence

All settings stored in localStorage:

**Config object** (`piano-play-along-config`):
- `practiceMode` - Selected hand mode
- `zoomLevel` - Score zoom level
- `voiceCommandsMuted` - Voice command state
- `keyboardSize` - Keyboard display size

**Score data** (`piano-play-along-saved-score`):
- Last loaded MusicXML content (auto-restores on page load)

## Development Notes

### Adding Features
- **MIDI features**: Extend `midi-handler.ts`
- **Practice modes**: Modify `practice-engine.ts` filtering logic
- **UI changes**: Update `ui-controller.ts` and `index.html`
- **Score parsing**: Modify `score-renderer.ts` note extraction
- **Voice commands**: Extend `app.ts` `handleVoiceCommand()`

### Common Tasks
- **Change note matching**: Edit `practice-engine.ts` `checkProgress()`
- **Modify keyboard**: Edit `simple-keyboard.ts` rendering methods
- **Adjust auto-scroll**: Edit `score-renderer.ts` `scrollCursorIntoView()`
- **Change hand assignment**: Modify `score-renderer.ts` staff detection

### Key Implementation Details

**Key signature detection:**
- Path: `osmd.Sheet.SourceMeasures[0].firstInstructionsStaffEntries[].Instructions[].keyType`
- Negative values indicate flats, positive indicate sharps

**Cursor positioning:**
- Cursor image ID pattern: `cursorImg-*`
- Position read from inline `style.top` attribute
- Scrolls to position cursor at top 1/4 of viewport

**Keyboard sizing:**
- Normal: Fixed 20px white key width
- Large: `calc(100vw / 52)` for 52 white keys across viewport
- Uses CSS variables for responsive sizing

### Known Limitations
- Requires Chromium-based browser (Web MIDI API)
- No timing enforcement (only note correctness)
- Hand assignment based on staff only (treble=right, bass=left)
- No audio playback
- No recording/playback of practice sessions
- Voice commands only work in Chrome

## Browser Compatibility

**Supported:**
- Chrome/Chromium (recommended)
- Edge (Chromium-based)
- Opera

**Not Supported:**
- Firefox (no Web MIDI API)
- Safari (no Web MIDI API)

## Future Enhancements

- Audio playback with synthesizer
- Metronome/click track
- Recording and playback
- Progress tracking and statistics
- Loop sections
- Tempo adjustment
- Transpose functionality
- Timing enforcement mode
- Multiple voice support (beyond treble/bass)
