import { describe, expect, it } from 'vitest';
import { parseClipboardMatrix, parseNumericMatrix, parseNumericVector } from './fileIO';

describe('strict numeric parsing', () => {
    it('preserves an empty pasted cell and reports its original coordinate', () => {
        const clipboard = parseClipboardMatrix('1\t\t3\n4\t5\t6');
        expect(clipboard.data[0]).toEqual(['1', '', '3']);

        const parsed = parseNumericMatrix(clipboard.data);
        expect(parsed.matrix[0]).toHaveLength(3);
        expect(Number.isNaN(parsed.matrix[0][1])).toBe(true);
        expect(parsed.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ row: 1, column: 2, message: '单元格为空' })
        ]));
    });

    it('rejects partial numbers instead of silently accepting parseFloat prefixes', () => {
        const parsed = parseNumericMatrix([['12abc']]);
        expect(parsed.errors[0].message).toBe('不是有限数值');
    });

    it('reads a row-labelled x sheet as a vector', () => {
        const parsed = parseNumericVector([
            ['sector', 'x'],
            ['A', '100'],
            ['B', '200']
        ], true);

        expect(parsed.errors).toEqual([]);
        expect(parsed.rowNames).toEqual(['A', 'B']);
        expect(parsed.vector).toEqual([100, 200]);
    });

    it('preserves every value in a header-labelled row vector without a row label', () => {
        const parsed = parseNumericVector([
            ['A', 'B'],
            ['100', '200']
        ], true);

        expect(parsed.errors).toEqual([]);
        expect(parsed.vector).toEqual([100, 200]);
    });

    it('rejects a two-dimensional x table', () => {
        const parsed = parseNumericVector([
            ['1', '2'],
            ['3', '4']
        ]);
        expect(parsed.vector).toEqual([]);
        expect(parsed.errors.map(error => error.message)).toContain('总产出 x 必须是一行或一列');
    });
});
