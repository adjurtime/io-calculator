/**
 * 文件导入模块
 * 支持 Excel（.xlsx）和 CSV 文件读取
 */

import * as XLSX from 'xlsx';
import type { IOData } from '../types/io';

/**
 * 读取 Excel 文件
 */
export async function readExcelFile(file: File): Promise<{
    sheets: { name: string; data: string[][] }[];
    error?: string;
}> {
    try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });

        const sheets = workbook.SheetNames.map(name => {
            const worksheet = workbook.Sheets[name];
            const data = XLSX.utils.sheet_to_json<string[]>(worksheet, {
                header: 1,
                defval: ''
            });
            return { name, data: data as string[][] };
        });

        return { sheets };
    } catch (e) {
        return {
            sheets: [],
            error: `Excel 文件读取失败：${e instanceof Error ? e.message : '未知错误'}`
        };
    }
}

/**
 * 读取 CSV 文件
 */
export async function readCSVFile(file: File): Promise<{
    data: string[][];
    error?: string;
}> {
    try {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(line => line.trim());
        const data = lines.map(line => parseCSVLine(line));
        return { data };
    } catch (e) {
        return {
            data: [],
            error: `CSV 文件读取失败：${e instanceof Error ? e.message : '未知错误'}`
        };
    }
}

/**
 * 读取 TXT 纯文本文件
 * 自动检测分隔符（Tab、空格、逗号、分号）
 */
export async function readTXTFile(file: File): Promise<{
    data: string[][];
    delimiter: string;
    error?: string;
}> {
    try {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(line => line.trim());

        if (lines.length === 0) {
            return { data: [], delimiter: 'unknown', error: '文件为空' };
        }

        // 智能检测分隔符
        const firstLine = lines[0];
        let delimiter: string;
        let delimiterName: string;

        if (firstLine.includes('\t')) {
            delimiter = '\t';
            delimiterName = 'Tab';
        } else if (firstLine.includes(';')) {
            delimiter = ';';
            delimiterName = '分号';
        } else if (firstLine.includes(',')) {
            delimiter = ',';
            delimiterName = '逗号';
        } else {
            // 空格分隔（可能是多个空格）
            delimiter = 'space';
            delimiterName = '空格';
        }

        const data = lines.map(line => {
            if (delimiter === 'space') {
                return line.trim().split(/\s+/);
            }
            return line.split(delimiter).map(s => s.trim());
        });

        return { data, delimiter: delimiterName };
    } catch (e) {
        return {
            data: [],
            delimiter: 'unknown',
            error: `TXT 文件读取失败：${e instanceof Error ? e.message : '未知错误'}`
        };
    }
}

/**
 * 读取 MATLAB .mat 文件
 * 支持 MAT-file v4/v5 格式（基础矩阵数据）
 * 注意：不支持 v7.3 (HDF5) 格式
 */
export async function readMATFile(file: File): Promise<{
    variables: { name: string; data: number[][] }[];
    error?: string;
}> {
    try {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        // 检查文件头
        const header = new TextDecoder().decode(bytes.slice(0, 116));

        // 检查是否是 HDF5 格式 (MAT v7.3)
        // HDF5 文件以 "\x89HDF\r\n\x1a\n" 开头
        if (bytes[0] === 0x89 && bytes[1] === 0x48 && bytes[2] === 0x44 && bytes[3] === 0x46) {
            return {
                variables: [],
                error: '此文件是 MAT v7.3 (HDF5) 格式，当前不支持。请在 MATLAB 中使用以下命令重新保存：\nsave(\'filename.mat\', \'-v7\')'
            };
        }

        if (header.startsWith('MATLAB')) {
            // MAT-file v5 格式
            // 获取版本信息
            const version = new DataView(buffer).getUint16(124, true);
            console.log(`MAT 文件版本: 0x${version.toString(16)}, 大小: ${buffer.byteLength} bytes`);

            return parseMATv5(buffer);
        } else {
            // 可能是 MAT-file v4 或文本格式
            // 尝试作为纯文本解析
            const text = new TextDecoder().decode(bytes);
            if (/^[\d\s.\-+eE,;\t\r\n]+$/.test(text.trim())) {
                // 全是数字，当作文本矩阵处理
                const txtResult = await readTXTFile(file);
                if (txtResult.data.length > 0) {
                    const matrix = txtResult.data.map(row =>
                        row.map(v => parseFloat(v) || 0)
                    );
                    return { variables: [{ name: 'matrix', data: matrix }] };
                }
            }
            return { variables: [], error: '不支持的 MAT 文件格式，请使用 MAT-file v5/v7 或导出为 TXT/CSV' };
        }
    } catch (e) {
        return {
            variables: [],
            error: `MAT 文件读取失败：${e instanceof Error ? e.message : '未知错误'}`
        };
    }
}

