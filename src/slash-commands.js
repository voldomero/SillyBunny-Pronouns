/**
 * Slash command registrations for the SillyBunny Pronouns extension.
 *
 * All mutating commands accept a `target` argument (persona | character) and
 * operate on the multi-set container. After a change we refresh the editors and
 * re-inject the directive so the effect is immediate.
 */

import { SlashCommand } from '../../../../slash-commands/SlashCommand.js';
import { SlashCommandNamedArgument, ARGUMENT_TYPE, SlashCommandArgument } from '../../../../slash-commands/SlashCommandArgument.js';
import { SlashCommandEnumValue, enumTypes } from '../../../../slash-commands/SlashCommandEnumValue.js';
import { SlashCommandParser } from '../../../../slash-commands/SlashCommandParser.js';
import { commonEnumProviders } from '../../../../slash-commands/SlashCommandCommonEnumsProvider.js';
import { isTrueBoolean } from '../../../../utils.js';
import { t } from '../../../../../scripts/i18n.js';
import { openPronounReplacePopup, replacePronounsWithMacros } from './replacer.js';
import {
    PRONOUN_KEYS,
    MODES,
    defaultSet,
    pronounPresets,
    multiPresets,
    setsFromPreset,
    getContainer,
    setContainer,
    hasEntityContext,
    pronounsSettings,
} from './pronouns.js';
import { refreshDirectives, getDirectiveDebugInfo } from './directive.js';
import { refreshEditors } from './ui.js';

const ENTITY_ENUMS = [
    new SlashCommandEnumValue('persona', 'The active persona (you)', enumTypes.enum, 'P'),
    new SlashCommandEnumValue('character', 'The active character', enumTypes.enum, 'C'),
];

const pronounKeyEnums = [
    new SlashCommandEnumValue('subjective', 'Subjective (she, he, they)', enumTypes.enum, 'S'),
    new SlashCommandEnumValue('objective', 'Objective (her, him, them)', enumTypes.enum, 'O'),
    new SlashCommandEnumValue('posDet', 'Possessive determiner (her, his, their)', enumTypes.enum, 'PD'),
    new SlashCommandEnumValue('posPro', 'Possessive pronoun (hers, his, theirs)', enumTypes.enum, 'PP'),
    new SlashCommandEnumValue('reflexive', 'Reflexive (herself, himself, themselves)', enumTypes.enum, 'R'),
];

const modeEnums = [
    new SlashCommandEnumValue('rotate', 'Vary between sets per use', enumTypes.enum),
    new SlashCommandEnumValue('primary', 'Always the first set', enumTypes.enum),
    new SlashCommandEnumValue('join', 'Join all sets (she/they)', enumTypes.enum),
];

/** @returns {SlashCommandEnumValue[]} Single + multi preset keys. */
function getPresetEnums() {
    const single = Object.keys(pronounPresets).map(k =>
        new SlashCommandEnumValue(k, `${pronounPresets[k].subjective}/${pronounPresets[k].objective}`, enumTypes.enum));
    const multi = Object.keys(multiPresets).map(k =>
        new SlashCommandEnumValue(k, multiPresets[k].join('+'), enumTypes.name));
    return [...single, ...multi];
}

/** @param {any} value @returns {'persona'|'character'} */
function resolveEntity(value) {
    return String(value ?? '').trim().toLowerCase() === 'character' ? 'character' : 'persona';
}

/** Re-render editors and re-inject directives after a programmatic change. */
function afterChange() {
    refreshDirectives();
    try { refreshEditors(); } catch { /* UI may not be injected yet */ }
}

/**
 * Resolves the effective `useShorthands` flag, warning if requested while globally off.
 * @param {string|undefined} argValue
 * @returns {boolean|null} resolved flag, or null to abort
 */
function resolveShorthandsArg(argValue) {
    if (typeof argValue === 'string') {
        const requested = isTrueBoolean(argValue);
        if (requested && !pronounsSettings.shorthands) {
            toastr.warning(t`Shorthand macros are not enabled. Enable them in the Pronouns settings first.`, 'Pronouns');
            return null;
        }
        return requested;
    }
    return pronounsSettings.shorthands;
}

