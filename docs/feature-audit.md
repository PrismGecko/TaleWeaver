# Simplification pass

The app kept every capability it had, but the interface was a three-column
desktop layout squeezed onto a phone: two slide-out drawers, a model-ID text
field competing for space in a 56px top bar, three dropdowns stacked above the
keyboard, and six 25px-tall text buttons on every message. This pass rebuilt
the shell around one screen and one navigation primitive.

## The shape now

**One screen.** The transcript is the app. Above it: the story title, a save
indicator and `⋯`. Below it: the composer. Between them, a scrolling chip row
that is the whole of the secondary navigation — which branch, which scene,
and the world.

**One navigation primitive.** Everything that is not the transcript is a
screen inside a bottom sheet (`src/ui/sheet.js`), which owns a stack and
therefore a back button. Sheets stack rather than replace, so a menu opened
from the world browser hands control back to the browser when dismissed.

**Touch targets.** `--tap: 44px` is the floor for anything tappable, and every
real input is at least 16px — below that, iOS Safari zooms the page in on
focus, which was a large part of why the app felt hostile on a phone.

## What changed conceptually

### Canon → the World
"Canon" is gone as a word. Characters, locations, objects and facts now live
in one searchable list with a kind filter. Objects and facts are still canon
entries underneath — split on `type` — so nothing migrates destructively and
the lorebook keyword mechanism is untouched.

Two dropdowns (`importance` × `keywords`) collapsed into one question: is this
**always** remembered, or brought up **only when it comes up**? Choosing the
latter without supplying keywords falls back to the entry's own name as the
trigger, so an entry can no longer silently behave as always-on.

### Personas → "Who you play"
Removed as a collection; kept as a capability. It was a full CRUD collection
plus a composer dropdown for what is, for one person, two fields about one
character. It is now `settings.you` — a name and a description — reachable
from the World and from Settings.

The part that earned its keep is intact: naming your character still emits
`Never speak, act, or decide for X` into the system prompt, which is the
single most valuable line in it for roleplay.

Migration (`migrateLegacyPersonas`): the persona you were actually playing
becomes `settings.you`; any spares become characters rather than being
dropped.

### Relationships → chips, never IDs
Every `*_ids` field used to be a text input asking you to type
comma-separated internal IDs. They are now tap-to-toggle name chips
(`chipField` in `src/ui/formFields.js`), backed by a hidden input so the
form-reading code stays uniform. Deleting an entry now also detaches every
reference to it.

### Message actions → one menu, plus a footer where your thumb is
Six inline buttons per message became one `⋯`. The actions you reach for
mid-scene — flip between takes, retry, illustrate — sit as a footer on the
newest reply. "Delve" is now "Illustrate", which says what it does.

### Composer → a text field
Role, persona and speaker dropdowns are behind `＋`: quick responses, write as
narrator, speak as a character (including a one-off walk-on), aside to the AI,
note for the AI. The chosen mode shows as a clearable badge. `//` still marks
an aside.

### Settings → ordered by how often you touch it
Story instructions first, then the model, images, and your key. Context size,
auto-summarize, emotion tracking, hidden knowledge and the raw context
inspector are folded under one disclosure.

## Kept, deliberately
Branching is first-class — it is the reason the app exists — and got a real
picker with rename, fork and compare, rather than a tree in a sidebar.

## Added
Per-story delete (a library you cannot prune is a hole once you keep several),
and a UI test suite (`tests/ui.test.js`) that boots the real `index.html` in
jsdom and drives it. Nothing above the services layer had test coverage before.
