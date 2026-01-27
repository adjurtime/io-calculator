const fs = require('fs');
const path = 'd:/Document/CUGB/4-Code/io-calculator/src/main.ts';

try {
    let content = fs.readFileSync(path, 'utf8');

    const badStart = "const rowNames = tabId === 's' || tabId === 'M' ? (d.satelliteNames || matrix.map((_, i) => `行${ i + 1 } `)) : names;";

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

    const startMarker = "if (matrix) {";
    // Using a more lenient end marker or finding it by offset
    // The broken code ends with: `    `;` (indented backticks?)
    // Let's rely on finding the second `if (matrix) {` ?? No.
    // Let's use the badStart to find the location.

    // The corrupted block STARTS after "return `"
    // It looks like:
    // ...
    //   if (matrix) {
    //     const rowNames ...
    //     return `
    //     const rowNames ... (BAD START)

    const blockStart = content.indexOf(startMarker);
    const endMarker = "return '<p class=\"text-muted\">无数据</p>';";
    const blockEnd = content.indexOf(endMarker, blockStart);

    if (blockStart !== -1 && blockEnd !== -1) {
        console.log(`Checking block between ${blockStart} and ${blockEnd}`);
        const currentBlock = content.substring(blockStart, blockEnd);

        // If it looks bad (contains the duplicate line)
        if (currentBlock.includes(badStart) || currentBlock.includes('const rowNames = tabId') && currentBlock.indexOf('const rowNames') !== currentBlock.lastIndexOf('const rowNames')) {
            console.log("Found corruption. Fixing...");
            content = content.substring(0, blockStart) + correctBlock + "\n\n  " + content.substring(blockEnd);
        } else {
            console.log("Block seems okay or pattern not found. dumping preview:");
            console.log(currentBlock.substring(0, 300));
        }
    } else {
        console.log("Could not find block boundaries.");
    }

    if (!content.includes('function renderHeatmap')) {
        console.log("Appending renderHeatmap...");
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
  const data = [];
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      data.push([j, i, matrix[i][j]]); // x=col, y=row
    }
  }

  const chart = echarts.init(container);
  
  const flatVals = matrix.flat();
  const maxVal = Math.max(...flatVals);
  const minVal = Math.min(...flatVals);

  const hasNegative = minVal < 0;
  const inRangeConfig = hasNegative ? {
    color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026']
  } : {
    color: ['#f6faaa', '#d88273', '#bf444c']
  };

  const option = {
    tooltip: {
      position: 'top',
      formatter: (params) => {
        const i = params.value[1];
        const j = params.value[0];
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
      inverse: true
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
        show: matrix.length < 25,
        formatter: (p) => p.value[2].toFixed(2)
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
    console.log("Success (CJS)!");

} catch (e) {
    console.error(e);
}
