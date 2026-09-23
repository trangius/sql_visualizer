# Handoff: SQL Visualizer restyle

## Overview
A redesign of **trangius/sql_visualizer**, a two-pane app with a text/SQL editor on the left and an ER diagram canvas on the right. The main goals are:
- group the toolbar buttons logically instead of stacking them in one row;
- restyle both themes with the **onedarkbleak.nvim** palettes (dark = `bleak`, light = `light`).

## About the design files
`SQL Visualizer.dc.html` is a **design reference built in HTML**. It's a working prototype of the intended look and behaviour, not production code to paste in. Open it in a browser; `support.js` must sit next to it.

Your task: **apply this design to the existing repo** (vanilla JS: `index.html`, `css/style.css`, `js/*.js`). Keep the existing parser, SQL round-trip, history, table dialog and exporters. Change the markup, CSS and diagram rendering to match.

## Fidelity
High fidelity. Colours, type, spacing and placement are final.

## Layout
```
┌ App bar 52px ───────────────────────────────────────────────────────────┐
│ [logo] SQL Visualizer  arrow diagrams        [Load example ▾] [Export ▾] | [☾] │
├ Editor (420px, resizable) ─┬─ Canvas ────────────────────────────────────┤
│ [Text|SQL]     ↶ ↷ | (?)Syntax │ [+ New table | ▦ Auto layout]   [Classic|Filled] │
│ gutter │ code                   │                                              │
│        │                        │            diagram                           │
│ ● No problems   4 tables · 3 rel│                         [− 100% + | ⤢ Fit]   │
└─────────────────────────────────┴─────────────────────────────────────────────┘
```
- **App bar** (52px, panel bg, 1px bottom border, padding 0 12 0 16):
  - Logo: a 24px accent square (radius 6) with three short bars in `accent-fg`.
  - Title: "SQL Visualizer", 14.5px/600. Subtitle: "arrow diagrams", 13px muted.
  - On the right: the examples `<select>` (32px tall, radius 8, custom chevron), then the **Export** primary button (accent bg, download icon and chevron), a 1px divider, then the theme icon button (32px, transparent, hover bg).
  - The Export menu is 230px wide (radius 10, shadow, 5px padding). Section "Diagram" holds SVG and PNG; section "Schema" holds MariaDB script (.sql) and Copy SQL. Each item is 32px tall and shows its extension right-aligned in mono 11px muted.
- **Editor header** (46px, bottom border):
  - Mode segmented control: `soft` background track with 2px padding. Each item is 26px tall, radius 6. The active item has panel bg and a small shadow.
  - On the right: undo and redo icon buttons (30px, disabled state at 0.35 opacity), a divider, then a "Syntax" button with a circled "?" icon. While the help panel is open, the Syntax button uses `accent-soft` bg and accent text.
- **Syntax help**: covers the editor area (not the header or footer). It has a "Back to editor" button, a highlighted example block, a two-column flag reference grid, and a list of gestures.
- **Editor**:
  - Gutter is 46px wide, mono 12px/20px, `faint` colour. Lines with a problem show the number in `err` and weight 600.
  - Code is Geist Mono 13px/20px, padding 14px 16px 14px 6px. Lines with a problem get a wavy `err` underline.
- **Status bar** (32px, top border, 12px muted):
  - Left: a 7px dot plus status text. The dot is accent when clean and err when there are problems. The text reads "No problems", or "N problems · Line X: msg" (clickable, jumps to the line). In SQL mode it reads "Generated MariaDB · read-only".
  - Right: "N tables · M relations".
- **Splitter**: a 1px line inside a 9px hit area. It turns accent while dragging. Minimum widths: editor 300px, canvas 380px.
- **Canvas**:
  - Dot grid: `radial-gradient(var(--dot) 1px, transparent 1.3px)` at 20px × zoom, offset by the pan.
  - Three floating "cards" sit on it. Each has panel bg, 1px line border, radius 10, 4px padding, a shadow, and 12px inset from the edges:
    - top-left: + New table, then Auto layout;
    - top-right: diagram style, Classic or Filled (each with a 10px swatch);
    - bottom-right: −, a zoom % label (click to reset to 100%), +, a divider, then Fit.
  - Buttons in these cards are 30px tall, radius 7, transparent, with a `hover` bg on hover.
  - Toast: bottom-centre, 36px tall, radius 9, using the `toast` colours, with an optional accent action button such as "Undo".

