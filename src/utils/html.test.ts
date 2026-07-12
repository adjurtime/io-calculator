import { describe, expect, it } from 'vitest';
import { escapeHTML } from './html';

describe('escapeHTML', () => {
    it('escapes markup and attribute delimiters', () => {
        expect(escapeHTML('<img src=x onerror="alert(1)">')).toBe(
            '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
        );
        expect(escapeHTML("O'Reilly & Co.")).toBe('O&#39;Reilly &amp; Co.');
    });
});
