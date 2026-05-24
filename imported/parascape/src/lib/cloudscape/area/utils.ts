// Vendored verbatim from @cloudscape-design/components
// area-chart/model/utils.js. Pure geometry/stacking logic.
const EPSILON = 0.0000000000001;

export function computeDomainX(series: any[]): any[] {
	const xValues = getXValues(series);
	if (xValues.length === 0) {
		return [];
	}
	if (typeof xValues[0] === 'string') {
		return uniq(xValues);
	}
	return xValues.reduce(
		([min, max]: any[], x: any) => [x < min ? x : min, max < x ? x : max],
		[xValues[0], xValues[0]],
	);
}

export function computeDomainY(series: any[], scaleType: string): any[] {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	series.forEach((s) => {
		if (s.type === 'threshold') {
			min = Math.min(min, s.y);
			max = Math.max(max, s.y);
		}
	});
	getXValues(series).forEach((_: any, xIndex: number) => {
		let stackY = scaleType === 'linear' ? 0 : EPSILON;
		for (const s of series) {
			if (s.type === 'area') {
				stackY = stackY + (s.data[xIndex]?.y || 0);
				min = Math.min(min, stackY);
				max = Math.max(max, stackY);
			}
		}
	});
	if (min === Number.POSITIVE_INFINITY) {
		return [];
	}
	if (scaleType === 'log' && min === 0 && max > 1) {
		return [1, max];
	}
	return [min, max];
}

export function computePlotPoints(series: any[], xScale: any, yScale: any) {
	const xValues = getXValues(series);
	const xy: any[] = [];
	const xs: any[] = [];
	const sx: any[] = [];
	getVisibleData(xValues, xScale).forEach(({ x, scaledX }: any, xIndex: number) => {
		let stackY = yScale.scaleType === 'linear' ? 0 : EPSILON;
		const points: any[] = [];
		series.forEach((s: any, sIndex: number) => {
			if (s.type === 'threshold') {
				const scaledY = yScale.d3Scale(s.y) || 0;
				points.push({
					x: x,
					y0: s.y,
					y1: s.y,
					scaled: { x: scaledX, y0: scaledY, y1: scaledY },
					index: { x: xIndex, s: sIndex, y: 0 },
					value: 0,
				});
			} else {
				const value = s.data[xIndex]?.y || 0;
				const y0 = stackY;
				const y1 = stackY + value;
				points.push({
					x: x,
					y0: y0,
					y1: y1,
					scaled: { x: scaledX, y0: yScale.d3Scale(y0) || 0, y1: yScale.d3Scale(y1) || 0 },
					index: { x: xIndex, s: sIndex, y: 0 },
					value: value,
				});
				stackY = y1;
			}
		});
		points
			.sort((p1, p2) => p1.y1 - p2.y1)
			.forEach((point, index) => {
				point.index.y = index;
				insertIntoMatrix(xy, point.index.x, point.index.y, point);
				insertIntoMatrix(xs, point.index.x, point.index.s, point);
				insertIntoMatrix(sx, point.index.s, point.index.x, point);
			});
	});
	return { xy, xs, sx };
}

export function findClosest(sortedArray: any[], target: number, getter: (x: any) => number) {
	if (sortedArray.length === 0) {
		return null;
	}
	const isAscending = getter(sortedArray[0]) < getter(sortedArray[sortedArray.length - 1]);
	const compare = (x: any) => (isAscending ? getter(x) < target : getter(x) > target);
	const delta = (x: any) => Math.abs(getter(x) - target);
	let lo = 0;
	let hi = sortedArray.length - 1;
	while (hi - lo > 1) {
		const mid = Math.floor((lo + hi) / 2);
		if (compare(sortedArray[mid])) {
			lo = mid;
		} else {
			hi = mid;
		}
	}
	return delta(sortedArray[lo]) < delta(sortedArray[hi]) ? sortedArray[lo] : sortedArray[hi];
}

export function isSeriesValid(series: any[]) {
	const sampleXValues = getXValues(series);
	for (const s of series) {
		if (s.type === 'area') {
			for (let i = 0; i < Math.max(s.data.length, sampleXValues.length); i++) {
				if (s.data[i]?.x !== sampleXValues[i]) {
					return false;
				}
			}
		}
	}
	return true;
}

function getXValues(series: any[]) {
	for (const s of series) {
		if (s.type === 'area') {
			return s.data.map(({ x }: any) => x);
		}
	}
	return [];
}

function getVisibleData(data: any[], xScale: any) {
	const scaledOffsetX = xScale.isCategorical()
		? Math.max(0, xScale.d3Scale.bandwidth() - 1) / 2
		: 0;
	const visibleData: any[] = [];
	for (const x of data) {
		const scaledX = xScale.d3Scale(x);
		if (scaledX !== undefined) {
			visibleData.push({ x, scaledX: scaledX + scaledOffsetX });
		}
	}
	return visibleData;
}

function insertIntoMatrix(matrix: any[], row: number, col: number, value: any) {
	if (!matrix[row]) {
		matrix[row] = [];
	}
	matrix[row][col] = value;
}

function uniq(arr: any[]) {
	const set = new Set();
	const uniqArray: any[] = [];
	for (const value of arr) {
		if (!set.has(value)) {
			set.add(value);
			uniqArray.push(value);
		}
	}
	return uniqArray;
}
