'use strict';

// ─── Themes ──────────────────────────────────────────────────────────────────
// Each theme colours the whole page: the bars and panels, the editor's syntax, the
// canvas and the table boxes. Each has a light and a dark variant, following the
// light/dark toggle. They are based on well-known editor themes; Bleak is the
// site's own palette (onedarkbleak.nvim), the same values as in style.css.
//
// A variant sets the page colours (bg, panel, soft, line, line2, fg, muted, faint,
// accent, err, warn) and the syntax tokens:
//   tbl: table names   type: types   flag: pk/null/unique and SQL keywords
//   arrow: "->" and SQL strings   ref: what an arrow points to, FK badges   com: comments
// Optional: canvas, dot, hover, edge (arrows), boxBg, boxBorder, rowHover,
// head/headFg (the table name bar; unset = same as the box), accentFg, accentSoft, sel,
// keyL/keyC (OKLCH lightness and chroma of the key colours), dvS/dvL (data view row colours).

const THEMES = {
  bleak: {
    name: 'Bleak',
    light: {
      bg: '#f5efe2', panel: '#faf6ee', soft: '#f0e8d6', dot: '#dccfb4', line: '#e6dcc6', line2: '#dccfb4',
      fg: '#1c1812', muted: '#5e5440', faint: '#8a7e60', accent: '#3a4658', accentSoft: '#e5e0d2',
      sel: 'rgba(58, 70, 88, .18)', err: '#7a2e22', warn: '#7e5414',
      boxBg: '#fffcf5', boxBorder: '#d3cab2', rowHover: '#f5efe2', keyL: .52, keyC: .11,
      tok: { tbl: '#a25a00', type: '#2b5c94', flag: '#b0392a', arrow: '#4a7d12', ref: '#4a7d12', com: '#8a7e60' },
    },
    dark: {
      bg: '#101012', panel: '#1b1c1e', soft: '#232427', canvas: '#141414', dot: '#2c2d31', hover: '#2c2d31',
      line: '#2c2d31', line2: '#35363b', fg: '#d4ccbf', muted: '#a8a8a4', faint: '#5a5b5e',
      accent: '#8ab1c8', accentFg: '#141414', accentSoft: '#1f2a31', sel: 'rgba(138, 177, 200, .25)',
      err: '#c4928e', warn: '#c8a878', edge: '#818387', boxBorder: '#37383d', keyL: .74, keyC: .085,
      tok: { tbl: '#c8a878', type: '#8ab1c8', flag: '#d4a8a0', arrow: '#a8c896', ref: '#a8c896', com: '#6e6f72' },
    },
  },
  github: {
    name: 'GitHub',
    light: {
      bg: '#f6f8fa', panel: '#ffffff', soft: '#eff2f5', dot: '#d8dee4', line: '#d8dee4', line2: '#d0d7de',
      fg: '#1f2328', muted: '#59636e', faint: '#818b98', accent: '#0969da', err: '#cf222e', warn: '#9a6700',
      head: '#f6f8fa',
      tok: { tbl: '#8250df', type: '#0550ae', flag: '#cf222e', arrow: '#953800', ref: '#116329', com: '#6e7781' },
    },
    dark: {
      bg: '#010409', panel: '#0d1117', soft: '#151b23', dot: '#21262d', line: '#21262d', line2: '#3d444d',
      fg: '#e6edf3', muted: '#9198a1', faint: '#656c76', accent: '#4493f8', err: '#f85149', warn: '#d29922',
      head: '#151b23',
      tok: { tbl: '#d2a8ff', type: '#79c0ff', flag: '#ff7b72', arrow: '#ffa657', ref: '#7ee787', com: '#8b949e' },
    },
  },
  one: {
    name: 'One',
    light: {
      bg: '#f0f0f1', panel: '#fafafa', soft: '#e5e5e6', dot: '#dbdbdc', line: '#e5e5e6', line2: '#d4d4d6',
      fg: '#383a42', muted: '#696c77', faint: '#a0a1a7', accent: '#4078f2', err: '#e45649', warn: '#986801',
      boxBg: '#ffffff',
      tok: { tbl: '#c18401', type: '#4078f2', flag: '#a626a4', arrow: '#0184bc', ref: '#50a14f', com: '#a0a1a7' },
    },
    dark: {
      bg: '#21252b', panel: '#282c34', soft: '#2c313a', dot: '#333842', line: '#333842', line2: '#3e4451',
      fg: '#abb2bf', muted: '#9da5b4', faint: '#5c6370', accent: '#61afef', err: '#e06c75', warn: '#d19a66',
      tok: { tbl: '#e5c07b', type: '#61afef', flag: '#c678dd', arrow: '#56b6c2', ref: '#98c379', com: '#7f848e' },
    },
  },
  solarized: {
    name: 'Solarized',
    light: {
      bg: '#eee8d5', panel: '#fdf6e3', soft: '#eee8d5', canvas: '#fdf6e3', dot: '#e4ddc8', line: '#e4ddc8', line2: '#d3cbb3',
      fg: '#073642', muted: '#586e75', faint: '#93a1a1', accent: '#268bd2', err: '#dc322f', warn: '#b58900',
      edge: '#657b83', head: '#eee8d5',
      tok: { tbl: '#b58900', type: '#268bd2', flag: '#d33682', arrow: '#2aa198', ref: '#859900', com: '#93a1a1' },
    },
    dark: {
      bg: '#00212b', panel: '#002b36', soft: '#073642', dot: '#073642', line: '#073642', line2: '#0e4a59',
      fg: '#eee8d5', muted: '#93a1a1', faint: '#586e75', accent: '#268bd2', err: '#dc322f', warn: '#b58900',
      edge: '#839496', head: '#073642',
      tok: { tbl: '#b58900', type: '#268bd2', flag: '#d33682', arrow: '#2aa198', ref: '#859900', com: '#586e75' },
    },
  },
  gruvbox: {
    name: 'Gruvbox',
    light: {
      bg: '#f2e5bc', panel: '#fbf1c7', soft: '#ebdbb2', dot: '#e3d3a8', line: '#ebdbb2', line2: '#d5c4a1',
      fg: '#3c3836', muted: '#665c54', faint: '#928374', accent: '#076678', err: '#9d0006', warn: '#b57614',
      head: '#ebdbb2',
      tok: { tbl: '#b57614', type: '#076678', flag: '#9d0006', arrow: '#427b58', ref: '#79740e', com: '#928374' },
    },
    dark: {
      bg: '#1d2021', panel: '#282828', soft: '#32302f', dot: '#3c3836', line: '#3c3836', line2: '#504945',
      fg: '#ebdbb2', muted: '#bdae93', faint: '#7c6f64', accent: '#83a598', err: '#fb4934', warn: '#fabd2f',
      head: '#3c3836',
      tok: { tbl: '#fabd2f', type: '#83a598', flag: '#fb4934', arrow: '#8ec07c', ref: '#b8bb26', com: '#928374' },
    },
  },
  catppuccin: {
    name: 'Catppuccin',
    light: { // Latte
      bg: '#e6e9ef', panel: '#eff1f5', soft: '#dce0e8', dot: '#ccd0da', line: '#dce0e8', line2: '#bcc0cc',
      fg: '#4c4f69', muted: '#6c6f85', faint: '#8c8fa1', accent: '#8839ef', err: '#d20f39', warn: '#df8e1d',
      head: '#8839ef', headFg: '#eff1f5', boxBorder: '#bcc0cc',
      tok: { tbl: '#df8e1d', type: '#1e66f5', flag: '#8839ef', arrow: '#179299', ref: '#40a02b', com: '#7c7f93' },
    },
    dark: { // Mocha
      bg: '#181825', panel: '#1e1e2e', soft: '#313244', dot: '#313244', line: '#313244', line2: '#45475a',
      fg: '#cdd6f4', muted: '#a6adc8', faint: '#6c7086', accent: '#cba6f7', err: '#f38ba8', warn: '#f9e2af',
      head: '#cba6f7', headFg: '#1e1e2e',
      tok: { tbl: '#f9e2af', type: '#89b4fa', flag: '#cba6f7', arrow: '#94e2d5', ref: '#a6e3a1', com: '#9399b2' },
    },
  },
  tokyonight: {
    name: 'Tokyo Night',
    light: { // Day
      bg: '#d0d5e3', panel: '#e1e2e7', soft: '#d5d8e3', dot: '#c4c8da', line: '#c4c8da', line2: '#a8aecb',
      fg: '#3760bf', muted: '#6172b0', faint: '#848cb5', accent: '#2e7de9', err: '#f52a65', warn: '#8c6c3e',
      boxBg: '#e9e9ed',
      tok: { tbl: '#8c6c3e', type: '#2e7de9', flag: '#9854f1', arrow: '#007197', ref: '#587539', com: '#848cb5' },
    },
    dark: { // Night
      bg: '#16161e', panel: '#1a1b26', soft: '#292e42', dot: '#292e42', line: '#292e42', line2: '#3b4261',
      fg: '#c0caf5', muted: '#a9b1d6', faint: '#565f89', accent: '#7aa2f7', err: '#f7768e', warn: '#e0af68',
      head: '#16161e',
      tok: { tbl: '#e0af68', type: '#7aa2f7', flag: '#bb9af7', arrow: '#7dcfff', ref: '#9ece6a', com: '#565f89' },
    },
  },
  nord: {
    name: 'Nord',
    light: { // Snow Storm
      bg: '#e5e9f0', panel: '#eceff4', soft: '#e5e9f0', dot: '#d8dee9', line: '#d8dee9', line2: '#c2cad8',
      fg: '#2e3440', muted: '#4c566a', faint: '#7b88a1', accent: '#5e81ac', err: '#bf616a', warn: '#b0762e',
      head: '#5e81ac', headFg: '#eceff4', boxBorder: '#b8c3d4',
      tok: { tbl: '#a0661c', type: '#5e81ac', flag: '#8f5c89', arrow: '#3f7f86', ref: '#5b8039', com: '#7b88a1' },
    },
    dark: { // Polar Night
      bg: '#292e39', panel: '#2e3440', soft: '#3b4252', dot: '#3b4252', line: '#3b4252', line2: '#434c5e',
      fg: '#d8dee9', muted: '#a5afc0', faint: '#616e88', accent: '#88c0d0', err: '#bf616a', warn: '#ebcb8b',
      head: '#5e81ac', headFg: '#eceff4', boxBg: '#3b4252', boxBorder: '#4c566a',
      tok: { tbl: '#ebcb8b', type: '#81a1c1', flag: '#b48ead', arrow: '#88c0d0', ref: '#a3be8c', com: '#616e88' },
    },
  },
  dracula: {
    name: 'Dracula',
    light: { // Alucard
      bg: '#efeddc', panel: '#fffbeb', soft: '#e8e4cf', dot: '#dedac4', line: '#e2dec8', line2: '#cfcbb4',
      fg: '#1f1f1f', muted: '#635d44', faint: '#9a9478', accent: '#644ac9', err: '#cb3a2a', warn: '#a34d14',
      head: '#cfcfde',
      tok: { tbl: '#14710a', type: '#036a96', flag: '#a3144d', arrow: '#a34d14', ref: '#846e15', com: '#6c664b' },
    },
    dark: {
      bg: '#21222c', panel: '#282a36', soft: '#343746', dot: '#343746', line: '#343746', line2: '#44475a',
      fg: '#f8f8f2', muted: '#b6b9cc', faint: '#6272a4', accent: '#bd93f9', err: '#ff5555', warn: '#ffb86c',
      head: '#44475a',
      tok: { tbl: '#50fa7b', type: '#8be9fd', flag: '#ff79c6', arrow: '#ffb86c', ref: '#f1fa8c', com: '#6272a4' },
    },
  },
  rosepine: {
    name: 'Rosé Pine',
    light: { // Dawn
      bg: '#f2e9e1', panel: '#fffaf3', soft: '#f2e9e1', canvas: '#faf4ed', dot: '#e4dcd4', line: '#ebe2da', line2: '#dfdad9',
      fg: '#575279', muted: '#797593', faint: '#9893a5', accent: '#286983', err: '#b4637a', warn: '#ea9d34',
      tok: { tbl: '#b4637a', type: '#286983', flag: '#907aa9', arrow: '#d7827e', ref: '#56949f', com: '#9893a5' },
    },
    dark: { // Main
      bg: '#191724', panel: '#1f1d2e', soft: '#26233a', dot: '#26233a', line: '#26233a', line2: '#403d52',
      fg: '#e0def4', muted: '#908caa', faint: '#6e6a86', accent: '#ebbcba', err: '#eb6f92', warn: '#f6c177',
      tok: { tbl: '#f6c177', type: '#9ccfd8', flag: '#eb6f92', arrow: '#ebbcba', ref: '#c4a7e7', com: '#6e6a86' },
    },
  },
  mono: {
    name: 'Grayscale',
    // four shades of grey for the text (strong, medium, soft, faint); keys tell apart by their symbols.
    // Errors and warnings keep a little colour, to be seen.
    light: {
      bg: '#f2f2f2', panel: '#fafafa', soft: '#ebebeb', canvas: '#f5f5f5', dot: '#d9d9d9', line: '#e0e0e0', line2: '#cccccc',
      fg: '#1a1a1a', muted: '#737373', faint: '#9e9e9e', accent: '#4d4d4d', err: '#a33a2e', warn: '#8a6414',
      boxBg: '#ffffff', boxBorder: '#cccccc', rowHover: '#f0f0f0', keyL: .44, keyC: 0, dvS: '0%', dvL: '88%',
      tok: { tbl: '#1a1a1a', type: '#737373', flag: '#4d4d4d', arrow: '#9e9e9e', ref: '#4d4d4d', com: '#9e9e9e' },
    },
    dark: {
      bg: '#111111', panel: '#1a1a1a', soft: '#242424', canvas: '#141414', dot: '#2a2a2a', hover: '#2a2a2a',
      line: '#2a2a2a', line2: '#363636', fg: '#e6e6e6', muted: '#999999', faint: '#6b6b6b', accent: '#bfbfbf',
      accentFg: '#141414', err: '#d88a80', warn: '#d0b070', boxBorder: '#3a3a3a', keyL: .8, keyC: 0, dvS: '0%', dvL: '30%',
      tok: { tbl: '#e6e6e6', type: '#999999', flag: '#bfbfbf', arrow: '#6b6b6b', ref: '#bfbfbf', com: '#6b6b6b' },
    },
  },
};

