// Vendored verbatim from @cloudscape-design/components
// mixed-line-bar-chart/make-scaled-bar-groups.js. Pure geometry.
import { isDataSeries, isXThreshold, isYThreshold, matchesX } from './utils.js';

export default function makeScaledBarGroups(
	series: any[],
	xScale: any,
	plotWidth: number,
	plotHeight: number,
	axis: 'x' | 'y',
) {
	if (!xScale.isCategorical()) {
		return [];
	}
	return xScale.domain.map((x: any) => {
		const scaledX = xScale.d3Scale(x);
		const isValid = typeof scaledX !== 'undefined' && isFinite(scaledX);
		return {
			x,
			isValid,
			hasData: series.some(({ series }: any) => {
				if (isYThreshold(series)) {
					return true;
				}
				if (isXThreshold(series)) {
					return false;
				}
				if (isDataSeries(series)) {
					return series.data.some((datum: any) => matchesX(datum.x, x));
				}
				return false;
			}),
			position:
				axis === 'x'
					? {
							x: 0,
							y: isValid ? scaledX || 0 : 0,
							width: plotWidth,
							height: xScale.d3Scale.bandwidth(),
						}
					: {
							x: isValid ? scaledX || 0 : 0,
							y: 0,
							width: xScale.d3Scale.bandwidth(),
							height: plotHeight,
						},
		};
	});
}
