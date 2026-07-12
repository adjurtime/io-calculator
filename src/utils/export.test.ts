import { describe, expect, it } from 'vitest';
import { escapeCSVCell } from './export';

describe('escapeCSVCell', () => {
    it('neutralizes spreadsheet formulas', () => {
        expect(escapeCSVCell('=1+1')).toBe("'=1+1");
        expect(escapeCSVCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    });

    it('quotes commas, quotes, and newlines', () => {
        expect(escapeCSVCell('A,"B"')).toBe('"A,""B"""');
        expect(escapeCSVCell('A\nB')).toBe('"A\nB"');
    });
});
