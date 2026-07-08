/**
 * Core pronoun data model, entity (persona / character) state, and settings
 * for the SillyBunny Pronouns extension.
 *
 * The key difference from the original SillyTavern-Pronouns extension is that an
 * entity no longer holds a single pronoun set — it holds an ordered *list* of
 * sets plus a resolution `mode`. This is what enables "multiple pronouns"
 * (she/they, he/they, any/all) to actually surface in chat.
 *
 * Storage:
 *  - Persona pronouns live on `power_user.persona_descriptions[avatarId].pronoun`
 *    (same location the original used, so old single-set data migrates in place).
 *  - Character pronouns live in this extension's own settings under
 *    `characters[charKey]`, keyed by the character's avatar filename. We keep them
 *    out of the card file so chatting with a card never mutates someone else's card.
 */

import { saveSettingsDebounced, saveSettings, user_avatar, this_chid } from '../../../../../script.js';
import { power_user } from '../../../../../scripts/power-user.js';
import { extension_settings } from '../../../../extensions.js';
import { getCharaFilename } from '../../../../utils.js';
import { EXTENSION_KEY } from '../index.js';

// ---------------------------------------------------------------------------
// Types and constants
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PronounSet
 * @property {string} subjective - Subjective pronoun (she/he/they)
 * @property {string} objective - Objective pronoun (her/him/them)
 * @property {string} posDet - Possessive determiner (her/his/their)
 * @property {string} posPro - Possessive pronoun (hers/his/theirs)
 * @property {string} reflexive - Reflexive pronoun (herself/himself/themselves)
 */

/**
 * @typedef {Object} PronounContainer
 * @property {PronounSet[]} sets - Ordered list of pronoun sets (0 or more).
 * @property {'rotate'|'primary'|'join'} mode - How macros resolve when there are 2+ sets.
 * @property {'default'|'on'|'off'} directive - Per-entity override for the injected directive.
 */

/** @typedef {'persona'|'character'} Entity */

/** Ordered pronoun field keys. Order matters for replacer precedence and UI layout. */
export const PRONOUN_KEYS = Object.freeze(['subjective', 'objective', 'posDet', 'posPro', 'reflexive']);

/** @type {PronounSet} */
export const defaultSet = Object.freeze({
    subjective: '',
    objective: '',
    posDet: '',
    posPro: '',
    reflexive: '',
});

/** Resolution modes for multi-set entities. */
export const MODES = Object.freeze({
    ROTATE: 'rotate',
    PRIMARY: 'primary',
    JOIN: 'join',
});

/** Per-entity directive override states. */
export const DIRECTIVE_OVERRIDE = Object.freeze({
    DEFAULT: 'default',
    ON: 'on',
    OFF: 'off',
});

/** Single-set presets — fill one pronoun set. */
/** @type {{[presetName: string]: PronounSet}} */
export const pronounPresets = {
    she: { subjective: 'she', objective: 'her', posDet: 'her', posPro: 'hers', reflexive: 'herself' },
    he: { subjective: 'he', objective: 'him', posDet: 'his', posPro: 'his', reflexive: 'himself' },
    they: { subjective: 'they', objective: 'them', posDet: 'their', posPro: 'theirs', reflexive: 'themselves' },
    it: { subjective: 'it', objective: 'it', posDet: 'its', posPro: 'its', reflexive: 'itself' },
};

/** Multi-set quick presets — combinations of single presets, in order. */
/** @type {{[presetName: string]: string[]}} */
export const multiPresets = {
    sheThey: ['she', 'they'],
    heThey: ['he', 'they'],
    sheHe: ['she', 'he'],
    any: ['she', 'he', 'they'],
};

/** @typedef {{ pronounKey: 'subjective'|'objective'|'posDet'|'posPro'|'reflexive'; names: string[] }} PronounShorthandAlias */

/** Readability shorthands (she/her/his_ etc.) — language-neutral names for common English pronouns. */
/** @type {ReadonlyArray<PronounShorthandAlias>} */
export const shorthandAliases = Object.freeze([
    { pronounKey: 'subjective', names: ['she', 'he', 'they'] },
    { pronounKey: 'objective', names: ['her', 'him', 'them'] },
    { pronounKey: 'posDet', names: ['her_', 'his_', 'their_'] },
    { pronounKey: 'posPro', names: ['hers', 'his', 'theirs'] },
    { pronounKey: 'reflexive', names: ['herself', 'himself', 'themself'] },
]);

