// Vendored verbatim from @cloudscape-design/components
// internal/components/cartesian-chart/ticks.js. Pure logic.
import { add, differenceInDays } from 'date-fns';
import { X_TICK_COUNT_RATIO, Y_TICK_COUNT_RATIO } from './constants.js';

export function getXTickCount(width: number) {
	return Math.ceil(width / X_TICK_COUNT_RATIO);
}
export function getYTickCount(height: number) {
	return Math.ceil(height / Y_TICK_COUNT_RATIO);
}
export function createXTicks(scale: any, values: number) {
	if (scale.isNumeric()) {
		return scale.d3Scale.ticks(values);
	} else if (scale.isTime()) {
		const rawTicks = scale.d3Scale.ticks(values);
		const domain = scale.d3Scale.domain();
		return uniform(rawTicks, domain[domain.length - 1]);
	} else {
		return scale.d3Scale.domain();
	}
}
export function createYTicks(scale: any, values: number) {
	const ticks = scale.d3Scale.ticks(values);
	if (scale.scaleType === 'log' && ticks.length > 10) {
		return scale.d3Scale.ticks(3);
	}
	return ticks;
}
function uniform(ticks: any[], max: any) {
	if (ticks.length < 3 || !isMixedDayInterval(ticks)) {
		return ticks;
	}
	return createTwoDayInterval(ticks[0], max);
}
function isMixedDayInterval(ticks: any[]) {
	let oneDayInterval = false;
	let twoDayInterval = false;
	for (let i = 1; i < ticks.length; i++) {
		oneDayInterval = oneDayInterval || isDayInterval(ticks[i - 1], ticks[i], 1);
		twoDayInterval = twoDayInterval || isDayInterval(ticks[i - 1], ticks[i], 2);
	}
	return oneDayInterval && twoDayInterval;
}
function isDayInterval(a: any, b: any, difference = 1) {
	return Math.abs(differenceInDays(a, b)) === difference;
}
function createTwoDayInterval(start: any, max: any) {
	const result = [];
	let curr = start;
	while (curr < max) {
		result.push(curr);
		curr = add(curr, { days: 2 });
	}
	return result;
}