// The CSS variables for one variant of a theme (the names in style.css, without --)
function themeVars(key, dark) {
  const c = THEMES[key][dark ? 'dark' : 'light'];
  const box = c.boxBg ?? c.panel;
  const v = {
    bg: c.bg, panel: c.panel, soft: c.soft, canvas: c.canvas ?? c.bg, dot: c.dot, line: c.line, line2: c.line2,
    hover: c.hover ?? c.soft, fg: c.fg, muted: c.muted, faint: c.faint,
    accent: c.accent, 'accent-fg': c.accentFg ?? (dark ? c.bg : c.panel),
    'accent-soft': c.accentSoft ?? `color-mix(in srgb, ${c.accent} 16%, ${c.panel})`,
    sel: c.sel ?? `color-mix(in srgb, ${c.accent} 24%, transparent)`,
    err: c.err, warn: c.warn, edge: c.edge ?? c.muted,
    'box-bg': box, 'box-head': c.head ?? box, 'box-head-fg': c.headFg ?? c.fg,
    'box-border': c.boxBorder ?? c.line2, 'row-hover': c.rowHover ?? c.soft,
    toast: c.fg, 'toast-fg': c.panel,
    'key-l': c.keyL ?? (dark ? .76 : .55), 'key-c': c.keyC ?? (dark ? .12 : .15),
    'dv-s': c.dvS ?? (dark ? '40%' : '70%'), 'dv-l': c.dvL ?? (dark ? '32%' : '84%'),
  };
  for (const [k, col] of Object.entries(c.tok)) v['tok-' + k] = col;
  return v;
}
const themeKey = () => THEMES[state.colors] ? state.colors : 'bleak';

// Colour the page with the chosen theme, in the current light/dark mode
function applyPalette() {
  const root = document.documentElement.style;
  for (const [k, col] of Object.entries(themeVars(themeKey(), isDark()))) root.setProperty('--' + k, col);
  renderThemeMenu();
}

// The menu: each theme with a preview of its colours (in the current mode), the chosen one ticked
function renderThemeMenu() {
  const current = themeKey(), dark = isDark();
  const preview = key => {
    const c = THEMES[key][dark ? 'dark' : 'light'];
    return [c.panel, c.accent, c.tok.tbl, c.tok.type, c.tok.flag].map(col => `<i style="background:${col}"></i>`).join('');
  };
  $('#themeList').innerHTML = Object.entries(THEMES).map(([key, t]) =>
    `<button role="menuitemradio" aria-checked="${key === current}" data-theme-key="${key}">` +
    `<span class="check">${key === current ? '✓' : ''}</span><span class="theme-name">${t.name}</span>` +
    `<span class="swatches">${preview(key)}</span></button>`).join('');
}
$('#themeList').addEventListener('click', e => {
  const b = e.target.closest('[data-theme-key]');
  if (!b) return;
  state.colors = b.dataset.themeKey;
  applyPalette();
  saveState();
  closeMenus();
});