/**
 * 解析 MAT-file v5 格式
 * 支持标准和小数据元素格式
 */
function parseMATv5(buffer: ArrayBuffer): {
    variables: { name: string; data: number[][] }[];
    error?: string;
} {
    const variables: { name: string; data: number[][] }[] = [];
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // 辅助函数：读取数据元素标签（处理小数据元素格式）
    function readTag(offset: number): { type: number; bytes: number; dataOffset: number; totalSize: number } {
        const first4 = view.getUint32(offset, true);

        // 检查是否是小数据元素格式（高16位非零表示数据字节数）
        const highBytes = (first4 >> 16) & 0xFFFF;
        if (highBytes !== 0) {
            // 小数据元素：类型在低16位，数据紧跟在同一个8字节块内
            return {
                type: first4 & 0xFFFF,
                bytes: highBytes,
                dataOffset: offset + 4,
                totalSize: 8
            };
        } else {
            // 标准格式：8字节标签
            const numBytes = view.getUint32(offset + 4, true);
            const paddedBytes = Math.ceil(numBytes / 8) * 8;
            return {
                type: first4,
                bytes: numBytes,
                dataOffset: offset + 8,
                totalSize: 8 + paddedBytes
            };
        }
    }

    // 辅助函数：读取数值数组
    function readNumericArray(dataOffset: number, numElements: number, dataType: number): number[] {
        const result: number[] = [];
        let off = dataOffset;

        for (let i = 0; i < numElements; i++) {
            let val = 0;
            switch (dataType) {
                case 1: val = new Int8Array(buffer, off, 1)[0]; off += 1; break;
                case 2: val = bytes[off]; off += 1; break;
                case 3: val = view.getInt16(off, true); off += 2; break;
                case 4: val = view.getUint16(off, true); off += 2; break;
                case 5: val = view.getInt32(off, true); off += 4; break;
                case 6: val = view.getUint32(off, true); off += 4; break;
                case 7: val = view.getFloat32(off, true); off += 4; break;
                case 9: val = view.getFloat64(off, true); off += 8; break;
                case 12: val = Number(view.getBigInt64(off, true)); off += 8; break;
                case 13: val = Number(view.getBigUint64(off, true)); off += 8; break;
                default: off += 1; break;
            }
            result.push(val);
        }
        return result;
    }

    try {
        // 跳过 128 字节头
        let offset = 128;
        let matrixCount = 0;

        while (offset < buffer.byteLength - 8) {
            const tag = readTag(offset);

            if (tag.type === 14) { // miMATRIX
                matrixCount++;
                const matrixStart = offset + 8;
                const matrixEnd = matrixStart + tag.bytes;
                let pos = matrixStart;

                try {
                    // 1. Array Flags (16 bytes fixed)
                    pos += 16;

                    // 2. Dimensions Array
                    const dimTag = readTag(pos);
                    pos = dimTag.dataOffset;
                    const rows = view.getUint32(pos, true);
                    const cols = view.getUint32(pos + 4, true);
                    pos = matrixStart + 16 + dimTag.totalSize;

                    // 3. Array Name
                    const nameTag = readTag(pos);
                    let name = '';
                    if (nameTag.bytes > 0) {
                        const nameBytes = new Uint8Array(buffer, nameTag.dataOffset, nameTag.bytes);
                        name = new TextDecoder().decode(nameBytes).replace(/\0+$/, '');
                    }
                    pos = matrixStart + 16 + dimTag.totalSize + nameTag.totalSize;

                    // 4. Real Part (pr)
                    if (pos < matrixEnd) {
                        const prTag = readTag(pos);
                        const numElements = rows * cols;

                        if (prTag.type >= 1 && prTag.type <= 13 && prTag.type !== 8 && prTag.type !== 10 && prTag.type !== 11) {
                            const values = readNumericArray(prTag.dataOffset, numElements, prTag.type);

                            // 转换为二维数组（MATLAB是列优先）
                            const matrix: number[][] = [];
                            for (let i = 0; i < rows; i++) {
                                matrix.push([]);
                                for (let j = 0; j < cols; j++) {
                                    matrix[i].push(values[j * rows + i]);
                                }
                            }

                            variables.push({ name: name || `var${variables.length + 1}`, data: matrix });
                            console.log(`成功解析变量: ${name}, 维度: ${rows}×${cols}`);
                        }
                    }
                } catch (innerErr) {
                    console.warn(`解析矩阵 #${matrixCount} 失败:`, innerErr);
                }

                offset = matrixEnd + 8;
            } else if (tag.type === 15) { // miCOMPRESSED
                console.warn('检测到压缩数据，暂不支持。请用 save(..., \'-v7\') 不带 \'-nocompression\' 保存');
                offset += tag.totalSize;
            } else {
                offset += tag.totalSize;
            }

            // 确保 8 字节对齐
            offset = Math.ceil(offset / 8) * 8;
        }

        console.log(`MAT 解析完成: 找到 ${matrixCount} 个矩阵块, 成功解析 ${variables.length} 个变量`);

        if (variables.length === 0) {
            return {
                variables: [],
                error: `MAT 文件解析失败：找到 ${matrixCount} 个数据块但无法解析。请尝试在 MATLAB 中执行：save('output.mat', '-v6')`
            };
        }

        return { variables };
    } catch (e) {
        console.error('MAT 解析错误:', e);
        return {
            variables: [],
            error: `MAT 文件解析失败：${e instanceof Error ? e.message : '格式不兼容'}`
        };
    }
}

