// Vendored verbatim from @cloudscape-design/components
// internal/components/cartesian-chart/scales.js — pure scale-factory
// logic over the byte-faithful vendored d3-scale (Phase-0 gate proved
// identical output). Transliterated JS→TS; behaviour unchanged.
import { scaleBand, scaleLinear, scaleLog, scaleTime } from '../../vendor/d3-scale.js';

type ScaleType = 'linear' | 'log' | 'time' | 'categorical';

function isNumericDomain(domain: any[]) {
	return domain.length > 0 && typeof domain[0] === 'number';
}
function isDateDomain(domain: any[]) {
	return domain.length > 0 && domain[0] instanceof Date;
}
function createNumericScale(type: string, domain: any[]) {
	let scale: any;
	switch (type) {
		case 'log':
			scale = scaleLog();
			break;
		default:
			scale = scaleLinear();
	}
	if (isNumericDomain(domain)) {
		scale.domain(domain);
	}
	return scale;
}
function createTimeScale(domain: any[]) {
	const scale: any = scaleTime();
	if (isDateDomain(domain)) {
		scale.domain(domain);
	}
	return scale;
}
function createBandScale(domain: any[]) {
	const scale: any = scaleBand().padding(0.1);
	scale.domain(domain);
	return scale;
}
function createScale(type: ScaleType, domain: any[], range: any[]) {
	switch (type) {
		case 'linear':
		case 'log':
			return { type: 'numeric', scale: createNumericScale(type, domain).range(range) };
		case 'time':
			return { type: 'time', scale: createTimeScale(domain).range(range) };
		case 'categorical':
			return { type: 'categorical', scale: createBandScale(domain).range(range) };
	}
}

export class ChartScale {
	scaleType: ScaleType;
	domain: any[];
	range: any[];
	scale: any;
	d3Scale: any;
	constructor(
		scaleType: ScaleType,
		domain: any[],
		range: any[],
		noCategoricalOuterPadding = false,
	) {
		this.scaleType = scaleType;
		this.domain = domain;
		this.range = range;
		this.scale = createScale(this.scaleType, this.domain, this.range);
		this.d3Scale = this.scale!.scale;
		if (this.isCategorical()) {
			if (noCategoricalOuterPadding) {
				this.d3Scale.paddingInner(0.7);
				this.d3Scale.paddingOuter(0);
			} else {
				this.d3Scale.paddingInner(0.2);
				this.d3Scale.paddingOuter(0.05);
			}
		}
	}
	cloneScale(newScaleType?: ScaleType, newDomain?: any[], newRange?: any[]) {
		return new ChartScale(
			newScaleType || this.scaleType,
			newDomain || this.domain,
			newRange || this.range,
		);
	}
	isNumeric() {
		return this.scale!.type === 'numeric';
	}
	isTime() {
		return this.scale!.type === 'time';
	}
	isCategorical() {
		return this.scale!.type === 'categorical';
	}
}

export class NumericChartScale {
	scaleType: string;
	scale: any;
	d3Scale: any;
	constructor(scaleType: string, domain: any[], range: any[], adjustDomain: any) {
		this.scaleType = scaleType;
		const scale = createNumericScale(scaleType, domain).range(range);
		if (adjustDomain !== null) {
			scale.nice(adjustDomain);
		}
		this.scale = { type: 'numeric', scale };
		this.d3Scale = this.scale.scale;
	}
	isCategorical() {
		return false;
	}
}
