import { describe, expect, it } from 'vitest';
import type { IOData } from '../types/io';
import { validateIOData } from './validation';

function baseData(): IOData {
    return {
        Z: [[10, 20], [30, 10]],
        x: [100, 100],
        Y: [[70], [60]],
        VA: [[60, 70]]
    };
}

describe('validateIOData', () => {
    it('accepts a balanced finite SRIO table', () => {
        expect(validateIOData(baseData()).status).toBe('pass');
    });

    it('rejects a missing total-output vector', () => {
        const result = validateIOData({ ...baseData(), x: [] });
        expect(result.status).toBe('fail');
        expect(result.errors.map(error => error.code)).toContain('X_REQUIRED');
    });

    it('rejects ragged and non-finite matrices', () => {
        const result = validateIOData({
            ...baseData(),
            Z: [[10, Number.NaN], [30]]
        });
        expect(result.status).toBe('fail');
        expect(result.errors.map(error => error.code)).toContain('Z_RAGGED');
        expect(result.errors.map(error => error.code)).toContain('Z_NON_FINITE');
    });

    it('treats zero output as a blocking error', () => {
        const result = validateIOData({
            Z: [[0]],
            x: [0],
            Y: [[0]],
            VA: [[0]]
        });
        expect(result.status).toBe('fail');
        expect(result.errors.map(error => error.code)).toContain('ZERO_OUTPUT');
    });

    it('rejects inconsistent MRIO region metadata', () => {
        const result = validateIOData({
            ...baseData(),
            isMRIO: true,
            regions: ['R1', 'R2'],
            sectorsPerRegion: 2
        });
        expect(result.status).toBe('fail');
        expect(result.errors.map(error => error.code)).toContain('MRIO_DIMENSION_MISMATCH');
    });
});
