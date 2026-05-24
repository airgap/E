// Vendored verbatim from @cloudscape-design/components
// mixed-line-bar-chart/domain.js. Pure logic.
import { isDataSeries, isXThreshold, isYThreshold, matchesX } from './utils.js';

export function computeDomainX(series: any[], xScaleType: string): any[] {
	if (xScaleType === 'categorical') {
		return series.reduce((acc: any[], s: any) => {
			if (isDataSeries(s.series)) {
				s.series.data.forEach(({ x }: any) => {
					if (acc.indexOf(x) === -1) {
						acc.push(x);
					}
				});
			}
			if (isXThreshold(s.series)) {
				if (acc.indexOf(s.series.x) === -1) {
					acc.push(s.series.x);
				}
			}
			return acc;
		}, []);
	}
	return series.reduce((acc: any[], curr: any) => {
		if (isYThreshold(curr.series)) {
			return acc;
		}
		if (isXThreshold(curr.series)) {
			const [min, max] = acc;
			const newMin = min === undefined || min === null || curr.series.x < min ? curr.series.x : min;
			const newMax = max === undefined || max === null || max < curr.series.x ? curr.series.x : max;
			return [newMin, newMax];
		}
		if (isDataSeries(curr.series)) {
			return curr.series.data.reduce(([min, max]: any[], { x }: any) => {
				const newMin = min === undefined || min === null || x < min ? x : min;
				const newMax = max === undefined || max === null || max < x ? x : max;
				return [newMin, newMax];
			}, acc);
		}
		return acc;
	}, []);
}

export function computeDomainY(series: any[], scaleType: string, stackedBars: boolean): any[] {
	let _series = series;
	if (stackedBars) {
		const { positiveData, negativeData } = series.reduce(
			(acc: any, curr: any) => {
				if (curr.series.type === 'bar') {
					curr.series.data.forEach(({ x, y }: any) => {
						const data = y < 0 ? acc.negativeData : acc.positiveData;
						const stackedDatum = data.find((el: any) => matchesX(el.x, x));
						if (stackedDatum) {
							stackedDatum.y += y;
						} else {
							data.push({ x, y });
						}
						return acc;
					});
				}
				return acc;
			},
			{ positiveData: [], negativeData: [] },
		);
		const stackedSeries = [
			{ color: '', index: NaN, series: { type: 'bar', title: 'positive', data: positiveData } },
			{ color: '', index: NaN, series: { type: 'bar', title: 'negative', data: negativeData } },
		];
		_series = [...stackedSeries, ..._series.filter((s: any) => s.series.type !== 'bar')];
	}
	const domain = _series.reduce(
		(acc: any[], curr: any) => {
			if (isYThreshold(curr.series)) {
				const [min, max] = acc;
				const newMin = min === undefined || curr.series.y < min ? curr.series.y : min;
				const newMax = max === undefined || max < curr.series.y ? curr.series.y : max;
				return [newMin, newMax];
			}
			if (isXThreshold(curr.series)) {
				return acc;
			}
			if (isDataSeries(curr.series)) {
				return curr.series.data.reduce(([min, max]: any[], { y }: any) => {
					const newMin = min === undefined || y < min ? y : min;
					const newMax = max === undefined || max < y ? y : max;
					return [newMin, newMax];
				}, acc);
			}
			return acc;
		},
		[0, 0],
	);
	if (scaleType === 'log' && domain[0] === 0 && domain[1] > 1) {
		return [1, domain[1]];
	}
	return domain;
}
