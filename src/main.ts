/**
 * IO Calculator - 主应用入口
 */

import './index.css';
import type { IOData, CalculationConfig, CalculationError, CalculationResults, MatrixDiagnostic, ValidationResult } from './types/io';
import { DEFAULT_CONFIG } from './types/io';
import { validateIOData } from './core/validation';
import { MAX_HEATMAP_DIMENSION, MAX_RENDER_DIMENSION } from './core/limits';
import {
  createSampleIOData,
  formatMatrixParseErrors,
  inferExcelSheetType,
  parseClipboardMatrix,
  parseNumericMatrix,
  parseNumericVector,
  readExcelFile,
  readMatrixFile
} from './utils/fileIO';
import { exportResultsToExcel, exportResultsToJSON } from './utils/export';
import { escapeHTML } from './utils/html';
import type { CalculationWorkerRequest, CalculationWorkerResponse } from './workers/protocol';

// ECharts type declaration
declare const echarts: any;

// 应用状态
interface ExcelSheetInfo {
  name: string;
  data: string[][];
  rows: number;
  cols: number;
}

interface ResultTab {
  id: string;
  label: string;
}

interface AppState {
  currentStep: number;
  data: IOData | null;
  validation: ValidationResult | null;
  config: CalculationConfig;
  results: CalculationResults | null;
  calculationErrors: CalculationError[];
  calculationWarnings: CalculationError[];
  isCalculating: boolean;
  // Excel Sheet 选择相关
  excelSheets: ExcelSheetInfo[];
  showSheetModal: boolean;
  pendingFile: File | null;
  // UI 状态
  activeResultTab: string;
  viewMode: 'table' | 'heatmap';
  // MRIO 手动配置
  mrioConfig: {
    regionCount: number;
    sectorsPerRegion: number;
  };
}

const state: AppState = {
  currentStep: 0,
  data: null,
  validation: null,
  config: { ...DEFAULT_CONFIG },
  results: null,
  calculationErrors: [],
  calculationWarnings: [],
  isCalculating: false,
  excelSheets: [],
  showSheetModal: false,
  pendingFile: null,
  activeResultTab: 'A',
  viewMode: 'table',
  mrioConfig: {
    regionCount: 1,
    sectorsPerRegion: 0  // 0 表示自动（等于矩阵维度n）
  }
};

let calculationWorker: Worker | null = null;
let calculationRequestId = 0;
let activeHeatmap: any = null;
let heatmapResizeHandler: (() => void) | null = null;

// 权威数据库链接
const IO_DATABASES = [
  { name: 'WIOD', desc: '世界投入产出数据库', url: 'https://www.rug.nl/ggdc/valuechain/wiod/' },
  { name: 'EXIOBASE', desc: '环境扩展IO表', url: 'https://www.exiobase.eu/' },
  { name: 'GTAP', desc: '全球贸易分析', url: 'https://www.gtap.agecon.purdue.edu/' },
  { name: 'OECD ICIO', desc: 'OECD国际IO表', url: 'https://www.oecd.org/sti/ind/inter-country-input-output-tables.htm' },
  { name: 'EORA', desc: '全球MRIO数据库', url: 'https://worldmrio.com/' },
  { name: '中国统计年鉴', desc: '中国官方IO表', url: 'http://www.stats.gov.cn/sj/ndsj/' },
  { name: 'CEADs', desc: '中国碳核算数据库', url: 'https://www.ceads.net/' }
];

// 初始化应用
function init(): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = renderApp();
  bindEvents();
}

// 渲染主应用
function renderApp(): string {
  return `
    <div class="app">
      ${renderHeader()}
      <main class="container">
        ${renderSteps()}
        <div id="step-content" class="animate-fadeIn">
          ${renderStepContent()}
        </div>
      </main>
      ${renderFooter()}
      ${state.showSheetModal ? renderSheetModal() : ''}
    </div>
  `;
}

function renderHeader(): string {
  return `
    <header class="header">
      <div class="container header-content">
        <div class="logo">
          <div class="logo-icon">IO</div>
          <span class="logo-text">IO Calculator</span>
        </div>
        <div class="flex gap-md">
          <button class="btn btn-secondary" id="btn-sample">📊 加载示例</button>
          <button class="btn btn-secondary" id="btn-reset">🔄 重置</button>
        </div>
      </div>
    </header>
  `;
}

function renderSteps(): string {
  const steps = ['数据输入', '数据校验', '指标计算', '结果导出'];
  return `
    <nav class="steps">
      ${steps.map((label, i) => `
        <button type="button" class="step ${i === state.currentStep ? 'active' : ''} ${i < state.currentStep ? 'completed' : ''}" data-step="${i}" ${i === state.currentStep ? 'aria-current="step"' : ''} ${i > state.currentStep ? 'disabled' : ''}>
          <span class="step-number">${i < state.currentStep ? '✓' : i + 1}</span>
          <span class="step-label">${label}</span>
        </button>
      `).join('')}
    </nav>
  `;
}

function renderStepContent(): string {
  switch (state.currentStep) {
    case 0: return renderDataInput();
    case 1: return renderValidation();
    case 2: return renderCalculation();
    case 3: return renderResults();
    default: return '';
  }
}

// 步骤1：数据输入
function renderDataInput(): string {
  const sectorCount = state.data ? getSectorCount(state.data) : 0;
  return `
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">📥 数据输入</h2>
      </div>
      
      <div class="grid grid-2">
        <button type="button" class="upload-zone" id="upload-zone" aria-controls="file-input">
          <span class="upload-zone-icon">📁</span>
          <span class="upload-zone-text">拖拽文件到此处，或点击上传</span>
          <span class="upload-zone-hint">支持 Excel (.xlsx)、CSV、TXT、DAT、MAT 格式</span>
        </button>
        <input type="file" id="file-input" accept=".xlsx,.xls,.csv,.txt,.dat,.mat" class="sr-only" tabindex="-1" aria-hidden="true">
        
        <div class="card" style="margin:0">
          <h3>📋 从 Excel 粘贴</h3>
          <p class="text-muted mb-md">从 Excel 复制矩阵数据，粘贴到下方</p>
          <div class="form-group">
            <label class="form-label" for="paste-type">选择数据类型</label>
            <select class="form-select" id="paste-type">
              <option value="Z">Z - 中间投入矩阵</option>
              <option value="x">x - 总产出向量</option>
              <option value="Y">Y - 最终需求</option>
              <option value="VA">VA - 增加值</option>
              <option value="F">F - 卫星账户</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">
              <input type="checkbox" id="has-headers"> 第一行/列为标题
            </label>
          </div>
          <textarea class="form-textarea" id="paste-area" placeholder="在此粘贴数据..."></textarea>
          <button class="btn btn-secondary mt-md" id="btn-parse">解析数据</button>
        </div>
      </div>
      
      <!-- MRIO 配置 -->
      <div class="card mt-md" style="background: var(--bg-secondary)">
        <h3>🌍 MRIO 区域配置</h3>
        <p class="text-muted mb-md">手动设置区域数量和每区域部门数（SRIO 模式设置区域数为 1）</p>
        <div class="grid grid-3" style="align-items: end;">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label" for="mrio-region-count">区域数量</label>
            <input type="number" class="form-input" id="mrio-region-count" 
                   value="${state.mrioConfig.regionCount}" min="1" step="1">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label" for="mrio-sectors-per-region">每区域部门数 ${state.data ? `<span class="text-muted">(默认=${Math.floor(sectorCount / state.mrioConfig.regionCount)})</span>` : ''}</label>
            <input type="number" class="form-input" id="mrio-sectors-per-region" 
                   value="${state.mrioConfig.sectorsPerRegion || ''}" min="0" step="1"
                   placeholder="${state.data ? Math.floor(sectorCount / state.mrioConfig.regionCount) : '自动'}">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <span class="badge ${state.mrioConfig.regionCount > 1 ? 'badge-info' : 'badge-secondary'}">
              ${state.mrioConfig.regionCount > 1 ? 'MRIO 模式' : 'SRIO 模式'}
            </span>
            ${state.data ? `<span class="text-muted ml-sm">n=${sectorCount}</span>` : ''}
          </div>
        </div>
        ${state.mrioConfig.regionCount > 1 ? `
        <div class="form-group mt-md">
          <label class="form-label" for="mrio-region-names">区域名称 <span class="text-muted">(每行一个，留空使用默认名称)</span></label>
          <textarea class="form-textarea" id="mrio-region-names" rows="3" 
                    placeholder="Region 1\nRegion 2\n...">${state.data?.regions?.map(escapeHTML).join('\n') || ''}</textarea>
        </div>
        ` : ''}
      </div>
      
      ${state.data ? renderDataPreview() : ''}
      
      <div class="flex-between mt-md">
        <div></div>
        <button class="btn btn-primary btn-lg" id="btn-next-1" ${!state.data ? 'disabled' : ''}>
          下一步：数据校验 →
        </button>
      </div>
    </div>
  `;
}

