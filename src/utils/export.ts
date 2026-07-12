/**
 * 导出模块
 * 支持 Excel、CSV、JSON 导出
 */

import * as XLSX from 'xlsx';
import type { IOData, CalculationResults, ValidationResult } from '../types/io';

/**
 * 导出计算结果为 Excel（多 sheet）
 */
export function exportResultsToExcel(
    data: IOData,
    results: CalculationResults,
    validation?: ValidationResult
): void {
    const workbook = XLSX.utils.book_new();

    const sectorNames = data.sectorNames ||
        Array.from({ length: data.x.length }, (_, i) => `部门${i + 1}`);

    // 1. 添加原始数据
    addMatrixSheet(workbook, 'Z_中间投入', data.Z, sectorNames, sectorNames);
    addVectorSheet(workbook, 'x_总产出', data.x, sectorNames);

    if (data.Y) {
        const fdNames = data.finalDemandNames ||
            Array.from({ length: data.Y[0].length }, (_, i) => `最终需求${i + 1}`);
        addMatrixSheet(workbook, 'Y_最终需求', data.Y, sectorNames, fdNames);
    }

    if (data.VA) {
        const vaNames = data.valueAddedNames ||
            Array.from({ length: data.VA.length }, (_, i) => `增加值${i + 1}`);
        addMatrixSheet(workbook, 'VA_增加值', data.VA, vaNames, sectorNames);
    }

    if (data.F) {
        const satNames = data.satelliteNames ||
            Array.from({ length: data.F.length }, (_, i) => `卫星${i + 1}`);
        addMatrixSheet(workbook, 'F_卫星账户', data.F, satNames, sectorNames);
    }

    // 2. 添加计算结果
    if (results.A) {
        addMatrixSheet(workbook, 'A_直接消耗系数', results.A, sectorNames, sectorNames);
    }

    if (results.B) {
        addMatrixSheet(workbook, 'B_分配系数', results.B, sectorNames, sectorNames);
    }

    if (results.L) {
        addMatrixSheet(workbook, 'L_Leontief逆', results.L, sectorNames, sectorNames);
    }

    if (results.G) {
        addMatrixSheet(workbook, 'G_Ghosh逆', results.G, sectorNames, sectorNames);
    }

    if (results.va_coef) {
        addVectorSheet(workbook, 'VA_Coef_增加值系数', results.va_coef, sectorNames);
    }

    if (results.outputMultiplier) {
        addVectorSheet(workbook, '产出乘数', results.outputMultiplier, sectorNames);
    }

    if (results.vaMultiplier) {
        addVectorSheet(workbook, '增加值乘数', results.vaMultiplier, sectorNames);
    }

    if (results.intermediateInputRate) {
        addVectorSheet(workbook, '中间投入率', results.intermediateInputRate, sectorNames);
    }

    if (results.valueAddedRate) {
        addVectorSheet(workbook, '增加值率', results.valueAddedRate, sectorNames);
    }

    if (results.s) {
        const satNames = data.satelliteNames ||
            Array.from({ length: results.s.length }, (_, i) => `卫星${i + 1}`);
        addMatrixSheet(workbook, 's_卫星强度', results.s, satNames, sectorNames);
    }

    if (results.M) {
        const satNames = data.satelliteNames ||
            Array.from({ length: results.M.length }, (_, i) => `卫星${i + 1}`);
        addMatrixSheet(workbook, 'M_足迹乘数', results.M, satNames, sectorNames);
    }

    if (results.footprint) {
        const satNames = data.satelliteNames ||
            Array.from({ length: results.footprint.length }, (_, i) => `卫星${i + 1}`);
        if (results.footprint[0].length === 1) {
            // 单列足迹
            addVectorSheet(workbook, '最终需求足迹',
                results.footprint.map(row => row[0]), satNames);
        } else {
            const finalDemandNames = data.finalDemandNames ||
                Array.from({ length: results.footprint[0].length }, (_, i) => `最终需求${i + 1}`);
            addMatrixSheet(workbook, '最终需求足迹', results.footprint, satNames,
                finalDemandNames);
        }
    }

    if (results.backwardLinkage && results.forwardLinkage) {
        const linkageRows = sectorNames.map((_, index) => [
            results.backwardLinkage?.[index] || 0,
            results.forwardLinkage?.[index] || 0,
            results.backwardLinkageNorm?.[index] || 0,
            results.forwardLinkageNorm?.[index] || 0,
            results.keyIndustries?.[index] || 0
        ]);
        addMatrixSheet(
            workbook,
            '产业关联',
            linkageRows,
            sectorNames,
            ['后向关联', '前向关联', '标准化后向', '标准化前向', '关键产业指数']
        );
    }

    // 3. 添加校验报告
    if (validation) {
        addValidationSheet(workbook, validation);
    }

    // 4. 添加计算日志
    addLogSheet(workbook, data, results);

    // 下载文件
    const fileName = `IO_Results_${formatDate(new Date())}.xlsx`;
    XLSX.writeFile(workbook, fileName);
}

