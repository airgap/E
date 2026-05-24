// Vendored verbatim from @cloudscape-design/components
// internal/components/cartesian-chart/label-utils.js. Pure logic
// (getSVGTextSize is the only DOM touch — measurement, not geometry).
const SPACE_BETWEEN = 4;

export function formatTicks({
	ticks,
	scale,
	getLabelSpace,
	tickFormatter,
}: {
	ticks: any[];
	scale: any;
	getLabelSpace: (s: string) => number;
	tickFormatter?: (t: any) => string;
}) {
	return ticks.map((tick) => {
		const position = scale.d3Scale(tick) ?? NaN;
		const label = tickFormatter ? tickFormatter(tick) : tick.toString();
		const lines = (label + '').split('\n');
		return { position, lines, space: Math.max(...lines.map(getLabelSpace)) };
	});
}

export function getVisibleTicks(ticks: any[], from: number, until: number, balanceTicks = false) {
	ticks = getTicksInRange(ticks, from, until);
	return balanceTicks ? getReducedTicks(ticks) : removeIntersections(ticks);
}

function getTicksInRange(ticks: any[], from: number, until: number) {
	return ticks.filter(
		(tick) => from <= tick.position - tick.space / 2 && tick.position + tick.space / 2 <= until,
	);
}

function getReducedTicks(ticks: any[]) {
	const reduceLabelRatio = findReduceLabelRatio(ticks);
	const reducedTicks = [];
	for (let index = 0; index < ticks.length; index += reduceLabelRatio) {
		reducedTicks.push(ticks[index]);
	}
	return reducedTicks;
}

function findReduceLabelRatio(ticks: any[], ratio = 1): number {
	if (ratio >= ticks.length) {
		return ratio;
	}
	for (let i = ratio; i < ticks.length; i += ratio) {
		if (hasIntersection(ticks[i - ratio], ticks[i])) {
			return findReduceLabelRatio(ticks, ratio + 1);
		}
	}
	return ratio;
}

function removeIntersections(ticks: any[]) {
	const visibleTicks = [];
	let prevTick: any = null;
	for (const tick of ticks) {
		if (!prevTick || !hasIntersection(prevTick, tick)) {
			visibleTicks.push(tick);
			prevTick = tick;
		}
	}
	return visibleTicks;
}

function hasIntersection(a: any, b: any) {
	const [left, right] = a.position < b.position ? [a, b] : [b, a];
	const leftEdge = left.position + left.space / 2 + SPACE_BETWEEN;
	const rightEdge = right.position - right.space / 2;
	return leftEdge > rightEdge;
}

/* istanbul ignore next */
export function getSVGTextSize(element: any) {
	if (element && element.getBBox) {
		return element.getBBox();
	}
	return undefined;
}
