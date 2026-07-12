/**
 * IO 指标计算引擎
 * 实现直接消耗系数、Leontief逆、增加值系数、卫星账户扩展等计算
 */

import type {
    IOData,
    CalculationConfig,
    CalculationResults,
    CalculationError
} from '../types/io';
import {
    identity,
    diagInverse,
    matrixMultiply,
    matrixSubtract,
    matrixInverse,
    matrixSolve,
    rowSum,
    colSum
} from './matrix';
import { validateIOData } from './validation';
import { CONDITION_WARNING_THRESHOLD } from './limits';

/**
 * 执行 IO 指标计算
 */
export function calculateIOIndicators(
    data: IOData,
    config: CalculationConfig
): { results: CalculationResults; errors: CalculationError[] } {
    const results: CalculationResults = {
        timestamp: new Date().toISOString(),
        config
    };
    const errors: CalculationError[] = [];

    const validation = validateIOData(data, config.tolerance);
    if (validation.status === 'fail') {
        return {
            results,
            errors: validation.errors
                .filter(error => error.severity === 'error')
                .map(error => ({
                    code: error.code,
                    message: error.message,
                    details: error.details,
                    severity: 'error'
                }))
        };
    }

    if (config.computeFootprint && data.F && !data.Y) {
        return {
            results,
            errors: [{
                code: 'FOOTPRINT_REQUIRES_FINAL_DEMAND',
                message: '计算最终需求足迹必须提供 Y 矩阵',
                severity: 'error'
            }]
        };
    }

    const n = data.x.length;

    // 计算 diag(x)^{-1}，处理零产出部门
    const { matrix: xInvDiag, zeroIndices } = diagInverse(data.x);

    // 零产出已由 validateIOData 作为阻断错误处理。保留返回值只用于
    // 防止未来调用者绕过校验时静默除零。
    if (zeroIndices.length > 0) {
        return {
            results,
            errors: [{
                code: 'ZERO_OUTPUT',
                message: '总产出向量包含零值，计算已停止',
                severity: 'error'
            }]
        };
    }

    // 1. 直接消耗系数 A = Z · diag(x)^{-1}
    let A: number[][] | undefined;
    if (config.computeA || config.computeL || config.computeM || config.computeFootprint || config.computeLinkage) {
        A = matrixMultiply(data.Z, xInvDiag);
        if (config.computeA) {
            results.A = A;
        }
    }

    // 2. 分配系数 B = diag(x)^{-1} · Z
    if (config.computeB) {
        results.B = matrixMultiply(xInvDiag, data.Z);
    }

    // 3. 最终需求向量 y（合并 Y 的各列）
    if (data.Y && config.aggregateFinalDemand) {
        results.y = data.Y.map(row => row.reduce((sum, val) => sum + val, 0));
    }

    // 4. Leontief 系统：只有需要展示完整逆矩阵、乘数或产业关联时才显式求逆。
    let L: number[][] | undefined;
    let IminusA: number[][] | undefined;
    const leontiefNeedsInverse = config.computeL || config.computeM || config.computeLinkage;
    if (leontiefNeedsInverse || config.computeFootprint) {
        if (!A) {
            A = matrixMultiply(data.Z, xInvDiag);
        }

        const I = identity(n);
        IminusA = matrixSubtract(I, A);

        if (leontiefNeedsInverse) {
            const invResult = matrixInverse(IminusA);
            if (invResult.error) {
                errors.push({
                    code: 'LEONTIEF_INVERSE_FAILED',
                    message: 'Leontief 逆矩阵计算失败',
                    details: invResult.error,
                    severity: 'error'
                });
            } else {
                L = invResult.matrix!;
                results.numericDiagnostics = {
                    ...results.numericDiagnostics,
                    leontief: {
                        method: 'inverse',
                        residual: invResult.inverseResidual ?? 0,
                        conditionEstimate: invResult.conditionEstimate
                    }
                };
                if ((invResult.conditionEstimate ?? 0) > CONDITION_WARNING_THRESHOLD) {
                    errors.push({
                        code: 'LEONTIEF_ILL_CONDITIONED',
                        message: 'Leontief 系统可能病态，结果对输入误差较敏感',
                        details: `无穷范数条件估计约为 ${(invResult.conditionEstimate ?? 0).toExponential(4)}`,
                        severity: 'warning'
                    });
                }
                if (config.computeL) {
                    results.L = L;

                    // 计算产出乘数（L 列和）
                    results.outputMultiplier = colSum(L);
                }
            }
        }
    }

    // 4.5 Ghosh 逆 G = (I - B)^{-1}（独立计算，供前向分析使用）
    let G: number[][] | undefined;
    if (config.computeG || config.computeLinkage) {
        // B = diag(x)^{-1} · Z 是分配系数矩阵
        const B = results.B || matrixMultiply(xInvDiag, data.Z);
        if (!results.B && config.computeB) {
            results.B = B;
        }

        const I = identity(n);
        const IminusB = matrixSubtract(I, B);

        const ghoshResult = matrixInverse(IminusB);
        if (ghoshResult.error) {
            errors.push({
                code: 'GHOSH_INVERSE_FAILED',
                message: 'Ghosh 逆矩阵计算失败',
                details: ghoshResult.error
            });
        } else {
            G = ghoshResult.matrix!;
            results.numericDiagnostics = {
                ...results.numericDiagnostics,
                ghosh: {
                    method: 'inverse',
                    residual: ghoshResult.inverseResidual ?? 0,
                    conditionEstimate: ghoshResult.conditionEstimate
                }
            };
            if ((ghoshResult.conditionEstimate ?? 0) > CONDITION_WARNING_THRESHOLD) {
                errors.push({
                    code: 'GHOSH_ILL_CONDITIONED',
                    message: 'Ghosh 系统可能病态，结果对输入误差较敏感',
                    details: `无穷范数条件估计约为 ${(ghoshResult.conditionEstimate ?? 0).toExponential(4)}`,
                    severity: 'warning'
                });
            }
            if (config.computeG) {
                results.G = G;
            }
        }
    }

    // 5. 增加值系数 va_coef = VA · diag(x)^{-1}
    if (config.computeVACoef && data.VA) {
        if (data.VA.length === 1) {
            // 单行增加值
            results.va_coef = matrixMultiply([data.VA[0]], xInvDiag)[0];
        } else {
            // 多行增加值分项
            results.va_coef_detail = matrixMultiply(data.VA, xInvDiag);
            // 总增加值系数（各分项之和）
            results.va_coef = colSum(data.VA).map((v, i) =>
                data.x[i] !== 0 ? v / data.x[i] : 0
            );
        }

        // 计算增加值乘数（如果有 L）
        if (L && results.va_coef) {
            results.vaMultiplier = [];
            for (let j = 0; j < n; j++) {
                let sum = 0;
                for (let i = 0; i < n; i++) {
                    sum += results.va_coef[i] * L[i][j];
                }
                results.vaMultiplier.push(sum);
            }
        }
    }

    // 6. 中间投入率和增加值率
    const zColSum = colSum(data.Z);
    results.intermediateInputRate = zColSum.map((v, i) =>
        data.x[i] !== 0 ? v / data.x[i] : 0
    );

    if (data.VA) {
        const vaTotal = data.VA.length === 1 ? data.VA[0] : colSum(data.VA);
        results.valueAddedRate = vaTotal.map((v, i) =>
            data.x[i] !== 0 ? v / data.x[i] : 0
        );
    }

    // 7. 卫星强度 s = F · diag(x)^{-1}
    let s: number[][] | undefined;
    if ((config.computeS || config.computeM || config.computeFootprint) && data.F) {
        s = matrixMultiply(data.F, xInvDiag);
        if (config.computeS) {
            results.s = s;
        }
    }

    // 8. 足迹乘数 M = s · L
    let M: number[][] | undefined;
    if ((config.computeM || config.computeFootprint) && s && L) {
        M = matrixMultiply(s, L);
        if (config.computeM) {
            results.M = M;
        }
    }

    // 9. 部门足迹：已有完整 L 时使用 M；否则直接求解 (I-A)X=Y。
    if (config.computeFootprint && s && data.Y) {
        if (M) {
            const demand = config.aggregateFinalDemand && results.y
                ? results.y.map(value => [value])
                : data.Y;
            results.footprint = matrixMultiply(M, demand);
        } else if (!leontiefNeedsInverse && IminusA) {
            const demand = config.aggregateFinalDemand && results.y
                ? results.y.map(value => [value])
                : data.Y;
            const solveResult = matrixSolve(IminusA, demand);
            if (solveResult.error) {
                errors.push({
                    code: 'LEONTIEF_SOLVE_FAILED',
                    message: 'Leontief 线性方程求解失败',
                    details: solveResult.error,
                    severity: 'error'
                });
            } else {
                results.numericDiagnostics = {
                    ...results.numericDiagnostics,
                    leontief: {
                        method: 'solve',
                        residual: solveResult.solveResidual ?? 0
                    }
                };
                results.footprint = matrixMultiply(s, solveResult.matrix!);
            }
        }
    }

    // 10. 产业关联分析
    if (config.computeLinkage && L && G) {
        // 后向关联（影响力系数）= Leontief 逆列和
        // 衡量某部门最终需求增加一单位对整个经济的拉动效应
        const backwardLinkage = colSum(L);
        results.backwardLinkage = backwardLinkage;

        // 保存 G 到结果
        if (!results.G) {
            results.G = G;
        }

        // 前向关联（感应度系数）= Ghosh 逆行和
        // 衡量某部门产品被其他部门使用的程度
        const forwardLinkage = rowSum(G);
        results.forwardLinkage = forwardLinkage;

        // 标准化关联系数（除以全国平均）
        const avgBackward = backwardLinkage.reduce((s, v) => s + v, 0) / n;
        const avgForward = forwardLinkage.reduce((s, v) => s + v, 0) / n;

        results.backwardLinkageNorm = backwardLinkage.map(v => v / avgBackward);
        results.forwardLinkageNorm = forwardLinkage.map(v => v / avgForward);

        // 关键产业识别（标准化后向 > 1 且 标准化前向 > 1）
        results.keyIndustries = [];
        for (let i = 0; i < n; i++) {
            const bl = results.backwardLinkageNorm[i];
            const fl = results.forwardLinkageNorm[i];
            // 关键产业指数 = (后向标准化 - 1) + (前向标准化 - 1)
            // > 0 表示是关键产业
            results.keyIndustries.push(bl > 1 && fl > 1 ? (bl + fl - 2) : 0);
        }
    }

    return { results, errors };
}

/**
 * 获取默认的空结果
 */
export function getEmptyResults(): CalculationResults {
    return {
        timestamp: new Date().toISOString()
    };
}

/**
 * 格式化矩阵为可显示的字符串（用于调试）
 */
export function formatMatrix(
    matrix: number[][],
    precision: number = 4,
    rowNames?: string[],
    colNames?: string[]
): string {
    const lines: string[] = [];

    // 表头
    if (colNames) {
        lines.push('\t' + colNames.join('\t'));
    }

    // 数据行
    for (let i = 0; i < matrix.length; i++) {
        const rowLabel = rowNames?.[i] || '';
        const values = matrix[i].map(v => v.toFixed(precision)).join('\t');
        lines.push(rowLabel + '\t' + values);
    }

    return lines.join('\n');
}
