/**
 * UI for the SillyBunny Pronouns extension.
 *
 * Renders a dynamic multi-set pronoun editor under both the persona description
 * (#persona_description) and the character description (#description_textarea), plus
 * the settings panel. Editors are built in JS because the set list is dynamic.
 */

import { eventSource, event_types } from '../../../../../script.js';
import { t } from '../../../../../scripts/i18n.js';
import { renderExtensionTemplateAsync } from '../../../../extensions.js';
import { EXTENSION_NAME } from '../index.js';
import {
    PRONOUN_KEYS,
    MODES,
    DIRECTIVE_OVERRIDE,
    defaultSet,
    pronounPresets,
    multiPresets,
    getContainer,
    setContainer,
    hasEntityContext,
    pronounsSettings,
    saveSetting,
    settingKeys,
    DEFAULT_DIRECTIVE_PERSONA,
    DEFAULT_DIRECTIVE_CHARACTER,
} from './pronouns.js';
import { getMacroManager, applyMacroSettings } from './macros.js';
import { openPronounReplacePopup } from './replacer.js';
import { refreshDirectives } from './directive.js';

let uiInjected = false;

/** Per-field column metadata. */
const FIELD_META = [
    { key: 'subjective', label: 'Subjective', placeholder: 'she, he, they, it' },
    { key: 'objective', label: 'Objective', placeholder: 'her, him, them, it' },
    { key: 'posDet', label: 'Pos. determiner', placeholder: 'her, his, their, its' },
    { key: 'posPro', label: 'Pos. pronoun', placeholder: 'hers, his, theirs, its' },
    { key: 'reflexive', label: 'Reflexive', placeholder: 'herself, themselves' },
];

const SINGLE_PRESET_LABELS = { she: 'She/Her', he: 'He/Him', they: 'They/Them', it: 'It/Its' };
const MULTI_PRESET_LABELS = { sheThey: 'She/They', heThey: 'He/They', sheHe: 'She/He', any: 'Any/All' };

// ---------------------------------------------------------------------------
// Editor construction
// ---------------------------------------------------------------------------

/** @param {'persona'|'character'} entity @returns {string} */
function editorId(entity) {
    return `sbp_editor_${entity}`;
}

/**
 * Reads the current editor DOM back into a container object.
 * @param {'persona'|'character'} entity
 * @returns {import('./pronouns.js').PronounContainer}
 */
function readContainerFromDom(entity) {
    const root = document.getElementById(editorId(entity));
    if (!root) return { sets: [], mode: MODES.ROTATE, directive: DIRECTIVE_OVERRIDE.DEFAULT };

    const sets = [];
    root.querySelectorAll('.sbp-set').forEach((row) => {
        const set = { ...defaultSet };
        PRONOUN_KEYS.forEach((key) => {
            const input = row.querySelector(`input[data-key="${key}"]`);
            if (input) set[key] = String(input.value ?? '').trim();
        });
        sets.push(set);
    });

    const mode = root.querySelector('.sbp-mode')?.value || MODES.ROTATE;
    const directive = root.querySelector('.sbp-directive')?.value || DIRECTIVE_OVERRIDE.DEFAULT;
    return { sets, mode, directive };
}

/** Persists the editor's current DOM state and refreshes derived state. */
function commit(entity) {
    if (!hasEntityContext(entity)) return;
    setContainer(entity, readContainerFromDom(entity));
    refreshDirectives();
    updateTooltips(entity);
}

/**
 * Creates one editable set row.
 * @param {'persona'|'character'} entity
 * @param {import('./pronouns.js').PronounSet} set
 * @returns {HTMLElement}
 */
function createSetRow(entity, set) {
    const row = document.createElement('div');
    row.className = 'sbp-set flex-container';

    FIELD_META.forEach(({ key, placeholder }) => {
        const cell = document.createElement('div');
        cell.className = 'sbp-cell flex1';
        const input = document.createElement('input');
        input.className = 'text_pole';
        input.type = 'text';
        input.dataset.key = key;
        input.placeholder = placeholder;
        input.value = set?.[key] ?? '';
        input.addEventListener('input', () => commit(entity));
        cell.appendChild(input);
        row.appendChild(cell);
    });

    const removeBtn = document.createElement('div');
    removeBtn.className = 'sbp-remove menu_button menu_button_icon fa-solid fa-trash-can';
    removeBtn.title = t`Remove this pronoun set`;
    removeBtn.addEventListener('click', () => {
        row.remove();
        commit(entity);
    });
    row.appendChild(removeBtn);

    return row;
}

/** Appends a set row to the editor and persists. */
function addSetRow(entity, set) {
    const setsContainer = document.getElementById(editorId(entity))?.querySelector('.sbp-sets');
    if (!setsContainer) return;
    setsContainer.appendChild(createSetRow(entity, set ?? { ...defaultSet }));
    commit(entity);
}

