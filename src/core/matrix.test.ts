import { describe, expect, it } from 'vitest';
import { identity, matrixInverse } from './matrix';

describe('matrixInverse', () => {
    it('does not reject a well-conditioned scaled matrix because its determinant is small', () => {
        const scaledIdentity = identity(40).map(row => row.map(value => value * 0.5));
        const result = matrixInverse(scaledIdentity);

        expect(result.error).toBeNull();
        expect(result.matrix?.[0][0]).toBeCloseTo(2, 12);
        expect(result.matrix?.[39][39]).toBeCloseTo(2, 12);
    });

    it('rejects a singular matrix', () => {
        const result = matrixInverse([[1, 2], [2, 4]]);
        expect(result.matrix).toBeNull();
        expect(result.error).toContain('矩阵求逆失败');
    });
});
