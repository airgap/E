// Real axe-core accessibility matcher (replaces the former always-pass stub).
// Used by the conformance suites as `await expect(node).toValidateA11y()`.
//
// Runs in jsdom, so layout-dependent rules (notably colour-contrast, which needs
// real computed geometry) are disabled here — those are validated accurately in a
// real browser by the Designer's Accessibility panel (LYK-931).
//
// Posture: this is a REAL check now, not a no-op. By default it runs axe and
// REPORTS serious/critical violations to the console (so component a11y gaps are
// surfaced) but still passes — flipping ~the whole conformance suite red in one
// go would conflate a11y findings with the separate component-parity track
// (64/94). Set PARASCAPE_A11Y_STRICT=1 to make violations FAIL the assertion
// (the intended end state once the component a11y gaps are triaged under #28).
import { expect } from 'vitest';
import axe from 'axe-core';

const STRICT =
	typeof process !== 'undefined' &&
	(process.env?.PARASCAPE_A11Y_STRICT === '1' || process.env?.PARASCAPE_A11Y_STRICT === 'true');

expect.extend({
	async toValidateA11y(received: Element) {
		const node = received as Element;
		if (!node || typeof (node as { querySelectorAll?: unknown }).querySelectorAll !== 'function') {
			return { pass: false, message: () => 'toValidateA11y expected a DOM element' };
		}
		const results = await axe.run(node, {
			runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
			rules: {
				// need real layout/geometry jsdom can't compute — checked in-browser instead
				'color-contrast': { enabled: false },
				'target-size': { enabled: false },
			},
			resultTypes: ['violations'],
		});
		const serious = results.violations.filter(
			(v) => v.impact === 'serious' || v.impact === 'critical',
		);
		if (serious.length === 0) {
			return { pass: true, message: () => 'no serious/critical a11y violations' };
		}
		const detail = serious
			.map(
				(v) =>
					`  • [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})\n    ${v.helpUrl}`,
			)
			.join('\n');
		const summary = `axe found ${serious.length} serious/critical a11y violation(s):\n${detail}`;
		if (STRICT) return { pass: false, message: () => summary };
		// report-only: surface the finding, don't fail (until PARASCAPE_A11Y_STRICT=1)
		console.warn(`[a11y][report-only] ${summary}`);
		return { pass: true, message: () => summary };
	},
});