function renderDataPreview(): string {
  if (!state.data) return '';
  const n = getSectorCount(state.data);
  const zRows = state.data.Z.length;
  const zCols = state.data.Z[0]?.length || 0;
  return `
    <div class="card mt-md" style="background: var(--bg-secondary)">
      <h3>📊 数据预览</h3>
      <div class="grid grid-3 mt-md">
        <div><span class="badge ${zRows > 0 ? 'badge-success' : 'badge-warning'}">Z 矩阵</span> ${zRows > 0 ? `${zRows}×${zCols}` : '未提供'}</div>
        <div><span class="badge ${state.data.x.length > 0 ? 'badge-success' : 'badge-warning'}">x 向量</span> ${state.data.x.length > 0 ? `${state.data.x.length} 部门` : '未提供（必需）'}</div>
        ${state.data.Y ? `<div><span class="badge badge-success">Y 矩阵</span> ${n}×${state.data.Y[0]?.length || 0}</div>` : '<div><span class="badge badge-warning">Y</span> 未提供</div>'}
        ${state.data.VA ? `<div><span class="badge badge-success">VA</span> ${state.data.VA.length}×${n}</div>` : '<div><span class="badge badge-warning">VA</span> 未提供</div>'}
        ${state.data.F ? `<div><span class="badge badge-success">F 卫星</span> ${state.data.F.length}×${n}</div>` : '<div><span class="badge badge-warning">F</span> 未提供</div>'}
        <div>部门名称: ${state.data.sectorNames ? '✓ 已加载' : '⚠ 默认'}</div>
        ${state.data.isMRIO ? `<div><span class="badge badge-info">MRIO</span> ${state.data.regions?.length || 0} 个区域</div>` : '<div><span class="badge badge-secondary">单区域</span></div>'}
      </div>
      ${state.data.isMRIO && state.data.regions ? `
        <div class="mt-md text-sm text-muted">
          <strong>识别到的区域：</strong> ${state.data.regions.map(escapeHTML).join('、')}
        </div>
      ` : ''}
    </div>
  `;
}

function getSectorCount(data: IOData): number {
  return data.x.length || data.Z.length;
}

// 步骤2：校验
function renderValidation(): string {
  const v = state.validation;
  const statusClass = v ? `validation-${v.status === 'fail' ? 'fail' : v.status === 'warning' ? 'warning' : 'pass'}` : '';
  const statusIcon = v ? (v.status === 'fail' ? '❌' : v.status === 'warning' ? '⚠️' : '✅') : '⏳';

  return `
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">🔍 数据校验</h2>
        <button class="btn btn-secondary" id="btn-validate">重新校验</button>
      </div>
      
      ${v ? `
        <div class="validation-report ${statusClass}">
          <div class="validation-header">
            <span class="validation-icon">${statusIcon}</span>
            <div>
              <h3>${escapeHTML(v.summary)}</h3>
              <p class="text-muted">共 ${v.errors.length} 个提示</p>
            </div>
          </div>
          
          ${v.errors.length > 0 ? `
            <div class="validation-errors">
              ${v.errors.map(e => `
                <div class="validation-error-item">
                  <span class="badge badge-${e.severity === 'error' ? 'error' : e.severity === 'warning' ? 'warning' : 'info'}">${e.severity}</span>
                  <strong>${escapeHTML(e.message)}</strong>
                  ${e.details ? `<div class="text-muted" style="margin-top:4px;white-space:pre-wrap;font-family:var(--font-mono);font-size:0.85em">${escapeHTML(e.details)}</div>` : ''}
                </div>
              `).join('')}
            </div>
          ` : ''}
          
          ${v.stats?.maxError !== undefined ? `
            <div class="mt-md">
              <p>最大误差: ${v.stats.maxError.toExponential(4)}</p>
              <p>平均误差: ${v.stats.meanError?.toExponential(4)}</p>
            </div>
          ` : ''}
        </div>
      ` : `
        <div class="loading">
          <div class="loading-spinner"></div>
          <span>正在校验数据...</span>
        </div>
      `}
      
      <!-- 部门合并选项 -->
      ${v && v.status !== 'fail' && state.data ? `
      <div class="card mt-md" style="background: var(--bg-secondary)">
        <h3>🔄 部门合并 <span class="badge badge-secondary">可选</span></h3>
        <p class="text-muted mb-md">将多个部门合并为一个，减少数据维度</p>
        
        <div class="form-group">
          <label class="form-label">
            <input type="checkbox" id="enable-aggregation"> 启用部门合并
          </label>
        </div>
        
        
        <div id="aggregation-config" style="display: none;">
          <div class="form-group">
            <label class="form-label">合并方式</label>
            <select class="form-select" id="aggregation-mode">
              <option value="simple">等量合并（每 N 个部门合并为 1 个）</option>
              <option value="custom">按索引合并（指定部门编号）</option>
            </select>
          </div>
          
          <div id="simple-aggregation">
            <div class="form-group">
              <label class="form-label">合并比例：每 <input type="number" id="agg-group-size" value="2" min="2" max="${state.data.x.length}" style="width:60px;display:inline-block"> 个部门合并为 1 个</label>
              <p class="text-muted">当前 ${state.data.x.length} 部门 → 合并后约 ${Math.ceil(state.data.x.length / 2)} 部门</p>
            </div>
            <button class="btn btn-secondary" id="btn-apply-aggregation">应用合并</button>
          </div>
          
          <div id="custom-aggregation" style="display: none;">
            <div class="form-group">
              <label class="form-label">合并规则 ${state.data.isMRIO ? '<span class="badge badge-info">MRIO: 规则自动应用到所有区域</span>' : ''}</label>
              <p class="text-muted">每行一条规则，格式：部门编号1,部门编号2,...=新名称</p>
              <textarea class="form-textarea" id="custom-merge-rules" rows="4" 
                placeholder="15,20=部门15+20合并\n22,23,24=制造业合计"></textarea>
            </div>
            <p class="text-muted text-sm">💡 未提及的部门将保持原样。${state.data.isMRIO ? `当前每区域 ${state.mrioConfig.sectorsPerRegion || Math.floor(state.data.x.length / state.mrioConfig.regionCount)} 部门。` : ''}</p>
            <button class="btn btn-secondary" id="btn-apply-custom-aggregation">应用自定义合并</button>
          </div>
        </div>
      </div>
      ` : ''}
      
      <div class="flex-between mt-md">
        <button class="btn btn-secondary" id="btn-prev-2">← 返回</button>
        <button class="btn btn-primary btn-lg" id="btn-next-2" ${v?.status === 'fail' ? 'disabled' : ''}>
          下一步：指标计算 →
        </button>
      </div>
    </div>
  `;
}

