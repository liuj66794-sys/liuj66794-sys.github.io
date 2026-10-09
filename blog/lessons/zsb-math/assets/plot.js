/* plot.js — 极简 SVG 函数绘图器（无依赖）
 *
 * 用法：
 *   <div class="plot" data-fn="Math.sin(x)" data-xmin="-6.8" data-xmax="6.8"
 *        data-ymin="-1.6" data-ymax="1.6" data-w="280" data-h="200"
 *        data-label="y = sin x" data-vlines="±1.5708"></div>
 *
 * data-fn     x 的表达式（JS 语法，可用 Math.*）
 * data-fn2    可选第二条曲线（虚线，朱砂色）
 * data-xmin/xmax/ymin/ymax   视窗；ymin/ymax 省略时按采样自动取范围
 * data-w/h    像素尺寸
 * data-label  底部说明文字（可用 $...$，配合 KaTeX 渲染）
 * data-vlines 竖直渐近线，逗号分隔；支持 "±1.5708" 简写（同时画正负）
 * data-hlines 水平渐近线，同上
 * data-clipy  越界截断阈值倍数（默认 3），相邻样本跳跃超限视为间断断开
 */
(function () {
  'use strict';

  window.ZC = window.ZC || {};

  var NS = 'http://www.w3.org/2000/svg';

  function expand(list) {
    var out = [];
    (list || '').split(',').forEach(function (t) {
      t = t.trim();
      if (!t) return;
      if (t.charAt(0) === '±') {
        var v = parseFloat(t.slice(1));
        if (!isNaN(v)) { out.push(v, -v); }
      } else {
        var w = parseFloat(t);
        if (!isNaN(w)) out.push(w);
      }
    });
    return out;
  }

  ZC.plot = function (el) {
    if (el.dataset.plotted) return;
    el.dataset.plotted = '1';

    var fn, fn2;
    try {
      fn = new Function('x', 'with (Math) { return (' + el.dataset.fn + '); }');
      if (el.dataset.fn2) fn2 = new Function('x', 'with (Math) { return (' + el.dataset.fn2 + '); }');
    } catch (e) { console.error('plot: 表达式错误', e); return; }

    var W = parseInt(el.dataset.w || '280', 10);
    var H = parseInt(el.dataset.h || '200', 10);
    var xmin = parseFloat(el.dataset.xmin != null ? el.dataset.xmin : -5);
    var xmax = parseFloat(el.dataset.xmax != null ? el.dataset.xmax : 5);

    var N = 480;
    var xs = [], ys = [];
    for (var i = 0; i <= N; i++) {
      var x = xmin + (xmax - xmin) * i / N;
      var y;
      try { y = fn(x); } catch (e) { y = NaN; }
      if (typeof y !== 'number' || isNaN(y) || !isFinite(y)) y = NaN;
      xs.push(x); ys.push(y);
    }

    var ymin, ymax;
    if (el.dataset.ymin != null && el.dataset.ymax != null) {
      ymin = parseFloat(el.dataset.ymin);
      ymax = parseFloat(el.dataset.ymax);
    } else {
      var finite = ys.filter(function (v) { return v != null && !isNaN(v); });
      finite.sort(function (a, b) { return a - b; });
      var lo = finite[Math.floor(finite.length * 0.03)];
      var hi = finite[Math.floor(finite.length * 0.97)];
      if (!isFinite(lo) || !isFinite(hi)) { lo = -2; hi = 2; }
      var pad = (hi - lo) * 0.12 || 1;
      ymin = lo - pad; ymax = hi + pad;
      if (ymax - ymin < 1e-9) { ymin -= 1; ymax += 1; }
    }

    var sx = function (x) { return (x - xmin) / (xmax - xmin) * W; };
    var sy = function (y) { return H - (y - ymin) / (ymax - ymin) * H; };

    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    /* 网格 */
    var grid = document.createElementNS(NS, 'g');
    grid.setAttribute('class', 'plot-grid');
    function niceStep(range) {
      var raw = range / 8;
      var mag = Math.pow(10, Math.floor(Math.log10 ? Math.log10(raw) : Math.log(raw) / Math.LN10));
      var n = raw / mag;
      var step = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
      return step * mag;
    }
    var gx = niceStep(xmax - xmin), gy = niceStep(ymax - ymin);
    for (var t = Math.ceil(xmin / gx) * gx; t <= xmax + 1e-9; t += gx) {
      var l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', sx(t)); l.setAttribute('x2', sx(t));
      l.setAttribute('y1', 0); l.setAttribute('y2', H);
      grid.appendChild(l);
    }
    for (var u = Math.ceil(ymin / gy) * gy; u <= ymax + 1e-9; u += gy) {
      var m = document.createElementNS(NS, 'line');
      m.setAttribute('x1', 0); m.setAttribute('x2', W);
      m.setAttribute('y1', sy(u)); m.setAttribute('y2', sy(u));
      grid.appendChild(m);
    }
    svg.appendChild(grid);

    /* 坐标轴 */
    var ax = document.createElementNS(NS, 'g');
    ax.setAttribute('class', 'plot-axis');
    if (ymin < 0 && ymax > 0) {
      var xaxis = document.createElementNS(NS, 'line');
      xaxis.setAttribute('x1', 0); xaxis.setAttribute('x2', W);
      xaxis.setAttribute('y1', sy(0)); xaxis.setAttribute('y2', sy(0));
      ax.appendChild(xaxis);
    }
    if (xmin < 0 && xmax > 0) {
      var yaxis = document.createElementNS(NS, 'line');
      yaxis.setAttribute('y1', 0); yaxis.setAttribute('y2', H);
      yaxis.setAttribute('x1', sx(0)); yaxis.setAttribute('x2', sx(0));
      ax.appendChild(yaxis);
    }
    svg.appendChild(ax);

    /* 渐近线 */
    expand(el.dataset.vlines).forEach(function (vx) {
      if (vx <= xmin || vx >= xmax) return;
      var v = document.createElementNS(NS, 'line');
      v.setAttribute('class', 'plot-asym');
      v.setAttribute('x1', sx(vx)); v.setAttribute('x2', sx(vx));
      v.setAttribute('y1', 0); v.setAttribute('y2', H);
      svg.appendChild(v);
    });
    expand(el.dataset.hlines).forEach(function (hy) {
      if (hy <= ymin || hy >= ymax) return;
      var h = document.createElementNS(NS, 'line');
      h.setAttribute('class', 'plot-asym');
      h.setAttribute('y1', sy(hy)); h.setAttribute('y2', sy(hy));
      h.setAttribute('x1', 0); h.setAttribute('x2', W);
      svg.appendChild(h);
    });

    /* 曲线（跳跃断开） */
    var clip = parseFloat(el.dataset.clipy || '3');
    function drawCurve(f, cls) {
      var d = '';
      var prevY = null;
      for (var i = 0; i <= N; i++) {
        var yv;
        try { yv = f(xs[i]); } catch (e) { yv = NaN; }
        if (typeof yv !== 'number' || isNaN(yv) || !isFinite(yv)) { prevY = null; continue; }
        if (yv < ymin - clip * (ymax - ymin) || yv > ymax + clip * (ymax - ymin)) { prevY = null; continue; }
        if (prevY !== null && Math.abs(yv - prevY) > clip * (ymax - ymin)) { prevY = null; }
        d += (prevY === null ? 'M' : 'L') + sx(xs[i]).toFixed(1) + ',' + sy(yv).toFixed(1);
        prevY = yv;
      }
      if (d) {
        var p = document.createElementNS(NS, 'path');
        p.setAttribute('class', cls);
        p.setAttribute('d', d);
        svg.appendChild(p);
      }
    }
    drawCurve(fn, 'plot-curve');
    if (fn2) drawCurve(fn2, 'plot-curve2');

    el.appendChild(svg);
    if (el.dataset.label) {
      var cap = document.createElement('div');
      cap.className = 'plot-caption';
      cap.textContent = el.dataset.label;
      el.appendChild(cap);
    }
  };

  ZC.plotAll = function () {
    document.querySelectorAll('.plot').forEach(ZC.plot);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ZC.plotAll);
  } else {
    ZC.plotAll();
  }
})();
