/* 页内目录组件：自动扫描页面中的 h2，生成可点击的目录，并附返回学习地图的链接。
   使用方式：在 <head> 中加入（路径按页面所在层级调整）：
   <script src="../assets/toc.js" defer></script> */
(function () {
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    var h1 = document.querySelector('h1');
    var headings = document.querySelectorAll('h2');
    if (!h1 || headings.length === 0) return;

    // 由本脚本的 src 推导工作区根路径，保证 lessons/、reference/ 和根目录页面都能正确回到 index.html
    var src = document.currentScript ? document.currentScript.src : '';
    var idx = src.indexOf('assets/toc.js');
    var root = idx >= 0 ? src.slice(0, idx) : './';

    var nav = document.createElement('nav');
    nav.className = 'toc';
    nav.setAttribute('aria-label', '本页目录');

    var home = document.createElement('a');
    home.className = 'toc-home';
    home.href = root + 'index.html';
    home.textContent = '← 返回学习地图';
    nav.appendChild(home);

    var title = document.createElement('div');
    title.className = 'toc-title';
    title.textContent = '本页目录';
    nav.appendChild(title);

    var list = document.createElement('ol');
    headings.forEach(function (h, i) {
      if (!h.id) h.id = 'sec-' + (i + 1);
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = h.textContent;
      li.appendChild(a);
      list.appendChild(li);
    });
    nav.appendChild(list);

    h1.insertAdjacentElement('afterend', nav);
  });
})();