/**
 * 通用文件读取入口
 * 根据扩展名自动选择解析方式
 */
export async function readMatrixFile(file: File): Promise<{
    matrices: { name: string; data: number[][] }[];
    sectorNames?: string[];
    regions?: string[];
    sectorsPerRegion?: number;
    error?: string;
}> {
    const ext = file.name.toLowerCase().split('.').pop() || '';

    // 是否需要解析区域（简单策略：MRIO 模式下总是尝试解析）
    // 这里我们传入一个 options 对象或者简单扩展参数
    // 为保持 API 兼容，我们假设调用者知道如何处理结果
    // MRIO 配置现在由用户手动输入，不再自动解析

    switch (ext) {
        case 'xlsx':
        case 'xls': {
            const result = await readExcelFile(file);
            if (result.error) return { matrices: [], error: result.error };

            const matrices = result.sheets.map(sheet => {
                const parsed = parseNumericMatrix(sheet.data, true, true);
                return {
                    name: sheet.name,
                    data: parsed.matrix
                };
            });
            return { matrices };
        }

        case 'csv': {
            const result = await readCSVFile(file);
            if (result.error) return { matrices: [], error: result.error };

            const parsed = parseNumericMatrix(result.data, true, true);
            return {
                matrices: [{ name: file.name.replace('.csv', ''), data: parsed.matrix }],
                sectorNames: parsed.rowNames
            };
        }

        case 'txt':
        case 'dat': {
            const result = await readTXTFile(file);
            if (result.error) return { matrices: [], error: result.error };

            const parsed = parseNumericMatrix(result.data, false, false);
            return {
                matrices: [{ name: file.name.replace(/\.(txt|dat)$/, ''), data: parsed.matrix }]
            };
        }

        case 'mat': {
            const result = await readMATFile(file);
            if (result.error) return { matrices: [], error: result.error };

            return { matrices: result.variables };
        }

        default:
            return { matrices: [], error: `不支持的文件格式: .${ext}` };
    }
}

/**
 * 解析 CSV 行（处理引号和逗号）
 */
function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    result.push(current.trim());
    return result;
}

/**
 * 将字符串二维数组转换为数值矩阵
 * 支持跳过标题行/列
 */
export function parseNumericMatrix(
    data: string[][],
    skipFirstRow: boolean = false,
    skipFirstCol: boolean = false
): {
    matrix: number[][];
    rowNames?: string[];
    colNames?: string[];
} {
    if (data.length === 0) {
        return { matrix: [] };
    }

    let startRow = skipFirstRow ? 1 : 0;
    let startCol = skipFirstCol ? 1 : 0;

    // 提取名称
    let colNames: string[] | undefined;
    let rowNames: string[] | undefined;

    if (skipFirstRow && data.length > 0) {
        colNames = data[0].slice(startCol);
    }

    if (skipFirstCol) {
        rowNames = [];
        for (let i = startRow; i < data.length; i++) {
            rowNames.push(data[i][0] || `行${i - startRow + 1}`);
        }
    }

    // 解析数值
    const matrix: number[][] = [];
    for (let i = startRow; i < data.length; i++) {
        const row: number[] = [];
        for (let j = startCol; j < data[i].length; j++) {
            const val = parseFloat(data[i][j]);
            row.push(isNaN(val) ? 0 : val);
        }
        matrix.push(row);
    }

    // 注意：不再自动转置向量
    // 不同的 IO 数据类型有不同的格式要求：
    // - Y (最终需求): n×m (n行, m列)
    // - VA (增加值): m×n (m行, n列)
    // - x (总产出): n×1 或 1×n 均可
    // 格式转换应该由调用者根据数据类型决定
    // 
    // MRIO 区域配置现在由用户手动输入，不再自动解析

    return { matrix, rowNames, colNames };
}



