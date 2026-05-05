"use strict";

// State -----------------------------------------------------------------

const layers = []; // { id, name, url, img, el, anchor:{x,y}, scale, rotate, opacity, visible }
let nextId = 1;
let anchoringLayer = null;

const view = { tx: 0, ty: 0, zoom: 1 };

// DOM -------------------------------------------------------------------

const fileInput = document.getElementById("file-input");
const layersEl = document.getElementById("layers");
const stage = document.getElementById("stage");
const viewport = document.getElementById("viewport");
const world = document.getElementById("world");
const emptyState = document.getElementById("empty-state");
const tpl = document.getElementById("layer-template");
const resetBtn = document.getElementById("reset-view");

// Layer creation --------------------------------------------------------

fileInput.addEventListener("change", (e) => {
  for (const file of e.target.files) addLayerFromFile(file);
  fileInput.value = "";
});

function addLayerFromFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  img.onload = () => {
    const layer = {
      id: nextId++,
      name: stripExt(file.name),
      url,
      img,
      anchor: { x: img.naturalWidth / 2, y: img.naturalHeight / 2 },
      scale: 1,
      rotate: 0,
      opacity: 0.5,
      visible: true,
      el: null,
      card: null,
    };
    world.appendChild(img);
    layers.push(layer);
    layer.el = img;
    layer.card = buildCard(layer);
    layersEl.appendChild(layer.card);
    applyLayer(layer);
    emptyState.classList.add("hidden");
  };
}

function stripExt(name) {
  return name.replace(/\.[^.]+$/, "");
}

// Card UI ---------------------------------------------------------------

function buildCard(layer) {
  const node = tpl.content.firstElementChild.cloneNode(true);

  const name = node.querySelector(".layer-name");
  const toggle = node.querySelector(".layer-toggle");
  const remove = node.querySelector(".layer-remove");
  const opacity = node.querySelector(".opacity");
  const opacityVal = node.querySelector(".opacity-val");
  const scale = node.querySelector(".scale");
  const scaleVal = node.querySelector(".scale-val");
  const rotate = node.querySelector(".rotate");
  const rotateVal = node.querySelector(".rotate-val");
  const setAnchor = node.querySelector(".set-anchor");

  name.value = layer.name;
  opacity.value = layer.opacity;
  opacityVal.textContent = pct(layer.opacity);
  scale.value = layer.scale;
  scaleVal.textContent = layer.scale.toFixed(2) + "×";
  rotate.value = layer.rotate;
  rotateVal.textContent = layer.rotate + "°";

  name.addEventListener("input", () => { layer.name = name.value; });

  toggle.addEventListener("click", () => {
    layer.visible = !layer.visible;
    toggle.classList.toggle("off", !layer.visible);
    layer.el.classList.toggle("hidden", !layer.visible);
  });

  remove.addEventListener("click", () => removeLayer(layer));

  opacity.addEventListener("input", () => {
    layer.opacity = parseFloat(opacity.value);
    opacityVal.textContent = pct(layer.opacity);
    layer.el.style.opacity = layer.opacity;
  });

  scale.addEventListener("input", () => {
    layer.scale = parseFloat(scale.value);
    scaleVal.textContent = layer.scale.toFixed(2) + "×";
    applyLayerTransform(layer);
  });

  rotate.addEventListener("input", () => {
    layer.rotate = parseFloat(rotate.value);
    rotateVal.textContent = layer.rotate + "°";
    applyLayerTransform(layer);
  });

  setAnchor.addEventListener("click", () => startAnchoring(layer));

  return node;
}

function pct(v) { return Math.round(v * 100) + "%"; }

function removeLayer(layer) {
  const idx = layers.indexOf(layer);
  if (idx === -1) return;
  layers.splice(idx, 1);
  layer.el.remove();
  layer.card.remove();
  URL.revokeObjectURL(layer.url);
  if (anchoringLayer === layer) cancelAnchoring();
  if (layers.length === 0) emptyState.classList.remove("hidden");
}

// Layer rendering -------------------------------------------------------

function applyLayer(layer) {
  layer.el.style.opacity = layer.opacity;
  applyLayerTransform(layer);
}