/** WyvernChat capitalized macro variants ({{pronounSubjectiveCap}} etc.). */
/** @type {ReadonlyArray<{pronounKey: 'subjective'|'objective'|'posDet'|'posPro'|'reflexive', name: string}>} */
export const wyvernChatAliases = Object.freeze([
    { pronounKey: 'subjective', name: 'pronounSubjectiveCap' },
    { pronounKey: 'objective', name: 'pronounObjectiveCap' },
    { pronounKey: 'posDet', name: 'pronounPosDetCap' },
    { pronounKey: 'posPro', name: 'pronounPosProCap' },
    { pronounKey: 'reflexive', name: 'pronounReflexiveCap' },
]);

/** JanitorAI compatibility aliases ({{sub}}, {{obj}}, {{poss}}, {{poss_p}}, {{ref}}). */
/** @type {ReadonlyArray<PronounShorthandAlias>} */
export const JanitorAIAliases = Object.freeze([
    { pronounKey: 'subjective', names: ['sub'] },
    { pronounKey: 'objective', names: ['obj'] },
    { pronounKey: 'posDet', names: ['poss'] },
    { pronounKey: 'posPro', names: ['poss_p'] },
    { pronounKey: 'reflexive', names: ['ref'] },
]);

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/**
 * Coerces an arbitrary object into a clean PronounSet (all five string fields).
 * @param {any} raw
 * @returns {PronounSet}
 */
export function normalizeSet(raw) {
    const out = { ...defaultSet };
    if (raw && typeof raw === 'object') {
        for (const key of PRONOUN_KEYS) {
            out[key] = String(raw[key] ?? '').trim();
        }
    }
    return out;
}

/**
 * @param {PronounSet} set
 * @returns {boolean} True if every field is empty.
 */
export function isEmptySet(set) {
    return PRONOUN_KEYS.every(key => !set[key]);
}

/** @param {any} mode @returns {'rotate'|'primary'|'join'} */
function normalizeMode(mode) {
    return Object.values(MODES).includes(mode) ? mode : MODES.ROTATE;
}

/** @param {any} directive @returns {'default'|'on'|'off'} */
function normalizeDirective(directive) {
    return Object.values(DIRECTIVE_OVERRIDE).includes(directive) ? directive : DIRECTIVE_OVERRIDE.DEFAULT;
}

/** @returns {PronounContainer} An empty container. */
export function emptyContainer() {
    return { sets: [], mode: MODES.ROTATE, directive: DIRECTIVE_OVERRIDE.DEFAULT };
}

/**
 * Normalizes stored data into a PronounContainer, migrating the original
 * extension's flat single-set shape (`{ subjective, objective, ... }`) in place.
 * Empty sets are dropped.
 * @param {any} raw
 * @returns {PronounContainer}
 */
export function normalizeContainer(raw) {
    if (!raw || typeof raw !== 'object') return emptyContainer();

    // Legacy flat shape: pronoun fields live directly on the object, no `sets` array.
    if (!Array.isArray(raw.sets)) {
        const set = normalizeSet(raw);
        return {
            sets: isEmptySet(set) ? [] : [set],
            mode: normalizeMode(raw.mode),
            directive: normalizeDirective(raw.directive),
        };
    }

    const sets = raw.sets.map(normalizeSet).filter(set => !isEmptySet(set));
    return {
        sets,
        mode: normalizeMode(raw.mode),
        directive: normalizeDirective(raw.directive),
    };
}

/**
 * Converts a container into the plain object we persist.
 * @param {PronounContainer} container
 * @returns {{ sets: PronounSet[], mode: string, directive: string }}
 */
