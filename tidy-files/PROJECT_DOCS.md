# Finch - AI Companion Interface

## Project Overview

**Finch** is a cinematic, spatial AI companion interface built with React 19, TanStack Start (v1), Vite, and Tailwind CSS v4. It features a liquid-glass aesthetic with a 3D Finch character and four distinct interaction modes controlled via both manual navigation and voice commands.

---

## Technology Stack

| Layer         | Technology                                                 |
| ------------- | ---------------------------------------------------------- |
| Framework     | React 19 + TanStack Start (file-based routing)             |
| Build Tool    | Vite 8 + Rolldown                                          |
| Styling       | Tailwind CSS v4 + tw-animate-css                           |
| State         | React useState + TanStack Query (server state)             |
| Routing       | TanStack Router (type-safe)                                |
| UI Components | Radix UI primitives + custom glass components              |
| Icons         | Lucide React                                               |
| Voice         | Web Speech API (SpeechRecognition/webkitSpeechRecognition) |
| Language      | TypeScript (strict)                                        |
| Deployment    | Nitro (Cloudflare Workers preset)                          |

---

## File Structure

`E:\Finch\tidy-files/
├── public/
│   └── favicon.ico
├── src/
│   ├── components/
│   │   ├── finch/                       # Finch-specific UI components
│   │   │   ├── ExpandedInformation.tsx  # Modal detail view for results
│   │   │   ├── FinchOrb.tsx             # Animated orb with voice-state glow
│   │   │   ├── FloatingInformation.tsx  # Floating glass cards for results
│   │   │   ├── GlassResearchField.tsx   # Research results grid
│   │   │   ├── GlassResult.tsx          # Individual search result card
│   │   │   ├── LiquidGlassEnvironment.tsx # Animated liquid glass background
│   │   │   ├── ModeIndicator.tsx        # Top-right mode navigation tabs
│   │   │   └── VoiceControl.tsx         # Bottom-center microphone button
│   │   └── ui/                          # Reusable UI primitives (Button, Textarea, Tooltip, etc.)
│   ├── data/
│   │   ├── mockResearch.ts              # Mock research data (5 items)
│   │   └── mockSearchResults.ts         # Mock search results (4 items)
│   ├── hooks/
│   │   ├── use-mobile.tsx               # Mobile detection hook
│   │   └── useVoiceRecognition.ts       # Web Speech API wrapper hook
│   ├── lib/
│   │   └── utils.ts                     # cn() className utility
│   ├── modes/                           # Four mode implementations
│   │   ├── ConversationMode.tsx         # Conversational chat interface
│   │   ├── PlanMode.tsx                 # Planning workspace
│   │   ├── SearchMode.tsx               # Web search interface
│   │   └── ResearchMode.tsx             # Deep research interface
│   ├── routes/
│   │   ├── __root.tsx                   # Root layout, providers, error boundaries
│   │   └── index.tsx                    # Main page - mode orchestration
│   ├── types/
│   │   └── mode.ts                      # TypeScript types (Mode, VoiceState, SearchResult, ResearchItem)
│   ├── utils/
│   │   └── detectModeIntent.ts          # Voice command to mode detection + request extraction
│   ├── router.tsx                       # TanStack Router configuration
│   ├── routeTree.gen.ts                 # Auto-generated route tree
│   ├── server.ts                        # Nitro server entry
│   ├── start.ts                         # TanStack Start client entry
│   ├── styles.css                       # Global styles + Tailwind + custom animations
│   └── vite.config.ts                   # Vite configuration
├── package.json
├── tsconfig.json
├── bun.lock
├── bunfig.toml
└── README.md`

---

## Routes / Pages

### Single Page Application (SPA) - /

**File:** src/routes/index.tsx  
**Purpose:** Main orchestration page - renders the active mode, handles voice recognition, manages global state.

**Responsibilities:**

- **Mode State**: Single source of truth for activeMode (conversation | plan | search | research)
- **Voice Recognition**: Integrates useVoiceRecognition hook, maps transcript to mode via detectModeIntent
- **Request Preservation**: Extracts and stores user request after mode switch (e.g., "search for React" to mode=search, request="search for React")
- **UI Composition**: Renders ModeIndicator (nav), active Mode component, VoiceControl (mic), system status
- **Error Handling**: Shows unsupported browser notice, HTTPS warning, recognition errors

**State:**
`	ypescript
mode: "conversation" | "plan" | "search" | "research"      // Active mode
voiceState: "idle" | "listening" | "thinking" | "speaking"  // Voice UI state
pendingRequest: string                                       // User request preserved after mode switch
`

**Child Components (conditional):**

- ConversationMode - when mode === "conversation"
- PlanMode - when mode === "plan"
- SearchMode - when mode === "search"
- ResearchMode - when mode === "research"

---

## Modes (Four Interaction Paradigms)

