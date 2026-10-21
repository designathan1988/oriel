// FORMA 3 interface shell: fixed panels around the 3D view (Figma went back
// from floating to fixed panels in UI3: floating panels squeezed the screen
// and the drawing showed behind them). Thin bar on top, tools on the left,
// library docked next to them, panel on the right (resizable) and a status
// bar at the bottom. Over the view there are only the breadcrumb, the view island,
// the contextual bar next to the selection and the warnings. Graphite theme, 16 px icons.
import { BRAND } from '../model/brand';
import { icon } from './icons';

export const CSS = `
.f3{--canvas:#d9d6cc;--panel:#1d1f23f2;--panel-solid:#1d1f23;--raise:#26292e;--field:#2b2e34;--field-h:#33373e;--line:#33363c;--line-2:#3d4148;
  --ink:#e9eaec;--muted:#a3a8b0;--faint:#737881;--accent:#f07a32;--accent-2:#f07a3229;--accent-ink:#ffb48a;--sel:#5b9cff;--sel-2:#5b9cff26;--danger:#ff7b72;
  --r:10px;--shadow:0 8px 28px #0000004d,0 1px 0 #ffffff0a inset;
  position:absolute;inset:0;display:grid;grid-template-rows:40px minmax(0,1fr) 26px;grid-template-columns:44px auto minmax(0,1fr) auto;grid-template-areas:"top top top top" "tools cat view aside" "status status status status";
  font:12px/1.35 Inter,"Segoe UI",system-ui,-apple-system,sans-serif;color:var(--ink);background:var(--panel-solid);user-select:none;overflow:hidden;letter-spacing:.005em}
.f3[data-theme=light]{--canvas:#d9d6cc;--panel:#f7f6f3f2;--panel-solid:#f7f6f3;--raise:#ebe9e4;--field:#ffffff;--field-h:#f0eee9;--line:#dcd9d2;--line-2:#cfcbc3;
  --ink:#1e2024;--muted:#555b63;--faint:#858a92;--accent:#e86a1e;--accent-2:#e86a1e24;--accent-ink:#a2470f;--sel:#2f7bf0;--sel-2:#2f7bf024;--danger:#c93a31;--shadow:0 8px 24px #0000001f,0 1px 0 #ffffff inset}
.f3[data-theme=light] ::-webkit-scrollbar-thumb{background:#0000002a}
.f3[data-theme=light] .f3-cell.over,.f3[data-theme=light] .f3-field.over input,.f3[data-theme=light] .f3-field.over select{background:#e3edff;border-color:#2f7bf066}
.f3[data-theme=light] .f3-cell>.f3-reset{color:#2f7bf0}
.f3[data-theme=light] .f3-card .fav{background:#ffffffcc}
.f3-info{display:grid;grid-template-columns:1fr auto;gap:3px 10px;margin:0;font-size:11.5px}
.f3-info dt{color:var(--muted)}
.f3-info dd{margin:0;font-variant-numeric:tabular-nums;text-align:right}
.f3-prefs{min-width:280px;gap:2px}
.f3-prefs-seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:4px;padding:2px 6px 6px}
.f3-prefs-seg button{height:28px;border:1px solid var(--line);border-radius:6px;background:var(--field);color:var(--ink);justify-content:center}
.f3-prefs-seg button[aria-checked=true]{background:var(--accent-2);border-color:var(--accent);color:var(--accent-ink)}
.f3-prefs-note{margin:4px 8px 6px;color:var(--muted);font-size:11px;white-space:normal;max-width:260px}
.f3 *{box-sizing:border-box}
.f3 [hidden]{display:none !important}
.f3 button{font:inherit;color:inherit;cursor:pointer}
.f3 svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex:none}
.f3 ::-webkit-scrollbar{width:8px;height:8px}
.f3 ::-webkit-scrollbar-thumb{background:#ffffff1f;border-radius:8px;border:2px solid transparent;background-clip:padding-box}
.f3 ::-webkit-scrollbar-track{background:transparent}
.f3 *{scrollbar-width:thin;scrollbar-color:#ffffff24 transparent}
/* Chrome sends no pointer events to a disabled control, not even to capturing listeners above it
   (jakearchibald.com, "Events and disabled form fields"): a click there never closed an open menu.
   The click goes to what is behind; a reason for being disabled lives on the parent label. */
.f3 :is(button,input,select,textarea):disabled{pointer-events:none}
/* Top bar */
.f3-top{grid-area:top;display:flex;align-items:center;gap:2px;padding:0 8px;background:var(--panel-solid);border-bottom:1px solid #000}
.f3-brand{display:flex;align-items:center;gap:7px;border:0;background:transparent;border-radius:7px;padding:5px 8px;font-weight:800;letter-spacing:.28em;font-size:11px}
.f3-brand:hover,.f3-brand[aria-expanded=true]{background:var(--raise)}
.f3-brand i{width:9px;height:9px;border-radius:2px;background:var(--accent);transform:rotate(45deg);display:block}
.f3-name{border:1px solid transparent;border-radius:6px;padding:4px 6px;font:500 12px Inter,"Segoe UI",system-ui,sans-serif;flex:0 1 200px;min-width:56px;width:0;background:transparent;color:var(--ink)}
.f3-name:hover{background:var(--raise)}
.f3-name:focus{border-color:var(--accent);outline:none;background:var(--field)}
/* A width that the text never changes: "Saving…" and "Saved in this browser" never move the search and
   undo buttons. In a narrow window the name, this note and the search give way (the search down to its
   icon), so that Export and the buttons at the right stay on the screen. */
.f3-saved{color:var(--faint);font-size:11px;margin-right:8px;white-space:nowrap;flex:0 1 126px;min-width:0;overflow:hidden;text-overflow:ellipsis}
.f3-top>.f3-tb,.f3-top>.f3-ws{flex:none}
.f3-sp{flex:1}
.f3-tb{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:0;background:transparent;border-radius:7px;height:28px;min-width:28px;padding:0 7px;white-space:nowrap;color:var(--muted)}
.f3-tb:hover{background:var(--raise);color:var(--ink)}
.f3-tb:disabled{opacity:.3;cursor:default;background:transparent}
.f3-tb.primary{background:var(--accent);color:#1b0f06;font-weight:600;padding:0 12px;margin-left:6px}
.f3-tb.primary:hover{background:#ff8b45;color:#1b0f06}
.f3-search{display:flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--raise);color:var(--faint);border-radius:7px;height:28px;padding:0 8px 0 9px;flex:0 1 240px;min-width:30px;overflow:hidden}
.f3-search:hover{border-color:var(--line-2);color:var(--muted)}
.f3-search span{flex:1;min-width:0;text-align:left;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.f3-search svg,.f3-search kbd{flex:none}
@media (max-width:1100px){.f3-search kbd{display:none}}
@media (max-width:900px){.f3-search span{display:none}.f3-search{flex:none;padding:0 7px}}
@media (max-width:780px){.f3-brand{letter-spacing:.12em;padding:5px 6px}}
.f3 kbd{font:600 10px ui-monospace,Consolas,monospace;border:1px solid var(--line-2);border-radius:4px;padding:1px 4px;color:var(--muted);background:#ffffff08}
/* View and islands */
.f3-view{grid-area:view;position:relative;overflow:hidden;min-height:0;background:var(--canvas)}
.f3-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;outline:none}
.f3-island{position:absolute;z-index:6;background:var(--panel);border:1px solid #00000059;border-radius:var(--r);box-shadow:var(--shadow);backdrop-filter:blur(10px)}
.f3-tools{grid-area:tools;position:relative;z-index:6;display:flex;flex-direction:column;align-items:center;padding:6px 0;background:var(--panel-solid);border-right:1px solid #000;overflow-y:auto;overflow-x:hidden;scrollbar-width:none}
.f3-tool{width:34px;height:34px;flex:none;border:0;border-radius:8px;background:transparent;display:grid;place-items:center;position:relative;color:var(--muted)}
.f3-tool svg{width:18px;height:18px}
.f3-tool:hover{background:var(--raise);color:var(--ink)}
.f3-tool[aria-pressed=true]{background:var(--accent-2);color:var(--accent-ink);box-shadow:inset 0 0 0 1px var(--accent)}
.f3-tool.grp::after{content:"";position:absolute;right:4px;bottom:4px;border:2.5px solid transparent;border-right-color:currentColor;border-bottom-color:currentColor;opacity:.55}
.f3-tools hr{width:22px;border:0;border-top:1px solid var(--line);margin:4px auto;flex:none}
.f3-toolset{display:flex;flex-direction:column;align-items:center;gap:2px;flex:none}
.f3-topsep{width:1px;height:20px;background:var(--line);margin:0 6px;flex:none}
.f3-top .f3-viewctl{display:flex;align-items:center;gap:2px;flex:none}
.f3-top .f3-viewctl .f3-tb{height:30px}
.f3-top .f3-viewctl select{height:28px;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--ink);padding:0 6px;font:inherit}
.f3-flyout{position:absolute;z-index:40;display:flex;flex-direction:column;gap:1px;padding:4px;min-width:170px;background:var(--panel-solid);border:1px solid var(--line-2);border-radius:10px;box-shadow:var(--shadow)}
.f3-flyout button{display:flex;align-items:center;gap:10px;height:32px;padding:0 10px;border:0;border-radius:7px;background:transparent;color:var(--ink);text-align:left}
.f3-flyout button span{flex:1}
.f3-flyout button kbd{font:10.5px ui-monospace,Consolas,monospace;color:var(--faint)}
.f3-flyout button:hover{background:var(--raise)}
.f3-flyout button[aria-pressed=true]{background:var(--accent-2);color:var(--accent-ink)}
.f3-fly{position:absolute;z-index:12;min-width:200px;padding:4px}
.f3-fly button{display:flex;align-items:center;gap:9px;width:100%;border:0;background:transparent;border-radius:6px;height:30px;padding:0 8px;color:var(--ink)}
.f3-fly button:hover{background:var(--raise)}
.f3-fly button[aria-pressed=true]{color:var(--accent-ink)}
.f3-fly kbd{margin-left:auto}
.f3-crumb{left:8px;top:8px;display:flex;align-items:center;gap:0;padding:3px;max-width:calc(100% - 140px);overflow:hidden}
.f3-crumb button{border:0;background:transparent;border-radius:6px;height:24px;padding:0 8px;font-size:12px;color:var(--muted)}
.f3-crumb button:hover{background:var(--raise);color:var(--ink)}
.f3-crumb button[aria-current=true]{color:var(--ink);font-weight:600}
.f3-crumb i{font-style:normal;color:var(--faint);padding:0 1px}
.f3-modes{left:8px;top:44px;display:flex;gap:2px;padding:3px}
.f3-modes[hidden]{display:none}
.f3-modes button{border:0;background:transparent;border-radius:6px;width:28px;height:26px;display:grid;place-items:center;color:var(--muted)}
.f3-modes button svg{width:16px;height:16px}
.f3-modes button:hover{background:var(--raise);color:var(--ink)}
.f3-modes button[aria-pressed=true]{background:var(--accent-2);color:var(--accent-ink)}
.f3-aside{grid-area:aside;position:relative;z-index:6;width:var(--aside-w,300px);display:flex;flex-direction:column;overflow:hidden;background:var(--panel-solid);border-left:1px solid #000}
.f3-aside.min{width:36px}
.f3-aside.min .f3-side,.f3-aside.min .f3-layers,.f3-aside.min .f3-tree,.f3-aside.min [role=tab],.f3-aside.min .f3-grip{display:none !important}
.f3-aside.min .f3-tabs{justify-content:center;border-bottom:0}
.f3-aside.min .f3-tabs .f3-tb{margin:0}
.f3-grip{position:absolute;left:0;top:0;bottom:0;width:5px;cursor:ew-resize;z-index:7}
.f3-grip:hover,.f3-grip.on{background:var(--accent-2)}
.f3-tabs{display:flex;align-items:center;gap:2px;padding:4px;border-bottom:1px solid var(--line);flex:none}
.f3-tabs button[role=tab]{border:0;background:transparent;border-radius:6px;height:26px;padding:0 10px;display:flex;align-items:center;gap:6px;font-weight:600;color:var(--faint)}
.f3-tabs button[role=tab]:hover{color:var(--ink)}
.f3-tabs button[aria-selected=true]{background:var(--raise);color:var(--ink)}
.f3-tabs .f3-tb{margin-left:auto;height:26px}
.f3-side,.f3-layers,.f3-tree{flex:1 1 auto;overflow:auto;min-height:0}
/* Structure tab: filter on top, tree below (SketchUp Outliner). */
.f3-tree-bar{position:sticky;top:0;z-index:1;display:flex;gap:4px;padding:6px 8px;background:var(--panel-solid);border-bottom:1px solid var(--line)}
.f3-tree-bar input{flex:1;min-width:0;height:26px;border:1px solid var(--line);border-radius:6px;background:var(--field);color:var(--ink);padding:0 8px;font:inherit}
.f3-lrow .kind{width:18px;flex:none;display:grid;place-items:center;color:var(--muted)}
.f3-lrow .kind svg{width:14px;height:14px}
.f3-lrow .ldot{width:8px;height:8px;border-radius:50%;flex:none;margin:0 4px;box-shadow:0 0 0 1px var(--line)}
.f3-lrow mark{background:var(--accent-2);color:inherit;border-radius:2px}
.f3-sets{border-bottom:1px solid var(--line);padding-bottom:4px}
/* Interior view panel (next to the View island). */
.f3-interior{position:absolute;z-index:40;width:300px;padding:6px 10px 10px;display:flex;flex-direction:column;color:var(--ink);container-type:inline-size}
/* Same header as a panel section (sentence case), not a menu caption. */
.f3-interior .hd{height:28px;display:flex;align-items:center;font-size:11.5px;font-weight:600;color:var(--ink)}
.f3-interior .f3-btns{margin-top:0}
.f3-interior-list{margin:6px -4px 0;padding-top:4px;border-top:1px solid var(--line)}
.f3-interior-ctl{margin-top:6px;padding-top:8px;border-top:1px solid var(--line)}
.f3-cell.rng{gap:8px;padding:0;background:none;border-color:transparent}
.f3-cell.rng input[type=range]{flex:1;min-width:0;padding:0;accent-color:var(--accent)}
.f3-cell.rng output{flex:none;width:36px;text-align:right;font-size:11.5px;font-variant-numeric:tabular-nums}
.f3-check{display:flex;align-items:center;gap:6px;height:24px;font-size:11.5px;color:var(--ink);cursor:pointer}
.f3-check input{margin:0;accent-color:var(--accent)}
.f3-check:has(input:disabled){color:var(--faint);cursor:default}
.f3-sets-head{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 8px 2px 10px;font-size:11px;font-weight:600;color:var(--muted)}
.f3-sets-head .f3-btn{height:24px;font-size:11px}
/* Library (docked) */
.f3-cat{grid-area:cat;position:relative;z-index:6;width:400px;display:flex;flex-direction:column;overflow:hidden;background:var(--panel-solid);border-right:1px solid #000}
.f3-cat.closed{display:none}
.f3-cat-head{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 12px;border-bottom:1px solid var(--line)}
.f3-cat-head b{font-size:12px}
.f3-cat-head input{flex:1;max-width:320px;border:1px solid transparent;border-radius:6px;height:26px;padding:0 8px;font:inherit;background:var(--field);color:var(--ink)}
.f3-cat-head input:focus{outline:none;border-color:var(--accent)}
.f3-cat-head .f3-tb{margin-left:auto}
.f3-cat-body{flex:1;display:flex;min-height:0}
.f3-cat-tabs{width:150px;flex:none;overflow:auto;padding:4px;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:1px}
.f3-cat-tabs button{border:0;background:transparent;border-radius:6px;min-height:26px;padding:4px 9px;text-align:left;white-space:normal;line-height:1.25;color:var(--muted);flex:none}
.f3-cat-tabs button:hover{background:var(--raise);color:var(--ink)}
.f3-cat-tabs button[aria-pressed=true]{background:var(--accent-2);color:var(--accent-ink);font-weight:600}
.f3-cat-tabs hr{border:0;border-top:1px solid var(--line);margin:4px 2px;width:100%}
.f3-cards{flex:1;overflow:auto;padding:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:6px;align-content:start}
.f3-card{border:1px solid transparent;border-radius:8px;background:var(--raise);padding:4px 4px 5px;position:relative;cursor:grab;text-align:center;min-width:0}
.f3-card:hover{border-color:var(--line-2);background:#2d3036}
.f3-card[aria-pressed=true]{border-color:var(--accent);background:var(--accent-2)}
.f3-card img{width:100%;height:60px;object-fit:contain;display:block;border-radius:5px;background:radial-gradient(circle at 50% 35%,#f2f0ea,#cfccc3)}
.f3-blockico{height:60px;display:grid;place-items:center;border-radius:5px;background:radial-gradient(circle at 50% 35%,#3a3e45,#2b2e34);color:var(--accent-ink)}
.f3-blockico svg{width:26px;height:26px;stroke-width:1.4}
.f3-card span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:11px;line-height:1.25;height:2.5em;margin-top:4px;overflow:hidden;color:var(--muted);overflow-wrap:anywhere}
.f3-card:hover span{color:var(--ink)}
.f3-card .fav{position:absolute;top:6px;right:6px;border:0;background:#1d1f23cc;border-radius:999px;width:18px;height:18px;display:none;place-items:center;padding:0;color:var(--muted)}
.f3-card:hover .fav,.f3-card .fav[aria-pressed=true]{display:grid}
.f3-card .fav svg{width:11px;height:11px}
.f3-card .fav[aria-pressed=true]{color:#ffc24b}
.f3-card .fav[aria-pressed=true] svg{fill:currentColor}
/* Status bar */
.f3-status{grid-area:status;position:relative;z-index:6;display:flex;align-items:center;gap:4px;padding:0 6px;background:var(--panel-solid);border-top:1px solid #000;color:var(--muted);font-size:11.5px;white-space:nowrap;min-width:0}
.f3-hint{overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1;padding-left:4px}
.f3-status .f3-tb{height:22px;min-width:22px;padding:0 6px}
.f3-status .f3-tb[aria-pressed=true]{color:var(--accent-ink);background:var(--accent-2)}
.f3-ctl{display:flex;align-items:center;gap:3px;color:var(--faint)}
.f3-ctl svg{width:14px;height:14px}
.f3-ctl select{border:0;border-radius:5px;height:22px;padding:0 2px;font:inherit;background:transparent;color:var(--muted);cursor:pointer}
.f3-ctl select:hover{background:var(--field);color:var(--ink)}
.f3-stats{color:var(--faint);padding:0 4px}
.f3-vcb{display:flex;align-items:center;gap:6px;border-radius:5px;height:20px;padding:0 6px 0 8px;background:var(--field)}
.f3-vcb label{color:var(--faint)}
.f3-vcb input{width:90px;border:0;background:transparent;font:600 12px ui-monospace,Consolas,monospace;color:var(--ink);outline:none;padding:0}
.f3-sepv{width:1px;height:16px;background:var(--line);margin:0 3px;flex:none}
/* Over the view */
/* Contextual bar next to the selection (above it; below when it does not fit): the
   actions of what is selected, without covering the object; hidden without a selection. */
.f3-ctx{position:absolute;z-index:9;left:0;top:0;display:flex;align-items:center;gap:0;padding:3px;background:var(--panel);border:1px solid #00000059;border-radius:9px;color:var(--ink);box-shadow:var(--shadow);pointer-events:auto;max-width:calc(100% - 16px);flex-wrap:wrap}
.f3-ctx .grp{display:flex;align-items:center;gap:1px;padding:0 3px;border-right:1px solid var(--line);flex:none}
.f3-ctx .grp:last-child{border-right:0}
.f3-ctx .btns{display:flex;gap:1px}
.f3-ctx .cap{display:none}
.f3-ctx button{border:0;background:transparent;color:var(--muted);border-radius:6px;min-width:30px;height:30px;padding:0 6px;display:flex;align-items:center;justify-content:center;gap:5px;font-size:11.5px;white-space:nowrap}
.f3-ctx button span{display:none}
.f3-ctx button.lbl span{display:inline}
.f3-ctx button svg{width:17px;height:17px}
.f3-ctx button:hover{background:var(--raise);color:var(--ink)}
.f3-ctx button[aria-pressed=true]{background:var(--accent);color:#1b0f06}
.f3-ctx button.danger:hover{background:#5a1f1f;color:#ffb4a8}
.f3-ctx .step{gap:0}
.f3-ctx .step .n{min-width:52px;text-align:center;font:600 12px Inter,"Segoe UI",system-ui,sans-serif;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}
/* Context menu (right button) */
.f3-cmenu{position:absolute;z-index:45;min-width:220px;max-height:min(70vh,640px);overflow:auto;padding:4px;display:flex;flex-direction:column;color:var(--ink)}
.f3-cmenu .hd{font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);padding:7px 8px 3px}
.f3-cmenu button{display:flex;align-items:center;gap:8px;height:28px;border:0;background:transparent;color:var(--ink);border-radius:6px;padding:0 10px 0 8px;font:inherit;font-size:12px;text-align:left;white-space:nowrap}
.f3-cmenu button svg{width:16px;height:16px;color:var(--muted)}
.f3-cmenu button:hover{background:var(--raise)}
.f3-chooser button{height:auto;min-height:28px;padding:5px 10px 5px 8px;flex-direction:column;align-items:flex-start;gap:1px}
.f3-chooser button small{color:var(--muted);font-size:11px;white-space:normal}
.f3-chooser button[aria-pressed=true]{background:color-mix(in srgb,var(--accent) 22%,transparent)}
.f3-chooser button:focus-visible{outline:1px solid var(--accent)}
.f3-cmenu button[aria-pressed=true]{color:var(--accent-ink)}
.f3-cmenu button.danger{color:#ff8f80}
/* "View" island: grid, rotation step, snap, time of day and frame. */
.f3-viewbar{right:8px;top:8px;display:flex;flex-direction:column;align-items:stretch;gap:2px;padding:4px;color:var(--muted);font-size:11.5px}
.f3-viewbar .f3-tb{height:26px;min-width:26px;padding:0 6px;justify-content:flex-start}
.f3-viewbar .f3-ctl{justify-content:flex-start}
.f3-viewbar .f3-sepv{width:auto;height:1px;margin:2px 0}
.f3-viewbar .f3-tb[aria-pressed=true]{color:var(--accent-ink);background:var(--accent-2)}
/* View cube (ui/viewcube.ts): 3 × 3 regions per face = face, edge and corner views. */
.f3-cube{display:flex;flex-direction:column;align-items:center;gap:2px;padding:2px 0 4px;--s:54px;--h:27px}
.f3-cube-top{align-self:stretch;display:flex;justify-content:space-between}
.f3-cube-par{font:600 14px/1 Inter,system-ui,sans-serif}
.f3-cube-par[aria-pressed=true]{background:var(--accent);color:var(--accent-ink)}
.f3-cube-stage{position:relative;width:var(--s);height:var(--s);perspective:260px;margin:6px 10px 8px}
.f3-cube-arrow{position:absolute;width:0;height:0;padding:0;border:6px solid transparent;background:none;cursor:pointer;opacity:.75}
.f3-cube-arrow:hover{opacity:1}
.f3-cube-arrow[hidden]{display:none}
.f3-cube-arrow[data-arrow=up]{left:calc(50% - 6px);top:-15px;border-bottom-color:var(--ink)}
.f3-cube-arrow[data-arrow=down]{left:calc(50% - 6px);bottom:-15px;border-top-color:var(--ink)}
.f3-cube-arrow[data-arrow=left]{top:calc(50% - 6px);left:-15px;border-right-color:var(--ink)}
.f3-cube-arrow[data-arrow=right]{top:calc(50% - 6px);right:-15px;border-left-color:var(--ink)}
.f3-cube-box{position:relative;width:100%;height:100%;transform-style:preserve-3d}
.f3-cube-face{position:absolute;inset:0;display:grid;grid-template:1fr 2fr 1fr/1fr 2fr 1fr;background:color-mix(in srgb,var(--panel-solid) 78%,#fff);border:1px solid color-mix(in srgb,var(--ink) 45%,transparent);backface-visibility:hidden;font-size:9.5px;font-weight:600;color:var(--ink);user-select:none}
.f3-cube-face>span{display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden}
.f3-cube-face>span:hover{background:var(--accent);color:var(--accent-ink)}
.f3-cube-face>span.off{cursor:not-allowed;opacity:.45}
.f3-cube-face>span.off:hover{background:none;color:inherit}
.f3-snap{position:absolute;z-index:8;pointer-events:none;font:600 11px Inter,system-ui;padding:2px 6px;border-radius:4px;color:#fff;transform:translate(12px,12px);white-space:nowrap;box-shadow:0 2px 6px #0003}
.f3-dim{position:absolute;z-index:8;pointer-events:none;font:600 11.5px ui-monospace,Consolas,monospace;background:#1d1f23;color:#fff;padding:2px 6px;border-radius:4px;transform:translate(-50%,-50%);white-space:nowrap;box-shadow:0 2px 6px #0003}


/* Editable dimensions (Revit temporary dimensions): click the value to type it. */
.f3-sdim.edit{pointer-events:auto;cursor:text}
.f3-sdim.edit:hover{background:var(--accent);color:var(--accent-ink)}
.f3-sdim input{width:5.5em;font:inherit;background:#fff;color:#111;border:0;border-radius:3px;padding:0 3px;outline:2px solid var(--accent)}
.f3-toast{position:absolute;left:50%;bottom:10px;z-index:10;background:var(--panel-solid);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:7px 11px;font-size:12px;opacity:0;transform:translate(-50%,4px);transition:opacity .18s,transform .18s;pointer-events:none;max-width:420px;box-shadow:var(--shadow)}
.f3-toast.on{opacity:1;transform:translate(-50%,0)}
/* With the last operation panel open, the toast centers in the space to its right (never over the panel). */
.f3-view:has(>.f3-lastop:not([hidden])) .f3-toast{left:calc(320px + (100% - 320px) / 2);max-width:calc(100% - 340px)}
/* Last operation panel (Blender, Adjust Last Operation): bottom-left corner of the view. */
.f3-lastop{left:10px;bottom:10px;width:300px;padding:6px 10px 10px;z-index:9}
.f3-lastop .hd{display:flex;align-items:center;gap:6px;height:28px;margin-bottom:4px}
.f3-lastop .hd b{flex:1;font-size:12px}
.f3-lastop .hd .f3-tb{height:22px;min-width:22px;padding:0 4px}
.f3-warn{position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:5;width:max-content;max-width:min(560px,46%);background:#3a2a12f2;border:1px solid #7a5a22;color:#ffd79a;border-radius:8px;padding:5px 10px;font-size:11.5px;line-height:1.35;display:none;white-space:normal;overflow-wrap:anywhere;box-shadow:var(--shadow)}
.f3-warn.on{display:block}
.f3-tip{position:fixed;z-index:60;pointer-events:none;background:#0d0e10f2;color:#f3f4f5;border:1px solid #ffffff14;border-radius:6px;padding:4px 8px;font:12px/1.35 Inter,"Segoe UI",system-ui,sans-serif;max-width:280px;box-shadow:0 6px 18px #0006;opacity:0;transition:opacity .12s}
.f3-tip.on{opacity:1}
.f3-tip.rich{max-width:300px;padding:7px 10px;border-radius:8px}
.f3-tip.rich b{font-weight:600}
.f3-tip.rich kbd{margin-left:8px;font:600 10.5px/1 ui-monospace,monospace;background:#ffffff14;border-radius:4px;padding:2px 5px;color:#c9ccd1}
.f3-tip.rich p{margin:3px 0 0;color:#b7bbc2}
/* Inspector */
.f3-title{display:flex;align-items:center;gap:6px;padding:8px 8px 8px 10px;border-bottom:1px solid var(--line);min-height:41px}
.f3-title input{flex:1;min-width:0;font:600 13px Inter,"Segoe UI",system-ui,sans-serif;border:1px solid transparent;border-radius:6px;padding:3px 5px;background:transparent;color:var(--ink)}
.f3-title input:hover{background:var(--raise)}
.f3-title input:focus{border-color:var(--accent);outline:none;background:var(--field)}
.f3-title>span:first-child{flex:1;font-weight:600;font-size:13px;padding-left:5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.f3-kind{font-size:10.5px;color:var(--muted);background:var(--raise);border-radius:5px;padding:2px 7px;white-space:nowrap}
.f3-sec{border-bottom:1px solid var(--line);padding:2px 10px 10px}
.f3-sec>h3{margin:0 -4px 2px;height:30px;padding:0 4px;font-size:11.5px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:7px;cursor:pointer;border-radius:5px;letter-spacing:0;text-transform:none}
.f3-sec>h3::before{content:"";width:0;height:0;border:4px solid transparent;border-top-color:var(--faint);margin-top:4px;transition:transform .12s;flex:none}
.f3-sec>h3:hover::before{border-top-color:var(--ink)}
.f3-sec.closed>h3::before{transform:rotate(-90deg);margin-top:0}
.f3-sec.closed{padding-bottom:2px}
.f3-sec.closed>*:not(h3){display:none !important}
.f3-sec>h3>svg{display:none}
.f3-sec>h3 .r{margin-left:auto;display:flex;gap:2px}
.f3-grid2{display:grid;grid-template-columns:1fr 1fr;gap:4px 8px}
.f3-field{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:6px;min-width:0;min-height:26px}
.f3-field>span{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}
.f3-field.w{grid-column:1/-1;grid-template-columns:116px minmax(0,1fr)}
.f3-field.w>span{max-width:none;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.15;overflow-wrap:anywhere}
/* Selection marquee: light border with a dark halo (reads over sky, brick or glass). */
.f3-marquee{position:absolute;z-index:6;pointer-events:none;border:2px solid #6aa6ff;background:#5b9cff2e;box-shadow:0 0 0 1px #0b1220aa,inset 0 0 0 1px #0b122066}
.f3-marquee.cross{border:2px dashed #5fd39b;background:#4cc38a26}
.f3-field.st{grid-template-columns:minmax(0,1fr);gap:3px}
.f3-field.st>span{-webkit-line-clamp:1}
.f3-in{position:relative;min-width:0;display:block}
.f3-in em{position:absolute;right:7px;top:50%;transform:translateY(-50%);font-style:normal;font-size:10.5px;color:var(--faint);pointer-events:none}
.f3-field input,.f3-field select,.f3-sw select{width:100%;min-width:0;height:24px;border:1px solid transparent;border-radius:5px;padding:0 7px;font:inherit;background:var(--field);color:var(--ink)}
.f3-in input{padding-right:22px;font-variant-numeric:tabular-nums}
.f3-field input:hover,.f3-field select:hover{background:var(--field-h)}
.f3-field input:focus,.f3-field select:focus,.f3-sw select:focus{outline:none;border-color:var(--accent);background:var(--field)}
.f3-field input[type=color]{padding:2px;height:24px;width:40px}
.f3-field.over input,.f3-field.over select{border-color:#5b9cff66;background:#1f2e47}
.f3-field>span.drag{cursor:ew-resize}
/* Panel standard (kit.ts prow/numCell): label with icon | one to three cells on a 6-column grid. */
.f3-side,.f3-lastop{container-type:inline-size}
.f3-prow{display:grid;grid-template-columns:88px minmax(0,1fr);align-items:center;gap:6px;min-height:26px}
.f3-prow+.f3-prow,.f3-prow+.f3-row,.f3-row+.f3-prow{margin-top:4px}
.f3-prow>.lab{display:flex;align-items:center;gap:5px;min-width:0;font-size:11px;color:var(--muted)}
.f3-prow>.lab>span{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;line-height:1.15;hyphens:manual;overflow-wrap:normal;word-break:normal}
.f3-prow>.lab>svg{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;color:var(--faint)}
.f3-cells{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;min-width:0}
.f3-cells>*{grid-column:span 3}
.f3-cells.n3>*{grid-column:span 2}
.f3-cells.nw>*{grid-column:1/-1}
.f3-cell{display:flex;align-items:center;height:24px;min-width:0;border:1px solid transparent;border-radius:5px;background:var(--field);color:var(--ink)}
.f3-cell:hover{background:var(--field-h)}
.f3-cell:focus-within{border-color:var(--accent);background:var(--field)}
.f3-cell>.g{flex:none;display:grid;place-items:center;min-width:17px;height:100%;padding-left:4px;font:700 10.5px/1 Inter,"Segoe UI",system-ui,sans-serif;color:var(--muted);cursor:ew-resize;user-select:none}
.f3-cell>.g svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.f3-cell>.g.gt{font-weight:600;font-size:10px;padding:0 1px 0 6px}
.f3-cell>.gx{color:#ff6f61}.f3-cell>.gy{color:#4cc27a}.f3-cell>.gz{color:#6aa6ff}
.f3-cell input,.f3-cell select{flex:1;width:100%;min-width:0;height:100%;border:0;background:transparent;color:inherit;font:inherit;padding:0 4px}
.f3-cell input{font-variant-numeric:tabular-nums}
.f3-cell input:focus,.f3-cell select:focus{outline:none}
.f3-cell.sel>.g+select{padding-left:3px}
.f3-cell>em{flex:none;font-style:normal;font-size:10px;color:var(--faint);padding-right:5px;pointer-events:none}
.f3-cell.col{background:none;border:0}.f3-cell.col input{padding:0;height:22px;width:100%;border-radius:5px;cursor:pointer}
.f3-cell.over{border-color:#5b9cff66;background:#1f2e47}
.f3-cell>.f3-reset{flex:none;display:grid;place-items:center;width:18px;height:100%;padding:0;border:0;background:none;color:#8db8ff;cursor:pointer;font-size:12px;line-height:1}
.f3-cell>.f3-reset:hover{color:var(--ink)}
.f3-btn.w{width:100%;justify-content:center}
/* Action buttons: equal columns (never a ragged wrap); short label, full name in the tooltip. */
.f3-btns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin-top:6px}
.f3-btns.n2{grid-template-columns:repeat(2,minmax(0,1fr))}.f3-btns.n1{grid-template-columns:minmax(0,1fr)}
.f3-btns>.f3-btn{justify-content:center;padding:0 5px;min-width:0}
.f3-prow .f3-btns{margin-top:0}
.f3-btn[aria-pressed=true]{background:var(--accent-2);color:var(--accent-ink)}
.f3-cells.fin{grid-template-columns:30px minmax(0,1fr)}.f3-prow>.lab>.f3-medit{margin-left:auto;flex:none;width:22px;height:22px;border-radius:6px;border:1px solid var(--line);background:var(--field);color:var(--muted);display:grid;place-items:center;cursor:pointer;padding:0}.f3-prow>.lab>.f3-medit[aria-pressed=true]{color:var(--accent,#e86a1e);border-color:var(--accent,#e86a1e)}.f3-prow>.lab>.f3-medit svg{width:13px;height:13px}.f3-surface{margin:2px 0 8px 10px;padding:4px 0 4px 10px;border-left:2px solid var(--line)}.f3-cells.fin>*{grid-column:auto}
/* A narrow panel puts the label above its cells (nothing cut). */
@container (max-width:268px){.f3-prow{grid-template-columns:minmax(0,1fr);gap:3px}.f3-btns{grid-template-columns:repeat(2,minmax(0,1fr))}}
.f3 select option{background:#24272c;color:var(--ink)}
.f3-row{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
.f3-seg{display:flex;flex-wrap:wrap;background:var(--field);border-radius:6px;padding:2px;gap:2px;width:100%}
/* A choice never shrinks below its text: when they do not fit on one line they wrap. */
.f3-seg button{flex:1 0 auto;border:0;background:transparent;border-radius:4px;height:22px;padding:0 4px;font-size:11.5px;display:flex;align-items:center;justify-content:center;gap:4px;min-width:0;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.f3-seg button:hover{color:var(--ink)}
.f3-seg button[aria-pressed=true]{background:var(--raise);color:var(--ink);box-shadow:0 1px 2px #0005}
.f3-swatch{display:inline-block;width:12px;height:12px;border-radius:3px;border:2px solid;margin-right:5px;flex:none}
.f3-chips{display:grid;grid-template-columns:repeat(6,1fr);gap:2px;background:var(--field);border-radius:6px;padding:2px}
.f3-chip{border:0;background:transparent;border-radius:4px;height:28px;display:grid;place-items:center;color:var(--muted);padding:0}
.f3-chip span{display:none}
.f3-chip:hover{color:var(--ink);background:#ffffff0d}
.f3-chip[aria-pressed=true]{background:var(--raise);color:var(--accent-ink);box-shadow:0 1px 2px #0005}
.f3-btn{border:0;background:var(--raise);border-radius:6px;height:24px;padding:0 9px;display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--ink);white-space:nowrap}
.f3-btn:hover{background:var(--field-h)}
.f3-btn svg{width:14px;height:14px}
.f3-btn.danger{color:var(--danger)}
.f3-btn.primary{background:var(--accent);color:#1b0f06;font-weight:600}
.f3-btn.ic{width:24px;padding:0;justify-content:center}
.f3-sw{display:grid;grid-template-columns:84px 24px minmax(0,1fr);gap:6px;align-items:center;min-height:26px}
.f3-sw input[type=color]{width:24px;height:22px;border:0;border-radius:5px;padding:0;background:none;cursor:pointer}
.f3-sw>span{font-size:11px;color:var(--muted)}
.f3-pick{width:100%;height:26px;border:1px solid transparent;border-radius:5px;padding:0 6px;font:inherit;background:var(--field);color:var(--ink)}
.f3-pick:focus{outline:none;border-color:var(--accent)}
.f3-swatch{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:11px;cursor:pointer}
.f3-swatch input{width:22px;height:22px;border:0;border-radius:5px;padding:0;background:none;cursor:pointer}
.f3-op{border-top:1px solid var(--line);margin-top:8px;padding-top:6px}
.f3-op h4{margin:0 0 4px;font-size:11px;font-weight:600;color:var(--muted)}
.f3-op .f3-row{justify-content:flex-end;margin-top:4px}
.f3-rule{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;align-items:center;gap:4px;border-radius:7px;background:var(--raise);padding:5px 6px;margin-bottom:4px}
.f3-rule .t{grid-column:1;min-width:0}
.f3-rule .t b{display:block;font-size:11.5px;font-weight:600;overflow-wrap:anywhere}
.f3-rule .t small{color:var(--faint);font-size:10.5px;display:block;line-height:1.3}
.f3-rule>.f3-grid2,.f3-rule>.f3-row{grid-column:1/-1}
.f3-rule select,.f3-rule input{height:22px;border:0;border-radius:5px;padding:0 6px;font:inherit;background:var(--field);color:var(--ink);min-width:0}
.f3-rule .f3-btn{height:22px}
.f3-rule{grid-template-columns:minmax(0,1fr) 78px auto}
.f3-rule .f3-cell input,.f3-rule .f3-cell select{height:100%;background:transparent;padding:0 4px}
.f3-rule-body{grid-column:1/-1;margin-top:4px}
.f3-empty{color:var(--muted);font-size:11.5px;padding:14px 12px;line-height:1.55}
.f3-sumstats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-bottom:12px}.f3-sumstats>div{display:grid;gap:1px;padding:8px 10px;border-radius:8px;background:var(--field)}.f3-sumstats b{font-size:15px;font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums}.f3-sumstats span{font-size:11px;color:var(--muted)}.f3-summary .f3-btns{gap:5px}.f3-summary .f3-btn{justify-content:flex-start;gap:8px;padding:0 10px}
.f3-empty b{color:var(--ink)}
.f3-keys{display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center;margin-top:12px}
/* Layers */
.f3-lrow{display:flex;align-items:center;gap:3px;padding:0 4px;border-radius:5px;height:26px}
.f3-lrow:hover{background:var(--raise)}
.f3-lrow[aria-selected=true]{background:var(--sel-2)}
.f3-lrow .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
.f3-lrow input.nm{border:1px solid transparent;border-radius:4px;height:22px;padding:0 4px;font:inherit;background:transparent;color:var(--ink);cursor:text}
.f3-lrow input.nm:focus{border-color:var(--accent);outline:none;background:var(--field)}
.f3-lrow .ic{border:0;background:transparent;border-radius:4px;width:22px;height:22px;display:grid;place-items:center;color:var(--muted);padding:0;flex:none;opacity:.55}
.f3-lrow:hover .ic,.f3-lrow .ic[aria-pressed=false],.f3-lrow .ic.on{opacity:1}
.f3-lrow .ic:hover{background:var(--field-h);color:var(--ink)}
.f3-lrow .ic[aria-pressed=false]{color:var(--faint)}
.f3-lrow .ic svg{width:14px;height:14px}
.f3-lrow input[type=color]{width:14px;height:14px;border:0;padding:0;background:none;flex:none;border-radius:3px;cursor:pointer}
.f3-lrow select{max-width:84px;height:20px;border:0;border-radius:4px;font:inherit;font-size:10.5px;padding:0 2px;background:transparent;color:var(--faint)}
.f3-lrow:hover select{background:var(--field);color:var(--ink)}
.f3-lrow .op{width:14px;text-align:center;font-weight:700;color:var(--faint);flex:none}
.f3-lrow small{color:var(--faint);font-size:10.5px;min-width:14px;text-align:right}
.f3-lrow.sub{padding-left:20px}
.f3-lrow.sub2{padding-left:34px;color:var(--muted)}
.f3-lrow.off .nm{color:var(--faint);text-decoration:line-through}
/* Dialogs */
.f3-modal{position:absolute;inset:0;background:#0009;z-index:40;display:grid;place-items:start center;padding-top:12vh}
.f3-modal>div{background:var(--panel-solid);border:1px solid var(--line);border-radius:12px;max-width:min(720px,92vw);max-height:76vh;overflow:auto;padding:16px 18px;box-shadow:0 24px 70px #000a;color:var(--ink)}
/* Automatic element groups (category → type → variant) */
.f3-groups{display:grid;gap:1px}
.f3-grp{display:flex;align-items:center;gap:6px;height:24px;padding:0 8px;border:0;border-radius:5px;background:transparent;color:var(--ink);font:inherit;text-align:left;cursor:pointer;min-width:0}
.f3-grp:hover{background:var(--raise)}
.f3-grp.d0{font-weight:600}
.f3-grp.d1{padding-left:18px;color:var(--muted)}
.f3-grp.d2{padding-left:30px;color:var(--faint)}
.f3-grp.d2 .nm::before{content:'↳ '}
.f3-grp .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.f3-grp .n{font:600 10.5px ui-monospace,Consolas,monospace;color:var(--faint)}
.f3-grp[aria-pressed=true]{background:var(--sel-2);color:var(--ink)}
.f3-grp[data-part] .n{color:var(--accent)}
.f3-chips{display:flex;flex-wrap:wrap;gap:4px}
.f3-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:var(--field);color:var(--ink);border-radius:999px;height:24px;padding:0 10px;font:inherit;cursor:pointer;max-width:100%;overflow:hidden;white-space:nowrap}
.f3-chip:hover{background:var(--field-h)}
.f3-chip b{font:600 10.5px ui-monospace,Consolas,monospace;color:var(--muted)}
.f3-help h2{margin:0 0 10px;font-size:16px}
.f3-chips{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:4px;padding:2px 0 4px}.f3-chips button{height:22px;padding:0 8px;border-radius:11px;border:1px solid var(--line);background:var(--field);color:var(--muted);font-size:11px;cursor:pointer}.f3-chips button[aria-pressed=true]{background:var(--accent-2);border-color:var(--accent);color:var(--accent-ink)}
.f3-catpop{position:absolute;z-index:30;width:220px;padding:8px;border-radius:10px;background:var(--panel-solid);border:1px solid var(--line);box-shadow:0 12px 40px #0008;pointer-events:none;display:grid;gap:4px}.f3-catpop img{width:100%;aspect-ratio:1;object-fit:contain;background:var(--field);border-radius:6px}.f3-catpop b{font-size:12.5px}.f3-catpop small{color:var(--muted);font-size:11px}
.f3-matlib{display:grid;gap:4px;margin-bottom:4px}.f3-matrow{display:grid;grid-template-columns:28px minmax(0,1fr) 24px 28px 28px;gap:4px;align-items:center}.f3-matrow .sw{width:28px;height:28px;border-radius:6px;border:1px solid var(--line);cursor:pointer;padding:0}.f3-matrow input{height:26px;border:1px solid var(--line);border-radius:6px;background:var(--field);color:var(--ink);padding:0 6px;min-width:0}.f3-matrow small{color:var(--faint);text-align:right;font-variant-numeric:tabular-nums}
.f3-link{background:none;border:0;padding:0;color:var(--accent);cursor:pointer;font:inherit;text-align:left}
.f3-roomlbl{position:absolute;z-index:6;transform:translate(-50%,-50%);display:grid;justify-items:center;gap:0;padding:3px 8px;border-radius:7px;border:1px solid #0003;background:#ffffffe6;color:#2a2a2a;cursor:pointer;font:600 11.5px system-ui,sans-serif;box-shadow:0 2px 8px #0003}.f3-roomlbl b{color:#222}.f3-roomlbl small{font-weight:500;color:#555;font-size:10.5px}.f3-roomlbl[aria-pressed=true]{background:var(--accent);color:#fff}.f3-roomlbl[aria-pressed=true] small,.f3-roomlbl[aria-pressed=true] b{color:#fff}
.f3-floors{width:100%;border-collapse:collapse;font-size:12px}.f3-floors th{text-align:left;color:var(--muted);font-weight:500;padding:2px 4px}.f3-floors td{padding:2px 4px;color:var(--muted)}.f3-floors input{width:100%;box-sizing:border-box;height:24px;border:1px solid var(--line);border-radius:5px;background:var(--field);color:var(--ink);padding:0 6px}.f3-floors td:first-child{width:48%}.f3-floors td:last-child{width:26%}
.f3-cat-tabs button{display:flex;align-items:center;justify-content:space-between;gap:6px}.f3-cat-tabs button small{color:var(--faint);font-size:10.5px;font-variant-numeric:tabular-nums}
.f3-modal>.f3-versions{width:min(620px,94vw);display:grid;gap:10px}
.f3-versions header{display:flex;align-items:center;justify-content:space-between}.f3-versions h2{margin:0;font-size:15px}
.f3-versions .f3-x{background:none;border:0;color:var(--muted);font-size:20px;cursor:pointer}
.f3-versions .row{display:flex;gap:6px}.f3-versions .row input{flex:1;height:30px;border:1px solid var(--line);border-radius:6px;background:var(--field);color:var(--ink);padding:0 8px}
.f3-versions .f3-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent);padding:0 12px}
.f3-versions .list{list-style:none;margin:0;padding:0;display:grid;gap:4px;max-height:50vh;overflow:auto}
.f3-versions li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;align-items:center;padding:6px;border:1px solid var(--line);border-radius:8px}
.f3-versions li div{display:grid;gap:2px;min-width:0}.f3-versions li input{border:0;background:none;color:var(--ink);font-weight:600;min-width:0;padding:2px 0}
.f3-versions li small{color:var(--muted);font-size:11px}.f3-versions li.empty{color:var(--muted);display:block;border-style:dashed}
.f3-versions .note{color:var(--faint);font-size:11px;margin:0}
.f3-versions h3{margin:4px 0 0;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.f3-versions li div b{font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.f3-acctbtn{margin-left:6px;position:relative;padding:0 5px}.f3-acctbtn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.f3-acctbtn .av{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:var(--accent-2);color:var(--accent-ink);font-weight:700;font-size:11px}
.f3-acctbtn .pro,.f3-pro{font-style:normal;font-size:9px;font-weight:700;letter-spacing:.04em;padding:1px 4px;border-radius:4px;background:var(--accent);color:#1b0f06;margin-right:4px}
.f3-acctbtn .cl{display:inline-grid;color:var(--faint)}.f3-acctbtn .cl svg{width:14px;height:14px}
.f3-acctbtn[data-state=saving] .cl{color:var(--sel)}.f3-acctbtn[data-state=saved] .cl{color:#4fb477}.f3-acctbtn[data-state=local] .cl,.f3-acctbtn[data-state=error] .cl{color:var(--danger)}
.f3-modal>.f3-acct{width:min(640px,94vw);max-height:88vh;display:grid;gap:12px;padding:20px 22px}
.f3-acct header{display:flex;align-items:center;justify-content:space-between}.f3-acct h2{margin:0;font-size:17px}
.f3-acct .f3-x{background:none;border:0;color:var(--muted);font-size:20px;cursor:pointer}
.f3-acct .lead{margin:0;color:var(--muted);font-size:13px;line-height:1.45}
.f3-acct .why{margin:0;display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:8px;background:var(--accent-2);color:var(--ink);font-size:12.5px}.f3-acct .why svg{flex:none;color:var(--accent-ink)}
.f3-acct .in{display:flex;gap:6px}.f3-acct .in input{flex:1;height:34px;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--ink);padding:0 10px;font-size:13px}
.f3-acct .f3-btn{height:34px;padding:0 14px;border-radius:7px;font-weight:600;gap:8px;display:inline-flex;align-items:center;justify-content:center}
.f3-acct .f3-btn.primary{background:var(--accent);color:#1b0f06;border-color:var(--accent)}
.f3-acct .f3-btn.google{width:100%}.f3-acct .f3-btn.google svg{stroke:none;width:18px;height:18px;fill:initial}
.f3-acct .f3-btn.busy{opacity:.6;cursor:progress}
.f3-acct .sent{margin:0;display:flex;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:8px;font-size:13px}.f3-acct .sent svg{flex:none;color:#4fb477}
.f3-acct .me{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:10px}
.f3-acct .me .av{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--accent-2);color:var(--accent-ink);font-weight:700}
.f3-acct .me div{display:grid;gap:2px;min-width:0}.f3-acct .me b{overflow:hidden;text-overflow:ellipsis}.f3-acct .me small{color:var(--muted);font-size:11.5px}
.f3-acct .plans{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.f3-acct .plan{display:grid;align-content:start;gap:8px;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--field)}
.f3-acct .plan.pro{border-color:var(--accent);background:linear-gradient(180deg,var(--accent-2),transparent 60%),var(--field)}
.f3-acct .plan h4{margin:0;font-size:14px;display:flex;align-items:center;gap:8px}.f3-acct .plan h4 em{font-style:normal;font-size:10.5px;font-weight:600;color:var(--accent-ink);background:var(--accent-2);padding:2px 6px;border-radius:99px}
.f3-acct .price{margin:0;color:var(--muted);font-size:12px}.f3-acct .price b{font-size:22px;color:var(--ink)}.f3-acct .price small{display:block;margin-top:2px}
.f3-acct .plan ul{margin:0;padding:0 0 0 16px;display:grid;gap:4px;font-size:12.5px;color:var(--ink)}
.f3-acct .buy{display:grid;gap:6px}.f3-acct .hint{margin:0;color:var(--muted);font-size:11.5px}
.f3-acct .note{margin:0;color:var(--faint);font-size:11.5px}
@media (max-width:620px){.f3-acct .plans{grid-template-columns:minmax(0,1fr)}}
.f3-modal>.f3-start{width:min(1040px,94vw);max-width:none;max-height:92vh;overflow:auto;display:grid;gap:14px;padding:20px 22px}
.f3-start header{display:flex;align-items:center;gap:8px}.f3-start h2{margin:0;font-size:18px;flex:1}
.f3-start .f3-x{background:none;border:0;color:var(--muted);font-size:20px;cursor:pointer}
.f3-start .cols{display:grid;grid-template-columns:minmax(0,1fr);gap:18px}
.f3-start h3{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.f3-start .tpls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.f3-start .tpl{display:grid;grid-template-rows:auto auto 1fr;gap:3px;align-content:start;text-align:left;padding:0 0 10px;border:1px solid var(--line);border-radius:10px;background:var(--field);color:var(--ink);cursor:pointer;overflow:hidden;transition:border-color .12s,transform .12s}.f3-start .tpl:hover{transform:translateY(-1px)}
.f3-start .tpl .pic{display:grid;place-items:center;aspect-ratio:16/10;background:#dedbd1;margin-bottom:6px;overflow:hidden}.f3-start .tpl .pic img{width:100%;height:100%;object-fit:cover;display:block}.f3-start .tpl[data-tpl=blank] .pic{background:repeating-linear-gradient(0deg,transparent 0 19px,#0000000f 19px 20px),repeating-linear-gradient(90deg,transparent 0 19px,#0000000f 19px 20px),#dedbd1}
.f3-start .tpl:hover,.f3-start .tpl:focus-visible{border-color:var(--accent);outline:none}
.f3-start .tpl .pic svg{width:34px;height:34px;fill:none;stroke:var(--accent);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.f3-start .tpl b{font-size:13px;font-weight:600;padding:0 11px}.f3-start .tpl small{color:var(--muted);font-size:11.5px;line-height:1.3;padding:0 11px}
@media (max-width:760px){.f3-start .cols{grid-template-columns:minmax(0,1fr)}.f3-start .tpls{grid-template-columns:repeat(2,minmax(0,1fr))}}
.f3-start .list{list-style:none;margin:0;padding:0;display:grid;gap:4px;max-height:52vh;overflow:auto}
.f3-start li{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:6px;align-items:center;padding:6px 8px;border:1px solid var(--line);border-radius:8px}
.f3-start li.cur{border-color:var(--accent)}
.f3-start li .th{width:64px;height:40px;border-radius:5px;object-fit:cover;background:var(--field);display:grid;place-items:center;color:var(--muted)}.f3-start li .th svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6}
.f3-start li div{display:grid;gap:2px;min-width:0}.f3-start li input{border:0;background:none;color:var(--ink);font-weight:600;min-width:0;padding:2px 0}
.f3-start li small{color:var(--muted);font-size:11px}.f3-start li.empty{color:var(--muted);display:block;border-style:dashed}
.f3-start .f3-btn.armed{color:#fff;background:var(--danger,#c2321f);border-color:transparent;width:auto;padding:0 8px}
.f3-start .note{color:var(--faint);font-size:11.5px;margin:0}
@media (max-width:760px){.f3-start .cols,.f3-start .tpls{grid-template-columns:minmax(0,1fr)}}
.f3-modal>.f3-creator{width:min(1100px,96vw);max-width:none;max-height:86vh;display:flex;flex-direction:column;padding:12px 14px}
.f3-creator header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.f3-creator h2{margin:0;font-size:15px}
.f3-creator .f3-x{background:none;border:0;color:var(--muted);font-size:20px;cursor:pointer}
.f3-creator .cols{display:grid;grid-template-columns:200px minmax(0,1fr) 300px;gap:12px;min-height:0;flex:1}
.f3-creator nav{display:flex;flex-direction:column;min-height:0}.f3-creator nav[hidden]{display:none}.f3-creator nav input{height:28px;border:1px solid var(--line);border-radius:6px;background:var(--field);color:var(--ink);padding:0 8px;margin-bottom:6px}
.f3-creator nav ul{list-style:none;margin:0;padding:0;overflow:auto;max-height:66vh}.f3-creator nav li.cat{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:8px 4px 2px}
.f3-creator nav button{width:100%;text-align:left;background:none;border:0;color:var(--ink);padding:4px 6px;border-radius:5px;cursor:pointer}.f3-creator nav button[aria-pressed=true]{background:var(--accent-2);color:var(--accent-ink)}
.f3-creator .form{overflow:auto;max-height:70vh;padding-right:4px}.f3-creator .fam{color:var(--muted);margin:0 0 6px;font-size:12px}
.f3-creator fieldset{border:1px solid var(--line);border-radius:8px;margin:0 0 8px;padding:6px 8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:4px 12px}
.f3-creator legend{font-size:11.5px;font-weight:600;padding:0 4px}
.f3-creator .form label{display:grid;grid-template-columns:minmax(0,1fr) 120px;align-items:center;gap:8px;font-size:12px;min-height:28px}
.f3-creator .form label>span{overflow-wrap:anywhere}
.f3-creator .form select,.f3-creator .form input:not([type=checkbox]),.f3-creator .num{height:26px;border:1px solid var(--line);border-radius:6px;background:var(--field);color:var(--ink);min-width:0;width:100%;box-sizing:border-box}
.f3-creator .num{display:flex;align-items:center;padding-right:6px}.f3-creator .num input{border:0!important;background:none!important;height:24px!important;padding:0 6px}.f3-creator .num em{font-style:normal;color:var(--muted);font-size:11px}
.f3-creator .form input[type=color]{padding:0 2px}.f3-creator .form input[type=checkbox]{justify-self:start}
.f3-creator aside{display:flex;flex-direction:column;gap:8px}.f3-creator aside img{width:100%;aspect-ratio:32/26;object-fit:contain;background:var(--field);border-radius:8px;border:1px solid var(--line)}
.f3-creator aside label{display:grid;gap:4px;font-size:12px}.f3-creator aside label input{height:28px;border:1px solid var(--line);border-radius:6px;background:var(--field);color:var(--ink);padding:0 8px}
.f3-creator .note{color:var(--muted);font-size:11.5px;margin:0;min-height:1em}.f3-creator .acts{display:flex;gap:6px;justify-content:flex-end;margin-top:auto}.f3-creator .acts .f3-btn{padding:0 12px;height:30px}
.f3-creator .f3-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
@media (max-width:900px){.f3-creator .cols{grid-template-columns:1fr}.f3-creator nav ul{max-height:22vh}}
.f3-modal>.f3-help{width:min(980px,94vw);max-width:none}
.f3-help .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:14px 26px;font-size:12px}
/* Columns of different lengths: rows never stretch, so the three headings line up. Same heading as a panel section. */
.f3-help .f3-keys{align-content:start}
.f3-help h3{grid-column:1/-1;margin:0 0 2px;font-size:11.5px;font-weight:600;color:var(--ink)}
.f3-help .f3-keys>span{min-width:0;overflow-wrap:anywhere}
.f3-help .f3-keys{grid-template-columns:auto minmax(0,1fr)}
.f3-menu{position:absolute;z-index:30;max-height:calc(100vh - 64px);overflow:auto;background:var(--panel-solid);border:1px solid var(--line);border-radius:9px;box-shadow:0 14px 40px #0008;padding:4px;min-width:210px;color:var(--ink)}
.f3-menu button{display:flex;width:100%;border:0;background:transparent;border-radius:6px;min-height:30px;padding:4px 9px;gap:9px;align-items:center;text-align:left;color:var(--ink);letter-spacing:0;font-weight:400}
.f3-menu button:hover{background:var(--raise)}
.f3-menu small,.f3-menu kbd{margin-left:auto;color:var(--faint);display:inline-flex;align-items:center;white-space:nowrap;padding-left:10px}
.f3-menu[data-menu-of=export]{width:min(400px,calc(100% - 16px))}
.f3-menu hr{border:0;border-top:1px solid var(--line);margin:4px 2px}
.f3-menu .f3-menu-h{font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);padding:8px 9px 3px}
.f3-pal{width:min(560px,92vw);padding:0 !important;overflow:hidden !important;display:flex;flex-direction:column}
.f3-pal input{border:0;border-bottom:1px solid var(--line);background:transparent;color:var(--ink);font:14px Inter,"Segoe UI",system-ui,sans-serif;padding:14px 16px;outline:none}
.f3-pal ul{list-style:none;margin:0;padding:4px;overflow:auto;max-height:52vh}
.f3-pal li{display:flex;align-items:center;gap:10px;height:32px;padding:0 10px;border-radius:6px;cursor:pointer}
.f3-pal li[aria-selected=true]{background:var(--accent-2)}
.f3-pal li small{margin-left:auto;color:var(--faint)}
.f3-pal li em{font-style:normal;color:var(--faint);font-size:11px}
`;