/** Replaces all set rows with the provided sets. */
function renderSets(entity, sets) {
    const setsContainer = document.getElementById(editorId(entity))?.querySelector('.sbp-sets');
    if (!setsContainer) return;
    setsContainer.innerHTML = '';
    (sets ?? []).forEach((set) => setsContainer.appendChild(createSetRow(entity, set)));
}

/**
 * Builds the full editor element for an entity.
 * @param {'persona'|'character'} entity
 * @returns {HTMLElement}
 */
function buildEditor(entity) {
    const who = entity === 'character' ? t`character` : t`persona`;
    const root = document.createElement('div');
    root.id = editorId(entity);
    root.className = 'sbp-editor';
    root.dataset.entity = entity;

    // Title
    const title = document.createElement('h4');
    title.className = 'sbp-title flex-container alignItemsBaseline';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = t`Pronouns`;
    const info = document.createElement('i');
    info.className = 'fa-solid fa-circle-info opacity50p sbp-info';
    info.title = t`Add one set for a single pronoun, or several sets for multiple pronouns (she/they, any/all).`;
    title.append(titleSpan, info);
    root.appendChild(title);

    // Column headers (with per-field macro info icons)
    const header = document.createElement('div');
    header.className = 'sbp-header flex-container';
    FIELD_META.forEach(({ key, label }) => {
        const cell = document.createElement('div');
        cell.className = 'sbp-cell flex1';
        const lbl = document.createElement('span');
        lbl.textContent = t`${label}`;
        const ic = document.createElement('i');
        ic.className = 'fa-solid fa-circle-info opacity50p sbp-field-info';
        ic.dataset.key = key;
        lbl.appendChild(document.createTextNode(' '));
        lbl.appendChild(ic);
        cell.appendChild(lbl);
        header.appendChild(cell);
    });
    const spacer = document.createElement('div');
    spacer.className = 'sbp-remove-spacer';
    header.appendChild(spacer);
    root.appendChild(header);

    // Sets container
    const setsContainer = document.createElement('div');
    setsContainer.className = 'sbp-sets';
    root.appendChild(setsContainer);

    // Add set + single presets (append) + multi presets (replace)
    const controls = document.createElement('div');
    controls.className = 'sbp-controls flex-container flexWrap';

    const addBtn = document.createElement('div');
    addBtn.className = 'menu_button sbp-add';
    addBtn.title = t`Add an empty pronoun set`;
    const addIcon = document.createElement('i');
    addIcon.className = 'fa-solid fa-plus';
    const addText = document.createElement('span');
    addText.textContent = t`Add set`;
    addBtn.append(addIcon, addText);
    addBtn.addEventListener('click', () => addSetRow(entity));
    controls.appendChild(addBtn);

    Object.entries(SINGLE_PRESET_LABELS).forEach(([key, label]) => {
        const btn = document.createElement('div');
        btn.className = 'menu_button sbp-preset';
        btn.textContent = label;
        btn.title = t`Append the ${label} set`;
        btn.addEventListener('click', () => addSetRow(entity, { ...pronounPresets[key] }));
        controls.appendChild(btn);
    });
    root.appendChild(controls);

    const multiRow = document.createElement('div');
    multiRow.className = 'sbp-controls sbp-multi flex-container flexWrap';
    const multiLabel = document.createElement('span');
    multiLabel.className = 'sbp-multi-label';
    multiLabel.textContent = t`Multiple:`;
    multiRow.appendChild(multiLabel);
    Object.entries(MULTI_PRESET_LABELS).forEach(([key, label]) => {
        const btn = document.createElement('div');
        btn.className = 'menu_button sbp-preset sbp-preset-multi';
        btn.textContent = label;
        btn.title = t`Replace all sets with ${label}`;
        btn.addEventListener('click', () => {
            renderSets(entity, multiPresets[key].map((p) => ({ ...pronounPresets[p] })));
            commit(entity);
        });
        multiRow.appendChild(btn);
    });
    root.appendChild(multiRow);

    // Mode + directive + replacer
    const opts = document.createElement('div');
    opts.className = 'sbp-options flex-container flexWrap alignItemsCenter';

    const modeWrap = document.createElement('label');
    modeWrap.className = 'sbp-option-label';
    modeWrap.append(document.createTextNode(t`When multiple:`));
    const modeSel = document.createElement('select');
    modeSel.className = 'sbp-mode text_pole widthNatural';
    [[MODES.ROTATE, t`Rotate (vary)`], [MODES.PRIMARY, t`Primary (first)`], [MODES.JOIN, t`Join (she/they)`]]
        .forEach(([val, label]) => {
            const opt = document.createElement('option');
            opt.value = val; opt.textContent = label;
            modeSel.appendChild(opt);
        });
    modeSel.addEventListener('change', () => commit(entity));
    modeWrap.appendChild(modeSel);
    opts.appendChild(modeWrap);

    const dirWrap = document.createElement('label');
    dirWrap.className = 'sbp-option-label';
    dirWrap.append(document.createTextNode(t`Directive:`));
    const dirSel = document.createElement('select');
    dirSel.className = 'sbp-directive text_pole widthNatural';
    [[DIRECTIVE_OVERRIDE.DEFAULT, t`Default`], [DIRECTIVE_OVERRIDE.ON, t`Always on`], [DIRECTIVE_OVERRIDE.OFF, t`Off`]]
        .forEach(([val, label]) => {
            const opt = document.createElement('option');
            opt.value = val; opt.textContent = label;
            dirSel.appendChild(opt);
        });
    dirSel.title = t`Whether to inject the "use multiple pronouns" instruction for this ${who} (when it has 2+ sets).`;
    dirSel.addEventListener('change', () => commit(entity));
    dirWrap.appendChild(dirSel);
    opts.appendChild(dirWrap);

    const replacerBtn = document.createElement('div');
    replacerBtn.className = 'menu_button sbp-replacer-btn';
    replacerBtn.textContent = t`Replacer`;
    replacerBtn.title = t`Open the pronoun replacer for this ${who}`;
    replacerBtn.addEventListener('click', () => openPronounReplacePopup(null, { entity }));
    opts.appendChild(replacerBtn);

    root.appendChild(opts);
    return root;
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

/** Re-reads stored data into an editor's DOM. */
function refreshEditor(entity) {
    const root = document.getElementById(editorId(entity));
    if (!root) return;
    const container = getContainer(entity);
    renderSets(entity, container.sets);
    const modeSel = root.querySelector('.sbp-mode');
    if (modeSel) modeSel.value = container.mode;
    const dirSel = root.querySelector('.sbp-directive');
    if (dirSel) dirSel.value = container.directive;
    updateTooltips(entity);
}

/** Re-reads both editors from storage. Exported for slash commands. */
export function refreshEditors() {
    refreshEditor('persona');
    refreshEditor('character');
}

/** Updates per-field macro tooltips for an entity's editor. */
export function updateTooltips(entity) {
    const root = document.getElementById(editorId(entity));
    if (!root) return;
    const byType = getMacroManager().getRegisteredByType(entity);
    root.querySelectorAll('.sbp-field-info').forEach((icon) => {
        const key = icon.dataset.key;
        const names = byType[key] ?? [];
        const list = names.map((n) => `  {{${n}}}`).join('\n');
        icon.title = t`Macros for this field:` + '\n' + (list || t`(none)`);
    });
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

function onShorthandsToggle(e) {
    saveSetting(settingKeys.ENABLE_SHORTHANDS, $(e.currentTarget).is(':checked'));
    applyMacroSettings();
    refreshEditors();
}
function onWyvernToggle(e) {
    saveSetting(settingKeys.ENABLE_WYVERN_COMPAT, $(e.currentTarget).is(':checked'));
    applyMacroSettings();
    refreshEditors();
}
function onJanitorToggle(e) {
    saveSetting(settingKeys.ENABLE_JANITOR_COMPAT, $(e.currentTarget).is(':checked'));
    applyMacroSettings();
    refreshEditors();
}
function onDirectiveEnabledToggle(e) {
    saveSetting(settingKeys.DIRECTIVE_ENABLED, $(e.currentTarget).is(':checked'));
    refreshDirectives();
}
function onDirectiveDepthChange(e) {
    saveSetting(settingKeys.DIRECTIVE_DEPTH, Number($(e.currentTarget).val()) || 0);
    refreshDirectives();
}
function onDirectiveRoleChange(e) {
    saveSetting(settingKeys.DIRECTIVE_ROLE, Number($(e.currentTarget).val()) || 0);
    refreshDirectives();
}
function onDirectivePersonaInput(e) {
    saveSetting(settingKeys.DIRECTIVE_TEMPLATE_PERSONA, String($(e.currentTarget).val() ?? ''));
    refreshDirectives();
}
function onDirectiveCharacterInput(e) {
    saveSetting(settingKeys.DIRECTIVE_TEMPLATE_CHARACTER, String($(e.currentTarget).val() ?? ''));
    refreshDirectives();
}
function onDebugLoggingToggle(e) {
    saveSetting(settingKeys.DEBUG_LOGGING, $(e.currentTarget).is(':checked'));
}

// ---------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------

async function injectEditors() {
    const personaTarget = document.getElementById('persona_description');
    if (personaTarget && !document.getElementById(editorId('persona'))) {
        personaTarget.after(buildEditor('persona'));
    }
    const charTarget = document.getElementById('description_textarea');
    if (charTarget && !document.getElementById(editorId('character'))) {
        charTarget.after(buildEditor('character'));
    }
}

/** Pushes stored settings values into the settings panel inputs. */
function syncSettingsInputs() {
    if (!document.getElementById('sbp_settings')) return;
    // Diagnostic: surfaces the *stored* value, so a persistence bug (false after a reload
    // where it was on) is distinguishable from a display bug.
    console.debug(`[${EXTENSION_NAME}] settings sync — directiveEnabled =`, pronounsSettings.directiveEnabled);
    $('#sbp_enable_shorthands').prop('checked', pronounsSettings.shorthands);
    $('#sbp_enable_wyvern_compat').prop('checked', pronounsSettings.wyvernCompat);
    $('#sbp_enable_janitor_compat').prop('checked', pronounsSettings.janitorCompat);
    $('#sbp_directive_enabled').prop('checked', pronounsSettings.directiveEnabled);
    $('#sbp_directive_depth').val(pronounsSettings.directiveDepth);
    $('#sbp_directive_role').val(String(pronounsSettings.directiveRole));
    $('#sbp_directive_persona').val(pronounsSettings.directiveTemplatePersona);
    $('#sbp_directive_character').val(pronounsSettings.directiveTemplateCharacter);
    $('#sbp_debug_logging').prop('checked', pronounsSettings.debugLogging);
}

async function injectSettings() {
    if (document.getElementById('sbp_settings')) return;
    const col2 = document.getElementById('extensions_settings2');
    const col1 = document.getElementById('extensions_settings');
    const parent = col2 && col1 ? (col2.children.length > col1.children.length ? col1 : col2) : (col2 || col1);
    if (!parent) return;

    const html = await renderExtensionTemplateAsync(`third-party/${EXTENSION_NAME}`, 'templates/settings');
    const template = document.createElement('template');
    template.innerHTML = html;
    parent.appendChild(template.content);

    $('#sbp_enable_shorthands').on('change', onShorthandsToggle);
    $('#sbp_enable_wyvern_compat').on('change', onWyvernToggle);
    $('#sbp_enable_janitor_compat').on('change', onJanitorToggle);
    $('#sbp_directive_enabled').on('change', onDirectiveEnabledToggle);
    $('#sbp_directive_depth').on('input', onDirectiveDepthChange);
    $('#sbp_directive_role').on('change', onDirectiveRoleChange);
    $('#sbp_directive_persona').on('input', onDirectivePersonaInput);
    $('#sbp_directive_character').on('input', onDirectiveCharacterInput);
    $('#sbp_debug_logging').on('change', onDebugLoggingToggle);

    // Sync every input from stored settings now, and again whenever the drawer is opened —
    // guards against any later re-render resetting a checkbox to its HTML default.
    syncSettingsInputs();
    $('#sbp_settings .inline-drawer-toggle').on('click', () => setTimeout(syncSettingsInputs, 0));

    $('#sbp_directive_reset').on('click', () => {
        saveSetting(settingKeys.DIRECTIVE_TEMPLATE_PERSONA, DEFAULT_DIRECTIVE_PERSONA);
        saveSetting(settingKeys.DIRECTIVE_TEMPLATE_CHARACTER, DEFAULT_DIRECTIVE_CHARACTER);
        $('#sbp_directive_persona').val(DEFAULT_DIRECTIVE_PERSONA);
        $('#sbp_directive_character').val(DEFAULT_DIRECTIVE_CHARACTER);
        refreshDirectives();
        toastr.success(t`Directive templates reset to default.`, 'Pronouns');
    });
}

/** Injects all UI and marks injection done. */
export async function injectUI() {
    if (uiInjected) return;
    await injectEditors();
    await injectSettings();
    uiInjected = true;
}

/** Registers document-level and event-source listeners. */
export function registerEventListeners() {
    // Persona switch
    $(document).on('click', '#user_avatar_block .avatar-container', () => {
        setTimeout(() => { refreshEditor('persona'); refreshDirectives(); }, 0);
    });
    // Character panel opened / edited
    eventSource.on(event_types.CHARACTER_PAGE_LOADED, () => setTimeout(() => { refreshEditor('character'); refreshDirectives(); }, 0));
    if (event_types.CHARACTER_EDITED) {
        eventSource.on(event_types.CHARACTER_EDITED, () => setTimeout(() => { refreshEditor('character'); refreshDirectives(); }, 0));
    }
    // Chat change can swap the active character/persona context
    eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(() => { refreshEditors(); refreshDirectives(); }, 0));
}
