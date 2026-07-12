import { describe, expect, it } from 'vitest';
import type { IOData } from '../types/io';
import { aggregateSectors } from './aggregation';

const mrio: IOData = {
    Z: [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
        [9, 10, 11, 12],
        [13, 14, 15, 16]
    ],
    x: [10, 20, 30, 40],
    Y: [[1], [2], [3], [4]],
    VA: [[5, 6, 7, 8]],
    F: [[2, 4, 6, 8]],
    isMRIO: true,
    regions: ['R1', 'R2'],
    sectorsPerRegion: 2
};

describe('aggregateSectors', () => {
    it('preserves totals for the same within-region rule', () => {
        const aggregated = aggregateSectors(mrio, {
            groups: [[0, 1], [2, 3]],
            newSectorNames: ['R1 total', 'R2 total']
        });

        expect(aggregated.x).toEqual([30, 70]);
        expect(aggregated.Y).toEqual([[3], [7]]);
        expect(aggregated.F).toEqual([[6, 14]]);
        expect(aggregated.Z.flat().reduce((sum, value) => sum + value, 0)).toBe(136);
        expect(aggregated.isMRIO).toBe(true);
        expect(aggregated.sectorsPerRegion).toBe(1);
    });

    it('rejects groups that cross region boundaries', () => {
        expect(() => aggregateSectors(mrio, {
            groups: [[0, 2], [1, 3]],
            newSectorNames: ['mixed 1', 'mixed 2']
        })).toThrow('不能跨越区域边界');
    });
});
