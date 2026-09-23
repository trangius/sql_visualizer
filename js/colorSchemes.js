'use strict';

// ─── Colour schemes for the text ─────────────────────────────────────────────
// Each scheme colours the syntax (in the editor, and the matching text in the
// table boxes) and has a light and a dark variant, following the site's theme.
// The keys are the token colours from the design:
//   tbl: table names   type: types   flag: pk/null/unique and SQL keywords
//   arrow: "->" and SQL strings   ref: what an arrow points to, FK badges   com: comments
// Bleak is the site's own palette (onedarkbleak.nvim), the same values as in style.css
// (light: a bit more saturated than the original, which read as almost grey).

const COLOR_SCHEMES = {
  bleak: {
    name: 'Bleak',
    light: { tbl: '#a25a00', type: '#2b5c94', flag: '#b0392a', arrow: '#4a7d12', ref: '#4a7d12', com: '#8a7e60' },
    dark: { tbl: '#c8a878', type: '#8ab1c8', flag: '#d4a8a0', arrow: '#a8c896', ref: '#a8c896', com: '#6e6f72' },
  },
  github: {
    name: 'GitHub',
    light: { tbl: '#8250df', type: '#0550ae', flag: '#cf222e', arrow: '#953800', ref: '#116329', com: '#6e7781' },
    dark: { tbl: '#d2a8ff', type: '#79c0ff', flag: '#ff7b72', arrow: '#ffa657', ref: '#7ee787', com: '#8b949e' },
  },
  one: {
    name: 'One',
    light: { tbl: '#c18401', type: '#4078f2', flag: '#a626a4', arrow: '#0184bc', ref: '#50a14f', com: '#a0a1a7' },
    dark: { tbl: '#e5c07b', type: '#61afef', flag: '#c678dd', arrow: '#56b6c2', ref: '#98c379', com: '#7f848e' },
  },
  solarized: {
    name: 'Solarized',
    light: { tbl: '#b58900', type: '#268bd2', flag: '#d33682', arrow: '#2aa198', ref: '#859900', com: '#93a1a1' },
    dark: { tbl: '#b58900', type: '#268bd2', flag: '#d33682', arrow: '#2aa198', ref: '#859900', com: '#586e75' },
  },
  gruvbox: {
    name: 'Gruvbox',
    light: { tbl: '#b57614', type: '#076678', flag: '#9d0006', arrow: '#427b58', ref: '#79740e', com: '#928374' },
    dark: { tbl: '#fabd2f', type: '#83a598', flag: '#fb4934', arrow: '#8ec07c', ref: '#b8bb26', com: '#928374' },
  },
  catppuccin: {
    name: 'Catppuccin',
    light: { tbl: '#df8e1d', type: '#1e66f5', flag: '#8839ef', arrow: '#179299', ref: '#40a02b', com: '#7c7f93' },
    dark: { tbl: '#f9e2af', type: '#89b4fa', flag: '#cba6f7', arrow: '#94e2d5', ref: '#a6e3a1', com: '#9399b2' },
  },
  tokyonight: {
    name: 'Tokyo Night',
    light: { tbl: '#8c6c3e', type: '#2e7de9', flag: '#9854f1', arrow: '#007197', ref: '#587539', com: '#848cb5' },
    dark: { tbl: '#e0af68', type: '#7aa2f7', flag: '#bb9af7', arrow: '#7dcfff', ref: '#9ece6a', com: '#565f89' },
  },
};
const TOKEN_KEYS = ['tbl', 'type', 'flag', 'arrow', 'ref', 'com'];

// Set the token colours for the chosen scheme and the current light/dark mode
function applyColorScheme() {
  const key = COLOR_SCHEMES[state.colors] ? state.colors : 'bleak';
  const colors = COLOR_SCHEMES[key][isDark() ? 'dark' : 'light'];
  for (const k of TOKEN_KEYS) document.documentElement.style.setProperty('--tok-' + k, colors[k]);
  renderSchemeMenu(key);
}

// The menu: each scheme with a preview of its colours, the current one ticked
function renderSchemeMenu(current) {
  const preview = key => {
    const c = COLOR_SCHEMES[key][isDark() ? 'dark' : 'light'];
    return ['tbl', 'type', 'flag', 'ref'].map(k => `<i style="background:${c[k]}"></i>`).join('');
  };
  $('#schemeList').innerHTML = Object.entries(COLOR_SCHEMES).map(([key, s]) =>
    `<button role="menuitemradio" aria-checked="${key === current}" data-scheme="${key}">` +
    `<span class="check">${key === current ? '✓' : ''}</span><span class="scheme-name">${s.name}</span>` +
    `<span class="swatches">${preview(key)}</span></button>`).join('');
}