## Table boxes
- **Box**: radius 9, 1px `box-border` (accent while hovered), shadow, `box-bg`.
- **Header**: 40px, 13.5px/600, `box-head` bg, bottom border. Dragging the header moves the box.
- **Rows**: 30px each, padding 0 12, gap 8. Hover shows the `row-hover` bg; clicking selects that line in the editor. Each row has:
  - a key badge (20px wide, mono 9.5px/600): "PK" in accent, "FK" in `tok-ref`;
  - the column name (600 when it's a PK);
  - on the right, the flags ("null", "unique") in mono 10.5px `tok-flag`, then the type in mono 11.5px muted;
  - types shown with `vc` expanded, e.g. `vc` → `varchar(128)`.
- **Arrows**: orthogonal with 9px rounded corners, 1.4px `edge` colour.
  - They start with a 3px hollow circle at the FK row and end with a filled 9×9 arrowhead at the target row.
  - Hovering a box highlights its arrows in accent at 2px and draws them on top.
  - Routing: when the target is to the right, go right edge to left edge with a vertical mid segment. When it's to the left, mirror that. When the boxes overlap horizontally, loop out 30px past the right edge. A self-reference loops 26px out on the right.
- **Filled style**: `--box-head: accent; --box-head-fg: accent-fg; --box-border: accent`.

## Design tokens (CSS custom properties)
| token | light (onedarkbleak `light`) | dark (onedarkbleak `bleak`) |
|---|---|---|
| bg | #f5efe2 | #101012 |
| panel | #faf6ee | #1b1c1e |
| soft | #f0e8d6 | #232427 |
| canvas | #f5efe2 | #141414 |
| dot | #dccfb4 | #2c2d31 |
| line | #e6dcc6 | #2c2d31 |
| line2 | #dccfb4 | #35363b |
| hover | #f0e8d6 | #2c2d31 |
| fg | #1c1812 | #d4ccbf |
| muted | #5e5440 | #a8a8a4 |
| faint | #8a7e60 | #5a5b5e |
| accent | #3a4658 | #8ab1c8 |
| accent-fg | #faf6ee | #141414 |
| accent-soft | #e5e0d2 | #1f2a31 |
| err | #7a2e22 | #c4928e |
| sel | rgba(58,70,88,.18) | rgba(138,177,200,.25) |
| tok-tbl (table name) | #7e5414 | #c8a878 |
| tok-type | #3a4658 | #8ab1c8 |
| tok-flag (pk/null/unique, SQL keywords) | #6e3a2e | #d4a8a0 |
| tok-arrow / tok-ref | #525e1e | #a8c896 |
| tok-com | #8a7e60 | #6e6f72 |
| edge | #5e5440 | #818387 |
| box-bg / box-head | #fffcf5 | #1b1c1e |
| box-border | #d3cab2 | #37383d |
| row-hover | #f5efe2 | #232427 |
| toast / toast-fg | #1c1812 / #faf6ee | #d4ccbf / #141414 |

Shadows:
- light: `0 1px 2px rgba(60,40,10,.06), 0 4px 14px rgba(60,40,10,.06)`
- dark: `0 1px 2px rgba(0,0,0,.4), 0 6px 18px rgba(0,0,0,.35)`

**Type**: Geist (UI, 13px base) and Geist Mono (code), both from Google Fonts. Weights used: 400, 500 and 600.

**Radii**: 6 (segment items), 7 (toolbar buttons), 8 (inputs and primary button), 9 (table boxes and toast), 10 (floating cards and menus).

**Icons**: simple 16px stroke icons at 1.5px stroke with round caps: undo, redo, sun, moon, plus, download, grid, fit-corners.

## Behaviour to keep or add
- Theme follows the system until the toggle is used (the existing logic in app.js).
- Clicking outside the Export menu closes it. The Export menu replaces the separate SVG and PNG buttons.
- "+ Table" in the old editor bar moves to the canvas as "New table". It places the table at the centre of the view and selects its name line in the editor.
- The example loader shows a toast with an Undo action (as today).
- The "Green" style is renamed **Filled**, and it now uses the accent colour.

## Files
- `SQL Visualizer.dc.html`: the prototype. Its `<style>` block at the top holds the exact token values.
- `support.js`: the runtime needed to open the prototype in a browser.