/**
 * 从粘贴的文本解析矩阵
 * 支持 Tab 分隔（从 Excel 粘贴）和空格分隔
 */
export function parseClipboardMatrix(text: string): {
    data: string[][];
    delimiter: 'tab' | 'comma' | 'space';
} {
    const lines = text.trim().split(/\r?\n/);

    // 检测分隔符
    const firstLine = lines[0] || '';
    let delimiter: 'tab' | 'comma' | 'space' = 'tab';

    if (firstLine.includes('\t')) {
        delimiter = 'tab';
    } else if (firstLine.includes(',')) {
        delimiter = 'comma';
    } else {
        delimiter = 'space';
    }

    const data = lines.map(line => {
        let values: string[];
        switch (delimiter) {
            case 'tab':
                values = line.split('\t');
                break;
            case 'comma':
                values = parseCSVLine(line);
                break;
            case 'space':
                values = line.trim().split(/\s+/);
                break;
        }
        // 过滤空值和空白字符串，避免误识别
        return values.filter(v => v.trim().length > 0);
    });

    return { data, delimiter };
}

/**
 * 自动检测并解析 IO 数据
 * 根据 sheet 名称或维度推断数据类型
 */
export function autoParseIOData(
    sheets: { name: string; data: string[][] }[]
): Partial<IOData> & { warnings: string[] } {
    const result: Partial<IOData> = {};
    const warnings: string[] = [];

    // 常见的 sheet 名称映射
    const sheetNamePatterns: Record<string, keyof IOData> = {
        'z': 'Z',
        'intermediate': 'Z',
        '中间投入': 'Z',
        '中间消耗': 'Z',
        'x': 'x',
        'output': 'x',
        '总产出': 'x',
        'y': 'Y',
        'final': 'Y',
        '最终需求': 'Y',
        'va': 'VA',
        'value': 'VA',
        '增加值': 'VA',
        'f': 'F',
        'satellite': 'F',
        '卫星账户': 'F',
        '排放': 'F',
        'emission': 'F'
    };

    for (const sheet of sheets) {
        const nameLower = sheet.name.toLowerCase().trim();
        let matched = false;

        for (const [pattern, field] of Object.entries(sheetNamePatterns)) {
            if (nameLower.includes(pattern)) {
                // 尝试解析
                const parsed = parseNumericMatrix(sheet.data, true, field !== 'x');

                if (field === 'x') {
                    // x 向量处理逻辑...
                    if (parsed.matrix.length > 0) {
                        if (parsed.matrix[0].length === 1) {
                            result.x = parsed.matrix.map(row => row[0]);
                        } else if (parsed.matrix.length === 1) {
                            result.x = parsed.matrix[0];
                        } else {
                            // 歧义处理...
                            warnings.push(`'${sheet.name}' sheet 维度不明确，默认取第一列作为总产出向量`);
                            result.x = parsed.matrix.map(row => row[0]);
                        }
                    }
                } else {
                    (result as Record<string, unknown>)[field] = parsed.matrix;
                }

                if (parsed.rowNames && field === 'Z') {
                    result.sectorNames = parsed.rowNames;
                }

                // MRIO 信息现在由用户手动配置，不再自动检测

                matched = true;
                break;
            }
        }

        if (!matched) {
            warnings.push(`未识别的 sheet '${sheet.name}'，已跳过`);
        }
    }

    return { ...result, warnings };
}

/**
 * 创建示例 IO 数据（用于演示）
 */
export function createSampleIOData(): IOData {
    // 3 部门示例
    const sectorNames = ['农业', '工业', '服务业'];

    const Z = [
        [150, 500, 200],
        [200, 1000, 350],
        [100, 400, 250]
    ];

    const x = [1000, 2500, 1200];

    const Y = [
        [150],
        [950],
        [450]
    ];

    const VA = [[550, 600, 400]];

    // 碳排放（示例：吨）
    const F = [[80, 350, 50]];

    return {
        Z,
        x,
        Y,
        VA,
        F,
        sectorNames,
        finalDemandNames: ['最终消费'],
        valueAddedNames: ['增加值合计'],
        satelliteNames: ['碳排放 (t)'],
        metadata: {
            name: '示例投入产出表',
            year: 2020,
            region: '示例区域',
            unit: '万元',
            currency: 'CNY',
            priceType: '当年价',
            importType: 'competitive'
        }
    };
}
