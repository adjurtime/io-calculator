import { describe, expect, it } from 'vitest';
import type { CalculationConfig, IOData } from '../types/io';
import { DEFAULT_CONFIG } from '../types/io';
import { calculateIOIndicators } from './calculator';

const data: IOData = {
    Z: [
        [10, 20],
        [30, 10]
    ],
    x: [100, 100],
    Y: [
        [60, 10],
        [40, 20]
    ],
    VA: [[60, 70]],
    F: [
        [10, 20],
        [100, 50]
    ],
    sectorNames: ['A', 'B'],
    finalDemandNames: ['Households', 'Government'],
    satelliteNames: ['Carbon', 'Energy']
};

function footprintOnly(aggregateFinalDemand: boolean): CalculationConfig {
    return {
        ...DEFAULT_CONFIG,
        computeA: false,
        computeB: false,
        computeL: false,
        computeG: false,
        computeVACoef: false,
        computeS: false,
        computeM: false,
        computeFootprint: true,
        computeLinkage: false,
        aggregateFinalDemand
    };
}

describe('calculateIOIndicators', () => {
    it('matches a two-sector golden SRIO case', () => {
        const { results, errors } = calculateIOIndicators(data, DEFAULT_CONFIG);

        expect(errors).toEqual([]);
        expect(results.A?.[0][0]).toBeCloseTo(0.1, 12);
        expect(results.A?.[1][0]).toBeCloseTo(0.3, 12);
        expect(results.L?.[0][0]).toBeCloseTo(1.2, 12);
        expect(results.L?.[0][1]).toBeCloseTo(0.2666666667, 9);
        expect(results.M?.[0][0]).toBeCloseTo(0.2, 12);
        expect(results.M?.[1][1]).toBeCloseTo(0.8666666667, 9);
        expect(results.footprint).toHaveLength(2);
        expect(results.footprint?.[0]).toHaveLength(1);
        expect(results.footprint?.[0][0]).toBeCloseTo(30, 10);
        expect(results.footprint?.[1][0]).toBeCloseTo(150, 10);
        expect(results.numericDiagnostics?.leontief?.conditionEstimate).toBeGreaterThanOrEqual(1);
        expect(results.numericDiagnostics?.leontief?.inverseResidual).toBeLessThan(1e-10);
    });

    it('computes footprint dependencies even when A, L, s, and M are not requested for display', () => {
        const { results, errors } = calculateIOIndicators(data, footprintOnly(true));

        expect(errors).toEqual([]);
        expect(results.A).toBeUndefined();
        expect(results.L).toBeUndefined();
        expect(results.s).toBeUndefined();
        expect(results.M).toBeUndefined();
        expect(results.footprint?.map(row => row[0])).toEqual([
            expect.closeTo(30, 10),
            expect.closeTo(150, 10)
        ]);
    });

    it('preserves multiple final-demand categories as a p by k footprint matrix', () => {
        const { results, errors } = calculateIOIndicators(data, footprintOnly(false));

        expect(errors).toEqual([]);
        expect(results.footprint).toHaveLength(2);
        expect(results.footprint?.[0]).toHaveLength(2);
        expect(results.footprint?.[0][0]).toBeCloseTo(22.6666666667, 9);
        expect(results.footprint?.[0][1]).toBeCloseTo(7.3333333333, 9);
        expect(results.footprint?.[1][0]).toBeCloseTo(118.6666666667, 9);
        expect(results.footprint?.[1][1]).toBeCloseTo(31.3333333333, 9);
    });

    it('stops before calculation when structural validation fails', () => {
        const invalid: IOData = { ...data, x: [] };
        const { results, errors } = calculateIOIndicators(invalid, DEFAULT_CONFIG);

        expect(results.A).toBeUndefined();
        expect(errors.map(error => error.code)).toContain('X_REQUIRED');
    });

    it('requires final demand when a satellite footprint is requested', () => {
        const withoutFinalDemand: IOData = { ...data, Y: undefined };
        const { errors } = calculateIOIndicators(withoutFinalDemand, footprintOnly(true));
        expect(errors.map(error => error.code)).toContain('FOOTPRINT_REQUIRES_FINAL_DEMAND');
    });
});
