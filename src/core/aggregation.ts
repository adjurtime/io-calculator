/**
 * 部门合并模块
 * 支持将多个部门合并为一个，适用于 SRIO 和 MRIO 数据
 */

import type { IOData } from '../types/io';

/**
 * 部门合并配置
 */
export interface AggregationConfig {
    /** 合并映射：newSectorIndex -> [原部门索引数组] */
    groups: number[][];
    /** 合并后的部门名称 */
    newSectorNames: string[];
}

/**
 * 验证合并配置
 */
export function validateAggregationConfig(config: AggregationConfig, n: number): string | null {
    // 检查所有原部门都被分配
    const allIndices = new Set<number>();
    for (const group of config.groups) {
        for (const idx of group) {
            if (idx < 0 || idx >= n) {
                return `部门索引 ${idx} 超出范围 [0, ${n - 1}]`;
            }
            if (allIndices.has(idx)) {
                return `部门 ${idx} 被重复分配`;
            }
            allIndices.add(idx);
        }
    }

    if (allIndices.size !== n) {
        return `未覆盖所有部门：已分配 ${allIndices.size}/${n}`;
    }

    if (config.groups.length !== config.newSectorNames.length) {
        return `分组数量 (${config.groups.length}) 与名称数量 (${config.newSectorNames.length}) 不匹配`;
    }

    return null;
}

/**
 * 执行部门合并
 */
export function aggregateSectors(data: IOData, config: AggregationConfig): IOData {
    const n = data.x.length;
    const m = config.groups.length; // 合并后的部门数

    // 验证
    const error = validateAggregationConfig(config, n);
    if (error) {
        throw new Error(error);
    }

    // 创建快速查找映射：原部门索引 -> 新部门索引
    const sectorMap = new Array<number>(n);
    for (let newIdx = 0; newIdx < config.groups.length; newIdx++) {
        for (const oldIdx of config.groups[newIdx]) {
            sectorMap[oldIdx] = newIdx;
        }
    }

    // 合并 Z 矩阵
    const Z_new: number[][] = Array.from({ length: m }, () => Array(m).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            Z_new[sectorMap[i]][sectorMap[j]] += data.Z[i][j];
        }
    }

    // 合并 x 向量
    const x_new: number[] = Array(m).fill(0);
    for (let i = 0; i < n; i++) {
        x_new[sectorMap[i]] += data.x[i];
    }

    // 合并 Y 矩阵
    let Y_new: number[][] | undefined;
    if (data.Y) {
        const k = data.Y[0]?.length || 0;
        Y_new = Array.from({ length: m }, () => Array(k).fill(0));
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < k; j++) {
                Y_new[sectorMap[i]][j] += data.Y[i][j];
            }
        }
    }

    // 合并 VA 矩阵
    let VA_new: number[][] | undefined;
    if (data.VA) {
        const rows = data.VA.length;
        VA_new = Array.from({ length: rows }, () => Array(m).fill(0));
        for (let r = 0; r < rows; r++) {
            for (let j = 0; j < n; j++) {
                VA_new[r][sectorMap[j]] += data.VA[r][j];
            }
        }
    }

    // 合并 F 矩阵
    let F_new: number[][] | undefined;
    if (data.F) {
        const rows = data.F.length;
        F_new = Array.from({ length: rows }, () => Array(m).fill(0));
        for (let r = 0; r < rows; r++) {
            for (let j = 0; j < n; j++) {
                F_new[r][sectorMap[j]] += data.F[r][j];
            }
        }
    }

    // 构建新数据
    const result: IOData = {
        Z: Z_new,
        x: x_new,
        Y: Y_new,
        VA: VA_new,
        F: F_new,
        sectorNames: config.newSectorNames,
        finalDemandNames: data.finalDemandNames,
        valueAddedNames: data.valueAddedNames,
        satelliteNames: data.satelliteNames,
        metadata: data.metadata
    };

    // 处理 MRIO 情况
    if (data.isMRIO && data.regions && data.sectorsPerRegion) {
        // 检查是否是按区域内合并
        const oldSectorsPerRegion = data.sectorsPerRegion;
        const newSectorsPerRegion = m / data.regions.length;

        if (Number.isInteger(newSectorsPerRegion)) {
            result.isMRIO = true;
            result.regions = data.regions;
            result.sectorsPerRegion = newSectorsPerRegion;
        }
    }

    return result;
}

