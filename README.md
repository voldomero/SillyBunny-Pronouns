# SillyBunny Pronouns — Multiple Pronouns

### This project has been updated and moved to a new repository!
> **Depreciated**. See [Character Lexicon](https://github.com/voldomero/SillyBunny-CharacterLexicon) for latest release.

---

Pronoun management for **SillyBunny** personas *and* characters, built to make
**multiple pronouns** actually work in chat.

LLMs tend to collapse "she/they" down to just "she" and refer to the persona only
one way. This extension fixes that two ways at once:

1. **An ordered list of pronoun sets** per persona/character (instead of a single set),
   with rotating macros so pronoun usage varies naturally where macros are placed.
2. **An injected directive** — when an entity has two or more sets, a short system
   instruction is added telling the model to alternate between them. This is the part
   that makes the model itself use varied pronouns in its own writing.

Ported from and inspired by the [SillyTavern-Pronouns](https://github.com/SillyTavern/SillyTavern-Pronouns)
extension by [Wolfsblvt](https://github.com/Wolfsblvt) and [Ana](https://github.com/phampyk).

## Installation

Install using SillyBunny's extension installer from the URL:

```txt
https://github.com/aracnai/SillyBunny-Pronouns
```

Or copy this folder into your SillyBunny third-party extensions directory, named
exactly **`SillyBunny-Pronouns`** (the folder name must match so templates resolve):

```
<SillyBunny>/data/<your-user>/extensions/SillyBunny-Pronouns/
```

Then enable **Pronouns (Multiple)** in the Extensions panel. Requires the macro
engine, which is enabled by default in SillyBunny.

## How it works

### Multiple pronoun sets

Each persona and character holds a list of pronoun sets. Add one set for a single
pronoun, or several for multiple pronouns:

- `she/her`
- `she/her` + `they/them` → **she/they**
- `she/her` + `he/him` + `they/them` → **any/all**

Use the editor under the **persona description** (Persona Management) and under the
**character description** (character panel). Quick buttons append single presets
(She/Her, He/Him, …) or replace everything with a multi preset (She/They, He/They, Any/All).

### Resolution mode

When an entity has 2+ sets, the **When multiple** selector controls how the macros resolve:

| Mode | Behavior | Example output |
|---|---|---|
| **Rotate** (default) | Varies between sets per occurrence | "She grabbed their bag." |
| **Primary** | Always the first set | "She grabbed her bag." |
| **Join** | All sets joined | "she/they grabbed she/they bag." |

### The directive

This is the lever that makes NPCs actually refer to you with varied pronouns.
When an entity has 2+ sets, a system instruction is injected and **refreshed before
every generation**, rotating a concrete "active" set each turn:

> *[Pronoun instruction: {{user}} uses multiple pronoun sets — she/her and they/them.
> In your next reply, refer to {{user}} using **they/them** pronouns specifically.
> Across the roleplay, deliberately rotate through all of {{user}}'s pronoun sets
> instead of defaulting to one — every set is equally correct and in-character.]*

The per-turn command (`%ACTIVE%`) is deliberately forceful: a soft "alternate naturally"
note gets ignored when the description and history are saturated with one pronoun, so
instead each reply is told exactly which set to use, and the choice rotates turn to turn.

Template placeholders: `%LIST%` = all sets ("she/her and they/them"); `%ACTIVE%` = this
turn's rotated set ("they/them"). It's toggleable globally (Extensions → Pronouns
(Multiple) settings), per-entity (the **Directive** selector: Default / Always on / Off),
and the wording, injection depth (default 2), and role are all configurable.

### Troubleshooting

If the model still won't vary pronouns, run **`/pronouns-debug`** (or enable
*Log directive to console* in settings). It reports, per entity: how many sets are
stored, whether the directive will inject, and the exact text being sent. If it shows
`0 set(s)` or `inject=false`, the data/toggle didn't take; if it shows the text but the
model ignores it, lower the injection depth toward 0–1.

## Macros

Persona (the user) and character (the bot) each get their own family. All resolve
through the entity's mode (rotate/primary/join).

| Persona | Character | Pronoun type | Examples |
|---|---|---|---|
| `{{pronounSubjective}}` | `{{charPronounSubjective}}` | Subjective | she / he / they |
| `{{pronounObjective}}` | `{{charPronounObjective}}` | Objective | her / him / them |
| `{{pronounPosDet}}` | `{{charPronounPosDet}}` | Possessive determiner | her / his / their |
| `{{pronounPosPro}}` | `{{charPronounPosPro}}` | Possessive pronoun | hers / his / theirs |
| `{{pronounReflexive}}` | `{{charPronounReflexive}}` | Reflexive | herself / themselves |
| `{{pronounVerbBe}}` | `{{charPronounVerbBe}}` | Verb-be agreement | is / are |

**Compatibility (opt-in, persona-mapped):**

- WyvernChat dot-notation (`{{pronoun.subjective}}` …) is rewritten automatically.
- WyvernChat capitalized variants (`{{pronounSubjectiveCap}}` …) — toggle.
- JanitorAI (`{{sub}}`, `{{obj}}`, `{{poss}}`, `{{poss_p}}`, `{{ref}}`) — toggle.
- English shorthands (`{{she}}`, `{{him}}`, `{{their_}}` …) — toggle.

## Slash commands

| Command | Description |
|---|---|
| `/pronouns-set key=<key> [target=persona\|character] [index=N] <value>` | Set one field of set `N`. |
| `/pronouns-preset [target=…] <preset>` | Replace all sets with a preset (`she`/`he`/`they`/`it` or `sheThey`/`heThey`/`sheHe`/`any`). |
| `/pronouns-add [target=…] <preset>` | Append a single preset set. |
| `/pronouns-mode [target=…] <rotate\|primary\|join>` | Set the resolution mode. |
| `/pronouns-clear [target=…]` | Remove all sets. |
| `/pronouns-replace [target=…] [shorthands=…] <text>` | Replace pronoun words in text with macros. |
| `/pronouns-open-replacer [target=…] [shorthands=…] [text]` | Open the replacer popup. |
| `/pronouns-debug` | Dump current sets, modes, and the injected directive text to the console. |

## Data & storage

- **Persona** pronouns are stored on the persona descriptor (alongside the description),
  so they survive exports and backups. Old single-set data from the original extension
  is migrated in place.
- **Character** pronouns are stored in this extension's settings (keyed by the character's
  avatar), so chatting with a card never modifies the card file.

Uninstalling removes all pronoun data and the injected directives.

## License

AGPL-3.0 — see [LICENSE](LICENSE). Based on [SillyTavern-Pronouns](https://github.com/SillyTavern/SillyTavern-Pronouns).
