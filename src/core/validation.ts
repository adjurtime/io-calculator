/**
 * 数据校验模块
 * 对 IO 数据进行维度、会计恒等式、非负性等校验
 */

import type { IOData, ValidationResult, ValidationError } from '../types/io';
import { getMatrixSize, isSquare, rowSum, colSum, vectorSubtract } from './matrix';

/**
 * 执行完整的数据校验
 */
export function validateIOData(data: IOData, tolerance: number = 1e-6): ValidationResult {
    const errors: ValidationError[] = [];
    const stats: ValidationResult['stats'] = {};

    const n = data.x.length;

    // 1. 维度校验
    validateDimensions(data, n, errors);

    // 2. 零产出部门检测
    const zeroOutputSectors = detectZeroOutput(data.x);
    if (zeroOutputSectors.length > 0) {
        stats.zeroOutputSectors = zeroOutputSectors;
        const sectorNames = zeroOutputSectors.map(i =>
            data.sectorNames?.[i] || `部门${i + 1}`
        ).join('、');
        errors.push({
            code: 'ZERO_OUTPUT',
            severity: 'warning',
            message: `检测到 ${zeroOutputSectors.length} 个零产出部门`,
            details: `部门：${sectorNames}。计算系数时这些部门的值将自动设为 0。`,
            affectedSectors: zeroOutputSectors
        });
    }

    // 3. 非负性检查
    const negativeCheck = checkNonNegativity(data);
    if (negativeCheck.hasNegative) {
        stats.negativeSectors = negativeCheck.sectors;
        errors.push({
            code: 'NEGATIVE_VALUES',
            severity: 'warning',
            message: `检测到负值`,
            details: negativeCheck.details,
            affectedSectors: negativeCheck.sectors
        });
    }

    // 4. 会计恒等式校验
    const balanceCheck = checkAccountingIdentity(data, tolerance);
    if (balanceCheck.errors.length > 0) {
        errors.push(...balanceCheck.errors);
        if (balanceCheck.maxError !== undefined) {
            stats.maxError = balanceCheck.maxError;
            stats.meanError = balanceCheck.meanError;
        }
    }

    // 判断最终状态
    const hasErrors = errors.some(e => e.severity === 'error');
    const hasWarnings = errors.some(e => e.severity === 'warning');

    let status: 'pass' | 'warning' | 'fail';
    let summary: string;

    if (hasErrors) {
        status = 'fail';
        summary = `校验失败：发现 ${errors.filter(e => e.severity === 'error').length} 个错误`;
    } else if (hasWarnings) {
        status = 'warning';
        summary = `校验通过（有警告）：发现 ${errors.filter(e => e.severity === 'warning').length} 个警告`;
    } else {
        status = 'pass';
        summary = '校验通过：所有检查项均正常';
    }

    return { status, errors, summary, stats };
}

/**
 * 维度校验
 */
function validateDimensions(data: IOData, n: number, errors: ValidationError[]): void {
    // Z 矩阵必须是 n×n
    if (!isSquare(data.Z)) {
        const size = getMatrixSize(data.Z);
        errors.push({
            code: 'Z_NOT_SQUARE',
            severity: 'error',
            message: `Z 矩阵不是方阵`,
            details: `Z 维度为 ${size.rows}×${size.cols}，但应为 ${n}×${n}`
        });
    } else if (data.Z.length !== n) {
        errors.push({
            code: 'Z_X_MISMATCH',
            severity: 'error',
            message: `Z 矩阵与 x 向量维度不匹配`,
            details: `Z 维度为 ${data.Z.length}×${data.Z.length}，x 长度为 ${n}`
        });
    }

    // Y 矩阵（如提供）必须是 n×k
    if (data.Y) {
        const ySize = getMatrixSize(data.Y);
        if (ySize.rows !== n) {
            errors.push({
                code: 'Y_ROWS_MISMATCH',
                severity: 'error',
                message: `Y 矩阵行数与部门数不匹配`,
                details: `Y 有 ${ySize.rows} 行，但应有 ${n} 行（与 x 一致）`
            });
        }
    }

    // VA 增加值（如提供）必须是 1×n 或 m×n
    if (data.VA) {
        const vaSize = getMatrixSize(data.VA);
        if (vaSize.cols !== n) {
            errors.push({
                code: 'VA_COLS_MISMATCH',
                severity: 'error',
                message: `VA 增加值列数与部门数不匹配`,
                details: `VA 有 ${vaSize.cols} 列，但应有 ${n} 列（与 x 一致）`
            });
        }
    }

    // F 卫星账户（如提供）必须是 p×n
    if (data.F) {
        const fSize = getMatrixSize(data.F);
        if (fSize.cols !== n) {
            errors.push({
                code: 'F_COLS_MISMATCH',
                severity: 'error',
                message: `F 卫星账户列数与部门数不匹配`,
                details: `F 有 ${fSize.cols} 列，但应有 ${n} 列（与 x 一致）`
            });
        }
    }
}

