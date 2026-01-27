const fs = require('fs');
const path = 'd:/Document/CUGB/4-Code/io-calculator/src/main.ts';

try {
    let content = fs.readFileSync(path, 'utf8');

    // 1. 定义损坏的代码块起始部分 (Line 515 approx)
    const badStart = "const rowNames = tabId === 's' || tabId === 'M' ? (d.satelliteNames || matrix.map((_, i) => `行${ i + 1 } `)) : names;";

    // 定义正确的代码块替换
    const correctBlock = `  if (matrix) {
    const rowNames = tabId === 's' || tabId === 'M' ? (d.satelliteNames || matrix.map((_, i) => \`行\${i + 1}\`)) : names;
    
    // 头部控制栏：支持切换视图
    const headerHtml = \`
      <div class="flex-between mb-md">
        <h3>\${title}</h3>
        <div class="result-toolbar btn-group">
           <button class="btn btn-sm \${state.viewMode === 'table' ? 'btn-primary' : 'btn-secondary'}" id="view-table">表格</button>
           <button class="btn btn-sm \${state.viewMode === 'heatmap' ? 'btn-primary' : 'btn-secondary'}" id="view-heatmap">热力图</button>
        </div>
      </div>
    \`;

    if (state.viewMode === 'heatmap') {
      return \`
        \${headerHtml}
        <div id="heatmap-container" style="width:100%;height:600px;border:1px solid var(--border-color);border-radius:var(--radius-md);"></div>
        <p class="text-sm text-muted mt-sm">提示：深色表示数值较大，鼠标悬停查看详情。</p>
      \`;
    }

    return \`
      \${headerHtml}
      <div class="table-container mt-md" style="max-height:400px;overflow:auto">
        <table class="table">
          <thead><tr><th></th>\${names.map(n => \`<th>\${n}</th>\`).join('')}</tr></thead>
          <tbody>
            \${matrix.map((row, i) => \`
              <tr>
                <td><strong>\${rowNames[i]}</strong></td>
                \${row.map(v => \`<td class="numeric">\${v.toFixed(4)}</td>\`).join('')}
              </tr>
            \`).join('')}
          </tbody>
        </table>
      </div>
    \`;
  }`;

    // 尝试定位损坏区块的范围
    // 我们知道它以 if (matrix) { 开始 (Line 512)，但后面紧接着重复的 const rowNames
    // 我们查找从 if (matrix) { 到 return '<p class="text-muted">无数据</p>'; 之前的部分

    const startMarker = "if (matrix) {";
    const endMarker = "return '<p class=\"text-muted\">无数据</p>';";

    const startIndex = content.indexOf(startMarker, 30000); // 从 30000 字符后搜索（跳过前面的代码）
    const endIndex = content.indexOf(endMarker, startIndex);

    if (startIndex !== -1 && endIndex !== -1) {
        console.log(`Found block at ${startIndex} to ${endIndex}`);
        // 检查这个块是否包含损坏的特征
        const block = content.substring(startIndex, endIndex);
        if (block.includes(badStart)) {
            console.log("Verified corrupted block. Replacing...");
            const newContent = content.substring(0, startIndex) + correctBlock + "\n\n  " + content.substring(endIndex);
            content = newContent;
        } else {
            console.log("Block found but didn't contain expected bad string. dumping substring check:");
            console.log(block.substring(0, 200));
        }
    } else {
        console.log("Could not locate block boundaries.");
    }

    // 2. 追加 renderHeatmap
    if (!content.includes('function renderHeatmap')) {
        console.log("Appending renderHeatmap function...");
        const renderHeatmapCode = `
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

  const names = state.data.sectorNames || state.data.x.map((_, i) => \`部门\${i + 1}\`);
  let rowNames = names;
  let colNames = names;

  if (tabId === 's' || tabId === 'M') {
    rowNames = state.data.satelliteNames || matrix.map((_, i) => \`行\${i+1}\`);
  }

  // 转换数据为 ECharts 格式 [y, x, value]
  const data: [number, number, number][] = [];
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      data.push([j, i, matrix[i][j]]); // x=col, y=row
    }
  }

  const chart = echarts.init(container);
  
  // 查找极值以设置颜色范围
  const flatVals = matrix.flat();
  const maxVal = Math.max(...flatVals);
  const minVal = Math.min(...flatVals);

  // 动态选择颜色方案：如果有负数（如关联），使用红蓝；全是正数，使用红黄
  const hasNegative = minVal < 0;
  const inRangeConfig = hasNegative ? {
    color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'] // 蓝 -> 红
  } : {
    color: ['#f6faaa', '#d88273', '#bf444c'] // 浅黄 -> 深红
  };

  const option = {
    tooltip: {
      position: 'top',
      formatter: (params: any) => {
        const i = params.value[1]; // row
        const j = params.value[0]; // col
        return \`\${rowNames[i]} → \${colNames[j]}<br><strong>\${params.value[2].toFixed(6)}</strong>\`;
      }
    },
    grid: {
      top: 60,
      bottom: 60,
      left: 60,
      right: 60,
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: colNames,
      splitArea: { show: true },
      axisLabel: { interval: 0, rotate: 45 }
    },
    yAxis: {
      type: 'category',
      data: rowNames,
      splitArea: { show: true },
      inverse: true // 让第一行在顶部
    },
    visualMap: {
      min: minVal,
      max: maxVal,
      calculable: true,
      orient: 'vertical',
      right: 0,
      top: 'center',
      inRange: inRangeConfig
    },
    series: [{
      name: title,
      type: 'heatmap',
      data: data,
      label: {
        show: matrix.length < 25, // 部门少时显示数值
        formatter: (p: any) => p.value[2].toFixed(2)
      },
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      }
    }]
  };

  chart.setOption(option);
  window.addEventListener('resize', () => chart.resize());
}
`;
        content += renderHeatmapCode;
    }

    fs.writeFileSync(path, content, 'utf8');
    console.log("Success!");

} catch (e) {
    console.error(e);
}