export interface Shell3 {
  root: HTMLElement;
  view: HTMLElement;
  side: HTMLElement;
  layers: HTMLElement;
  tree: HTMLElement;
  tabs: HTMLElement;
  aside: HTMLElement;
  cat: HTMLElement;
  tools: HTMLElement;
  /** The view controls at the right of the toolbar: 3D / 2D and the floor shown. */
  viewctl: HTMLElement;
  status: { hint: HTMLElement; vcbLabel: HTMLElement; vcb: HTMLInputElement; stats: HTMLElement; bar: HTMLElement };
  crumb: HTMLElement;
  /** Selection mode switch (volumes, vertex, edge, face). */
  modes: HTMLElement;
  ctxbar: HTMLElement;
  /** "View" island (grid, rotation step, snap, time of day, frame). */
  viewbar: HTMLElement;
  snap: HTMLElement;
  dim: HTMLElement;
  toast: HTMLElement;
  warn: HTMLElement;
  name: HTMLInputElement;
  top: HTMLElement;
}

export function createShell3(container: HTMLElement): Shell3 {
  const doc = container.ownerDocument;
  if (!doc.getElementById('f3-css')) {
    const st = doc.createElement('style');
    st.id = 'f3-css';
    st.textContent = CSS;
    doc.head.appendChild(st);
  }
  const root = doc.createElement('div');
  root.className = 'f3';
  root.innerHTML = `
  <header class="f3-top">
    <button class="f3-brand" aria-haspopup="menu" aria-expanded="false" title="Project: new, open, save, projects"><i></i>${BRAND}</button>
    <input class="f3-name" aria-label="Project name" value="Untitled project">
    <span class="f3-saved"></span>
    <button class="f3-tb" data-cmd="undo" title="Undo · Ctrl+Z" aria-label="Undo">${icon('undo')}</button>
    <button class="f3-tb" data-cmd="redo" title="Redo · Ctrl+Y" aria-label="Redo">${icon('redo')}</button>
    <span class="f3-topsep"></span>
    <div class="f3-viewctl" aria-label="View"></div>
    <span class="f3-sp"></span>
    <button class="f3-search" data-cmd="palette" title="Search tools, commands and components">${icon('search')}<span>Search commands</span><kbd>Ctrl K</kbd></button>
    <span class="f3-sp"></span>
    <button class="f3-tb" data-cmd="help" title="Shortcuts · ?" aria-label="Shortcuts">${icon('help')}</button>
    <button class="f3-tb primary" data-cmd="export" title="Export drawings (PDF, DXF), BIM (IFC), 3D and image">${icon('export')}<span>Export</span></button>
    <div class="f3-menu" data-menu-of="project" role="menu" hidden>
      <button data-cmd="new" role="menuitem">${icon('folder')}New project…</button>
      <button data-cmd="projects" role="menuitem">${icon('template')}Projects…</button>
      <button data-cmd="open" role="menuitem">${icon('open')}Open…</button>
      <button data-cmd="save" role="menuitem">${icon('save')}Save<kbd>Ctrl S</kbd></button>
      <button data-cmd="versions" role="menuitem">${icon('layers')}Versions…</button>
    </div>
  </header>
  <nav class="f3-tools" aria-label="Tools"><div class="f3-toolset"></div></nav>
  <section class="f3-cat closed" aria-label="Library"></section>
  <main class="f3-view">
    <div class="f3-crumb f3-island"></div>
    <div class="f3-modes f3-island" role="toolbar" aria-label="Selection mode" hidden></div>
    <div class="f3-ctx" role="toolbar" aria-label="Selection actions" hidden></div>
    <div class="f3-snap" hidden></div>
    <div class="f3-dim" hidden></div>
    <div class="f3-toast" role="status"></div>
    <div class="f3-warn" role="alert"></div>
    <div class="f3-viewbar f3-island" aria-label="View">
      <label class="f3-ctl" title="Grid and snap step">${icon('grid')}<select data-grid><option value="0.05">5 cm</option><option value="0.1">10 cm</option><option value="0.25">25 cm</option><option value="0.5" selected>50 cm</option><option value="1">1 m</option><option value="2">2 m</option><option value="5">5 m</option></select></label>
      <label class="f3-ctl" title="Rotation step">${icon('rotate')}<select data-rot><option value="1">1°</option><option value="5">5°</option><option value="15" selected>15°</option><option value="30">30°</option><option value="45">45°</option><option value="90">90°</option></select></label>
      <span class="f3-sepv"></span>
      <button class="f3-tb" data-cmd="snap" title="Snap · G">${icon('magnet')}</button>
      <button class="f3-tb" data-cmd="frame" title="Frame · F">${icon('focus')}</button>
    </div>
  </main>
  <aside class="f3-aside">
    <div class="f3-grip" title="Drag to change the panel width"></div>
    <div class="f3-tabs" role="tablist"><button role="tab" data-tab="props" aria-selected="true">Properties</button><button role="tab" data-tab="tree" aria-selected="false">Structure</button><button role="tab" data-tab="layers" aria-selected="false">Layers</button><button class="f3-tb" data-aside="min" title="Collapse or open the panel">${icon('minus')}</button></div>
    <div class="f3-side" role="tabpanel" aria-label="Properties"></div>
    <div class="f3-tree" role="tabpanel" aria-label="Structure" hidden></div>
    <div class="f3-layers" role="tabpanel" aria-label="Layers" hidden></div>
  </aside>
  <footer class="f3-status">
    <span class="f3-hint"></span>
    <span class="f3-vcb" title="Type a value and Enter during or right after an operation (10, 10x8, 5x)"><label>Measure</label><input aria-label="Measure" spellcheck="false" autocomplete="off"></span>
    <span class="f3-stats"></span>
  </footer>
  <input type="file" accept=".json,application/json,.dxf" hidden data-file="project">
  <input type="file" accept=".json,application/json" hidden data-file="component">`;
  container.appendChild(root);
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  // Project menu (on the brand).
  const brand = $('.f3-brand');
  const pmenu = $('[data-menu-of="project"]');
  const closeMenu = () => {
    pmenu.hidden = true;
    brand.setAttribute('aria-expanded', 'false');
  };
  brand.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = pmenu.hidden;
    pmenu.hidden = !open;
    brand.setAttribute('aria-expanded', String(open));
    if (open) {
      const r = brand.getBoundingClientRect(),
        rr = root.getBoundingClientRect();
      pmenu.style.left = `${r.left - rr.left}px`;
      pmenu.style.top = `${r.bottom - rr.top + 4}px`;
    }
  });
  pmenu.addEventListener('click', closeMenu);
  doc.addEventListener('pointerdown', (e) => {
    if (!pmenu.hidden && !pmenu.contains(e.target as Node) && !brand.contains(e.target as Node)) closeMenu();
  });
  // Esc closes the menu and gives the focus back to the brand (menu button pattern), before the editor sees the key.
  doc.addEventListener(
    'keydown',
    (e) => {
      if (pmenu.hidden || e.key !== 'Escape') return;
      e.stopPropagation();
      closeMenu();
      brand.focus();
    },
    true,
  );
  const aside = $('.f3-aside');
  const minBtn = $('[data-aside="min"]');
  minBtn.addEventListener('click', () => {
    const min = aside.classList.toggle('min');
    // Collapsed, the button shows that it reopens the panel.
    minBtn.innerHTML = icon(min ? 'props' : 'minus');
    minBtn.dataset.tip = min ? 'Open the panel' : 'Collapse the panel';
  });
  // Panel width: drag the left edge (240–560 px), remembered in this browser.
  const grip = $('.f3-grip');
  const setW = (w: number) => root.style.setProperty('--aside-w', `${Math.round(Math.max(240, Math.min(560, w)))}px`);
  try {
    const saved = Number(localStorage.getItem('forma3_aside_w'));
    if (saved) setW(saved);
  } catch {
    /* no storage: default width */
  }
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('on');
    const x0 = e.clientX,
      w0 = aside.getBoundingClientRect().width;
    const move = (ev: PointerEvent) => setW(w0 + (x0 - ev.clientX));
    const up = () => {
      grip.classList.remove('on');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      try {
        localStorage.setItem('forma3_aside_w', String(Math.round(aside.getBoundingClientRect().width)));
      } catch {
        /* no storage */
      }
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
  installTooltips(root);
  return {
    root,
    view: $('.f3-view'),
    side: $('.f3-side'),
    layers: $('.f3-layers'),
    tree: $('.f3-tree'),
    tabs: $('.f3-tabs'),
    aside,
    cat: $('.f3-cat'),
    tools: $('.f3-toolset'),
    viewctl: $('.f3-viewctl'),
    status: { hint: $('.f3-hint'), vcbLabel: $('.f3-vcb label'), vcb: $('.f3-vcb input'), stats: $('.f3-stats'), bar: $('.f3-status') },
    crumb: $('.f3-crumb'),
    modes: $('.f3-modes'),
    ctxbar: $('.f3-ctx'),
    viewbar: $('.f3-viewbar'),
    snap: $('.f3-snap'),
    dim: $('.f3-dim'),
    toast: $('.f3-toast'),
    warn: $('.f3-warn'),
    name: $('.f3-name'),
    top: $('.f3-top'),
  };
}

