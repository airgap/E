// vendored verbatim from @cloudscape-design generated tokens +
// internal/styles/colors.js + internal/utils/create-category-color-scale.js
export const categoryPalette = [
	'var(--color-charts-palette-categorical-1-xu0deg, #688ae8)',
	'var(--color-charts-palette-categorical-2-ktit09, #c33d69)',
	'var(--color-charts-palette-categorical-3-g0srj0, #2ea597)',
	'var(--color-charts-palette-categorical-4-5vauwp, #8456ce)',
	'var(--color-charts-palette-categorical-5-3v8ery, #e07941)',
	'var(--color-charts-palette-categorical-6-ztdd8d, #3759ce)',
	'var(--color-charts-palette-categorical-7-3j5o6w, #962249)',
	'var(--color-charts-palette-categorical-8-c5r39m, #096f64)',
	'var(--color-charts-palette-categorical-9-8n6iuv, #6237a7)',
	'var(--color-charts-palette-categorical-10-opta0w, #a84401)',
	'var(--color-charts-palette-categorical-11-b2r7jc, #273ea5)',
	'var(--color-charts-palette-categorical-12-b5drtm, #780d35)',
	'var(--color-charts-palette-categorical-13-c69xg9, #03524a)',
	'var(--color-charts-palette-categorical-14-db19x8, #4a238b)',
	'var(--color-charts-palette-categorical-15-8z8vjw, #7e3103)',
	'var(--color-charts-palette-categorical-16-549jkl, #1b2b88)',
	'var(--color-charts-palette-categorical-17-nrio7t, #ce567c)',
	'var(--color-charts-palette-categorical-18-tm902v, #003e38)',
	'var(--color-charts-palette-categorical-19-ujcr86, #9469d6)',
	'var(--color-charts-palette-categorical-20-h55e4g, #602400)',
	'var(--color-charts-palette-categorical-21-vs0u8l, #4066df)',
	'var(--color-charts-palette-categorical-22-6klt3l, #a32952)',
	'var(--color-charts-palette-categorical-23-3zpkdt, #0d7d70)',
	'var(--color-charts-palette-categorical-24-z9a4uk, #6b40b2)',
];
export const thresholdColor = 'var(--color-charts-threshold-neutral-pd7kh4, #656871)';
export default function createCategoryColorScale(
	items: any[],
	isThreshold: (it: any) => boolean = () => false,
	getOwnColor: (it: any) => string | null = () => null,
) {
	const colors = [];
	let categoryIndex = 0;
	for (const it of items) {
		const ownColor = getOwnColor(it);
		const defaultColor = isThreshold(it)
			? thresholdColor
			: categoryPalette[categoryIndex % categoryPalette.length];
		colors.push(ownColor || defaultColor);
		if (!isThreshold(it) && !ownColor) categoryIndex++;
	}
	return colors;
}
