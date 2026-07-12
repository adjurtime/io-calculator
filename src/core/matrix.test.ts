import { describe, expect, it } from 'vitest';
import { identity, matrixInverse, matrixSolve } from './matrix';

describe('matrixInverse', () => {
    it('does not reject a well-conditioned scaled matrix because its determinant is small', () => {
        const scaledIdentity = identity(40).map(row => row.map(value => value * 0.5));
        const result = matrixInverse(scaledIdentity);

        expect(result.error).toBeNull();
        expect(result.matrix?.[0][0]).toBeCloseTo(2, 12);
        expect(result.matrix?.[39][39]).toBeCloseTo(2, 12);
        expect(result.conditionEstimate).toBeCloseTo(1, 12);
        expect(result.inverseResidual).toBeCloseTo(0, 12);
    });

    it('rejects a singular matrix', () => {
        const result = matrixInverse([[1, 2], [2, 4]]);
        expect(result.matrix).toBeNull();
        expect(result.error).toContain('矩阵求逆失败');
    });
});

describe('matrixSolve', () => {
    it('solves multiple right-hand sides without constructing an inverse', () => {
        const result = matrixSolve(
            [[3, 1], [1, 2]],
            [[9, 1], [8, 0]]
        );

        expect(result.error).toBeNull();
        expect(result.matrix?.[0][0]).toBeCloseTo(2, 12);
        expect(result.matrix?.[1][0]).toBeCloseTo(3, 12);
        expect(result.matrix?.[0][1]).toBeCloseTo(0.4, 12);
        expect(result.matrix?.[1][1]).toBeCloseTo(-0.2, 12);
        expect(result.solveResidual).toBeLessThan(1e-12);
    });

    it('rejects a singular system', () => {
        const result = matrixSolve([[1, 2], [2, 4]], [[1], [2]]);
        expect(result.matrix).toBeNull();
        expect(result.error).toContain('奇异');
    });

    it('does not reject a well-conditioned system only because its scale is small', () => {
        const result = matrixSolve(
            [[1e-20, 0], [0, 1e-20]],
            [[1e-20], [2e-20]]
        );
        expect(result.error).toBeNull();
        expect(result.matrix?.map(row => row[0])).toEqual([
            expect.closeTo(1, 12),
            expect.closeTo(2, 12)
        ]);
    });
});
