/**
 * Pronoun directive injection.
 *
 * This is the piece that makes the *model's own writing* use multiple pronouns.
 * Macros only change text we substitute; they can't make an NPC vary how it refers
 * to someone. So when an entity has two or more pronoun sets, we inject a short
 * system instruction (via setExtensionPrompt) telling the model which set to use.
 *
 * Key design: instead of a soft "alternate naturally" note (which a model buried in
 * a single-pronoun context tends to ignore), each generation we rotate a concrete
 * *active* set and command its use for that reply (`%ACTIVE%`). The directive is
 * refreshed on GENERATION_AFTER_COMMANDS — which fires right before the prompt is
 * assembled — so the rotation advances per turn and the injection is always current.
 *
 * Two independent injection slots are maintained: one for the active persona, one
 * for the active character.
 */

import { setExtensionPrompt, extension_prompt_types } from '../../../../../script.js';
import {
    getPersonaContainer,
    getCharacterContainer,
    formatSetsList,
    formatSet,
    pickActiveSet,
    pronounsSettings,
    DIRECTIVE_OVERRIDE,
} from './pronouns.js';

const KEY_PERSONA = 'sillybunny_pronouns_persona';
const KEY_CHARACTER = 'sillybunny_pronouns_character';

const LOG_PREFIX = '[SillyBunny-Pronouns]';

/** Per-turn rotation counter. Advances once per real (non-dry) generation. */
let turnCounter = 0;

/**
 * Builds the directive text for a container, or '' if it has fewer than two sets.
 * `%LIST%` -> all sets; `%ACTIVE%` -> the set featured this turn.
 * `{{user}}`/`{{char}}` are left intact for the core macro engine to resolve.
 * @param {string} template
 * @param {import('./pronouns.js').PronounContainer} container
 * @param {number} turn
 * @returns {string}
 */
export function buildDirectiveText(template, container, turn = turnCounter) {
    if (!container || (container.sets?.length ?? 0) < 2) return '';
    const list = formatSetsList(container);
    if (!list) return '';
    const active = formatSet(pickActiveSet(container, turn)) || list;
    return String(template ?? '')
        .replace(/%LIST%/g, list)
        .replace(/%ACTIVE%/g, active);
}

/**
 * Decides whether a container's directive should be injected, honoring the
 * per-entity override on top of the global default.
 * @param {import('./pronouns.js').PronounContainer} container
 * @returns {boolean}
 */
function shouldInject(container) {
    switch (container?.directive) {
        case DIRECTIVE_OVERRIDE.ON: return true;
        case DIRECTIVE_OVERRIDE.OFF: return false;
        default: return pronounsSettings.directiveEnabled;
    }
}

/**
 * Recomputes and (re)injects both directive slots. Setting an empty value clears
 * a slot, so this both adds and removes directives as state changes.
 * @param {{ advance?: boolean }} [options] - advance: bump the per-turn counter first.
 */
export function refreshDirectives({ advance = false } = {}) {
    if (advance) turnCounter++;

    const depth = pronounsSettings.directiveDepth;
    const role = pronounsSettings.directiveRole;

    const persona = getPersonaContainer();
    const personaText = shouldInject(persona)
        ? buildDirectiveText(pronounsSettings.directiveTemplatePersona, persona)
        : '';
    setExtensionPrompt(KEY_PERSONA, personaText, extension_prompt_types.IN_CHAT, depth, false, role);

    const character = getCharacterContainer();
    const characterText = shouldInject(character)
        ? buildDirectiveText(pronounsSettings.directiveTemplateCharacter, character)
        : '';
    setExtensionPrompt(KEY_CHARACTER, characterText, extension_prompt_types.IN_CHAT, depth, false, role);

    if (pronounsSettings.debugLogging) {
        console.info(`${LOG_PREFIX} directive refresh (turn ${turnCounter}, depth ${depth}, role ${role})`, {
            persona: { sets: persona.sets.length, directive: persona.directive, injected: personaText || '(none)' },
            character: { sets: character.sets.length, directive: character.directive, injected: characterText || '(none)' },
        });
    }
}

/**
 * Event handler for GENERATION_AFTER_COMMANDS — refreshes directives just before
 * the prompt is built. Advances the rotation only for real generations.
 * @param {string} _type
 * @param {object} [_args]
 * @param {boolean} [dryRun]
 */
export function onGenerationDirective(_type, _args, dryRun) {
    refreshDirectives({ advance: !dryRun });
}

/**
 * Returns a diagnostic snapshot of current directive state (for /pronouns-debug).
 * @returns {object}
 */
export function getDirectiveDebugInfo() {
    const persona = getPersonaContainer();
    const character = getCharacterContainer();
    return {
        turn: turnCounter,
        globalDirectiveEnabled: pronounsSettings.directiveEnabled,
        depth: pronounsSettings.directiveDepth,
        role: pronounsSettings.directiveRole,
        persona: {
            sets: persona.sets,
            mode: persona.mode,
            directiveOverride: persona.directive,
            willInject: shouldInject(persona),
            text: shouldInject(persona) ? buildDirectiveText(pronounsSettings.directiveTemplatePersona, persona) : '(empty)',
        },
        character: {
            sets: character.sets,
            mode: character.mode,
            directiveOverride: character.directive,
            willInject: shouldInject(character),
            text: shouldInject(character) ? buildDirectiveText(pronounsSettings.directiveTemplateCharacter, character) : '(empty)',
        },
    };
}

/** Clears both directive slots. Used on cleanup/uninstall. */
export function clearDirectives() {
    setExtensionPrompt(KEY_PERSONA, '', extension_prompt_types.IN_CHAT, 0, false, 0);
    setExtensionPrompt(KEY_CHARACTER, '', extension_prompt_types.IN_CHAT, 0, false, 0);
}