/**
 * 创建简单的连续合并配置
 * 例如：将 6 部门按每 2 个合并为 3 部门
 */
export function createSimpleAggregation(
    n: number,
    groupSize: number,
    sectorNames?: string[]
): AggregationConfig {
    const groups: number[][] = [];
    const newSectorNames: string[] = [];

    for (let i = 0; i < n; i += groupSize) {
        const group: number[] = [];
        const names: string[] = [];

        for (let j = i; j < Math.min(i + groupSize, n); j++) {
            group.push(j);
            names.push(sectorNames?.[j] || `部门${j + 1}`);
        }

        groups.push(group);
        newSectorNames.push(names.join('+'));
    }

    return { groups, newSectorNames };
}

/**
 * MRIO 灵活部门合并规则
 * 每条规则指定区域内的部门索引（0-based）进行合并
 */
export interface MrioMergeRule {
    /** 要合并的区域内部门索引（0-based），例如 [14, 19] 表示第15和20部门 */
    sectorIndices: number[];
    /** 合并后的部门名称 */
    newName: string;
}

/**
 * 创建 MRIO 灵活合并配置
 * 对于每个区域，应用相同的合并规则
 * 
 * @param sectorsPerRegion 每区域部门数
 * @param regionCount 区域数量
 * @param mergeRules 合并规则（使用区域内部门索引）
 * @param sectorNames 原始部门名称（可选）
 */
export function createMrioAggregation(
    sectorsPerRegion: number,
    regionCount: number,
    mergeRules: MrioMergeRule[],
    sectorNames?: string[]
): AggregationConfig {
    const n = sectorsPerRegion * regionCount;
    const groups: number[][] = [];
    const newSectorNames: string[] = [];

    // 计算合并后每区域的部门结构
    // 首先标记哪些区域内索引会被合并
    const mergedIndices = new Set<number>();
    for (const rule of mergeRules) {
        for (const idx of rule.sectorIndices) {
            mergedIndices.add(idx);
        }
    }

    // 对每个区域应用相同的合并规则
    for (let r = 0; r < regionCount; r++) {
        const regionOffset = r * sectorsPerRegion;

        // 1. 添加未被合并的部门（保持原样）
        for (let s = 0; s < sectorsPerRegion; s++) {
            if (!mergedIndices.has(s)) {
                groups.push([regionOffset + s]);
                const name = sectorNames?.[regionOffset + s] || `部门${s + 1}`;
                newSectorNames.push(name);
            }
        }

        // 2. 添加合并的部门组
        for (const rule of mergeRules) {
            const globalIndices = rule.sectorIndices.map(s => regionOffset + s);
            groups.push(globalIndices);
            newSectorNames.push(rule.newName);
        }
    }

    return { groups, newSectorNames };
}

/**
 * 解析用户输入的合并规则文本
 * 格式：每行一条规则，格式为 "部门索引1,部门索引2,...=新部门名称"
 * 例如：
 *   15,20=部门15+20
 *   22,23,24=制造业合计
 */
export function parseMergeRules(text: string): MrioMergeRule[] {
    const rules: MrioMergeRule[] = [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);

    for (const line of lines) {
        // 支持全角标点：将全角逗号、等号替换为半角
        const normalizedLine = line
            .replace(/，/g, ',')  // 全角逗号 → 半角
            .replace(/＝/g, '='); // 全角等号 → 半角

        const [indicesPart, namePart] = normalizedLine.split('=');
        if (!indicesPart) continue;

        // 解析索引（用户输入1-based，转为0-based）
        const sectorIndices = indicesPart
            .split(',')
            .map(s => parseInt(s.trim()) - 1)  // 转为0-based
            .filter(n => !isNaN(n) && n >= 0);

        if (sectorIndices.length > 0) {
            const newName = namePart?.trim() || sectorIndices.map(i => `部门${i + 1}`).join('+');
            rules.push({ sectorIndices, newName });
        }
    }

    return rules;
}