/**
 * 添加矩阵 sheet
 */
function addMatrixSheet(
    workbook: XLSX.WorkBook,
    sheetName: string,
    matrix: number[][],
    rowNames: string[],
    colNames: string[]
): void {
    // 构建数据（含标题行和列）
    const data: (string | number)[][] = [];

    // 标题行
    data.push(['', ...colNames]);

    // 数据行
    for (let i = 0; i < matrix.length; i++) {
        data.push([rowNames[i] || `行${i + 1}`, ...matrix[i]]);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.substring(0, 31));
}

/**
 * 添加向量 sheet
 */
function addVectorSheet(
    workbook: XLSX.WorkBook,
    sheetName: string,
    vector: number[],
    names: string[]
): void {
    const data: (string | number)[][] = [['名称', '值']];

    for (let i = 0; i < vector.length; i++) {
        data.push([names[i] || `项${i + 1}`, vector[i]]);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.substring(0, 31));
}

/**
 * 添加校验报告 sheet
 */
function addValidationSheet(
    workbook: XLSX.WorkBook,
    validation: ValidationResult
): void {
    const data: (string | number)[][] = [
        ['校验报告'],
        [''],
        ['状态', validation.status],
        ['摘要', validation.summary],
        [''],
        ['错误/警告列表'],
        ['严重性', '代码', '消息', '详情']
    ];

    for (const error of validation.errors) {
        data.push([
            error.severity,
            error.code,
            error.message,
            error.details || ''
        ]);
    }

    if (validation.stats) {
        data.push(['']);
        data.push(['统计信息']);
        if (validation.stats.maxError !== undefined) {
            data.push(['最大误差', validation.stats.maxError]);
        }
        if (validation.stats.meanError !== undefined) {
            data.push(['平均误差', validation.stats.meanError]);
        }
        if (validation.stats.zeroOutputSectors?.length) {
            data.push(['零产出部门数', validation.stats.zeroOutputSectors.length]);
        }
    }

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, worksheet, '校验报告');
}

/**
 * 添加计算日志 sheet
 */
