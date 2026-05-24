// Vendored verbatim from @cloudscape-design/components
// mixed-line-bar-chart/utils.js. Pure logic.
export const chartLegendMap: Record<string, string> = {
	line: 'line',
	bar: 'rectangle',
	threshold: 'dashed',
};

export const nextValidDomainIndex = (nextGroupIndex: number, barGroups: any[], direction = 1) => {
	let index = nextGroupIndex;
	if (index < 0 || index >= barGroups.length) {
		index = 0;
	}
	do {
		if (barGroups[index].isValid && barGroups[index].hasData) {
			return index;
		}
		index += direction;
		if (index >= barGroups.length) {
			index = 0;
		} else if (index < 0) {
			index = barGroups.length - 1;
		}
	} while (index !== nextGroupIndex);
	return 0;
};

export function findNavigableSeries(series: any[]) {
	const navigableSeries: any[] = [];
	let navigableBarSeriesIndex = -1;
	series.forEach((internalSeries) => {
		if (internalSeries.series.type === 'bar') {
			if (navigableBarSeriesIndex === -1) {
				navigableBarSeriesIndex = navigableSeries.length;
				navigableSeries.push(internalSeries.series);
			}
		} else {
			navigableSeries.push(internalSeries.series);
		}
	});
	return { navigableSeries, navigableBarSeriesIndex };
}

export const matchesX = (x1: any, x2: any) => {
	if (x1 instanceof Date && x2 instanceof Date) {
		return x1.getTime() === x2.getTime();
	}
	return x1 === x2;
};

export function calculateStackedBarValues(dataBySeries: any[]) {
	const negativeValues = new Map<any, number>();
	const positiveValues = new Map<any, number>();
	const values = new Map<any, Map<number, number>>();
	for (let seriesIndex = 0; seriesIndex < dataBySeries.length; seriesIndex++) {
		for (const datum of dataBySeries[seriesIndex]) {
			const key = getKeyValue(datum.x);
			if (datum.y < 0) {
				negativeValues.set(key, (negativeValues.get(key) ?? 0) + datum.y);
			} else {
				positiveValues.set(key, (positiveValues.get(key) ?? 0) + datum.y);
			}
			const seriesValue = (datum.y < 0 ? negativeValues.get(key) : positiveValues.get(key)) ?? 0;
			const valuesByIndex = values.get(key) ?? new Map<number, number>();
			valuesByIndex.set(seriesIndex, seriesValue);
			values.set(key, valuesByIndex);
		}
	}
	return values;
}

export const getKeyValue = (key: any) => (key instanceof Date ? key.getTime() : key);

export function isYThreshold(series: any) {
	const key = 'y';
	return series.type === 'threshold' && key in series;
}
export function isXThreshold(series: any) {
	const key = 'x';
	return series.type === 'threshold' && key in series;
}
export function isDataSeries(series: any) {
	return series.type === 'line' || series.type === 'bar';
}
