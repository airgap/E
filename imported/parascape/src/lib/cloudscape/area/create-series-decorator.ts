// Vendored verbatim from @cloudscape-design/components
// area-chart/model/create-series-decorator.js. Reuses the vendored
// createCategoryColorScale (same palette as Phase 1).
import createCategoryColorScale from '../mlbc/category-color-scale.js';

export default function createSeriesDecorator(externalSeries: any[]) {
	const colorScale = createCategoryColorScale(
		externalSeries,
		(s: any) => s.type === 'threshold',
		(s: any) => s.color || null,
	);
	const decorateSeries = (s: any, index: number) => {
		const title = s.title;
		const color = colorScale[index];
		const markerType = s.type === 'area' ? 'hollow-rectangle' : 'dashed';
		const formatValue =
			s.type === 'threshold'
				? () => (s.valueFormatter ? s.valueFormatter(s.y) : s.y)
				: (y: any, x: any) => (s.valueFormatter ? s.valueFormatter(y, x) : y);
		return { series: s, title, color, markerType, formatValue };
	};
	const mapping = externalSeries.reduce((map: Map<any, any>, series: any, index: number) => {
		map.set(series, decorateSeries(series, index));
		return map;
	}, new Map());
	const seriesDecorator = (series: any) =>
		mapping.get(series) || decorateSeries(series, externalSeries.length);
	return seriesDecorator;
}
