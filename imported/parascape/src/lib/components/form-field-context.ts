// Parascape port of @cloudscape-design/components/internal/context/
// form-field-context.js. Cloudscape: FormFieldContext = createContext({});
// useFormFieldContext(props) = applyDefault(props, context, keys) where
// applyDefault picks the prop when it is !== undefined, else the context
// value. FormField provides { controlId, invalid, warning,
// ariaLabelledby, ariaDescribedby }; controls (Input/Textarea, which set
// __inheritFormFieldProps) read it so an Input inside <FormField
// errorText> goes invalid without an explicit prop. Svelte context is
// the faithful equivalent of the React context here.
import { getContext, setContext } from 'svelte';

export type FormFieldCtx = {
	readonly invalid?: boolean;
	readonly warning?: boolean;
	readonly controlId?: string;
	readonly ariaLabelledby?: string;
	readonly ariaDescribedby?: string;
};

const KEY = Symbol('awsui-form-field-context');

export function setFormFieldContext(ctx: FormFieldCtx): void {
	setContext(KEY, ctx);
}

export function getFormFieldContext(): FormFieldCtx {
	return getContext<FormFieldCtx>(KEY) ?? {};
}

// applyDefault, per-key: prop if it was explicitly provided (!== undefined),
// otherwise fall back to the form-field context value.
export function fieldProp<T>(prop: T | undefined, ctxValue: T | undefined): T | undefined {
	return prop === undefined ? ctxValue : prop;
}