function serializeContainer(container) {
    const sets = (container?.sets ?? []).map(normalizeSet).filter(set => !isEmptySet(set));
    return {
        sets,
        mode: normalizeMode(container?.mode),
        directive: normalizeDirective(container?.directive),
    };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const settingKeys = Object.freeze({
    CUR_VERSION: '_curVersion',
    ENABLE_SHORTHANDS: 'enableShorthands',
    ENABLE_WYVERN_COMPAT: 'enableWyvernCompat',
    ENABLE_JANITOR_COMPAT: 'enableJanitorCompat',
    DIRECTIVE_ENABLED: 'directiveEnabled',
    DIRECTIVE_DEPTH: 'directiveDepth',
    DIRECTIVE_ROLE: 'directiveRole',
    DIRECTIVE_TEMPLATE_PERSONA: 'directiveTemplatePersona',
    DIRECTIVE_TEMPLATE_CHARACTER: 'directiveTemplateCharacter',
    DEBUG_LOGGING: 'debugLogging',
    CHARACTERS: 'characters',
});

/**
 * Default injected directive for personas.
 * `%LIST%` -> all sets ("she/her and they/them"); `%ACTIVE%` -> this turn's rotated set ("they/them").
 * The per-turn `%ACTIVE%` command is the strong lever: it gives the model a concrete instruction
 * for the current reply, which overrides a context otherwise saturated with one pronoun.
 */
export const DEFAULT_DIRECTIVE_PERSONA =
    '[Pronoun instruction: {{user}} uses multiple pronoun sets — %LIST%. In your next reply, refer to {{user}} using %ACTIVE% pronouns specifically. Across the roleplay, deliberately rotate through all of {{user}}\'s pronoun sets instead of defaulting to one — every set is equally correct and in-character.]';

/** Default injected directive for characters. Same placeholders as the persona template. */
export const DEFAULT_DIRECTIVE_CHARACTER =
    '[Pronoun instruction: {{char}} uses multiple pronoun sets — %LIST%. In your next reply, refer to {{char}} using %ACTIVE% pronouns specifically. Across the roleplay, deliberately rotate through all of {{char}}\'s pronoun sets instead of defaulting to one — every set is equally correct and in-character.]';

const defaultSettings = Object.freeze({
    [settingKeys.CUR_VERSION]: null,
    [settingKeys.ENABLE_SHORTHANDS]: false,
    [settingKeys.ENABLE_WYVERN_COMPAT]: false,
    [settingKeys.ENABLE_JANITOR_COMPAT]: false,
    [settingKeys.DIRECTIVE_ENABLED]: true,
    [settingKeys.DIRECTIVE_DEPTH]: 2, // shallow = more recent = stronger pull on the next reply
    [settingKeys.DIRECTIVE_ROLE]: 0, // extension_prompt_roles.SYSTEM
    [settingKeys.DIRECTIVE_TEMPLATE_PERSONA]: DEFAULT_DIRECTIVE_PERSONA,
    [settingKeys.DIRECTIVE_TEMPLATE_CHARACTER]: DEFAULT_DIRECTIVE_CHARACTER,
    [settingKeys.DEBUG_LOGGING]: false,
    [settingKeys.CHARACTERS]: {},
});

/**
 * Ensures extension settings exist with defaults.
 * @param {string|null} [version=null]
 * @returns {Record<string, any>}
 */
export function ensureSettings(version = null) {
    extension_settings[EXTENSION_KEY] = extension_settings[EXTENSION_KEY] || {};
    const settings = extension_settings[EXTENSION_KEY];
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (!(key in settings)) {
            settings[key] = typeof value === 'object' && value !== null ? structuredClone(value) : value;
        }
    }
    if (version !== null) settings[settingKeys.CUR_VERSION] = version;
    return settings;
}