/**
 * Own tooltips instead of the native `title` (slow and off-style): the title
 * becomes `data-tip` on the first hover and shows in a dark balloon.
 */
function installTooltips(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const tip = doc.createElement('div');
  tip.className = 'f3-tip';
  root.appendChild(tip);
  let timer = 0;
  let cur: HTMLElement | null = null;
  const hide = () => {
    clearTimeout(timer);
    tip.classList.remove('on');
    cur = null;
  };
  // A field being typed in needs no name, and its balloon would cover the row below
  // (a panel redraw under a still mouse sends a new pointerover to the new field).
  const typing = (el: HTMLElement) => {
    const a = doc.activeElement;
    return !!a && el.contains(a) && a.matches('input, textarea, select');
  };
  // After a press or a key, no balloon until the mouse really moves (like the native title):
  // a panel redrawn under a still mouse sends a pointerover to the new element, and the
  // balloon came back at once over the rows below what was just used.
  let quiet: [number, number] | null = null;
  let at: [number, number] = [-1e4, -1e4];
  const over = (target: EventTarget | null) => {
    if (quiet) return;
    const el = (target as HTMLElement | null)?.closest?.<HTMLElement>('[title],[data-tip]');
    if (!el || !root.contains(el)) return hide();
    if (el.title) {
      el.dataset.tip = el.title;
      el.removeAttribute('title');
    }
    if (el === cur) return;
    hide();
    cur = el;
    timer = window.setTimeout(() => {
      if (!cur || !cur.isConnected || typing(cur)) return;
      const text = cur.dataset.tip ?? '';
      // A tool: its name and key on the first line, what it does below ("Name: what it does · Key").
      const cut = text.lastIndexOf(' · ');
      const body = cut > 0 ? text.slice(0, cut) : text;
      const colon = body.indexOf(': ');
      if (cur.closest('.f3-tools') && cut > 0) {
        tip.textContent = '';
        const b = doc.createElement('b');
        b.textContent = colon > 0 ? body.slice(0, colon) : body;
        const k = doc.createElement('kbd');
        k.textContent = text.slice(cut + 3);
        tip.append(b, k);
        if (colon > 0) {
          const pr = doc.createElement('p');
          const what = body.slice(colon + 2);
          pr.textContent = what[0]!.toUpperCase() + what.slice(1);
          tip.append(pr);
        }
        tip.classList.add('rich');
      } else {
        tip.classList.remove('rich');
        tip.textContent = text;
      }
      const r = cur.getBoundingClientRect();
      tip.classList.add('on');
      const tw = tip.offsetWidth,
        th = tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2,
        y = r.bottom + 6;
      // Tools on the left: balloon on the right side.
      if (cur.closest('.f3-tools')) {
        x = r.right + 8;
        y = r.top + r.height / 2 - th / 2;
      }
      if (y + th > innerHeight - 4) y = r.top - th - 6;
      tip.style.left = `${Math.max(4, Math.min(innerWidth - tw - 4, x))}px`;
      tip.style.top = `${Math.max(4, y)}px`;
      // The tool bar answers at once (its icons have no words); elsewhere after a short pause.
    }, cur.closest('.f3-tools') ? 120 : 380);
  };
  root.addEventListener('pointerover', (e) => over(e.target));
  root.addEventListener('pointermove', (e) => {
    at = [e.clientX, e.clientY];
    if (quiet && e.buttons === 0 && Math.hypot(e.clientX - quiet[0], e.clientY - quiet[1]) > 4) {
      quiet = null;
      over(e.target);
    }
  });
  root.addEventListener('pointerleave', hide);
  root.addEventListener('pointerdown', (e) => {
    hide();
    quiet = [e.clientX, e.clientY];
  });
  // The release point (a drag ends away from where it started).
  root.addEventListener('pointerup', (e) => quiet && (quiet = [e.clientX, e.clientY]));
  root.addEventListener('keydown', () => {
    hide();
    quiet = at;
  });
}
