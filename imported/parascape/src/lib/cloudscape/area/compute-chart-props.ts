// Vendored verbatim from @cloudscape-design/components
// area-chart/model/compute-chart-props.js. Reuses the Phase-1a-gated
// ChartScale/NumericChartScale/createX|YTicks + the Phase-2a utils.
import { ChartScale, NumericChartScale } from '../cartesian/scales.js';
import { createXTicks, createYTicks, getXTickCount, getYTickCount } from '../cartesian/ticks.js';
import { computeDomainX, computeDomainY, computePlotPoints } from './utils.js';

export default function computeChartProps({
	isRtl,
	series,
	xDomain: externalXDomain,
	yDomain: externalYDomain,
	xScaleType,
	yScaleType,
	height,
	width,
}: {
	isRtl: boolean;
	series: any[];
	xDomain?: any[];
	yDomain?: any[];
	xScaleType: any;
	yScaleType: any;
	height: number;
	width: number;
}) {
	const xDomain = externalXDomain ? [...externalXDomain] : computeDomainX(series);
	const xTickCount = getXTickCount(width);
	const xScale = new ChartScale(xScaleType, xDomain, !isRtl ? [0, width] : [width, 0]);
	const xTicks = xScale.domain.length > 0 ? createXTicks(xScale, xTickCount) : [];
	const yDomain = externalYDomain || computeDomainY(series, yScaleType);
	const yTickCount = getYTickCount(height);
	const yScale = new NumericChartScale(
		yScaleType,
		yDomain,
		[height, 0],
		externalYDomain ? null : yTickCount,
	);
	const yTicks = createYTicks(yScale, yTickCount);
	const plot = computePlotPoints(series, xScale, yScale);
	return { xDomain, yDomain, xScale, yScale, xTicks, yTicks, plot };
}