export const pronounsSettings = {
    get shorthands() { return Boolean(ensureSettings()[settingKeys.ENABLE_SHORTHANDS]); },
    get wyvernCompat() { return Boolean(ensureSettings()[settingKeys.ENABLE_WYVERN_COMPAT]); },
    get janitorCompat() { return Boolean(ensureSettings()[settingKeys.ENABLE_JANITOR_COMPAT]); },
    get directiveEnabled() { return Boolean(ensureSettings()[settingKeys.DIRECTIVE_ENABLED]); },
    get directiveDepth() {
        const n = Number(ensureSettings()[settingKeys.DIRECTIVE_DEPTH]);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2;
    },
    get directiveRole() {
        const n = Number(ensureSettings()[settingKeys.DIRECTIVE_ROLE]);
        return [0, 1, 2].includes(n) ? n : 0;
    },
    get directiveTemplatePersona() {
        const t = ensureSettings()[settingKeys.DIRECTIVE_TEMPLATE_PERSONA];
        return typeof t === 'string' && t.trim() ? t : DEFAULT_DIRECTIVE_PERSONA;
    },
    get directiveTemplateCharacter() {
        const t = ensureSettings()[settingKeys.DIRECTIVE_TEMPLATE_CHARACTER];
        return typeof t === 'string' && t.trim() ? t : DEFAULT_DIRECTIVE_CHARACTER;
    },
    get debugLogging() { return Boolean(ensureSettings()[settingKeys.DEBUG_LOGGING]); },
};

/**
 * Persists a setting value and triggers a debounced save.
 * @param {string} key
 * @param {unknown} value
 */
export function saveSetting(key, value) {
    ensureSettings()[key] = value;
    saveSettingsDebounced();
}

// ---------------------------------------------------------------------------
// Entity access (persona + character)
// ---------------------------------------------------------------------------

/** @returns {string} Current persona avatar id. */
export function getCurrentPersonaId() {
    return user_avatar || '';
}

/** @returns {string} Stable key for the active character, or '' if none. */
export function getCurrentCharacterKey() {
    if (this_chid === undefined || this_chid === null || this_chid === '') return '';
    return getCharaFilename(this_chid) || '';
}

/** @returns {Record<string, any>} The per-character store inside extension settings. */
function ensureCharacterStore() {
    const settings = ensureSettings();
    if (!settings[settingKeys.CHARACTERS] || typeof settings[settingKeys.CHARACTERS] !== 'object') {
        settings[settingKeys.CHARACTERS] = {};
    }
    return settings[settingKeys.CHARACTERS];
}

/**
 * Reads the persona pronoun container for the active persona.
 * @returns {PronounContainer}
 */
export function getPersonaContainer() {
    const id = getCurrentPersonaId();
    if (!id) return emptyContainer();
    return normalizeContainer(power_user.persona_descriptions?.[id]?.pronoun);
}

/**
 * Writes the persona pronoun container for the active persona and persists.
 * @param {PronounContainer} container
 */
export function setPersonaContainer(container) {
    const id = getCurrentPersonaId();
    if (!id) return;
    power_user.persona_descriptions = power_user.persona_descriptions || {};
    power_user.persona_descriptions[id] = power_user.persona_descriptions[id] || {};
    power_user.persona_descriptions[id].pronoun = serializeContainer(container);
    saveSettingsDebounced();
}

/**
 * Reads the pronoun container for the active character.
 * @returns {PronounContainer}
 */
export function getCharacterContainer() {
    const key = getCurrentCharacterKey();
    if (!key) return emptyContainer();
    return normalizeContainer(ensureCharacterStore()[key]);
}

/**
 * Writes the pronoun container for the active character and persists.
 * @param {PronounContainer} container
 */
export function setCharacterContainer(container) {
    const key = getCurrentCharacterKey();
    if (!key) return;
    const serialized = serializeContainer(container);
    const store = ensureCharacterStore();
    if (serialized.sets.length === 0 && serialized.directive === DIRECTIVE_OVERRIDE.DEFAULT && serialized.mode === MODES.ROTATE) {
        delete store[key]; // keep the store tidy when an entry is fully cleared
    } else {
        store[key] = serialized;
    }
    saveSettingsDebounced();
}

/**
 * Reads the container for the given entity.
 * @param {Entity} entity
 * @returns {PronounContainer}
 */
export function getContainer(entity) {
    return entity === 'character' ? getCharacterContainer() : getPersonaContainer();
}

/**
 * Writes the container for the given entity.
 * @param {Entity} entity
 * @param {PronounContainer} container
 */
export function setContainer(entity, container) {
    if (entity === 'character') setCharacterContainer(container);
    else setPersonaContainer(container);
}

/** @param {Entity} entity @returns {boolean} Whether the entity has a usable id/context. */
export function hasEntityContext(entity) {
    return entity === 'character' ? Boolean(getCurrentCharacterKey()) : Boolean(getCurrentPersonaId());
}

