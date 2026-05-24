// Vendored verbatim from @cloudscape-design/components
// mixed-line-bar-chart/make-scaled-series.js. Pure geometry.
import { isXThreshold, isYThreshold } from './utils.js';

export default function makeScaledSeries(allSeries: any[], xScale: any, yScale: any) {
	const xOffset = xScale.isCategorical() ? Math.max(0, xScale.d3Scale.bandwidth() - 1) / 2 : 0;
	const scaleX = (x: any) => (xScale.d3Scale(x) || 0) + xOffset;
	const scaleY = (y: any) => yScale.d3Scale(y) || 0;
	const allX = getAllX(allSeries);
	function mergeLineSeriesPointsWithXThresholds(
		scaledPoints: any[],
		xThresholdSeries: any,
		xThresholdSeriesColor: any,
	) {
		const x = scaleX(xThresholdSeries.x);
		let bisectIndex = -1;
		for (let i = 0; i < scaledPoints.length - 1; i++) {
			if (scaledPoints[i].x < x && x < scaledPoints[i + 1].x) {
				bisectIndex = i;
				break;
			}
		}
		if (bisectIndex !== -1) {
			const prevY = scaledPoints[bisectIndex].datum?.y || 0;
			const nextY = scaledPoints[bisectIndex + 1].datum?.y || 0;
			const averageY = (prevY + nextY) / 2;
			scaledPoints.push({
				x: x,
				y: scaleY(averageY),
				datum: { x: xThresholdSeries.x, y: NaN },
				series: scaledPoints[bisectIndex].series,
				color: xThresholdSeriesColor,
			});
		}
	}
	const scaledSeriesX = allSeries.map(({ series, color }: any) => {
		const scaledPoints: any[] = [];
		if (series.type === 'line') {
			for (const datum of series.data) {
				scaledPoints.push({ x: scaleX(datum.x), y: scaleY(datum.y), datum, series, color });
			}
			scaledPoints.sort((s1, s2) => s1.x - s2.x);
			for (const otherSeries of allSeries) {
				if (isXThreshold(otherSeries.series)) {
					mergeLineSeriesPointsWithXThresholds(scaledPoints, otherSeries.series, otherSeries.color);
				}
			}
		} else if (isYThreshold(series)) {
			for (const x of allX) {
				scaledPoints.push({
					x: scaleX(x),
					y: scaleY(series.y),
					datum: { x, y: series.y },
					series,
					color,
				});
			}
			if (allX.length === 0) {
				scaledPoints.push({ x: NaN, y: scaleY(series.y), series, color });
			}
		} else if (isXThreshold(series)) {
			scaledPoints.push({
				x: scaleX(series.x),
				y: NaN,
				datum: { x: series.x, y: NaN },
				series,
				color,
			});
		}
		return scaledPoints;
	});
	return flatten(scaledSeriesX).sort((s1: any, s2: any) => s1.x - s2.x);
}

function getAllX(series: any[]) {
	const addDataXSet = new Set<any>();
	for (const { series: s } of series) {
		switch (s.type) {
			case 'bar':
			case 'line':
				for (const d of s.data) {
					addDataXSet.add(d.x);
				}
				break;
			case 'threshold':
				if (isXThreshold(s)) {
					addDataXSet.add(s.x);
				}
				break;
		}
	}
	return Array.from(addDataXSet);
}

function flatten(arrays: any[]) {
	return arrays.flat();
}