/**
 * 检测零产出部门
 */
function detectZeroOutput(x: number[]): number[] {
    const zeroSectors: number[] = [];
    for (let i = 0; i < x.length; i++) {
        if (x[i] === 0 || Math.abs(x[i]) < 1e-15) {
            zeroSectors.push(i);
        }
    }
    return zeroSectors;
}

/**
 * 非负性检查
 */
/**
 * 非负性检查
 */
function checkNonNegativity(data: IOData): {
    hasNegative: boolean;
    sectors: number[];
    details: string
} {
    const negativeDetails: string[] = [];
    const sectors = new Set<number>();

    // 检查 Z 矩阵
    let zNegCount = 0;
    const zNegCoords: string[] = [];
    for (let i = 0; i < data.Z.length; i++) {
        for (let j = 0; j < data.Z[i].length; j++) {
            if (data.Z[i][j] < 0) {
                sectors.add(i);
                sectors.add(j);
                zNegCount++;
                if (zNegCoords.length < 5) {
                    const rowName = data.sectorNames?.[i] || `行${i + 1}`;
                    const colName = data.sectorNames?.[j] || `列${j + 1}`;
                    zNegCoords.push(`${rowName}→${colName} (${data.Z[i][j]})`);
                }
            }
        }
    }
    if (zNegCount > 0) {
        negativeDetails.push(`Z 矩阵中存在 ${zNegCount} 个负值，例如：${zNegCoords.join('、')}${zNegCount > 5 ? '等' : ''}`);
    }

    // 检查 x 向量
    const negX = data.x.map((v, i) => ({ v, i })).filter(d => d.v < 0);
    if (negX.length > 0) {
        const xDetails = negX.slice(0, 5).map(d => `${data.sectorNames?.[d.i] || `部门${d.i + 1}`} (${d.v})`).join('、');
        negativeDetails.push(`x 向量中有 ${negX.length} 个负值：${xDetails}${negX.length > 5 ? '等' : ''}`);
        negX.forEach(d => sectors.add(d.i));
    }

    // 检查 Y（如提供）
    if (data.Y) {
        let yNegCount = 0;
        const yNegCoords: string[] = [];
        for (let i = 0; i < data.Y.length; i++) {
            for (let j = 0; j < data.Y[i].length; j++) {
                if (data.Y[i][j] < 0) {
                    yNegCount++;
                    if (yNegCoords.length < 3) {
                        const rowName = data.sectorNames?.[i] || `部门${i + 1}`;
                        const colName = data.finalDemandNames?.[j] || `列${j + 1}`;
                        yNegCoords.push(`${rowName}→${colName} (${data.Y[i][j]})`);
                    }
                }
            }
        }
        if (yNegCount > 0) {
            negativeDetails.push(`Y 矩阵中存在 ${yNegCount} 个负值（可能是存货减少）：${yNegCoords.join('、')}${yNegCount > 3 ? '等' : ''}`);
        }
    }

    return {
        hasNegative: negativeDetails.length > 0,
        sectors: Array.from(sectors),
        details: negativeDetails.join('\n')
    };
}

