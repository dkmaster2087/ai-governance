// Apply the theme before React loads, so the page doesn't flash. A file, not inline: the gateway's security
// policy (and any strict one) allows only scripts served from the dashboard's own address.
(function () {
  // Light is the default; dark returns later as an opt-in theme.
  var theme = 'light';
  try { theme = localStorage.getItem('probaline_theme_v2') || 'light'; } catch (e) {}
  document.documentElement.className = theme;
})();