/** Registers all pronoun slash commands. */
export function registerSlashCommands() {
    // /pronouns-set
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'pronouns-set',
        returns: 'The updated pronoun value, or an empty string if the key was invalid.',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'key', description: 'Which pronoun field to set.', isRequired: true,
                typeList: [ARGUMENT_TYPE.STRING], enumList: pronounKeyEnums, forceEnum: true,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'target', description: 'Whose pronouns to set (default persona).',
                typeList: [ARGUMENT_TYPE.STRING], enumList: ENTITY_ENUMS, forceEnum: true,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'index', description: 'Which set to edit (0-based, default 0). Higher sets are created as needed.',
                typeList: [ARGUMENT_TYPE.NUMBER],
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'The value to set. Empty string clears the field.',
                typeList: [ARGUMENT_TYPE.STRING], isRequired: true,
            }),
        ],
        helpString: `
            <div>Sets a single pronoun field for one set of the persona or character.</div>
            <div><strong>Examples:</strong>
                <ul>
                    <li><pre><code>/pronouns-set key=subjective xe</code></pre>Sets the persona's first-set subjective to "xe".</li>
                    <li><pre><code>/pronouns-set key=subjective index=1 they</code></pre>Adds/sets a second set's subjective to "they".</li>
                    <li><pre><code>/pronouns-set key=objective target=character them</code></pre>Sets the active character's objective.</li>
                </ul>
            </div>`,
        callback: (args, value) => {
            try {
                const key = String(args.key ?? '').trim();
                if (!PRONOUN_KEYS.includes(key)) return '';
                const entity = resolveEntity(args.target);
                if (!hasEntityContext(entity)) {
                    toastr.warning(t`No active ${entity} to set pronouns for.`, 'Pronouns');
                    return '';
                }
                const index = Math.max(0, Math.trunc(Number(args.index) || 0));
                const container = getContainer(entity);
                while (container.sets.length <= index) container.sets.push({ ...defaultSet });
                container.sets[index][key] = String(value ?? '');
                setContainer(entity, container);
                afterChange();
                return String(value ?? '');
            } catch (error) {
                toastr.error(String(error?.message ?? error), 'Pronouns');
                return '';
            }
        },
    }));

    // /pronouns-preset (replace all sets)
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'pronouns-preset',
        returns: 'The applied preset key, or empty string if not found.',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'target', description: 'Whose pronouns to set (default persona).',
                typeList: [ARGUMENT_TYPE.STRING], enumList: ENTITY_ENUMS, forceEnum: true,
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Preset to apply. Single: she/he/they/it. Multi: sheThey/heThey/sheHe/any.',
                typeList: [ARGUMENT_TYPE.STRING], enumList: getPresetEnums(), forceEnum: true, isRequired: true,
            }),
        ],
        helpString: `
            <div>Replaces all pronoun sets with a preset. Multi-presets set several sets at once.</div>
            <div><strong>Examples:</strong>
                <ul>
                    <li><pre><code>/pronouns-preset sheThey</code></pre>Sets the persona to she/her + they/them.</li>
                    <li><pre><code>/pronouns-preset target=character any</code></pre>Sets the character to she + he + they.</li>
                </ul>
            </div>`,
        callback: (args, presetName) => {
            try {
                const key = String(presetName ?? '').trim();
                const sets = setsFromPreset(key);
                if (sets.length === 0) return '';
                const entity = resolveEntity(args.target);
                if (!hasEntityContext(entity)) {
                    toastr.warning(t`No active ${entity} to set pronouns for.`, 'Pronouns');
                    return '';
                }
                const container = getContainer(entity);
                container.sets = sets;
                setContainer(entity, container);
                afterChange();
                return key;
            } catch (error) {
                toastr.error(String(error?.message ?? error), 'Pronouns');
                return '';
            }
        },
    }));

    // /pronouns-add (append a single set)
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'pronouns-add',
        returns: 'The added preset key, or empty string if not found.',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'target', description: 'Whose pronouns to add to (default persona).',
                typeList: [ARGUMENT_TYPE.STRING], enumList: ENTITY_ENUMS, forceEnum: true,
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Single preset to append (she/he/they/it).',
                typeList: [ARGUMENT_TYPE.STRING],
                enumList: Object.keys(pronounPresets).map(k => new SlashCommandEnumValue(k, `${pronounPresets[k].subjective}/${pronounPresets[k].objective}`, enumTypes.enum)),
                forceEnum: true, isRequired: true,
            }),
        ],
        helpString: `
            <div>Appends one pronoun set to the persona or character.</div>
            <div><strong>Example:</strong> <pre><code>/pronouns-add they</code></pre> Adds they/them as an additional set.</div>`,
        callback: (args, presetName) => {
            try {
                const key = String(presetName ?? '').trim();
                if (!pronounPresets[key]) return '';
                const entity = resolveEntity(args.target);
                if (!hasEntityContext(entity)) {
                    toastr.warning(t`No active ${entity} to add pronouns for.`, 'Pronouns');
                    return '';
                }
                const container = getContainer(entity);
                container.sets.push({ ...pronounPresets[key] });
                setContainer(entity, container);
                afterChange();
                return key;
            } catch (error) {
                toastr.error(String(error?.message ?? error), 'Pronouns');
                return '';
            }
        },
    }));

    // /pronouns-mode
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'pronouns-mode',
        returns: 'The applied mode.',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'target', description: 'Whose mode to set (default persona).',
                typeList: [ARGUMENT_TYPE.STRING], enumList: ENTITY_ENUMS, forceEnum: true,
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'How macros resolve with multiple sets.',
                typeList: [ARGUMENT_TYPE.STRING], enumList: modeEnums, forceEnum: true, isRequired: true,
            }),
        ],
        helpString: `
            <div>Sets how the pronoun macros resolve when there are multiple sets:
            <code>rotate</code> (vary per use), <code>primary</code> (first set), or <code>join</code> (she/they).</div>`,
        callback: (args, modeName) => {
            try {
                const mode = String(modeName ?? '').trim().toLowerCase();
                if (!Object.values(MODES).includes(mode)) return '';
                const entity = resolveEntity(args.target);
                const container = getContainer(entity);
                container.mode = mode;
                setContainer(entity, container);
                afterChange();
                return mode;
            } catch (error) {
                toastr.error(String(error?.message ?? error), 'Pronouns');
                return '';
            }
        },
    }));

    // /pronouns-clear
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'pronouns-clear',
        returns: 'Empty string.',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'target', description: 'Whose pronouns to clear (default persona).',
                typeList: [ARGUMENT_TYPE.STRING], enumList: ENTITY_ENUMS, forceEnum: true,
            }),
        ],
        helpString: '<div>Removes all pronoun sets for the persona or character.</div>',
        callback: (args) => {
            try {
                const entity = resolveEntity(args.target);
                const container = getContainer(entity);
                container.sets = [];
                setContainer(entity, container);
                afterChange();
                return '';
            } catch (error) {
                toastr.error(String(error?.message ?? error), 'Pronouns');
                return '';
            }
        },
    }));

    // /pronouns-replace
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'pronouns-replace',
        returns: 'The input text with matching pronoun words replaced by macros.',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'target', description: 'Whose pronouns to use (default persona).',
                typeList: [ARGUMENT_TYPE.STRING], enumList: ENTITY_ENUMS, forceEnum: true,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'shorthands', description: 'Use shorthand macro names (persona only). Defaults to the global setting.',
                typeList: [ARGUMENT_TYPE.BOOLEAN], enumList: commonEnumProviders.boolean('trueFalse')(), forceEnum: true,
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({ description: 'Text to scan and replace.', typeList: [ARGUMENT_TYPE.STRING], isRequired: true }),
        ],
        helpString: `
            <div>Replaces pronoun words in text with macros, using the active persona's (or character's) pronouns.</div>
            <div>With multiple sets each word maps to the rotating per-field macro.</div>`,
        callback: (args, text = '') => {
            try {
                const useSh = resolveShorthandsArg(typeof args.shorthands === 'string' ? args.shorthands : undefined);
                if (useSh === null) return '';
                const entity = resolveEntity(args.target);
                return replacePronounsWithMacros(String(text ?? ''), { useShorthands: useSh, entity }) || '';
            } catch (error) {
                toastr.error(String(error?.message ?? error), 'Pronouns');
                return '';
            }
        },
    }));

    // /pronouns-open-replacer
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'pronouns-open-replacer',
        returns: 'The converted text after the user confirms, or empty string.',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'target', description: 'Whose pronouns to use (default persona).',
                typeList: [ARGUMENT_TYPE.STRING], enumList: ENTITY_ENUMS, forceEnum: true,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'shorthands', description: 'Default state of the shorthand checkbox.',
                typeList: [ARGUMENT_TYPE.BOOLEAN], enumList: commonEnumProviders.boolean('trueFalse')(), forceEnum: true,
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({ description: 'Text to prefill (otherwise clipboard).', typeList: [ARGUMENT_TYPE.STRING] }),
        ],
        helpString: '<div>Opens the pronoun replacer popup for the active persona (or character).</div>',
        callback: async (args, text = '') => {
            try {
                const useSh = resolveShorthandsArg(typeof args.shorthands === 'string' ? args.shorthands : undefined);
                if (useSh === null) return '';
                const entity = resolveEntity(args.target);
                return await openPronounReplacePopup(String(text ?? ''), { defaultUseShorthands: useSh ?? false, entity }) ?? '';
            } catch (error) {
                toastr.error(String(error?.message ?? error), 'Pronouns');
                return '';
            }
        },
    }));

    // /pronouns-debug
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'pronouns-debug',
        returns: 'A short summary; full detail is logged to the browser console.',
        helpString: `
            <div>Dumps the current pronoun state to the browser console: persona/character sets,
            modes, directive overrides, and the exact directive text that will be injected.</div>
            <div>Use this to confirm whether the directive is empty (no sets / disabled) or active.</div>`,
        callback: () => {
            try {
                const info = getDirectiveDebugInfo();
                console.info('[SillyBunny-Pronouns] /pronouns-debug', info);
                const p = info.persona;
                const c = info.character;
                const summary = `Persona: ${p.sets.length} set(s), inject=${p.willInject}. Character: ${c.sets.length} set(s), inject=${c.willInject}. Global directive=${info.globalDirectiveEnabled}, depth=${info.depth}. (Full detail in console.)`;
                toastr.info(summary, 'Pronouns debug', { timeOut: 12000, extendedTimeOut: 20000 });
                return summary;
            } catch (error) {
                toastr.error(String(error?.message ?? error), 'Pronouns');
                return '';
            }
        },
    }));
}
