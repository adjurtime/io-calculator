/**
 * 矩阵运算工具模块
 * 使用 mathjs 进行核心数值计算
 */

import { create, all, Matrix } from 'mathjs';

// 创建 mathjs 实例
const math = create(all, {
    number: 'number',
    precision: 64
});

export interface MatrixInverseResult {
    matrix: number[][] | null;
    error: string | null;
    inverseResidual?: number;
    conditionEstimate?: number;
}

/**
 * 创建 n×n 单位矩阵
 */
export function identity(n: number): number[][] {
    const I: number[][] = [];
    for (let i = 0; i < n; i++) {
        I[i] = new Array(n).fill(0);
        I[i][i] = 1;
    }
    return I;
}

/**
 * 向量转对角矩阵
 */
export function diag(v: number[]): number[][] {
    const n = v.length;
    const D: number[][] = [];
    for (let i = 0; i < n; i++) {
        D[i] = new Array(n).fill(0);
        D[i][i] = v[i];
    }
    return D;
}

/**
 * 向量转对角逆矩阵
 * 对于 x[i] = 0 的情况，对角元素设为 0（而非报错）
 * 返回同时包含逆矩阵和零值索引列表
 */
export function diagInverse(v: number[]): { matrix: number[][]; zeroIndices: number[] } {
    const n = v.length;
    const D: number[][] = [];
    const zeroIndices: number[] = [];

    for (let i = 0; i < n; i++) {
        D[i] = new Array(n).fill(0);
        if (v[i] === 0 || Math.abs(v[i]) < 1e-15) {
            D[i][i] = 0;  // 零产出部门：系数设为 0
            zeroIndices.push(i);
        } else {
            D[i][i] = 1 / v[i];
        }
    }

    return { matrix: D, zeroIndices };
}

/**
 * 矩阵乘法 A × B
 */
export function matrixMultiply(A: number[][], B: number[][]): number[][] {
    const result = math.multiply(A, B);
    return matrixToArray(result);
}

/**
 * 矩阵与向量乘法 A × v
 */
export function matrixVectorMultiply(A: number[][], v: number[]): number[] {
    const result = math.multiply(A, v);
    const maybeMatrix = result as unknown as { toArray?: () => unknown };
    const raw: unknown = typeof maybeMatrix.toArray === 'function'
        ? maybeMatrix.toArray()
        : result;

    if (Array.isArray(raw) && raw.every(value => typeof value === 'number')) {
        return raw;
    }

    if (typeof raw === 'number') {
        return [raw];
    }

    throw new Error('矩阵与向量乘法返回了非一维结果');
}

/**
 * 矩阵减法 A - B
 */
export function matrixSubtract(A: number[][], B: number[][]): number[][] {
    const result = math.subtract(A, B);
    return matrixToArray(result);
}

/**
 * 矩阵加法 A + B
 */
export function matrixAdd(A: number[][], B: number[][]): number[][] {
    const result = math.add(A, B);
    return matrixToArray(result);
}

/**
 * 矩阵求逆
 * 返回逆矩阵或错误信息
 */
export function matrixInverse(A: number[][]): MatrixInverseResult {
    try {
        const n = A.length;
        if (n === 0 || A.some(row => row.length !== n)) {
            return {
                matrix: null,
                error: '矩阵必须是非空方阵'
            };
        }
        if (A.some(row => row.some(value => !Number.isFinite(value)))) {
            return {
                matrix: null,
                error: '矩阵包含 NaN 或 Infinity'
            };
        }

        const inv = math.inv(A);
        const inverse = matrixToArray(inv);

        if (inverse.some(row => row.some(value => !Number.isFinite(value)))) {
            return {
                matrix: null,
                error: '矩阵求逆产生了非有限数值'
            };
        }

        // 用 A·A⁻¹ 与单位矩阵的残差检查结果，避免以行列式绝对值误判
        // 尺度较小但条件良好的矩阵。
        const product = matrixMultiply(A, inverse);
        let maxResidual = 0;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                const expected = i === j ? 1 : 0;
                maxResidual = Math.max(maxResidual, Math.abs(product[i][j] - expected));
            }
        }

        const residualTolerance = 1e-8 * Math.max(1, n);
        if (!Number.isFinite(maxResidual) || maxResidual > residualTolerance) {
            return {
                matrix: null,
                error: `矩阵求逆残差过大（${maxResidual.toExponential(4)}）`
            };
        }

        const conditionEstimate = matrixInfinityNorm(A) * matrixInfinityNorm(inverse);
        return {
            matrix: inverse,
            error: null,
            inverseResidual: maxResidual,
            conditionEstimate
        };
    } catch (e) {
        return {
            matrix: null,
            error: `矩阵求逆失败：${e instanceof Error ? e.message : '未知错误'}`
        };
    }
}

