// 主题预加载：在 CSS 渲染前恢复跨页面主题，避免切页时短暂闪烁。
(function () {
  try {
    if (localStorage.getItem('elderMonitorTheme') === 'light') {
      document.documentElement.classList.add('light-mode');
    }
  } catch (error) {
    // localStorage 不可用时保持默认深色主题。
  }
}());
