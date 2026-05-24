// Standardized configurator core — pure functions that turn a component's
// manifest props (+ thin hints) into interactive controls, live props, and a
// code snippet. One engine, consumed by every component (see Configurator.pui).

export type PropInfo = {
	name: string;
	type: string;
	default: string | null;
	optional: boolean;
	bindable: boolean;
	kind: 'value' | 'event' | 'slot';
};

export type Hints = {
	/** Real option sets for props the manifest types loosely as `string`. */
	options?: Record<string, string[]>;
	/** Initial editable children text; presence also forces a children control. */
	children?: string;
	/** Fixed values for complex props the engine can't build a control for (e.g. items). */
	samples?: Record<string, unknown>;
	/** Props to hide from the panel. */
	hide?: string[];
	/** Components that can't be driven from plain data (need snippets / render
	 *  functions): show this note in the preview area instead of an empty box. */
	previewNote?: string;
};

export type Control =
	| { name: string; label: string; kind: 'toggle'; value: boolean }
	| { name: string; label: string; kind: 'select'; options: string[]; value: string }
	| { name: string; label: string; kind: 'text'; value: string }
	| { name: string; label: string; kind: 'number'; value: number };

// Low-value / non-configurable props hidden from every panel.
const HIDE =
	/^(class|style|controlId|id|name|tabIndex|spellcheck|autoComplete|autoFocus|disableBrowserAutocorrect|inputMode|step|i18nStrings|nativeInputAttributes|nativeAttributes|ariaControls|ariaRequired|aria[A-Z].*|.*AriaLabel|.*AriaLabelledby|.*AriaDescribedby)$/;

const STRING_UNION = /^'[^']*'(\s*\|\s*'[^']*')+$/;

const humanize = (name: string): string => {
	const s = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
	return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};

const parseUnion = (type: string): string[] =>
	type.split('|').map((s) => s.trim().replace(/^'|'$/g, ''));

const isComplex = (type: string): boolean =>
	/Record<|=>|\bunknown\b|\bany\b|\[\]|Array<|^\{|\(/.test(type);

const acceptsString = (type: string): boolean => /\bstring\b/.test(type);

// Initial value from the manifest default, falling back per control kind.
const initValue = (def: string | null, kind: Control['kind'], options?: string[]): unknown => {
	if (kind === 'toggle') return def === 'true';
	if (kind === 'number') return def != null && def !== '' ? Number(def) : 0;
	const raw = def != null ? def.replace(/^['"]|['"]$/g, '') : '';
	if (kind === 'select') return options && options.includes(raw) ? raw : (options?.[0] ?? '');
	return raw === 'undefined' ? '' : raw;
};

export type Derived = {
	controls: Control[];
	hasChildren: boolean;
	childrenLabel: string;
	childrenInit: string;
};

/** Build the control set for one component from its manifest props + hints. */
export function deriveControls(props: PropInfo[], hints: Hints = {}): Derived {
	const hide = new Set(hints.hide ?? []);
	const controls: Control[] = [];
	let childrenSlot: PropInfo | undefined;

	for (const p of props) {
		if (p.kind === 'event') continue;
		if (p.name === 'children') {
			childrenSlot = p;
			continue;
		}
		// An explicit hint (options) means the author wants this prop shown, even
		// if it would otherwise be hidden (e.g. Icon's `name`, which the HIDE list
		// would drop as a form-field name attribute).
		const hinted = hints.options?.[p.name];
		if (!hinted && (HIDE.test(p.name) || hide.has(p.name))) continue;

		// Slots that accept a string (header / label / description …) → text control.
		if (p.kind === 'slot') {
			if (acceptsString(p.type)) {
				controls.push({
					name: p.name,
					label: humanize(p.name),
					kind: 'text',
					value: initValue(p.default, 'text') as string,
				});
			}
			continue;
		}

		const opts = hinted;
		if (opts) {
			controls.push({
				name: p.name,
				label: humanize(p.name),
				kind: 'select',
				options: opts,
				value: initValue(p.default, 'select', opts) as string,
			});
		} else if (p.type === 'boolean') {
			controls.push({
				name: p.name,
				label: humanize(p.name),
				kind: 'toggle',
				value: initValue(p.default, 'toggle') as boolean,
			});
		} else if (STRING_UNION.test(p.type)) {
			const u = parseUnion(p.type);
			controls.push({
				name: p.name,
				label: humanize(p.name),
				kind: 'select',
				options: u,
				value: initValue(p.default, 'select', u) as string,
			});
		} else if (p.type === 'number') {
			controls.push({
				name: p.name,
				label: humanize(p.name),
				kind: 'number',
				value: initValue(p.default, 'number') as number,
			});
		} else if (p.type === 'string') {
			controls.push({
				name: p.name,
				label: humanize(p.name),
				kind: 'text',
				value: initValue(p.default, 'text') as string,
			});
		}
		// else: complex prop with no hint → no control (may be supplied via hints.samples)
	}

	const hasChildren = childrenSlot !== undefined || hints.children !== undefined;
	return {
		controls,
		hasChildren,
		childrenLabel: 'Content',
		childrenInit: hints.children ?? (hasChildren ? 'Content' : ''),
	};
}

/** Props to pass to the live component: toggles/numbers always, non-empty text/select, + samples. */
export function buildLiveProps(
	controls: Control[],
	values: Record<string, unknown>,
	samples: Record<string, unknown> = {},
): Record<string, unknown> {
	const p: Record<string, unknown> = { ...samples };
	for (const c of controls) {
		const v = values[c.name];
		if (c.kind === 'toggle') p[c.name] = !!v;
		else if (c.kind === 'number') p[c.name] = Number(v);
		else if (v !== '' && v != null) p[c.name] = v;
	}
	return p;
}

const fmt = (c: Control, v: unknown): string | null => {
	if (c.kind === 'toggle') return v ? '' : null;
	if (c.kind === 'number') return `{${Number(v)}}`;
	if (v === '' || v == null) return null;
	return `"${String(v)}"`;
};

/** Generate the JSX-ish snippet reflecting the current control values. */
export function generateCode(
	name: string,
	controls: Control[],
	values: Record<string, unknown>,
	hasChildren: boolean,
	childrenText: string,
	samples: Record<string, unknown> = {},
): string {
	const parts: string[] = [];
	for (const k of Object.keys(samples)) parts.push(`${k}={…}`);
	for (const c of controls) {
		const f = fmt(c, values[c.name]);
		if (f === null) continue;
		parts.push(f === '' ? c.name : `${c.name}=${f}`);
	}
	const attrs = parts.length ? ' ' + parts.join(' ') : '';
	return hasChildren ? `<${name}${attrs}>${childrenText}</${name}>` : `<${name}${attrs} />`;
}