// 步骤3：计算配置
function renderCalculation(): string {
  const c = state.config;
  return `
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">⚙️ 计算配置</h2>
      </div>

      ${state.calculationErrors.length > 0 ? `
        <div class="validation-report validation-fail mb-md" role="alert">
          <div class="validation-header">
            <span class="validation-icon">❌</span>
            <div>
              <h3>计算已停止</h3>
              <p class="text-muted">请修正以下问题后重试</p>
            </div>
          </div>
          <div class="validation-errors">
            ${state.calculationErrors.map(error => `
              <div class="validation-error-item">
                <strong>${escapeHTML(error.message)}</strong>
                ${error.details ? `<div class="text-muted mt-sm">${escapeHTML(error.details)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      
      <div class="grid grid-2">
        <div>
          <h3>基础系数</h3>
          <div class="checkbox-group mt-md">
            <label class="checkbox-item"><input type="checkbox" data-config="computeA" ${c.computeA ? 'checked' : ''}> A 直接消耗系数</label>
            <label class="checkbox-item"><input type="checkbox" data-config="computeB" ${c.computeB ? 'checked' : ''}> B 分配系数</label>
            <label class="checkbox-item"><input type="checkbox" data-config="computeVACoef" ${c.computeVACoef ? 'checked' : ''}> 增加值系数</label>
          </div>
          
          <h3 class="mt-md">逆矩阵与乘数</h3>
          <div class="checkbox-group mt-md">
            <label class="checkbox-item"><input type="checkbox" data-config="computeL" ${c.computeL ? 'checked' : ''}> L Leontief逆</label>
            <label class="checkbox-item"><input type="checkbox" data-config="computeG" ${c.computeG ? 'checked' : ''}> G Ghosh逆 (供给驱动)</label>
            <label class="checkbox-item"><input type="checkbox" data-config="computeLinkage" ${c.computeLinkage ? 'checked' : ''}> 🔗 产业关联分析</label>
          </div>
        </div>
        
        <div>
          <h3>卫星账户扩展</h3>
          <div class="checkbox-group mt-md">
            <label class="checkbox-item"><input type="checkbox" data-config="computeS" ${c.computeS ? 'checked' : ''} ${!state.data?.F ? 'disabled' : ''}> s 卫星强度</label>
            <label class="checkbox-item"><input type="checkbox" data-config="computeM" ${c.computeM ? 'checked' : ''} ${!state.data?.F ? 'disabled' : ''}> M 足迹乘数</label>
            <label class="checkbox-item"><input type="checkbox" data-config="computeFootprint" ${c.computeFootprint ? 'checked' : ''} ${!state.data?.F ? 'disabled' : ''}> 部门足迹</label>
          </div>
          ${!state.data?.F ? '<p class="text-muted mt-md">⚠ 未提供卫星账户数据 (F)</p>' : ''}
          
          <h3 class="mt-md">参数设置</h3>
          <div class="form-group mt-md">
            <label class="form-label" for="tolerance">容差 ε</label>
            <input type="number" class="form-input" id="tolerance" value="${c.tolerance}" step="0.000001">
          </div>
        </div>
      </div>
      
      <div class="flex-between mt-md">
        <button class="btn btn-secondary" id="btn-prev-3">← 返回</button>
        ${state.isCalculating ? `
          <div class="flex gap-md" role="status" aria-live="polite">
            <span class="loading"><span class="loading-spinner"></span>正在后台计算…</span>
            <button class="btn btn-secondary" id="btn-cancel-calculation">取消计算</button>
          </div>
        ` : `
          <button class="btn btn-primary btn-lg" id="btn-calculate">🚀 运行计算</button>
        `}
      </div>
    </div>
  `;
}

// 步骤4：结果展示
function renderResults(): string {
  const r = state.results;
  if (!r) return '<div class="loading"><div class="loading-spinner"></div><span>正在计算...</span></div>';

  const tabs: ResultTab[] = [];
  if (r.A) tabs.push({ id: 'A', label: 'A 直接消耗系数' });
  if (r.B) tabs.push({ id: 'B', label: 'B 分配系数' });
  if (r.L) tabs.push({ id: 'L', label: 'L Leontief逆' });
  if (r.G) tabs.push({ id: 'G', label: 'G Ghosh逆' });
  if (r.va_coef) tabs.push({ id: 'va', label: '增加值系数' });
  if (r.outputMultiplier) tabs.push({ id: 'mult', label: '乘数' });
  if (r.backwardLinkage) tabs.push({ id: 'linkage', label: '🔗 产业关联' });
  if (state.data?.isMRIO) tabs.push({ id: 'regions', label: '🌍 区域规模' });
  if (r.s) tabs.push({ id: 's', label: 's 卫星强度' });
  if (r.M) tabs.push({ id: 'M', label: 'M 足迹乘数' });
  if (r.footprint) tabs.push({ id: 'footprint', label: '最终需求足迹' });

  return `
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">📊 计算结果</h2>
        <div class="flex gap-md">
          <button class="btn btn-primary" id="btn-export-excel">📥 导出 Excel</button>
          <button class="btn btn-secondary" id="btn-export-json">📄 导出 JSON</button>
        </div>
      </div>

      ${state.calculationWarnings.length > 0 ? `
        <div class="validation-report validation-warning mb-md" role="status">
          <strong>数值诊断提示</strong>
          ${state.calculationWarnings.map(issue => `
            <p class="mt-sm">${escapeHTML(issue.message)}${issue.details ? `：${escapeHTML(issue.details)}` : ''}</p>
          `).join('')}
        </div>
      ` : ''}

      ${r.numericDiagnostics ? `
        <div class="card mb-md" style="background: var(--bg-secondary); margin-bottom: 16px;">
          <h3>数值诊断</h3>
          <div class="grid grid-2 mt-sm">
            ${renderNumericDiagnostic('Leontief', r.numericDiagnostics.leontief)}
            ${renderNumericDiagnostic('Ghosh', r.numericDiagnostics.ghosh)}
          </div>
        </div>
      ` : ''}
      
      <div class="tabs" role="tablist" aria-label="计算结果">
        ${tabs.map((t) => {
          const active = t.id === (state.activeResultTab || tabs[0]?.id);
          return `<button class="tab ${active ? 'active' : ''}" role="tab" aria-selected="${active}" aria-controls="result-content" tabindex="${active ? '0' : '-1'}" data-tab="${t.id}">${t.label}</button>`;
        }).join('')}
      </div>
      
      <div id="result-content" role="tabpanel">
        ${renderResultTable(state.activeResultTab || tabs[0]?.id || 'A')}
      </div>
      
      <div class="flex-between mt-md">
        <button class="btn btn-secondary" id="btn-prev-4">← 返回修改配置</button>
        <p class="text-muted">计算完成于 ${r.timestamp ? new Date(r.timestamp).toLocaleString() : '-'}</p>
      </div>
    </div>
  `;
}

function renderNumericDiagnostic(
  name: string,
  diagnostic: MatrixDiagnostic | undefined
): string {
  if (!diagnostic) return '';
  const method = diagnostic.method === 'solve' ? '线性方程求解' : '显式逆矩阵';
  return `
    <div>
      <strong>${name}</strong>
      <p class="text-muted text-sm">计算方式：${method}</p>
      ${diagnostic.conditionEstimate === undefined ? '' : `<p class="text-muted text-sm">条件估计：${diagnostic.conditionEstimate.toExponential(4)}</p>`}
      <p class="text-muted text-sm">${diagnostic.method === 'solve' ? '求解' : '逆矩阵'}残差：${diagnostic.residual.toExponential(4)}</p>
    </div>
  `;
}

function renderResultTable(tabId: string): string {
  const r = state.results;
  const d = state.data;
  if (!r || !d) return '';

  const names = d.sectorNames || d.x.map((_, i) => `部门${i + 1}`);

  let matrix: number[][] | undefined;
  let vector: number[] | undefined;
  let title = '';

  switch (tabId) {
    case 'A': matrix = r.A; title = 'A 直接消耗系数矩阵'; break;
    case 'B': matrix = r.B; title = 'B 分配系数矩阵'; break;
    case 'L': matrix = r.L; title = 'L Leontief 逆矩阵'; break;
    case 'G': matrix = r.G; title = 'G Ghosh 供给驱动逆矩阵'; break;
    case 's': matrix = r.s; title = 's 卫星强度矩阵'; break;
    case 'M': matrix = r.M; title = 'M 足迹乘数矩阵'; break;
    case 'va': vector = r.va_coef; title = '增加值系数'; break;
    case 'footprint': {
      if (!r.footprint) return '<p class="text-muted">无足迹结果</p>';
      const rowNames = d.satelliteNames || r.footprint.map((_, i) => `卫星${i + 1}`);
      const colNames = r.footprint[0]?.length === 1
        ? ['最终需求合计']
        : (d.finalDemandNames || r.footprint[0].map((_, i) => `最终需求${i + 1}`));
      return `
        <h3>最终需求足迹</h3>
        <div class="table-container mt-md" style="max-height:400px;overflow:auto">
          <table class="table">
            <thead><tr><th>卫星账户</th>${colNames.map(name => `<th>${escapeHTML(name)}</th>`).join('')}</tr></thead>
            <tbody>
              ${r.footprint.map((row, i) => `
                <tr><td>${escapeHTML(rowNames[i])}</td>${row.map(value => `<td class="numeric">${value.toFixed(6)}</td>`).join('')}</tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
    case 'mult':
      return `
        <h3>${title || '乘数'}</h3>
        <div class="table-container mt-md" style="max-height:400px;overflow:auto">
          <table class="table">
            <thead><tr><th>部门</th><th>产出乘数</th>${r.vaMultiplier ? '<th>增加值乘数</th>' : ''}</tr></thead>
            <tbody>
              ${names.map((n, i) => `
                <tr>
                  <td>${escapeHTML(n)}</td>
                  <td class="numeric">${r.outputMultiplier?.[i]?.toFixed(4) || '-'}</td>
                  ${r.vaMultiplier ? `<td class="numeric">${r.vaMultiplier[i]?.toFixed(4) || '-'}</td>` : ''}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    case 'linkage':
      return `
        <h3>🔗 产业关联分析</h3>
        <p class="text-muted mb-md">后向关联（影响力系数）：某部门最终需求增加对经济的拉动效应<br>
        前向关联（感应度系数）：某部门产品被其他部门使用的程度<br>
        <strong>关键产业</strong>：标准化后向>1 且 标准化前向>1 的部门</p>
        <div class="table-container mt-md" style="max-height:400px;overflow:auto">
          <table class="table">
            <thead>
              <tr>
                <th>部门</th>
                <th>后向关联</th>
                <th>前向关联</th>
                <th>标准化后向</th>
                <th>标准化前向</th>
                <th>产业类型</th>
              </tr>
            </thead>
            <tbody>
              ${names.map((n, i) => {
        const bl = r.backwardLinkageNorm?.[i] || 0;
        const fl = r.forwardLinkageNorm?.[i] || 0;
        let type = '';
        let typeClass = '';
        if (bl > 1 && fl > 1) {
          type = '⭐ 关键产业';
          typeClass = 'badge badge-success';
        } else if (bl > 1) {
          type = '📈 强后向';
          typeClass = 'badge badge-warning';
        } else if (fl > 1) {
          type = '📊 强前向';
          typeClass = 'badge badge-info';
        } else {
          type = '一般';
          typeClass = 'text-muted';
        }
        return `
                <tr>
                  <td>${escapeHTML(n)}</td>
                  <td class="numeric">${r.backwardLinkage?.[i]?.toFixed(4) || '-'}</td>
                  <td class="numeric">${r.forwardLinkage?.[i]?.toFixed(4) || '-'}</td>
                  <td class="numeric">${bl.toFixed(4)}</td>
                  <td class="numeric">${fl.toFixed(4)}</td>
                  <td><span class="${typeClass}">${type}</span></td>
                </tr>
              `}).join('')}
            </tbody>
          </table>
        </div>
      `;
    case 'regions':
      if (!d.regions || !d.sectorsPerRegion) return '<p>无区域数据</p>';
      // 对已通过区域维度校验的 MRIO 数据做描述性规模汇总。
      const regionStats = d.regions.map((region, rIdx) => {
        const start = rIdx * d.sectorsPerRegion!;
        const end = start + d.sectorsPerRegion!;

        // 区域总产出 (x 的切片求和)
        const totalX = d.x.slice(start, end).reduce((a, b) => a + b, 0);

        // 区域增加值 (VA 的切片切列求和)
        let totalVA = 0;
        if (state.data?.VA) {
          // 如果 VA 是多行的，先求列和得到 1xN 向量
          const vaVec = state.data.VA.length === 1 ? state.data.VA[0] : state.data.VA[0].map((_, c) => state.data!.VA!.reduce((s, row) => s + row[c], 0));
          totalVA = vaVec.slice(start, end).reduce((a, b) => a + b, 0);
        }
        return { region, totalX, totalVA };
      });

      return `
        <h3>🌍 区域规模汇总</h3>
        <p class="text-muted mb-md">基于 ${d.regions.length} 个区域的描述性汇总；不代表双边隐含流、净转移或责任分配结果。</p>
        <div class="table-container mt-md">
          <table class="table">
            <thead>
              <tr>
                <th>区域</th>
                <th>总产出 (Total Output)</th>
                <th>增加值 (Value Added)</th>
                <th>增加值率</th>
              </tr>
            </thead>
            <tbody>
              ${regionStats.map(s => `
                <tr>
                  <td><strong>${escapeHTML(s.region)}</strong></td>
                  <td class="numeric">${s.totalX.toFixed(2)}</td>
                  <td class="numeric">${s.totalVA.toFixed(2)}</td>
                  <td class="numeric">${s.totalX ? (s.totalVA / s.totalX * 100).toFixed(2) + '%' : '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
  }

  if (vector) {
    return `
      <h3>${title}</h3>
      <div class="table-container mt-md" style="max-height:400px;overflow:auto">
        <table class="table">
          <thead><tr><th>部门</th><th>值</th></tr></thead>
          <tbody>${names.map((n, i) => `<tr><td>${escapeHTML(n)}</td><td class="numeric">${vector![i]?.toFixed(6) || '-'}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    `;
  }

  if (matrix) {
    const rowNames = tabId === 's' || tabId === 'M' ? (d.satelliteNames || matrix.map((_, i) => `行${i + 1}`)) : names;
    const visibleMatrix = matrix
      .slice(0, MAX_RENDER_DIMENSION)
      .map(row => row.slice(0, MAX_RENDER_DIMENSION));
    const visibleRowNames = rowNames.slice(0, MAX_RENDER_DIMENSION);
    const visibleColNames = names.slice(0, MAX_RENDER_DIMENSION);
    const tableTruncated = matrix.length > MAX_RENDER_DIMENSION ||
      (matrix[0]?.length || 0) > MAX_RENDER_DIMENSION;

    // 头部控制栏：支持切换视图
    const headerHtml = `
      <div class="flex-between mb-md">
        <h3>${title}</h3>
        <div class="result-toolbar btn-group">
           <button class="btn btn-sm ${state.viewMode === 'table' ? 'btn-primary' : 'btn-secondary'}" id="view-table">表格</button>
           <button class="btn btn-sm ${state.viewMode === 'heatmap' ? 'btn-primary' : 'btn-secondary'}" id="view-heatmap">热力图</button>
        </div>
      </div>
    `;

    if (state.viewMode === 'heatmap') {
      return `
        ${headerHtml}
        <div id="heatmap-container" style="width:100%;height:600px;border:1px solid var(--border-color);border-radius:var(--radius-md);"></div>
        <p class="text-sm text-muted mt-sm">提示：深色表示数值较大，鼠标悬停查看详情。</p>
        ${matrix.length > MAX_HEATMAP_DIMENSION || (matrix[0]?.length || 0) > MAX_HEATMAP_DIMENSION
          ? `<p class="text-sm text-muted mt-sm">热力图按间隔抽样到最多 ${MAX_HEATMAP_DIMENSION}×${MAX_HEATMAP_DIMENSION}；导出保留完整结果。</p>`
          : ''}
      `;
    }

    return `
      ${headerHtml}
      <div class="table-container mt-md" style="max-height:400px;overflow:auto">
        <table class="table">
          <thead><tr><th></th>${visibleColNames.map(n => `<th>${escapeHTML(n)}</th>`).join('')}</tr></thead>
          <tbody>
            ${visibleMatrix.map((row, i) => `
              <tr>
                <td><strong>${escapeHTML(visibleRowNames[i])}</strong></td>
                ${row.map(v => `<td class="numeric">${v.toFixed(4)}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${tableTruncated ? `<p class="text-sm text-muted mt-sm">为保持页面响应，仅显示前 ${MAX_RENDER_DIMENSION} 行和前 ${MAX_RENDER_DIMENSION} 列；导出文件保留完整结果。</p>` : ''}
    `;
  }

  return '<p class="text-muted">无数据</p>';
}

function renderFooter(): string {
  return `
    <footer class="footer">
      <div class="container footer-content">
        <p class="footer-title">📚 权威投入产出数据库</p>
        <div class="footer-links">
          ${IO_DATABASES.map(db => `
            <a href="${db.url}" target="_blank" rel="noopener noreferrer" class="footer-link">
              <span class="footer-link-name">${escapeHTML(db.name)}</span>
              <span class="footer-link-desc">${escapeHTML(db.desc)}</span>
            </a>
          `).join('')}
        </div>
      </div>
    </footer>
  `;
}

// Sheet 选择模态框
function renderSheetModal(): string {
  return `
    <div class="modal-overlay" id="sheet-modal">
      <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="sheet-modal-title" tabindex="-1">
        <div class="modal-header">
          <h2 id="sheet-modal-title">📊 选择 Excel Sheet 并指定数据类型</h2>
          <button class="btn btn-icon" id="btn-close-modal" aria-label="关闭导入窗口">✕</button>
        </div>
        <div class="modal-body">
          <p class="text-muted mb-md">文件: ${escapeHTML(state.pendingFile?.name || '')} (共 ${state.excelSheets.length} 个 Sheet)</p>
          
          <div class="sheet-list">
            ${state.excelSheets.map((sheet, idx) => {
              const inferredType = inferExcelSheetType(sheet.name);
              return `
              <div class="sheet-item" data-sheet-idx="${idx}">
                <div class="sheet-info">
                  <strong>${escapeHTML(sheet.name)}</strong>
                  <span class="text-muted">${sheet.rows}×${sheet.cols}</span>
                </div>
                <label class="sr-only" for="sheet-type-${idx}">为 ${escapeHTML(sheet.name)} 选择数据类型</label>
                <select class="form-select sheet-type-select" id="sheet-type-${idx}" data-sheet-idx="${idx}">
                  <option value="" ${inferredType === '' ? 'selected' : ''}>-- 跳过 --</option>
                  <option value="Z" ${inferredType === 'Z' ? 'selected' : ''}>Z - 中间投入矩阵</option>
                  <option value="x" ${inferredType === 'x' ? 'selected' : ''}>x - 总产出向量</option>
                  <option value="Y" ${inferredType === 'Y' ? 'selected' : ''}>Y - 最终需求</option>
                  <option value="VA" ${inferredType === 'VA' ? 'selected' : ''}>VA - 增加值</option>
                  <option value="F" ${inferredType === 'F' ? 'selected' : ''}>F - 卫星账户</option>
                  <option value="sectors" ${inferredType === 'sectors' ? 'selected' : ''}>📋 部门名称列表</option>
                  <option value="regions" ${inferredType === 'regions' ? 'selected' : ''}>🌍 区域名称列表</option>
                </select>
              </div>
            `}).join('')}
          </div>
          
          <div class="form-group mt-md">
            <label class="form-label">
              <input type="checkbox" id="modal-has-headers" checked> 第一行/列为标题（自动提取部门名称）
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="btn-cancel-import">取消</button>
          <button class="btn btn-primary" id="btn-confirm-import">确认导入</button>
        </div>
      </div>
    </div>
  `;
}

// 事件绑定
function bindEvents(): void {
  // 步骤导航
  document.querySelectorAll('.step').forEach(el => {
    el.addEventListener('click', () => {
      const step = parseInt(el.getAttribute('data-step') || '0');
      if (step <= state.currentStep) {
        state.currentStep = step;
        updateView();
      }
    });
  });

  // 加载示例
  document.getElementById('btn-sample')?.addEventListener('click', () => {
    cancelCalculation(false);
    state.data = createSampleIOData();
    state.validation = null;
    state.results = null;
    state.calculationErrors = [];
    state.calculationWarnings = [];
    updateView();
  });

  // 重置
  document.getElementById('btn-reset')?.addEventListener('click', () => {
    cancelCalculation(false);
    state.data = null;
    state.validation = null;
    state.results = null;
    state.calculationErrors = [];
    state.calculationWarnings = [];
    state.currentStep = 0;
    state.config = { ...DEFAULT_CONFIG };
    updateView();
  });

  // 文件上传
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input') as HTMLInputElement;

  uploadZone?.addEventListener('click', () => fileInput?.click());
  uploadZone?.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
  uploadZone?.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone?.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const file = e.dataTransfer?.files[0];
    if (file) handleFile(file);
  });
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleFile(file);
  });

  // 粘贴解析
  document.getElementById('btn-parse')?.addEventListener('click', handlePaste);

  // 导航按钮
  document.getElementById('btn-next-1')?.addEventListener('click', () => {
    if (state.data) {
      state.currentStep = 1;
      state.validation = validateIOData(state.data, state.config.tolerance);
      updateView();
    }
  });
  document.getElementById('btn-prev-2')?.addEventListener('click', () => { state.currentStep = 0; updateView(); });
  document.getElementById('btn-next-2')?.addEventListener('click', () => {
    if (state.validation?.status !== 'fail') {
      state.currentStep = 2;
      updateView();
    }
  });
  document.getElementById('btn-validate')?.addEventListener('click', () => {
    if (state.data) {
      state.validation = validateIOData(state.data, state.config.tolerance);
      updateView();
    }
  });

  // 部门合并事件
  document.getElementById('enable-aggregation')?.addEventListener('change', (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    const configDiv = document.getElementById('aggregation-config');
    if (configDiv) {
      configDiv.style.display = enabled ? 'block' : 'none';
    }
  });

  document.getElementById('btn-apply-aggregation')?.addEventListener('click', async () => {
    if (!state.data) return;

    const groupSize = parseInt((document.getElementById('agg-group-size') as HTMLInputElement)?.value) || 2;
    const n = state.data.x.length;

    if (groupSize < 2 || groupSize > n) {
      alert('合并比例无效');
      return;
    }

    try {
      const { createSimpleAggregation, aggregateSectors } = await import('./core/aggregation');
      const config = createSimpleAggregation(n, groupSize, state.data.sectorNames);
      state.data = aggregateSectors(state.data, config);
      state.validation = validateIOData(state.data, state.config.tolerance);
      alert(`合并完成：${n} 部门 → ${state.data.x.length} 部门`);
      updateView();
    } catch (e) {
      alert(`合并失败：${e instanceof Error ? e.message : '未知错误'}`);
    }
  });

  // 合并模式切换
  document.getElementById('aggregation-mode')?.addEventListener('change', (e) => {
    const mode = (e.target as HTMLSelectElement).value;
    const simpleDiv = document.getElementById('simple-aggregation');
    const customDiv = document.getElementById('custom-aggregation');
    if (simpleDiv) simpleDiv.style.display = mode === 'simple' ? 'block' : 'none';
    if (customDiv) customDiv.style.display = mode === 'custom' ? 'block' : 'none';
  });

  // 自定义合并
  document.getElementById('btn-apply-custom-aggregation')?.addEventListener('click', async () => {
    if (!state.data) return;

    const rulesText = (document.getElementById('custom-merge-rules') as HTMLTextAreaElement)?.value || '';
    if (!rulesText.trim()) {
      alert('请输入合并规则');
      return;
    }

    try {
      const { parseMergeRules, createMrioAggregation, aggregateSectors } = await import('./core/aggregation');
      const mergeRules = parseMergeRules(rulesText);

      if (mergeRules.length === 0) {
        alert('未能解析任何有效规则');
        return;
      }

      const n = state.data.x.length;
      const sectorsPerRegion = state.data.isMRIO ?
        (state.data.sectorsPerRegion || Math.floor(n / state.mrioConfig.regionCount)) : n;
      const regionCount = state.data.isMRIO ? state.mrioConfig.regionCount : 1;

      const config = createMrioAggregation(sectorsPerRegion, regionCount, mergeRules, state.data.sectorNames);
      state.data = aggregateSectors(state.data, config);
      state.validation = validateIOData(state.data, state.config.tolerance);
      alert(`合并完成：${n} 部门 → ${state.data.x.length} 部门`);
      updateView();
    } catch (e) {
      alert(`合并失败：${e instanceof Error ? e.message : '未知错误'}`);
    }
  });

  document.getElementById('btn-prev-3')?.addEventListener('click', () => { state.currentStep = 1; updateView(); });
  document.getElementById('btn-calculate')?.addEventListener('click', runCalculation);
  document.getElementById('btn-cancel-calculation')?.addEventListener('click', () => cancelCalculation());
  document.getElementById('btn-prev-4')?.addEventListener('click', () => { state.currentStep = 2; updateView(); });

  // 配置复选框
  document.querySelectorAll('[data-config]').forEach(el => {
    el.addEventListener('change', (e) => {
      const key = (e.target as HTMLInputElement).getAttribute('data-config') as keyof CalculationConfig;
      if (key) {
        (state.config as unknown as Record<string, boolean>)[key] = (e.target as HTMLInputElement).checked;
        state.calculationErrors = [];
      }
    });
  });

  // 容差输入
  document.getElementById('tolerance')?.addEventListener('change', (e) => {
    state.config.tolerance = parseFloat((e.target as HTMLInputElement).value) || 1e-6;
    state.calculationErrors = [];
  });

  // Tab 切换与键盘导航
  const resultTabs = Array.from(document.querySelectorAll('.tab')) as HTMLButtonElement[];
  resultTabs.forEach((el, index) => {
    el.addEventListener('click', () => {
      const tabId = el.getAttribute('data-tab') || 'A';
      if (tabId === state.activeResultTab) return;
      state.activeResultTab = tabId;
      state.viewMode = 'table'; // 切换Tab时重置为表格视图
      updateView();
      requestAnimationFrame(() => {
        (document.querySelector(`[data-tab="${tabId}"]`) as HTMLButtonElement | null)?.focus();
      });
    });
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const offset = event.key === 'ArrowRight' ? 1 : -1;
      const next = (index + offset + resultTabs.length) % resultTabs.length;
      const nextTabId = resultTabs[next]?.getAttribute('data-tab');
      if (!nextTabId) return;
      state.activeResultTab = nextTabId;
      state.viewMode = 'table';
      updateView();
      requestAnimationFrame(() => {
        (document.querySelector(`[data-tab="${nextTabId}"]`) as HTMLButtonElement | null)?.focus();
      });
    });
  });

  // 视图切换 (表格/热力图)
  document.getElementById('view-table')?.addEventListener('click', () => {
    state.viewMode = 'table';
    updateView();
  });
  document.getElementById('view-heatmap')?.addEventListener('click', () => {
    state.viewMode = 'heatmap';
    updateView();
  });

  // 尝试渲染热力图 (如果在热力图模式下)
  if (state.currentStep === 3 && state.viewMode === 'heatmap') {
    // 稍微延迟确保 DOM 准备好（尽管 bindEvents 是在 innerHTML 后调用的，通常立即执行即可）
    requestAnimationFrame(() => renderHeatmap());
  }

  // 导出
  document.getElementById('btn-export-excel')?.addEventListener('click', async () => {
    if (state.data && state.results) {
      try {
        await exportResultsToExcel(state.data, state.results, state.validation || undefined);
      } catch (error) {
        alert(`Excel 导出失败：${error instanceof Error ? error.message : '未知错误'}`);
      }
    }
  });
  document.getElementById('btn-export-json')?.addEventListener('click', () => {
    if (state.data && state.results) {
      exportResultsToJSON(state.data, state.results, state.validation || undefined);
    }
  });

  // Sheet 选择模态框事件
  document.getElementById('btn-close-modal')?.addEventListener('click', closeSheetModal);
  document.getElementById('btn-cancel-import')?.addEventListener('click', closeSheetModal);
  document.getElementById('btn-confirm-import')?.addEventListener('click', handleSheetImport);
  document.getElementById('sheet-modal')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'sheet-modal') {
      closeSheetModal();
    }
  });
  document.querySelector('.modal-content')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') closeSheetModal();
  });
  if (state.showSheetModal) {
    requestAnimationFrame(() => {
      const firstSelect = document.querySelector('.sheet-type-select') as HTMLSelectElement | null;
      const dialog = document.querySelector('.modal-content') as HTMLElement | null;
      (firstSelect || dialog)?.focus();
    });
  }

  // MRIO 配置输入
  document.getElementById('mrio-region-count')?.addEventListener('change', (e) => {
    const value = parseInt((e.target as HTMLInputElement).value) || 1;
    state.mrioConfig.regionCount = Math.max(1, value);
    applyMrioConfig();
    updateView();
  });
  document.getElementById('mrio-sectors-per-region')?.addEventListener('change', (e) => {
    const value = parseInt((e.target as HTMLInputElement).value) || 0;
    state.mrioConfig.sectorsPerRegion = Math.max(0, value);
    applyMrioConfig();
    updateView();
  });

  // 区域名称输入
  document.getElementById('mrio-region-names')?.addEventListener('change', (e) => {
    const text = (e.target as HTMLTextAreaElement).value.trim();
    if (text && state.data) {
      const names = text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
      if (names.length === state.mrioConfig.regionCount) {
        state.data.regions = names;
      } else {
        alert(`区域名称数量 (${names.length}) 与区域数 (${state.mrioConfig.regionCount}) 不匹配`);
      }
    }
    updateView();
  });
}

// 应用 MRIO 手动配置到当前数据
function applyMrioConfig(): void {
  if (!state.data) return;

  const n = state.data.x.length;
  const { regionCount, sectorsPerRegion } = state.mrioConfig;

  // 如果 sectorsPerRegion 为 0，自动计算
  const actualSectorsPerRegion = sectorsPerRegion > 0 ? sectorsPerRegion : Math.floor(n / regionCount);

  // 验证配置
  if (regionCount > 1 && actualSectorsPerRegion * regionCount !== n) {
    console.warn(`MRIO 配置警告: ${regionCount} 区域 × ${actualSectorsPerRegion} 部门/区域 = ${regionCount * actualSectorsPerRegion} ≠ n=${n}`);
  }

  // 应用配置
  if (regionCount > 1) {
    state.data.isMRIO = true;
    // 只有在没有自定义区域名称时才使用默认名称
    if (!state.data.regions || state.data.regions.length !== regionCount) {
      state.data.regions = Array.from({ length: regionCount }, (_, i) => `Region ${i + 1}`);
    }
    state.data.sectorsPerRegion = actualSectorsPerRegion;
  } else {
    state.data.isMRIO = false;
    state.data.regions = undefined;
    state.data.sectorsPerRegion = undefined;
  }

  state.validation = null;
  state.results = null;
  state.calculationErrors = [];
}

// 关闭 Sheet 选择模态框
function closeSheetModal(): void {
  state.showSheetModal = false;
  state.excelSheets = [];
  state.pendingFile = null;
  updateView();
}

// 文件处理
async function handleFile(file: File): Promise<void> {
  const ext = file.name.toLowerCase().split('.').pop() || '';

  try {
    // Excel 文件：显示 Sheet 选择模态框
    if (ext === 'xlsx' || ext === 'xls') {
      const result = await readExcelFile(file);

      if (result.error) {
        alert(`Excel 文件读取失败：${result.error}`);
        return;
      }

      if (result.sheets.length === 0) {
        alert('Excel 文件中没有找到有效的 Sheet');
        return;
      }

      // 保存 sheets 信息并显示模态框
      state.excelSheets = result.sheets.map(sheet => ({
        name: sheet.name,
        data: sheet.data,
        rows: sheet.data.length,
        cols: sheet.data[0]?.length || 0
      }));
      state.pendingFile = file;
      state.showSheetModal = true;
      updateView();
      return;
    }

    // 其他格式：直接处理
    const result = await readMatrixFile(file);

    if (result.error) {
      alert(`文件读取失败：${result.error}`);
      return;
    }

    if (result.matrices.length === 0) {
      alert('未在文件中找到有效矩阵数据');
      return;
    }

    // 初始化数据
    if (!state.data) {
      state.data = { Z: [], x: [] };
    }

    // 根据文件名或变量名推断数据类型
    for (const mat of result.matrices) {
      const name = mat.name.toLowerCase();

      if (name.includes('z') || name.includes('intermediate') || name.includes('中间')) {
        state.data.Z = mat.data;
      } else if (name.includes('x') || name.includes('output') || name.includes('产出')) {
        const vector = matrixToVector(mat.data);
        if (!vector) {
          alert(`矩阵 "${mat.name}" 不能作为 x：总产出必须是一行或一列`);
          continue;
        }
        state.data.x = vector;
      } else if (name.includes('y') || name.includes('final') || name.includes('需求')) {
        state.data.Y = mat.data;
      } else if (name.includes('va') || name.includes('value') || name.includes('增加值')) {
        state.data.VA = mat.data;
      } else if (name.includes('f') || name.includes('emission') || name.includes('carbon') || name.includes('排放')) {
        state.data.F = mat.data;
      } else {
        const rows = mat.data.length;
        const cols = mat.data[0]?.length || 0;

        if (rows === cols && rows > 1 && !state.data.Z.length) {
          state.data.Z = mat.data;
        } else if (rows === 1 || cols === 1) {
          if (!state.data.x.length) {
            const vector = matrixToVector(mat.data);
            if (vector) state.data.x = vector;
          }
        }
      }
    }

    if (result.sectorNames) {
      state.data.sectorNames = result.sectorNames;
    }

    if (state.data.Z.length === 0 || state.data.x.length === 0) {
      alert(`文件 "${file.name}" 已加载 ${result.matrices.length} 个矩阵。\n请检查数据并通过粘贴功能补充缺失的 Z 或 x 数据。`);
    }

    state.validation = null;
    state.results = null;
    state.calculationErrors = [];
    updateView();
  } catch (e) {
    alert(`文件处理失败：${e instanceof Error ? e.message : '未知错误'}`);
  }
}

// 处理 Sheet 选择模态框确认
function handleSheetImport(): void {
  const hasHeaders = (document.getElementById('modal-has-headers') as HTMLInputElement)?.checked ?? true;
  const selects = document.querySelectorAll('.sheet-type-select') as NodeListOf<HTMLSelectElement>;
  const imported: Partial<IOData> = {};
  const importErrors: string[] = [];

  Array.from(selects).forEach((select, idx) => {
    const type = select.value;
    const sheet = state.excelSheets[idx];
    if (!type || !sheet) return;

    switch (type) {
      case 'Z': {
        const parsed = parseNumericMatrix(sheet.data, hasHeaders, hasHeaders);
        if (parsed.errors.length > 0) {
          importErrors.push(`${sheet.name}: ${formatMatrixParseErrors(parsed.errors)}`);
          break;
        }
        imported.Z = parsed.matrix;
        const { rowNames, colNames } = parsed;
        if (rowNames && rowNames.length > 0) {
          imported.sectorNames = rowNames;
        } else if (colNames && colNames.length > 0) {
          imported.sectorNames = colNames;
        }
        break;
      }
      case 'x': {
        const parsed = parseNumericVector(sheet.data, hasHeaders);
        if (parsed.errors.length > 0) {
          importErrors.push(`${sheet.name}: ${formatMatrixParseErrors(parsed.errors)}`);
          break;
        }
        imported.x = parsed.vector;
        break;
      }
      case 'Y': {
        const parsed = parseNumericMatrix(sheet.data, hasHeaders, hasHeaders);
        if (parsed.errors.length > 0) {
          importErrors.push(`${sheet.name}: ${formatMatrixParseErrors(parsed.errors)}`);
          break;
        }
        imported.Y = parsed.matrix;
        if (parsed.colNames) imported.finalDemandNames = parsed.colNames;
        break;
      }
      case 'VA': {
        const parsed = parseNumericMatrix(sheet.data, hasHeaders, hasHeaders);
        if (parsed.errors.length > 0) {
          importErrors.push(`${sheet.name}: ${formatMatrixParseErrors(parsed.errors)}`);
          break;
        }
        imported.VA = parsed.matrix;
        if (parsed.rowNames) imported.valueAddedNames = parsed.rowNames;
        break;
      }
      case 'F': {
        const parsed = parseNumericMatrix(sheet.data, hasHeaders, hasHeaders);
        if (parsed.errors.length > 0) {
          importErrors.push(`${sheet.name}: ${formatMatrixParseErrors(parsed.errors)}`);
          break;
        }
        imported.F = parsed.matrix;
        if (parsed.rowNames) imported.satelliteNames = parsed.rowNames;
        break;
      }
      case 'sectors': {
        // 部门名称列表：取第一列或第一行
        const names = sheet.data
          .slice(hasHeaders ? 1 : 0)
          .map(row => row[0]?.toString() || '')
          .filter(n => n);
        if (names.length > 0) {
          imported.sectorNames = names;
        }
        break;
      }
      case 'regions': {
        // 区域名称列表：取第一列或第一行
        const regionNames = sheet.data
          .slice(hasHeaders ? 1 : 0)
          .map(row => row[0]?.toString() || '')
          .filter(n => n);
        if (regionNames.length > 0) {
          imported.regions = regionNames;
          imported.isMRIO = regionNames.length > 1;
        }
        break;
      }
    }
  });

  if (importErrors.length > 0) {
    alert(`导入已停止，请修正以下问题：\n${importErrors.join('\n')}`);
    return;
  }

  const existing = state.data || { Z: [], x: [] };
  const nextData: IOData = {
    ...existing,
    ...imported,
    Z: imported.Z || existing.Z,
    x: imported.x || existing.x
  };

  if (nextData.isMRIO && nextData.regions) {
    const regionCount = nextData.regions.length;
    const sectorsPerRegion = regionCount > 0 && nextData.x.length % regionCount === 0
      ? nextData.x.length / regionCount
      : 0;
    nextData.sectorsPerRegion = sectorsPerRegion;
    state.mrioConfig = { regionCount, sectorsPerRegion };
  }

  state.data = nextData;
  state.validation = null;
  state.results = null;
  state.calculationErrors = [];

  // 关闭模态框
  state.showSheetModal = false;
  state.excelSheets = [];
  state.pendingFile = null;

  updateView();
}

function matrixToVector(matrix: number[][]): number[] | null {
  if (matrix.length === 1) return matrix[0];
  if (matrix.length > 0 && matrix.every(row => row.length === 1)) {
    return matrix.map(row => row[0]);
  }
  return null;
}

// 粘贴处理
function handlePaste(): void {
  const textarea = document.getElementById('paste-area') as HTMLTextAreaElement;
  const typeSelect = document.getElementById('paste-type') as HTMLSelectElement;
  const hasHeaders = (document.getElementById('has-headers') as HTMLInputElement).checked;

  if (!textarea?.value.trim()) {
    alert('请先粘贴数据');
    return;
  }

  const { data } = parseClipboardMatrix(textarea.value);
  const type = typeSelect.value;
  const parsed = type === 'x'
    ? parseNumericVector(data, hasHeaders)
    : parseNumericMatrix(data, hasHeaders, hasHeaders);
  if (parsed.errors.length > 0) {
    alert(`解析失败：${formatMatrixParseErrors(parsed.errors)}`);
    return;
  }
  const { matrix, rowNames, colNames } = parsed;

  if (!state.data) {
    state.data = { Z: [], x: [] };
  }

  switch (type) {
    case 'Z':
      state.data.Z = matrix;
      if (rowNames) state.data.sectorNames = rowNames;
      break;
    case 'x':
      state.data.x = (parsed as ReturnType<typeof parseNumericVector>).vector;
      break;
    case 'Y':
      state.data.Y = matrix;
      if (colNames) state.data.finalDemandNames = colNames;
      break;
    case 'VA':
      state.data.VA = matrix;
      if (rowNames) state.data.valueAddedNames = rowNames;
      break;
    case 'F':
      state.data.F = matrix;
      if (rowNames) state.data.satelliteNames = rowNames;
      break;
  }

  state.validation = null;
  state.results = null;
  state.calculationErrors = [];
  textarea.value = '';
  updateView();
}

// 运行计算
function runCalculation(): void {
  if (!state.data) return;

  cancelCalculation(false);

  state.validation = validateIOData(state.data, state.config.tolerance);
  if (state.validation.status === 'fail') {
    state.results = null;
    state.calculationErrors = state.validation.errors
      .filter(error => error.severity === 'error')
      .map(error => ({ code: error.code, message: error.message, details: error.details, severity: 'error' }));
    state.calculationWarnings = [];
    state.currentStep = 1;
    updateView();
    return;
  }

  const requestId = ++calculationRequestId;
  const worker = new Worker(
    new URL('./workers/calculation.worker.ts', import.meta.url),
    { type: 'module' }
  );
  calculationWorker = worker;
  state.isCalculating = true;
  state.results = null;
  state.calculationErrors = [];
  state.calculationWarnings = [];
  updateView();

  worker.onmessage = (event: MessageEvent<CalculationWorkerResponse>) => {
    const response = event.data;
    if (response.requestId !== requestId || requestId !== calculationRequestId) return;

    finishCalculationWorker();
    if (response.type === 'error') {
      state.calculationErrors = [{
        code: 'WORKER_CALCULATION_FAILED',
        message: '后台计算失败',
        details: response.message,
        severity: 'error'
      }];
      updateView();
      return;
    }

    const blocking = response.issues.filter(issue => issue.severity !== 'warning');
    state.calculationWarnings = response.issues.filter(issue => issue.severity === 'warning');
    if (blocking.length > 0) {
      state.calculationErrors = blocking;
      updateView();
      return;
    }

    state.results = response.results;
    state.calculationErrors = [];
    state.currentStep = 3;
    updateView();
  };

  worker.onerror = (event) => {
    if (requestId !== calculationRequestId) return;
    finishCalculationWorker();
    state.calculationErrors = [{
      code: 'WORKER_RUNTIME_ERROR',
      message: '后台计算线程异常',
      details: event.message,
      severity: 'error'
    }];
    updateView();
  };

  const request: CalculationWorkerRequest = {
    type: 'calculate',
    requestId,
    data: state.data,
    config: state.config
  };
  worker.postMessage(request);
}

function finishCalculationWorker(): void {
  calculationWorker?.terminate();
  calculationWorker = null;
  state.isCalculating = false;
}

function cancelCalculation(update: boolean = true): void {
  if (!calculationWorker && !state.isCalculating) return;
  calculationRequestId++;
  finishCalculationWorker();
  if (update) updateView();
}

// 更新视图
function updateView(): void {
  const app = document.getElementById('app');
  if (app) {
    disposeHeatmap();
    app.innerHTML = renderApp();
    bindEvents();
  }
}

function disposeHeatmap(): void {
  if (heatmapResizeHandler) {
    window.removeEventListener('resize', heatmapResizeHandler);
    heatmapResizeHandler = null;
  }
  if (activeHeatmap) {
    activeHeatmap.dispose();
    activeHeatmap = null;
  }
}

// 渲染热力图
function renderHeatmap(): void {
  const container = document.getElementById('heatmap-container');
  if (!container || !state.results || !state.data) return;

  const tabId = state.activeResultTab || 'A';
  let matrix: number[][] | undefined;
  let title = '';

  // 获取当前矩阵数据
  switch (tabId) {
    case 'A': matrix = state.results.A; title = 'A 直接消耗系数'; break;
    case 'L': matrix = state.results.L; title = 'L Leontief 逆矩阵'; break;
    case 'G': matrix = state.results.G; title = 'G Ghosh 逆矩阵'; break;
    case 's': matrix = state.results.s; title = 's 卫星强度'; break;
    case 'M': matrix = state.results.M; title = 'M 足迹乘数'; break;
  }

  if (!matrix) return;

  const names = state.data.sectorNames || state.data.x.map((_, i) => `部门${i + 1}`);
  let rowNames = names;
  let colNames = names;

  if (tabId === 's' || tabId === 'M') {
    rowNames = state.data.satelliteNames || matrix.map((_, i) => `行${i + 1}`);
  }

  const rowStep = Math.max(1, Math.ceil(matrix.length / MAX_HEATMAP_DIMENSION));
  const colStep = Math.max(1, Math.ceil((matrix[0]?.length || 0) / MAX_HEATMAP_DIMENSION));
  const sampledRows = Array.from(
    { length: Math.ceil(matrix.length / rowStep) },
    (_, index) => index * rowStep
  ).filter(index => index < matrix.length);
  const sampledCols = Array.from(
    { length: Math.ceil((matrix[0]?.length || 0) / colStep) },
    (_, index) => index * colStep
  ).filter(index => index < (matrix[0]?.length || 0));

  // 生成原始位置编号作为坐标轴标签
  const colIndices = sampledCols.map(index => String(index + 1));
  const rowIndices = sampledRows.map(index => String(index + 1));

  // 转换数据为 ECharts 格式 [y, x, value]
  const data: [number, number, number][] = [];
  let minVal = Number.POSITIVE_INFINITY;
  let maxVal = Number.NEGATIVE_INFINITY;
  for (let rowIndex = 0; rowIndex < sampledRows.length; rowIndex++) {
    const sourceRow = sampledRows[rowIndex];
    for (let colIndex = 0; colIndex < sampledCols.length; colIndex++) {
      const sourceCol = sampledCols[colIndex];
      const value = matrix[sourceRow][sourceCol];
      data.push([colIndex, rowIndex, value]);
      minVal = Math.min(minVal, value);
      maxVal = Math.max(maxVal, value);
    }
  }

  disposeHeatmap();
  const chart = echarts.init(container);
  activeHeatmap = chart;

  // 增强的颜色方案：提高对比度
  const hasNegative = minVal < 0;
  const inRangeConfig = hasNegative ? {
    // 蓝白红配色（适合有负数的情况）
    color: ['#053061', '#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b', '#67001f']
  } : {
    // 白到深红配色（高对比度）
    color: ['#ffffff', '#fee5d9', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#99000d']
  };

  const option = {
    tooltip: {
      position: 'top',
      formatter: (params: any) => {
        const i = params.value[1]; // row
        const j = params.value[0]; // col
        const sourceRow = sampledRows[i];
        const sourceCol = sampledCols[j];
        return `<strong>${escapeHTML(rowNames[sourceRow])}</strong> → <strong>${escapeHTML(colNames[sourceCol])}</strong><br>数值: <strong>${params.value[2].toFixed(6)}</strong>`;
      }
    },
    grid: {
      top: 40,
      bottom: 40,
      left: 50,
      right: 100,
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: colIndices, // 使用数字编号
      splitArea: { show: true },
      axisLabel: {
        interval: 0,
        rotate: 0, // 数字不需要旋转
        fontSize: 10
      },
      name: '列 (j)',
      nameLocation: 'middle',
      nameGap: 25
    },
    yAxis: {
      type: 'category',
      data: rowIndices, // 使用数字编号
      splitArea: { show: true },
      inverse: true, // 让第一行在顶部
      axisLabel: { fontSize: 10 },
      name: '行 (i)',
      nameLocation: 'middle',
      nameGap: 35
    },
    visualMap: {
      min: minVal,
      max: maxVal,
      calculable: true,
      orient: 'vertical',
      right: 10,
      top: 'center',
      inRange: inRangeConfig,
      text: ['高', '低'],
      textStyle: { color: '#333' }
    },
    series: [{
      name: title,
      type: 'heatmap',
      data: data,
      label: {
        show: sampledRows.length < 20,
        formatter: (p: any) => p.value[2].toFixed(3),
        fontSize: 9
      },
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowColor: 'rgba(0, 0, 0, 0.5)',
          borderColor: '#333',
          borderWidth: 2
        }
      }
    }]
  };

  chart.setOption(option);
  heatmapResizeHandler = () => chart.resize();
  window.addEventListener('resize', heatmapResizeHandler);
}

// 启动
document.addEventListener('DOMContentLoaded', init);
