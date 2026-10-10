/* math.js — 本地 KaTeX 加载与公式渲染（离线可用）
 * 页面只需引入本文件；KaTeX 资源按本文件自身 URL 定位，与页面所在目录无关。
 * 行内公式 $...$ 或 \(...\)，行间公式 $$...$$。
 */
(function () {
  window.ZC = window.ZC || {};

  var base = (function () {
    var s = document.currentScript;
    if (!s) return 'assets/';
    return s.src.replace(/math\.js(\?.*)?$/, '');
  })();

  ZC.MATH_OPTS = {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\(', right: '\\)', display: false },
      { left: '$', right: '$', display: false }
    ],
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
    throwOnError: false
  };

  ZC.renderMath = function (node) {
    if (window.renderMathInElement) {
      try { renderMathInElement(node || document.body, ZC.MATH_OPTS); } catch (e) { /* 忽略单点渲染失败 */ }
    }
  };

  function loadCss(href) {
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }

  function loadJs(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  ZC.mathReady = (async function () {
    loadCss(base + 'katex/katex.min.css');
    await loadJs(base + 'katex/katex.min.js');
    await loadJs(base + 'katex/contrib/auto-render.min.js');
    ZC.renderMath();
    document.dispatchEvent(new CustomEvent('zc-math-ready'));
  })().catch(function (e) {
    console.error('KaTeX 加载失败：', e);
  });
})();