/**
 * 会计恒等式校验
 */
function checkAccountingIdentity(
    data: IOData,
    tolerance: number
): { errors: ValidationError[]; maxError?: number; meanError?: number } {
    const errors: ValidationError[] = [];
    let maxError: number | undefined;
    let meanError: number | undefined;

    const n = data.x.length;

    // 产出平衡检验: x ≈ rowSum(Z) + y
    if (data.Y) {
        const zRowSum = rowSum(data.Z);
        const yVector = data.Y.map(row => row.reduce((s, v) => s + v, 0)); // 合并最终需求列

        const expectedX = zRowSum.map((z, i) => z + yVector[i]);
        const diff = vectorSubtract(data.x, expectedX);
        const absDiff = diff.map(Math.abs);

        maxError = Math.max(...absDiff);
        meanError = absDiff.reduce((s, v) => s + v, 0) / n;

        // 计算相对误差
        const relErrors = absDiff.map((d, i) => ({
            idx: i,
            abs: d,
            rel: data.x[i] !== 0 ? d / Math.abs(data.x[i]) : d
        }));

        const failingSectors = relErrors
            .filter(e => e.rel > tolerance)
            .sort((a, b) => b.rel - a.rel);

        if (failingSectors.length > 0) {
            const top5 = failingSectors.slice(0, 5);
            const detailText = top5.map(e => {
                const name = data.sectorNames?.[e.idx] || `部门${e.idx + 1}`;
                return `${name}: ${(e.rel * 100).toFixed(4)}% (差值 ${diff[e.idx].toFixed(4)})`;
            }).join('\n');

            errors.push({
                code: 'OUTPUT_BALANCE_ERROR',
                severity: 'warning',
                message: `产出平衡校验未通过（${failingSectors.length} 个部门误差 > ${(tolerance * 100)}%）`,
                details: `x ≠ Z·1 + y。误差最大的前 5 个部门：\n${detailText}${failingSectors.length > 5 ? '\n...' : ''}`,
                affectedSectors: failingSectors.map(e => e.idx)
            });
        }
    }

    // 增加值恒等式检验: x ≈ colSum(Z) + VA
    if (data.VA) {
        const zColSum = colSum(data.Z);
        const vaTotal = data.VA.length === 1
            ? data.VA[0]
            : colSum(data.VA); // 多行增加值取列和

        const expectedX = zColSum.map((z, i) => z + vaTotal[i]);
        const diff = vectorSubtract(data.x, expectedX);
        const absDiff = diff.map(Math.abs);

        const vaMaxError = Math.max(...absDiff);
        const vaMeanError = absDiff.reduce((s, v) => s + v, 0) / n;

        // 使用相对误差
        const relErrors = absDiff.map((d, i) => ({
            idx: i,
            abs: d,
            rel: data.x[i] !== 0 ? d / Math.abs(data.x[i]) : d
        }));

        const failingSectors = relErrors
            .filter(e => e.rel > tolerance)
            .sort((a, b) => b.rel - a.rel);

        if (failingSectors.length > 0) {
            const top5 = failingSectors.slice(0, 5);
            const detailText = top5.map(e => {
                const name = data.sectorNames?.[e.idx] || `部门${e.idx + 1}`;
                return `${name}: ${(e.rel * 100).toFixed(4)}% (差值 ${diff[e.idx].toFixed(4)})`;
            }).join('\n');

            errors.push({
                code: 'VA_BALANCE_ERROR',
                severity: 'warning',
                message: `增加值恒等式校验未通过（${failingSectors.length} 个部门误差 > ${(tolerance * 100)}%）`,
                details: `x ≠ 1'·Z + VA。误差最大的前 5 个部门：\n${detailText}${failingSectors.length > 5 ? '\n...' : ''}`,
                affectedSectors: failingSectors.map(e => e.idx)
            });
        }

        // 更新统计（取较大值）
        if (maxError === undefined || vaMaxError > maxError) {
            maxError = vaMaxError;
            meanError = vaMeanError;
        }
    }

    return { errors, maxError, meanError };
}