// ---------------------------------------------------------------------------
// Pronoun resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a single pronoun field for a container, honoring its mode.
 *
 * - 0 sets  -> ''
 * - 1 set   -> that set's value (mode is irrelevant)
 * - primary -> first set's value
 * - join    -> unique non-empty values joined with '/'  (e.g. "she/they")
 * - rotate  -> deterministic pick by `offset` among non-empty values, so repeated
 *              occurrences at different prompt positions vary between sets
 *
 * @param {PronounContainer} container
 * @param {'subjective'|'objective'|'posDet'|'posPro'|'reflexive'} key
 * @param {number} [offset=0] - Position seed for rotation (use the macro's globalOffset).
 * @returns {string}
 */
export function resolvePronoun(container, key, offset = 0) {
    const sets = container?.sets ?? [];
    if (sets.length === 0) return '';

    const values = sets.map(set => set[key]).filter(Boolean);
    if (values.length === 0) return '';
    if (values.length === 1) return values[0];

    switch (container.mode) {
        case MODES.JOIN:
            return Array.from(new Set(values)).join('/');
        case MODES.PRIMARY:
            return values[0];
        case MODES.ROTATE:
        default: {
            const idx = Math.abs(Math.trunc(Number(offset) || 0)) % values.length;
            return values[idx];
        }
    }
}

/**
 * Collects every distinct word used across all of a container's sets, mapped to
 * its pronoun key (first key wins on collisions, following PRONOUN_KEYS order).
 * Used by the replacer.
 * @param {PronounContainer} container
 * @returns {Map<string, 'subjective'|'objective'|'posDet'|'posPro'|'reflexive'>}
 */
export function collectWordKeyMap(container) {
    /** @type {Map<string, any>} */
    const map = new Map();
    for (const key of PRONOUN_KEYS) {
        for (const set of container?.sets ?? []) {
            const word = String(set[key] ?? '').trim().toLowerCase();
            if (word && !map.has(word)) map.set(word, key);
        }
    }
    return map;
}

/**
 * Formats a single set as "subjective/objective" (e.g. "they/them").
 * @param {PronounSet} set
 * @returns {string}
 */
export function formatSet(set) {
    return [set?.subjective, set?.objective].filter(Boolean).join('/');
}

/**
 * Picks the set to feature in this turn's directive, rotating by `turn`.
 * @param {PronounContainer} container
 * @param {number} turn
 * @returns {PronounSet|null}
 */
export function pickActiveSet(container, turn) {
    const sets = container?.sets ?? [];
    if (sets.length === 0) return null;
    const idx = Math.abs(Math.trunc(Number(turn) || 0)) % sets.length;
    return sets[idx];
}

/**
 * Formats a container's sets as a human-readable list for the directive,
 * e.g. "she/her, they/them" or "she/her and they/them".
 * @param {PronounContainer} container
 * @returns {string}
 */
export function formatSetsList(container) {
    const parts = (container?.sets ?? [])
        .map(set => [set.subjective, set.objective].filter(Boolean).join('/'))
        .filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
    return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Preset helpers
// ---------------------------------------------------------------------------

/**
 * Builds a list of pronoun sets from a multi-preset key (or a single-preset key).
 * @param {string} presetKey
 * @returns {PronounSet[]}
 */
export function setsFromPreset(presetKey) {
    if (multiPresets[presetKey]) {
        return multiPresets[presetKey].map(key => ({ ...pronounPresets[key] }));
    }
    if (pronounPresets[presetKey]) {
        return [{ ...pronounPresets[presetKey] }];
    }
    return [];
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Removes all data this extension added:
 *  - the `pronoun` field from every persona descriptor
 *  - the extension's own settings block (including stored character pronouns)
 * Uses a direct (non-debounced) save so cleanup persists before any reload.
 */
export async function cleanAllPronounData() {
    if (power_user?.persona_descriptions) {
        for (const descriptor of Object.values(power_user.persona_descriptions)) {
            if (descriptor && 'pronoun' in descriptor) {
                delete descriptor.pronoun;
            }
        }
    }
    delete extension_settings[EXTENSION_KEY];
    await saveSettings();
}
