// Vendored verbatim from @cloudscape-design/components
// pie-chart/utils.js. Pure dimension/angle math + the DOM-measuring
// balanceLabelNodes (used by <Labels>, parameterised on a styles map
// + getBBox so it stays a faithful transliteration).
const minRadius = 30;
const paddingLabels = 44;
const defaultPadding = 12;
const smallPadding = 8;
export const minLabelLineAngularPadding = Math.PI / 20;

export const dimensionsBySize: Record<string, any> = {
	small: {
		innerRadius: 33,
		outerRadius: 50,
		innerLabelPadding: smallPadding,
		padding: smallPadding,
		paddingLabels,
	},
	medium: {
		innerRadius: 66,
		outerRadius: 100,
		innerLabelPadding: defaultPadding,
		padding: defaultPadding,
		paddingLabels,
	},
	large: {
		innerRadius: 93,
		outerRadius: 140,
		innerLabelPadding: defaultPadding,
		padding: defaultPadding,
		paddingLabels,
	},
};
export const refreshDimensionsBySize: Record<string, any> = {
	small: { ...dimensionsBySize.small, innerRadius: 38, cornerRadius: 3 },
	medium: { ...dimensionsBySize.medium, innerRadius: 75, cornerRadius: 4 },
	large: { ...dimensionsBySize.large, innerRadius: 105, cornerRadius: 5 },
};

export function getDimensionsBySize({
	size,
	hasLabels,
	visualRefresh,
}: {
	size: any;
	hasLabels: boolean;
	visualRefresh: boolean;
}) {
	if (typeof size === 'string') {
		const dimensions = visualRefresh ? refreshDimensionsBySize[size] : dimensionsBySize[size];
		return { ...dimensions, size };
	}
	const sizeSpec = visualRefresh ? refreshDimensionsBySize : dimensionsBySize;
	const getPixelSize = (d: any) =>
		d.outerRadius * 2 + d.padding * 2 + (hasLabels ? d.paddingLabels : 0) * 2;
	let matchedSize = 'small';
	if (size > getPixelSize(sizeSpec.medium)) {
		matchedSize = 'medium';
	}
	if (size > getPixelSize(sizeSpec.large)) {
		matchedSize = 'large';
	}
	const padding = sizeSpec[matchedSize].padding;
	const pLabels = hasLabels ? sizeSpec[matchedSize].paddingLabels : 0;
	const radiiRatio = sizeSpec[matchedSize].outerRadius / sizeSpec[matchedSize].innerRadius;
	const outerRadius = Math.max(minRadius, (size - 2 * pLabels - 2 * padding) / 2);
	const innerRadius = outerRadius / radiiRatio;
	return { ...sizeSpec[matchedSize], outerRadius, innerRadius, size: matchedSize };
}

export const defaultDetails = (i18n: any, i18nStrings: any) => (datum: any, dataSum: number) => [
	{
		key: i18n('i18nStrings.detailsValue', i18nStrings.detailsValue) || '',
		value: datum.value,
	},
	{
		key: i18n('i18nStrings.detailsPercentage', i18nStrings.detailsPercentage) || '',
		value: `${((datum.value * 100) / dataSum).toFixed(0)}%`,
	},
];

export const balanceLabelNodes = (
	nodes: any,
	markers: any[],
	leftSide: boolean,
	radius: number,
	labelLineClass: string,
) => {
	const MARGIN = 10;
	let previousBBox: any = null;
	let i = leftSide ? nodes.length - 1 : 0;
	while ((leftSide && i >= 0) || (!leftSide && i < nodes.length)) {
		const node = nodes[i];
		const x = parseFloat(node.getAttribute('data-x') || '0');
		const y = parseFloat(node.getAttribute('data-y') || '0');
		const box = { x, y, height: node.getBoundingClientRect().height };
		const marker = markers[i];
		if (leftSide) {
			i--;
		} else {
			i++;
		}
		if (!previousBBox) {
			previousBBox = box;
			node.setAttribute('transform', '');
			continue;
		}
		if ((!leftSide && box.x < 0) || (leftSide && box.x >= 0)) {
			break;
		}
		node.setAttribute('transform', '');
		const yOffset = previousBBox.y + previousBBox.height + MARGIN - box.y;
		if (yOffset > 0) {
			const xOffset = computeXOffset(box, yOffset, radius) * (leftSide ? -1 : 1);
			node.setAttribute('transform', `translate(${xOffset} ${yOffset})`);
			const lineNode = node.parentNode?.querySelector(`.${labelLineClass}`);
			if (lineNode) {
				const { endY, endX } = marker;
				lineNode.setAttribute('y2', '' + (endY + yOffset));
				lineNode.setAttribute('x2', '' + (endX + xOffset));
			}
			box.y += yOffset;
			box.x += xOffset;
		}
		previousBBox = box;
	}
};

const squareDistance = (edge: number[]) => Math.pow(edge[0], 2) + Math.pow(edge[1], 2);
const computeXOffset = (box: any, yOffset: number, radius: number) => {
	const upperEdge = [box.x, box.y + yOffset];
	const lowerEdge = [box.x, box.y + box.height + yOffset];
	const closestEdge = squareDistance(upperEdge) < squareDistance(lowerEdge) ? upperEdge : lowerEdge;
	if (squareDistance(closestEdge) < Math.pow(radius, 2)) {
		return Math.sqrt(Math.pow(radius, 2) - Math.pow(closestEdge[1], 2)) - Math.abs(closestEdge[0]);
	}
	return 0;
};

export const computeSmartAngle = (startAngle: number, endAngle: number, optimize = false) => {
	if (!optimize || endAngle - startAngle < 2 * minLabelLineAngularPadding) {
		return (endAngle + startAngle) / 2;
	}
	const paddedStartAngle = startAngle + minLabelLineAngularPadding;
	const paddedEndAngle = endAngle - minLabelLineAngularPadding;
	if (paddedStartAngle < 0 && paddedEndAngle > 0) {
		return 0;
	}
	if (paddedStartAngle < Math.PI && paddedEndAngle > Math.PI) {
		return Math.PI;
	}
	const endAngleMinDistance = Math.min(
		paddedEndAngle,
		Math.abs(Math.PI - paddedEndAngle),
		2 * Math.PI - paddedEndAngle,
	);
	const startAngleMinDistance = Math.min(
		paddedStartAngle,
		Math.abs(Math.PI - paddedStartAngle),
		2 * Math.PI - paddedStartAngle,
	);
	if (endAngleMinDistance < startAngleMinDistance) {
		return paddedEndAngle;
	}
	return paddedStartAngle;
};