All modes share: pendingRequest prop (pre-fills input from voice command)

### 1. Conversation Mode (ConversationMode.tsx)

**Route:** / (default)  
**Purpose:** Natural language chat with Finch - the "home" mode.

**UI:**

- Centered animated orb (FinchOrb) with voice-state glow
- Greeting: "Good morning." / "FINCH / 01"
- Voice request display (shows preserved request from voice command)
- Microphone button (passed from parent)

**Interaction:**

- Click mic - speak - voice command detected - switches mode
- No text input in this mode (conversation happens via voice)

---

### 2. Plan Mode (PlanMode.tsx)

**Route:** / (mode=plan)  
**Purpose:** Structured planning workspace - turn intentions into actionable plans.

**UI:**

- Orbit background animation
- Glass-textarea composer: "What would you like to plan?"
- Submit button (ArrowUp icon)
- Response area: "I've shaped that into a calm, focused plan..."
- Footnote: "A quiet space for turning intention into direction."

**Interaction:**

- Text input for planning requests
- Mock response on submit (simulates AI plan generation)
- Pre-fills from pendingRequest (voice: "Turn on plan mode and plan my project")

---

### 3. Search Mode (SearchMode.tsx)

**Route:** / (mode=search)  
**Purpose:** Web search interface with liquid glass environment and animated results.

**UI:**

- LiquidGlassEnvironment - animated fluid background (speeds up during search)
- Immersed Finch viewport (smaller, lower)
- Search stages: "Searching..." to "Finding sources..." to "Comparing information..." to "Collecting results..."
- Floating glass result cards (GlassResult) - 4 mock results positioned in 3D space
- Search composer: input + submit button
- ExpandedInformation modal on result click

**Mock Data:** mockSearchResults (4 items with title, source, description, category, detail)

**Interaction:**

- Type query - submit - animated search stages - results appear as floating cards
- Click card - expanded detail modal
- Pre-fills from pendingRequest

---

### 4. Research Mode (ResearchMode.tsx)

**Route:** / (mode=research)  
**Purpose:** Deep research with multi-stage analysis and connected knowledge graph.

**UI:**

- LiquidGlassEnvironment (active during research stages)
- Immersed Finch viewport
- 6 research stages: "Understanding context..." to "Reviewing conversation..." to "Connecting related information..." to "Analyzing relationships..." to "Building research..." to "Research complete."
- GlassResearchField - 5 connected research items positioned by depth (near/middle/far)
- Research caption: "CONTEXTUAL FIELD - Five connected threads"
- ExpandedInformation modal with connections on item click

**Mock Data:** mockResearch (5 items with category, title, description, detail, connections[], depth)

**Interaction:**