function addLogSheet(
    workbook: XLSX.WorkBook,
    data: IOData,
    results: CalculationResults
): void {
    const logData: (string | number)[][] = [
        ['计算日志'],
        [''],
        ['计算时间', results.timestamp || new Date().toISOString()],
        [''],
        ['输入数据摘要'],
        ['部门数 (n)', data.x.length],
        ['Z 矩阵维度', `${data.Z.length}×${data.Z[0]?.length || 0}`],
        ['总产出合计', data.x.reduce((s, v) => s + v, 0)]
    ];

    if (data.Y) {
        logData.push(['最终需求列数', data.Y[0]?.length || 0]);
    }
    if (data.VA) {
        logData.push(['增加值行数', data.VA.length]);
    }
    if (data.F) {
        logData.push(['卫星账户行数', data.F.length]);
    }

    logData.push(['']);
    logData.push(['计算配置']);
    if (results.config) {
        logData.push(['容差 (ε)', results.config.tolerance]);
        logData.push(['计算直接消耗系数 A', results.config.computeA ? '是' : '否']);
        logData.push(['计算 Leontief 逆 L', results.config.computeL ? '是' : '否']);
        logData.push(['计算增加值系数', results.config.computeVACoef ? '是' : '否']);
        logData.push(['计算卫星强度 s', results.config.computeS ? '是' : '否']);
        logData.push(['计算足迹乘数 M', results.config.computeM ? '是' : '否']);
    }

    if (results.numericDiagnostics) {
        logData.push(['']);
        logData.push(['数值诊断']);
        if (results.numericDiagnostics.leontief) {
            logData.push(['Leontief 条件估计', results.numericDiagnostics.leontief.conditionEstimate]);
            logData.push(['Leontief 逆矩阵残差', results.numericDiagnostics.leontief.inverseResidual]);
        }
        if (results.numericDiagnostics.ghosh) {
            logData.push(['Ghosh 条件估计', results.numericDiagnostics.ghosh.conditionEstimate]);
            logData.push(['Ghosh 逆矩阵残差', results.numericDiagnostics.ghosh.inverseResidual]);
        }
    }

    if (data.metadata) {
        logData.push(['']);
        logData.push(['元数据']);
        if (data.metadata.name) logData.push(['项目名称', data.metadata.name]);
        if (data.metadata.year) logData.push(['年份', data.metadata.year]);
        if (data.metadata.region) logData.push(['区域', data.metadata.region]);
        if (data.metadata.unit) logData.push(['单位', data.metadata.unit]);
        if (data.metadata.currency) logData.push(['币种', data.metadata.currency]);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(logData);
    XLSX.utils.book_append_sheet(workbook, worksheet, '计算日志');
}

/**
 * 导出单个矩阵为 CSV
 */
export function exportMatrixToCSV(
    matrix: number[][],
    rowNames?: string[],
    colNames?: string[],
    fileName: string = 'matrix.csv'
): void {
    const lines: string[] = [];

    // 标题行
    if (colNames) {
        lines.push(['', ...colNames].map(escapeCSVCell).join(','));
    }

    // 数据行
    for (let i = 0; i < matrix.length; i++) {
        const rowName = rowNames?.[i] || '';
        const values = matrix[i].map(v => v.toString()).join(',');
        lines.push(`${escapeCSVCell(rowName)},${values}`);
    }

    downloadText(lines.join('\n'), fileName, 'text/csv');
}

export function escapeCSVCell(value: string): string {
    const neutralized = /^[=+\-@]/.test(value) ? `'${value}` : value;
    if (/[",\r\n]/.test(neutralized)) {
        return `"${neutralized.replace(/"/g, '""')}"`;
    }
    return neutralized;
}

/**
 * 导出结果为 JSON
 */
export function exportResultsToJSON(
    data: IOData,
    results: CalculationResults,
    validation?: ValidationResult
): void {
    const exportData = {
        version: '2.0-alpha.2',
        exportedAt: new Date().toISOString(),
        metadata: data.metadata,
        dimensions: {
            sectors: data.x.length,
            finalDemandCategories: data.Y?.[0]?.length || 0,
            valueAddedRows: data.VA?.length || 0,
            satelliteRows: data.F?.length || 0
        },
        sectorNames: data.sectorNames,
        validation: validation ? {
            status: validation.status,
            summary: validation.summary,
            errorCount: validation.errors.length
        } : undefined,
        results: {
            ...results,
            // 移除大型矩阵以减小文件大小，或保留所有
        }
    };

    const json = JSON.stringify(exportData, null, 2);
    downloadText(json, `IO_Results_${formatDate(new Date())}.json`, 'application/json');
}

/**
 * 下载文本文件
 */
function downloadText(content: string, fileName: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * 格式化日期为文件名安全字符串
 */
function formatDate(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}
