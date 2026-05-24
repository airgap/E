// Vendored verbatim from @cloudscape-design/components
// mixed-line-bar-chart/create-one-side-rounded-rect-path.js.
// Source https://stackoverflow.com/a/65186378/16648714
export function createOneSideRoundedRectPath(
	{ x, y, width, height }: { x: number; y: number; width: number; height: number },
	radius: number,
	side: 'left' | 'right' | 'top' | 'bottom',
) {
	const coordinates = [
		{ x, y },
		{ x: x + width, y },
		{ x: x + width, y: y + height },
		{ x: x, y: y + height },
	];
	const startIndex = { left: 2, right: 0, top: 3, bottom: 1 }[side];
	let path = '';
	for (let i = startIndex; i < startIndex + coordinates.length + 1; i++) {
		const start = coordinates[i % coordinates.length];
		const end = coordinates[(i + 1) % coordinates.length];
		const c =
			radius && i < startIndex + 3
				? Math.min(radius / Math.hypot(end.x - start.x, end.y - start.y), 0.5)
				: 0;
		if (i === startIndex) {
			path += `M${start.x * (1 - c) + end.x * c},${start.y * (1 - c) + end.y * c}`;
		}
		if (i > startIndex) {
			path += `Q${start.x},${start.y} ${start.x * (1 - c) + end.x * c},${start.y * (1 - c) + end.y * c}`;
		}
		if (i < startIndex + coordinates.length) {
			path += `L${start.x * c + end.x * (1 - c)},${start.y * c + end.y * (1 - c)}`;
		}
	}
	return path + 'Z';
}