- Auto-advances through research stages on mount
- Results appear as positioned floating cards with depth layering
- Click card - expanded detail with connection threads
- Pre-fills from pendingRequest (though ResearchMode doesn't currently use it for input)

---

## Core Systems

### Voice Recognition System (useVoiceRecognition.ts)

**Hook:** useVoiceRecognition() to { state, transcript, error, startListening, stopListening, reset, isSupported, isSecureContext }

**States:**

- idle - Ready, mic shows "Ready"
- listening - Active recognition, pulsing ring animation
- processing - Recognition ended, analyzing transcript
- error - Recognition failed, shows error notice
- unsupported - Browser doesn't support SpeechRecognition

**Features:**

- Supports both SpeechRecognition and webkitSpeechRecognition
- Single-shot recognition (not continuous)
- Interim results enabled
- Auto-retry on transient "network" errors (1 attempt)
- Secure context detection (HTTPS/localhost required)
- Cleanup on unmount (stops recognition, removes listeners)

**Error Messages:**

| Error           | Message                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| no-speech       | "No speech detected. Please try again."                                         |
| audio-capture   | "Microphone not found. Please check your microphone."                           |
| not-allowed     | "Microphone access denied. Please allow microphone access in browser settings." |
| network (1st)   | "Speech service temporarily unavailable. Retrying..." - auto-retry              |
| network (retry) | "Speech service unavailable. Please try again in a moment."                     |
| Insecure origin | "Voice recognition requires HTTPS. Use localhost or deploy with SSL."           |

---

### Mode Intent Detection (detectModeIntent.ts)

**Function:** detectModeIntent(text: string) to { mode: Mode | null, request: string }

**Direct Commands (high priority):**
`"Turn on conversation mode" to conversation
"Turn on plan mode" to plan
"Turn on search mode" to search
"Turn on research mode" to research
"Switch to [mode] mode" to [mode]
"Go to [mode]" to [mode]
"Activate [mode] mode" to [mode]`

**Natural Variations:**
`Conversation: "Let's talk", "Let's chat", "I want to talk", "Talk with me"
Plan: "Let's make a plan", "Help me plan this", "I want to plan something"
Search: "Search for React", "Find information about TypeScript", "Look this up"
Research: "Research this", "Do deep research on React", "Investigate this topic"`

**Compound Commands (preserves request):**
`
"Turn on search mode and search for React tutorials"
to mode: "search", request: "search for React tutorials"

"Switch to plan mode and create a plan for my Finch project"
to mode: "plan", request: "create a plan for my Finch project"
`

**Priority:** Research > Search (explicit "research" beats "search for")

**Negative Cases (no mode switch):**
`Current: conversation to "What is React?" to stays conversation
Current: research to "Explain React hooks" to stays research`

---

## UI Components (Finch-Specific)

| Component              | Purpose                  | Key Features                                     |
| ---------------------- | ------------------------ | ------------------------------------------------ |
| FinchOrb               | Animated orb display     | Voice-state animation, aura glow, ground shadow  |
| ModeIndicator          | Top-right navigation     | 4 tabs, active dot indicator, click to switch    |
| VoiceControl           | Bottom-center mic button | Toggle idle to listening, pulsing ring, tooltips |
| LiquidGlassEnvironment | Animated background      | 4 fluid layers, speeds up when active={true}     |
| GlassResult            | Search result card       | Glass morphism, hover lift, position props       |
| GlassResearchField     | Research results grid    | 5 positioned items, depth layering               |
| FloatingInformation    | Base floating card       | Drift animation, hover expand, pointer glow      |
| ExpandedInformation    | Full-screen detail modal | Backdrop blur, connections list, close button    |

---

## Data Flow

### Voice Command Flow

`User clicks mic
       down
VoiceControl.onClick to handleVoiceClick()
       down
startListening() to SpeechRecognition.start()
       down
User speaks
       down
onresult to transcript captured
       down
onend to state = "processing"
       down
useEffect(processing + transcript) to detectModeIntent(transcript)
       down
setMode(detectedMode) + setPendingRequest(extractedRequest)
       down
UI re-renders with new mode + request pre-filled
       down
setTimeout(500ms) to voiceState = "idle", resetRecognition()`

### Manual Navigation Flow

`User clicks ModeIndicator tab
       down
onChange(mode) to setMode(mode)
       down
UI re-renders with new mode component
       down
pendingRequest preserved (not cleared on manual switch)`

---

## Key Design Decisions

1. **Single Page, Multiple Modes** - No route changes; mode is client state (useState). Enables instant switching, preserves scroll/animation state.

2. **Voice + Manual Share State** - Both update the same mode state. No duplication.

3. **Request Preservation** - Voice commands like "Turn on X and do Y" keep "do Y" for the new mode.

4. **No Continuous Listening** - User must explicitly click mic each time. Privacy-first.

5. **Graceful Degradation** - HTTPS check, unsupported browser notice, error recovery via retry button.

6. **Liquid Glass Aesthetic** - Custom CSS animations (fluid-drift, refract-drift, light-flow) create living background.

7. **Accessibility** - ARIA labels, live regions, keyboard navigation, reduced-motion support.

---

## Development Commands

`ash

# Install dependencies

npm install # or bun install

# Development server

npm run dev # http://localhost:8081

# Production build

npm run build # outputs to .output/

# Preview production build

npm run preview

# Lint

npm run lint

# Format

npm run format
`

---

## Environment Requirements

- **Node.js** 20+ (or Bun 1.0+)
- **HTTPS or localhost** - Required for Web Speech API (Chrome policy)
- **Microphone permission** - Browser prompt on first use
- **Modern browser** - SpeechRecognition support (Chrome, Edge, Safari 14.1+)

---

## Future Extensibility Points

| Area           | Current        | Planned                                |
| -------------- | -------------- | -------------------------------------- |
| AI Integration | Mock responses | Qwen / LLM via API                     |
| Search         | Mock data      | Real search API (SerpAPI, Brave, etc.) |
| Research       | Mock data      | Deep research agent                    |
| Voice Output   | None           | TTS (Web Speech API speechSynthesis)   |
| Persistence    | None           | Conversation history, plan storage     |
| Multi-user     | None           | Auth + sync                            |

---

## Testing Voice Commands

Open http://localhost:8081 and test:

| Test | Command                                               | Expected                        |
| ---- | ----------------------------------------------------- | ------------------------------- |
| 1    | "Turn on conversation mode"                           | Mode to Conversation            |
| 2    | "Turn on plan mode"                                   | Mode to Plan                    |
| 3    | "Turn on search mode"                                 | Mode to Search                  |
| 4    | "Turn on research mode"                               | Mode to Research                |
| 5    | "Switch to plan mode and help me organize my project" | Mode to Plan, request preserved |
| 6    | (in Conversation) "What is JavaScript?"               | Stays in Conversation           |
| 7    | "Research JavaScript closures"                        | Mode to Research                |

---

_Generated from codebase analysis - Finch v0.1.0_
