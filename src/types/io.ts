/**
 * IO 投入产出分析 - 核心数据类型定义
 */

/** 元数据信息 */
export interface IOMetadata {
    name?: string;              // 项目名称
    year?: number;              // 年份
    region?: string;            // 区域
    unit?: string;              // 单位（万元、百万元等）
    currency?: string;          // 币种
    priceType?: string;         // 价格类型（当年价、可比价）
    importType?: 'competitive' | 'non-competitive'; // 进口处理方式
    notes?: string;             // 备注
}

/** 核心 IO 数据 */
export interface IOData {
    Z: number[][];              // 中间投入矩阵 n×n
    x: number[];                // 总产出向量 n×1
    Y?: number[][];             // 最终需求矩阵 n×k（可选）
    VA?: number[][];            // 增加值 1×n 或 m×n（可选）
    F?: number[][];             // 卫星账户 p×n（可选）
    sectorNames?: string[];     // 部门名称列表
    finalDemandNames?: string[];// 最终需求分项名称
    valueAddedNames?: string[]; // 增加值分项名称
    satelliteNames?: string[];  // 卫星账户行名称
    // MRIO fields
    regions?: string[];         // 区域名称列表
    sectorsPerRegion?: number;  // 每个区域的部门数量 (假设是对称 MRIO)
    isMRIO?: boolean;           // 是否为 MRIO 数据
    metadata?: IOMetadata;
}

/** 校验错误类型 */
export type ValidationSeverity = 'error' | 'warning' | 'info';

/** 单个校验错误 */
export interface ValidationError {
    code: string;               // 错误代码
    severity: ValidationSeverity;
    message: string;            // 错误描述
    details?: string;           // 详细信息
    affectedSectors?: number[]; // 受影响的部门索引
}

/** 校验结果 */
export interface ValidationResult {
    status: 'pass' | 'warning' | 'fail';
    errors: ValidationError[];
    summary: string;
    stats?: {
        maxError?: number;        // 最大误差
        meanError?: number;       // 平均误差
        zeroOutputSectors?: number[]; // 零产出部门
        negativeSectors?: number[];   // 含负值部门
    };
}

/** 计算配置 */
export interface CalculationConfig {
    tolerance: number;          // 容差 ε，默认 1e-6
    computeA: boolean;          // 直接消耗系数
    computeB: boolean;          // 分配系数
    computeL: boolean;          // Leontief 逆
    computeG: boolean;          // Ghosh 逆
    computeVACoef: boolean;     // 增加值系数
    computeS: boolean;          // 卫星强度
    computeM: boolean;          // 足迹乘数
    computeFootprint: boolean;  // 部门足迹
    computeLinkage: boolean;    // 产业关联分析
    aggregateFinalDemand: boolean; // 是否合并最终需求列
}

/** 计算结果 */
export interface CalculationResults {
    A?: number[][];             // 直接消耗系数矩阵 n×n
    B?: number[][];             // 分配系数矩阵 n×n
    y?: number[];               // 最终需求向量 n×1
    L?: number[][];             // Leontief 逆矩阵 n×n
    G?: number[][];             // Ghosh 逆矩阵 n×n (前向关联用)
    va_coef?: number[];         // 增加值系数 1×n
    va_coef_detail?: number[][]; // 增加值分项系数 m×n
    intermediateInputRate?: number[];  // 中间投入率 1×n
    valueAddedRate?: number[];  // 增加值率 1×n
    s?: number[][];             // 卫星强度 p×n
    M?: number[][];             // 足迹乘数 p×n
    footprint?: number[][];     // 部门足迹 p×1 或 p×k
    outputMultiplier?: number[]; // 产出乘数（L 列和）
    vaMultiplier?: number[];    // 增加值乘数
    // 产业关联分析
    backwardLinkage?: number[];  // 后向关联（影响力系数）
    forwardLinkage?: number[];   // 前向关联（感应度系数）
    backwardLinkageNorm?: number[];  // 标准化后向关联
    forwardLinkageNorm?: number[];   // 标准化前向关联
    keyIndustries?: number[];    // 关键产业指数 (后向>1 且 前向>1)
    numericDiagnostics?: {
        leontief?: MatrixDiagnostic;
        ghosh?: MatrixDiagnostic;
    };
    timestamp?: string;         // 计算时间戳
    config?: CalculationConfig; // 使用的配置
}

export interface MatrixDiagnostic {
    method: 'inverse' | 'solve';
    residual: number;
    conditionEstimate?: number;
}

/** 计算错误 */
export interface CalculationError {
    code: string;
    message: string;
    details?: string;
    severity?: 'error' | 'warning';
}

/** 完整项目状态 */
export interface IOProject {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    data: IOData;
    validation?: ValidationResult;
    results?: CalculationResults;
    config?: CalculationConfig;
}

/** 默认计算配置 */
export const DEFAULT_CONFIG: CalculationConfig = {
    tolerance: 1e-6,
    computeA: true,
    computeB: false,
    computeL: true,
    computeG: true,
    computeVACoef: true,
    computeS: true,
    computeM: true,
    computeFootprint: true,
    computeLinkage: true,
    aggregateFinalDemand: true
};
