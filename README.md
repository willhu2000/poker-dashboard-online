# ♠ Poker Dashboard

[![CI](https://github.com/willhu2000/poker-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/willhu2000/poker-dashboard/actions/workflows/ci.yml)

A web app for analysing your weekly [PokerNow](https://www.pokernow.club/) home game. Upload your hand history CSV files to see stats like VPIP, PFR, Aggression Factor, net chips, and preflop range grids for every player. Sessions are saved locally in your browser so you can add a new file each week and view combined stats over time.

---

## What you need before starting

You only need to do this setup once.

### 1. Install Node.js

Node.js is the engine that runs this app on your computer.

1. Go to **https://nodejs.org**
2. Click the big **"LTS"** download button (LTS = recommended stable version)
3. Run the installer — click Next through all the steps, leave everything as default
4. When it finishes, **restart your computer**

To check it worked: open a terminal (see step 2 below) and type `node --version`. You should see something like `v22.0.0`.

---

### 2. Open a terminal

A terminal is a text window you type commands into.

**On Windows:**
- Press `Windows key + R`, type `cmd`, press Enter
- *Or* search for "Command Prompt" in the Start menu

**On Mac:**
- Press `Cmd + Space`, type `Terminal`, press Enter

---

### 3. Download the project

**If you received a ZIP file:**
1. Unzip it somewhere easy to find, like your Desktop or Documents folder
2. In your terminal, navigate into the folder:

   **Windows example** (adjust the path to match where you unzipped it):
   ```
   cd C:\Users\YourName\Desktop\poker-dashboard
   ```

   **Mac example:**
   ```
   cd ~/Desktop/poker-dashboard
   ```

**If you have Git installed** (more advanced):
```
git clone <repo-url>
cd poker-dashboard
```

---

### 4. Install dependencies (one-time setup)

In your terminal, with the project folder open, run:

```
npm install
```

This downloads everything the app needs. It may take a minute or two. You'll see a lot of text — that's normal.

---

## Running the app

Every time you want to use the dashboard, open a terminal in the project folder and run:

```
npm run dev
```

You'll see output like:

```
  VITE v8.x.x  ready in 300ms

  ➜  Local:   http://localhost:5173/
```

Then open your browser and go to **http://localhost:5173**

The app is running! To stop it, go back to the terminal and press `Ctrl + C`.

> **Tip:** Keep the terminal window open while using the app. If you close it, the app stops.

---

## How to export your hand history from PokerNow

After each game session on PokerNow:

1. Go to the game room
2. Click the **menu (≡)** in the top-right corner
3. Click **"Download Hand History"** — this saves a `.csv` file to your Downloads folder

---

## Using the dashboard

1. Start the app (`npm run dev`) and open **http://localhost:5173** in your browser
2. On the home screen, drag your CSV file onto the upload area, or click to browse for it
3. The session is saved automatically — you don't need to re-upload it next time
4. Each week after your game, upload the new CSV. Click **"+ Add Session"** from the dashboard, or go back to the Sessions page and drop the new file there
5. Click **"View All Sessions (N) →"** to see combined stats across all weeks

Your data lives in your browser's local storage, so it persists between visits as long as you use the same browser on the same computer.

---

## Troubleshooting

**"npm is not recognized" or "command not found"**
- Node.js didn't install correctly, or you need to restart your computer after installing it
- Try restarting, then open a fresh terminal

**The page won't load at http://localhost:5173**
- Make sure the terminal is still running `npm run dev` (you should see the "ready" message)
- Try a different browser

**"Failed to parse file" error after uploading**
- Make sure you're uploading a PokerNow hand history CSV (not a different type of file)
- The file should come from PokerNow's "Download Hand History" option

**The app is slow or the terminal shows errors**
- Stop the app (`Ctrl + C`) and run `npm install` again, then `npm run dev`

---

## Stats glossary

| Term | Meaning |
|------|---------|
| **VPIP** | Voluntarily Put $ In Pot — % of hands where the player called or raised preflop (blinds don't count). High = loose player. |
| **PFR** | Preflop Raise % — % of hands with a preflop raise. Always ≤ VPIP. |
| **AF** | Aggression Factor — (Bets + Raises) ÷ Calls post-flop. >2 = aggressive, <1 = passive. |
| **Win%** | % of dealt hands where the player collected the pot. |
| **Fold%** | % of hands folded before seeing the flop. |
| **Luck†** | % of observed hands that were premium (AA/KK/QQ/JJ/AK). Higher = ran hot. |
| **Tight** | VPIP below 20% — plays only strong hands. |
| **Loose** | VPIP above 50% — plays most dealt hands. |
| **Passive** | AF below 1 — tends to call rather than bet or raise. |
| **Aggressive** | AF above 2 — frequently bets and raises. |
| **Net Chips** | Total cash-out minus total buy-ins across all loaded sessions. |

---

## Codebase overview

This section is for developers. It covers what every source file does and how they fit together.

### Architecture

```
src/
├── main.jsx                   # React entry point
├── App.jsx                    # Root component — routing & file handling
├── parser.js                  # CSV parsing, card normalisation, hashing
├── stats.js                   # Hand-level state machine & stat computation
├── sessions.js                # localStorage CRUD & session merging
├── handEval.js                # 5-card hand evaluator (combination enumeration)
├── index.css                  # All application styles (dark theme)
└── components/
    ├── Dashboard.jsx          # Main view after upload — charts, tabs, leaderboard
    ├── SessionsHome.jsx       # Landing page — session list & upload drop zone
    ├── PlayerDetail.jsx       # Per-player deep-dive — hand history, bad beats
    ├── Leaderboard.jsx        # Summary table of all players
    └── OverviewCharts.jsx     # Recharts bar charts for session overview
```

Data flows in one direction: CSV text → `parser.js` → `stats.js` → stored via `sessions.js` → rendered by components.

---

### `src/main.jsx`

Standard Vite/React entry point. Mounts `<App />` inside React `StrictMode` into the `#root` div. No logic lives here.

---

### `src/App.jsx`

Root component. Owns top-level state and coordinates all navigation between views.

**State**
- `sessions` — array of session records loaded from localStorage on mount
- `view` — `null` (home screen) | `{ type: 'single', id }` | `{ type: 'merged', selectedIds[] }`
- `error` — error string shown when a file fails to parse or is a duplicate

**Key functions**
- `handleNewFile(file)` — reads a CSV, hashes it to detect duplicates, parses it, saves it, then navigates into the session view
- `handleAddSession(file)` — same pipeline but stays on the current (merged) view instead of navigating away
- `handleDelete(id)` — removes a session from storage; returns to home if the deleted session was active

**Rendering**
- When `view` is set, resolves the data (single session stats or the output of `mergeSessions`) and renders `<Dashboard>`
- Otherwise renders `<SessionsHome>` with the full saved-session list

---

### `src/parser.js`

Utilities for reading PokerNow CSV files and normalising their content.

**Exports**

| Export | Purpose |
|---|---|
| `hashContent(text)` | FNV-1a hash of the raw CSV text → 8-char hex string; used for duplicate upload detection |
| `parseLog(csvText)` | Parses CSV via PapaParse; returns rows sorted ascending by the `order` column |
| `extractName(raw)` | Strips the `@ tag` suffix from PokerNow player identifiers (`"Alice @ abc123"` → `"Alice"`) |
| `normaliseCard(raw)` | Parses a card string (e.g. `"A♠"`, `"10♥"`) into `{ rank, suit }`, handling Unicode suit symbols and mojibake encoding variants from mis-encoded files |
| `cardToString(card)` | Converts a `{ rank, suit }` object back to a display string with the Unicode suit symbol |
| `classifyHand(c1, c2)` | Categorises a two-card starting hand into a named group (e.g. `"Premium Pair (AA/KK)"`, `"Suited Connector"`, `"Speculative / Trash"`) |
| `extractGameDate(rows)` | Reads the `at` ISO timestamp column on the first valid row; falls back to scanning entry text for a `YYYY-MM-DD` pattern |
| `formatSessionName(date)` | Returns a session label in `poker-MM-DD-YYYY` format |

**Card normalisation detail**

`normaliseCard` handles three encoding scenarios for suit symbols: direct Unicode (`♠ ♥ ♦ ♣`), mojibake byte sequences from files opened with the wrong encoding, and a last-byte fallback for edge cases. Suits that cannot be determined are stored as `'?'` and excluded from hand evaluation.

---

### `src/stats.js`

The core analysis engine. Processes the sorted row array from `parseLog` through a hand-level state machine and returns aggregate statistics for every player.

**Export: `analyseLog(rows)` → `{ players, handCount }`**

The function maintains a `currentHand` object (initialised by `emptyHand()`) and commits it to all players' records whenever a hand-end marker is encountered.

**`emptyHand()` fields**

| Field | Description |
|---|---|
| `players` | Map of player name → seat/stack for this hand |
| `preflopActions` | Map of player name → sequence of preflop action strings |
| `street` | Current street: `preflop`, `flop`, `turn`, or `river` |
| `shownCards` | Map of player name → `[card1, card2]` revealed at showdown |
| `winners` | Array of `{ name, amount }` for each pot collector |
| `board` | Up to 5 community cards in order |
| `viewerCards` | Hole cards for the file's point-of-view player (detected by name starting with `"will"`) |
| `dealer` / `sb` / `bb` | Role assignments detected for the hand |
| `actionLog` | Ordered array of `{ type, street, player?, action?, amount? }` entries |

**Log lines parsed (in order of priority)**
- Hand start/end markers
- Buy-in and cash-out events (processed even between hands to track net chips correctly)
- Dealer designation
- Player stacks line (registers who is dealt in)
- `Your hand is` — viewer's private hole cards
- Street markers (`Flop:` / `Turn:` / `River:`) — parses board cards from bracket or bare notation; handles both cumulative and incremental card formats
- Player actions: fold, call, raise, bet, check, shows a hand, collected from pot
- Blind postings (small and big — not counted as voluntary VPIP)

**`commitHand(hand)` — what gets recorded**
- VPIP, PFR, and preflop-fold increments for all dealt players
- Showdown hand categories and premium-hand counts (for the luckiness proxy)
- Winner tracking
- Viewer cards (known every hand even without a showdown)
- **Bad beat detection**: if a losing showdown player held Two Pair or better, the hand is recorded on their `badBeats` array and mirrored on the winner's `suckOuts` array
- A full `handsHistory` entry on every dealt player, including hole cards (if known), board, opponents, pot size, role metadata, and the complete `actionLog`

**Derived metrics** (computed after all rows are processed)

`vpip`, `pfr`, `preflopFoldPct`, `winRate`, `af` (Aggression Factor = bets+raises ÷ calls; capped at `99` when calls = 0), `netChips` (cash-out − buy-ins), `luckiness` (premium showdown hands %), `tightness` (100 − VPIP).

---

### `src/sessions.js`

Manages the persistence layer. Sessions are stored as a JSON array under the `"poker-sessions"` key in `localStorage`.

**Exports**

| Export | Purpose |
|---|---|
| `loadSessions()` | Returns the stored session array, or `[]` on parse failure |
| `isDuplicate(contentHash)` | Returns `true` if any saved session has a matching `contentHash` |
| `saveSession(fileName, stats, gameDate, contentHash)` | Prepends a new session record with a generated ID and persists it; stores `gameDate` as `YYYY-MM-DD` |
| `deleteSession(id)` | Removes the session from the array and persists the result |
| `mergeSessions(sessions)` | Aggregates one or more session stat objects into a single combined stats object |

**`mergeSessions` detail**

For a single session, it tags every `handsHistory`, `badBeats`, and `suckOuts` entry with `sessionId` and `sessionDate` (needed so the merged-view hand table can show which session each hand came from) and returns the stats unchanged.

For multiple sessions, it sums all accumulator fields (handsDealt, vpipHands, totalBetsRaises, etc.), concatenates array fields (shownHands, rangeHands, handsHistory, badBeats, suckOuts), merges `handCategories` maps, and recomputes all derived percentage metrics from the combined accumulators.

---

### `src/handEval.js`

5-card hand evaluator used for bad-beat detection, hand-history display, and the Hand Strength column.

**Exports**

| Export | Purpose |
|---|---|
| `bestHand(holeCards, board)` | Returns `{ rank: 0–9, name }` for the best 5-card hand from the supplied cards, or `null` if fewer than 5 valid cards (no unknown suits) are available |

**Hand ranks returned by `evalFive`**

| Rank | Name |
|---|---|
| 9 | Royal Flush |
| 8 | Straight Flush |
| 7 | Four of a Kind |
| 6 | Full House |
| 5 | Flush |
| 4 | Straight |
| 3 | Three of a Kind |
| 2 | Two Pair |
| 1 | Pair |
| 0 | High Card |

Royal Flush is distinguished from Straight Flush by checking that the top card is an Ace (`uniq[4] === 14`) with a gap of exactly 4 (T-J-Q-K-A). The wheel straight (A-2-3-4-5) is detected separately and correctly stays Straight Flush rank 8.

`bestHand` uses `pickCombos(arr, 5)` to enumerate all C(n, 5) five-card subsets from the combined hole cards and board, evaluates each with `evalFive`, and returns the highest-ranked result.

---

### `src/index.css`

Single-file stylesheet for the entire application using a dark colour theme defined with CSS custom properties.

**CSS custom properties (`:root`)**
- `--bg`, `--surface`, `--surface2` — layered background surfaces
- `--accent` — primary purple highlight colour
- `--green`, `--red` — profit/loss chip colours
- `--text`, `--muted`, `--border` — typography and divider colours

**Key class groups**

| Group | What it styles |
|---|---|
| Layout | `.app`, `.upload-zone`, `.sessions-page`, `.sessions-body` |
| Session list | `.session-row`, `.session-info`, `.session-meta`, `.merged-session-card` |
| Dashboard | `.dashboard-header`, `.stats-grid`, `.stat-card`, `.charts-grid`, `.chart-card` |
| Leaderboard | `.lb-table`, `.range-bar-wrap`, `.range-bar`, `.tag` (+ `.tight`, `.loose`, `.agg` modifiers) |
| Player detail | `.player-tabs`, `.player-tab`, `.hand-table`, `.hand-row`, `.expanded-row` |
| Hand table controls | `.search-row`, `.search-input`, `.search-col-select`, `.detail-toggle-btn` (+ `.active`) |
| Sortable columns | `.hand-table th.sortable`, `.sort-active` |
| Board / cards | `.board-cards`, `.board-sep` |
| Action log | `.action-log`, `.al-group`, `.al-street-label`, `.al-board`, `.al-action`, `.al-player`, `.al-verb` |
| Glossary | `.glossary-panel`, `.glossary-toggle`, `.glossary-grid`, `.glossary-item` |
| Buttons | `.btn`, `.btn-primary`, `.btn-ghost` |

---

### `src/components/Dashboard.jsx`

The main application view rendered after at least one session is loaded.

**Props**
- `data` — merged or single-session stats object (`{ players, handCount }`)
- `fileName` — display label for the header bar
- `isMerged` — boolean; enables the session-selector checkbox dropdown when true
- `sessionCount` — total saved sessions (shows "View All N Sessions" button when ≥ 2 and not already merged)
- `selectedIds` — IDs of sessions currently included in the merged view
- `allSessions` — full session list for the selector dropdown
- `onBack`, `onViewMerged`, `onUpdateSessions`, `onAddSession` — navigation and data callbacks

**Layout from top to bottom**
1. **Header bar** — back button, title, hand/player count, merged tag, session-selector dropdown, and an "+ Add Session" file input
2. **Error display** — shown inline when file parsing or duplicate detection fails
3. **`<GlossaryPanel>`** — collapsible definition list for all stat abbreviations
4. **Stats grid** — six summary tiles: Hands Played, Players, Biggest Winner, Biggest Loser, Most Aggressive, Tightest Player
5. **`<OverviewCharts>`** — four Recharts bar charts
6. **Player tabs** — one button per player sorted by net chips; click switches the deep-dive below
7. **`<PlayerDetail>`** — full per-player analysis panel
8. **`<Leaderboard>`** — scrollable summary table of all players

---

### `src/components/SessionsHome.jsx`

Landing page shown when no session is being viewed.

**Two layouts**
- **Empty state** — fullscreen drop zone with upload instructions shown when no sessions have been saved yet
- **Session list** — compact drop zone at the top, an "All Sessions Combined" card (shown when ≥ 2 sessions exist), and a scrollable list of individual session rows

Each session row shows the name, upload date, hand count, player count, and a comma-separated preview of player names (capped at 6, with "+N more"). Row actions are **View** and **Delete** (with a `confirm()` prompt).

Drag-and-drop is wired on both drop zones via `onDrop`, `onDragOver`, and `onDragLeave`, which toggle the `.over` CSS class for visual feedback.

---

### `src/components/PlayerDetail.jsx`

The most feature-rich component. Provides a full per-player analysis panel: a searchable, sortable hand-history table with expandable rows, and collapsible sections for bad beats and suck-outs.

**Module-level helpers**

| Helper | Description |
|---|---|
| `fmtDate(iso)` | Converts `YYYY-MM-DD` → `MM-DD-YYYY` for display |
| `handStrength(c1, c2)` | Numeric sort score for hole cards: pairs score 500 + rank·10; non-pairs score hi·15 + lo + suited bonus |
| `_RMAP` | Rank alias map — maps spoken names and abbreviations to canonical rank strings (`"ace" → "A"`, `"ten" → "10"`, etc.) |
| `_SMAP` | Suit alias map — maps `"spade"`, `"heart"`, etc. and single-letter codes to `s/h/d/c` |
| `parseCardQuery(input)` | Tokenises freeform text into 0–2 card descriptors; handles compact notation (`AA`, `AKs`, `1010`, `AS KD`), spelled-out names, and space-separated rank/suit pairs |
| `cardMatchesDesc(card, desc)` | Returns true if a `{ rank, suit }` card matches a parsed descriptor object |
| `handMatchesCardQuery(c1, c2, descs)` | Checks a two-card hand against 1 or 2 descriptors in either order |
| `matchesSearch(h, query, col)` | Master search dispatcher — routes to per-column check functions; `col = 'all'` checks every searchable column |
| `computeHandStrength(h)` | Evaluates best available hand: preflop (no board) checks for a pocket pair; with board cards uses `bestHand`; no hole cards falls back to board-only evaluation when ≥ 5 board cards are available |

**Sub-components**

| Component | Description |
|---|---|
| `BoardCards({ board })` | Renders community cards with `\|` separators between the flop (cards 1–3), turn (card 4), and river (card 5) |
| `ActionLog({ log })` | Groups `actionLog` entries by street and renders a street label, the board state at that point, and each player action with optional chip amount |
| `SortTh({ col, children })` | A `<th>` with click-to-sort behaviour and a ↕ / ↑ / ↓ direction indicator |

**State managed**
- `handFilter` — `'all'` | `'wins'` | `'losses'` | `'shown'` | `'badbeat'` | `'suckout'`
- `expandedHand` — hand number of the currently expanded row, or `null`
- `detailMode` — boolean; shows dealer/SB/BB roles and the full `<ActionLog>` when enabled
- `sortCol` / `sortDir` — active column key and direction (`'asc'` or `'desc'`); default is hand number descending
- `searchQuery` / `searchCol` — freeform search text and which column to search within

**Hand table columns**

| Column | Sort logic |
|---|---|
| Hand # | Numeric |
| Session | Alphabetical by date string (merged view only) |
| Cards | `handStrength` score |
| Won | Boolean (wins first when descending) |
| Board | String concatenation of all board card representations |
| Pot | Numeric |
| Hand Strength | `computeHandStrength(h).rank` (0 = High Card → 9 = Royal Flush) |

**Expanded row**

Clicking any hand row expands a detail panel showing: hole cards, board, pot size, amount won (if applicable), opponents' shown cards with their best made hand, and (when Detailed Mode is on) dealer/SB/BB roles and the full `<ActionLog>`.

**Bad beats and suck-outs**

Rendered as collapsible sections below the main hand table. Each entry shows both players' hole cards, the board, the pot size, and the hand names. When Detailed Mode is active, the full `<ActionLog>` is shown for each entry.

---

### `src/components/Leaderboard.jsx`

A read-only summary table listing all players sorted by net chips (as passed in from `Dashboard`, highest to lowest).

**Columns:** Rank, Player, Hands, Net Chips (green/red), VPIP (with a proportional bar visualisation), PFR %, Fold %, AF, Win %, Luck †, Style.

The **Style** column combines two derived tags:
- Tight (VPIP < 25) / Semi-Loose / Loose (VPIP > 50)
- Aggressive (AF > 2) / Balanced / Passive (AF < 1)

Clicking a row fires `onSelect(playerName)` which scrolls the Player Deep Dive above to that player.

---

### `src/components/OverviewCharts.jsx`

Four Recharts bar charts giving a visual session overview. Only players with ≥ 3 hands dealt are included.

| Chart | Description |
|---|---|
| Net Chips by Player | Vertical bars coloured green (profit) or red (loss) per player |
| VPIP vs PFR | Grouped bars per player on a 0–100% scale |
| Preflop Fold % | Horizontal bar chart sorted descending, each bar individually coloured |
| Aggression Factor | Vertical bars capped at 10 for readability, with a footnote explaining the cap |

All charts use a shared `<Tip>` custom tooltip component and a shared `COLORS` palette array. Charts are wrapped in `ResponsiveContainer` so they scale fluidly within their `.chart-card` grid cells.

---

### Data model

A saved session in localStorage has this shape:

```json
{
  "id": "m0abc123xyz",
  "fileName": "poker-04-12-2025",
  "gameDate": "2025-04-12",
  "uploadedAt": "2025-04-13T10:22:00.000Z",
  "handCount": 87,
  "playerNames": ["Alice", "Bob", "Will"],
  "contentHash": "a1b2c3d4",
  "stats": { "players": { "...": {} }, "handCount": 87 }
}
```

Each player entry inside `stats.players` contains:
- Raw accumulators: `vpipHands`, `pfrHands`, `preflopFolds`, `totalBetsRaises`, `totalCalls`, `totalChecks`, `handsDealt`, `handsWon`, `buyIns`, `cashOut`, `allHandsShown`, `premiumHandsShown`
- Derived percentages: `vpip`, `pfr`, `preflopFoldPct`, `winRate`, `af`, `netChips`, `luckiness`, `tightness`
- Arrays: `shownHands`, `handCategories`, `rangeHands`, `handsHistory`, `badBeats`, `suckOuts`

Each `handsHistory` entry (and each bad beat / suck-out) carries `sessionId` and `sessionDate` so the merged-view hand table can show which session a hand came from.