function matrixInfinityNorm(matrix: number[][]): number {
    return matrix.reduce((max, row) => {
        const rowSum = row.reduce((sum, value) => sum + Math.abs(value), 0);
        return Math.max(max, rowSum);
    }, 0);
}

/**
 * 计算矩阵行列式
 */
export function determinant(A: number[][]): number {
    return math.det(A) as number;
}

/**
 * 检查矩阵是否奇异或接近奇异
 */
export function isSingular(A: number[][], tolerance: number = 1e-10): boolean {
    const det = Math.abs(determinant(A));
    return det < tolerance;
}

/**
 * 矩阵按行求和
 */
export function rowSum(A: number[][]): number[] {
    return A.map(row => row.reduce((sum, val) => sum + val, 0));
}

/**
 * 矩阵按列求和
 */
export function colSum(A: number[][]): number[] {
    if (A.length === 0) return [];
    const n = A[0].length;
    const sums = new Array(n).fill(0);
    for (const row of A) {
        for (let j = 0; j < n; j++) {
            sums[j] += row[j];
        }
    }
    return sums;
}

/**
 * 向量元素求和
 */
export function vectorSum(v: number[]): number {
    return v.reduce((sum, val) => sum + val, 0);
}

/**
 * 向量元素差
 */
export function vectorSubtract(a: number[], b: number[]): number[] {
    return a.map((val, i) => val - b[i]);
}

/**
 * 向量元素乘法（逐元素）
 */
export function vectorElementwiseMultiply(a: number[], b: number[]): number[] {
    return a.map((val, i) => val * b[i]);
}

/**
 * 将 mathjs Matrix 转换为二维数组
 */
function matrixToArray(m: Matrix | number[][] | number[] | number): number[][] {
    if (typeof m === 'number') {
        return [[m]];
    }
    if (Array.isArray(m)) {
        if (m.length === 0) return [];
        if (typeof m[0] === 'number') {
            return [m as number[]];
        }
        return m as number[][];
    }
    return m.toArray() as number[][];
}

/**
 * 获取矩阵维度
 */
export function getMatrixSize(A: number[][]): { rows: number; cols: number } {
    if (A.length === 0) return { rows: 0, cols: 0 };
    return { rows: A.length, cols: A[0].length };
}

/**
 * 检查矩阵是否为方阵
 */
export function isSquare(A: number[][]): boolean {
    const size = getMatrixSize(A);
    return size.rows === size.cols && size.rows > 0;
}

/**
 * 转置矩阵
 */
export function transpose(A: number[][]): number[][] {
    if (A.length === 0) return [];
    const rows = A.length;
    const cols = A[0].length;
    const result: number[][] = [];
    for (let j = 0; j < cols; j++) {
        result[j] = [];
        for (let i = 0; i < rows; i++) {
            result[j][i] = A[i][j];
        }
    }
    return result;
}

/**
 * 深拷贝矩阵
 */
export function cloneMatrix(A: number[][]): number[][] {
    return A.map(row => [...row]);
}

/**
 * 深拷贝向量
 */
export function cloneVector(v: number[]): number[] {
    return [...v];
}