function applyLayerTransform(layer) {
  // Image is drawn at (0, 0) — we translate so that the anchor lands at
  // world origin (which is the viewport center). Then scale & rotate
  // around that anchor.
  const a = layer.anchor;
  layer.el.style.transform =
    `rotate(${layer.rotate}deg) ` +
    `scale(${layer.scale}) ` +
    `translate(${-a.x}px, ${-a.y}px)`;
}

function applyWorldTransform() {
  world.style.transform =
    `translate(${view.tx}px, ${view.ty}px) scale(${view.zoom})`;
}
applyWorldTransform();

// Anchor picking --------------------------------------------------------

function startAnchoring(layer) {
  if (anchoringLayer) anchoringLayer.card.classList.remove("anchoring");
  anchoringLayer = layer;
  layer.card.classList.add("anchoring");
  stage.classList.add("anchoring");
}

function cancelAnchoring() {
  if (anchoringLayer) anchoringLayer.card.classList.remove("anchoring");
  anchoringLayer = null;
  stage.classList.remove("anchoring");
}

// Convert a clientX/Y from a stage event into world coordinates (i.e.
// where (0, 0) is the viewport center, before per-layer transforms).
function clientToWorld(clientX, clientY) {
  const rect = viewport.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return {
    x: (clientX - cx - view.tx) / view.zoom,
    y: (clientY - cy - view.ty) / view.zoom,
  };
}

// On click in stage: if anchoring, find the anchor in image-space; else
// nothing. We compute the click in world coords, then invert the
// per-layer transform (currently translate(-a.x,-a.y) * scale * rotate
// is applied to image coords → world; so world → image-coord requires
// inverse: rotate(-θ), scale(1/s), then add anchor). But because the
// anchor is what we are *defining*, we can't depend on it. Trick: take
// the click in world coords, undo the rotation+scale parts that are
// independent of anchor, then add the *current* anchor — that gives the
// image coordinate that was clicked under the current transform, which
// is exactly the new anchor we want (because moving the anchor moves
// the image so that pixel ends up at world origin).

stage.addEventListener("click", (e) => {
  if (!anchoringLayer) return;
  if (didDrag) return; // ignore the click that ends a pan-drag
  const layer = anchoringLayer;
  const w = clientToWorld(e.clientX, e.clientY);
  const cos = Math.cos(-layer.rotate * Math.PI / 180);
  const sin = Math.sin(-layer.rotate * Math.PI / 180);
  // unrotate
  const ux = w.x * cos - w.y * sin;
  const uy = w.x * sin + w.y * cos;
  // unscale
  const ix = ux / layer.scale + layer.anchor.x;
  const iy = uy / layer.scale + layer.anchor.y;
  layer.anchor = { x: ix, y: iy };
  applyLayerTransform(layer);
  cancelAnchoring();
});

// Pan & zoom ------------------------------------------------------------

let isPanning = false;
let didDrag = false;
let panStart = { x: 0, y: 0, tx: 0, ty: 0 };

stage.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  isPanning = true;
  didDrag = false;
  panStart = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  stage.setPointerCapture(e.pointerId);
  stage.classList.add("panning");
});

stage.addEventListener("pointermove", (e) => {
  if (!isPanning) return;
  const dx = e.clientX - panStart.x;
  const dy = e.clientY - panStart.y;
  if (!didDrag && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) didDrag = true;
  view.tx = panStart.tx + dx;
  view.ty = panStart.ty + dy;
  applyWorldTransform();
});

stage.addEventListener("pointerup", (e) => {
  if (!isPanning) return;
  isPanning = false;
  stage.releasePointerCapture(e.pointerId);
  stage.classList.remove("panning");
});

stage.addEventListener("wheel", (e) => {
  e.preventDefault();
  const rect = viewport.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  // World coord under cursor before zoom.
  const wx = (e.clientX - cx - view.tx) / view.zoom;
  const wy = (e.clientY - cy - view.ty) / view.zoom;
  const factor = Math.exp(-e.deltaY * 0.0015);
  view.zoom = clamp(view.zoom * factor, 0.05, 20);
  // Keep that world point under cursor.
  view.tx = e.clientX - cx - wx * view.zoom;
  view.ty = e.clientY - cy - wy * view.zoom;
  applyWorldTransform();
}, { passive: false });

resetBtn.addEventListener("click", () => {
  view.tx = 0; view.ty = 0; view.zoom = 1;
  applyWorldTransform();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && anchoringLayer) cancelAnchoring();
});

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
