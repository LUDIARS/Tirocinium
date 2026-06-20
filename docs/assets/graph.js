/* 自前の force-directed グラフ描画 (canvas, 依存なし)。 */
(function () {
  const DATA = window.TIROCINIUM_GRAPH;
  const catColor = Object.fromEntries(DATA.categories.map((c) => [c.id, c.color]));
  const statusRing = { ok: '#3fb950', partial: '#e3b341', no: '#f85149', spec: '#6b7785' };

  const canvas = document.getElementById('graph-canvas');
  const ctx = canvas.getContext('2d');
  const tip = document.getElementById('graph-tip');
  let DPR = Math.min(window.devicePixelRatio || 1, 2);

  // ---- build node/link objects ----
  const nodeById = new Map();
  const nodes = DATA.nodes.map((n) => {
    const o = { ...n, x: 0, y: 0, vx: 0, vy: 0, deg: 0 };
    nodeById.set(n.id, o);
    return o;
  });
  const links = DATA.links
    .map(([s, t]) => ({ s: nodeById.get(s), t: nodeById.get(t) }))
    .filter((l) => l.s && l.t);
  links.forEach((l) => { l.s.deg++; l.t.deg++; });

  // initial layout: rough circle clustered by category
  const catOrder = ['surface', 'domain', 'feature', 'external'];
  nodes.forEach((n, i) => {
    const ci = catOrder.indexOf(n.cat);
    const ang = (i / nodes.length) * Math.PI * 2;
    const r = 160 + ci * 70;
    n.x = Math.cos(ang) * r + (Math.random() - 0.5) * 40;
    n.y = Math.sin(ang) * r + (Math.random() - 0.5) * 40;
  });

  // ---- view transform ----
  let view = { x: 0, y: 0, k: 1 };
  let W = 0, H = 0;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', () => { resize(); });

  // ---- force simulation ----
  let alpha = 1;
  function nodeRadius(n) {
    const base = { surface: 13, domain: 11, feature: 7, external: 9 }[n.cat] || 8;
    return base + Math.min(n.deg, 8) * 0.6;
  }
  function tick() {
    const k = alpha;
    // repulsion (O(n^2), n is small)
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy || 0.01;
        const rep = 2600 / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * rep, fy = (dy / d) * rep;
        a.vx += fx * k; a.vy += fy * k;
        b.vx -= fx * k; b.vy -= fy * k;
      }
    }
    // spring links
    const LEN = 78;
    for (const l of links) {
      let dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
      let d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = ((d - LEN) / d) * 0.06 * k;
      const fx = dx * f, fy = dy * f;
      l.s.vx += fx; l.s.vy += fy;
      l.t.vx -= fx; l.t.vy -= fy;
    }
    // centering + integrate
    for (const n of nodes) {
      n.vx += -n.x * 0.0016 * k;
      n.vy += -n.y * 0.0016 * k;
      if (n === dragNode) continue;
      n.vx *= 0.86; n.vy *= 0.86;
      n.x += n.vx; n.y += n.vy;
    }
    alpha *= 0.992;
    if (alpha < 0.02) alpha = 0.02;
  }

  // ---- interaction ----
  let dragNode = null, panning = false, last = { x: 0, y: 0 };
  let highlight = null; // node id to highlight neighborhood

  function toWorld(px, py) {
    return { x: (px - W / 2 - view.x) / view.k, y: (py - H / 2 - view.y) / view.k };
  }
  function pick(px, py) {
    const w = toWorld(px, py);
    let best = null, bd = Infinity;
    for (const n of nodes) {
      const dx = n.x - w.x, dy = n.y - w.y;
      const d = dx * dx + dy * dy;
      const r = nodeRadius(n) + 6;
      if (d < r * r && d < bd) { bd = d; best = n; }
    }
    return best;
  }

  canvas.addEventListener('mousedown', (e) => {
    const n = pick(e.offsetX, e.offsetY);
    if (n) { dragNode = n; highlight = n.id; alpha = Math.max(alpha, 0.5); }
    else { panning = true; }
    last = { x: e.offsetX, y: e.offsetY };
  });
  window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (dragNode) {
      const w = toWorld(px, py);
      dragNode.x = w.x; dragNode.y = w.y; dragNode.vx = 0; dragNode.vy = 0;
      alpha = Math.max(alpha, 0.4);
    } else if (panning) {
      view.x += px - last.x; view.y += py - last.y;
      last = { x: px, y: py };
    }
  });
  window.addEventListener('mouseup', () => { dragNode = null; panning = false; });

  canvas.addEventListener('mousemove', (e) => {
    if (dragNode || panning) { tip.style.display = 'none'; return; }
    const n = pick(e.offsetX, e.offsetY);
    if (n) {
      tip.style.display = 'block';
      tip.style.left = Math.min(e.offsetX + 14, W - 270) + 'px';
      tip.style.top = (e.offsetY + 14) + 'px';
      const catLabel = (DATA.categories.find((c) => c.id === n.cat) || {}).label || n.cat;
      const st = { ok: '✅ 実装一致', partial: '🟡 部分実装/差異', no: '❌ 未実装', spec: '📄 仕様のみ' }[n.status] || '';
      tip.innerHTML = '<h4>' + esc(n.label) + '</h4><p><span style="color:' + catColor[n.cat] + '">●</span> ' +
        esc(catLabel) + ' · ' + st + '</p><p style="margin-top:6px">' + esc(n.desc) + '</p>';
      canvas.style.cursor = 'pointer';
    } else {
      tip.style.display = 'none';
      canvas.style.cursor = 'grab';
    }
  });
  canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const nk = Math.max(0.3, Math.min(3, view.k * factor));
    // zoom toward cursor
    const cx = e.offsetX - W / 2, cy = e.offsetY - H / 2;
    view.x = cx - (cx - view.x) * (nk / view.k);
    view.y = cy - (cy - view.y) * (nk / view.k);
    view.k = nk;
  }, { passive: false });

  canvas.addEventListener('dblclick', () => { highlight = null; });

  // ---- neighbor set for highlight ----
  function neighbors(id) {
    const set = new Set([id]);
    for (const l of links) {
      if (l.s.id === id) set.add(l.t.id);
      if (l.t.id === id) set.add(l.s.id);
    }
    return set;
  }

  // ---- render ----
  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2 + view.x, H / 2 + view.y);
    ctx.scale(view.k, view.k);

    const nset = highlight ? neighbors(highlight) : null;

    // links
    for (const l of links) {
      const on = !nset || (nset.has(l.s.id) && nset.has(l.t.id));
      ctx.beginPath();
      ctx.moveTo(l.s.x, l.s.y);
      ctx.lineTo(l.t.x, l.t.y);
      ctx.strokeStyle = on ? 'rgba(140,160,185,0.32)' : 'rgba(120,135,160,0.06)';
      ctx.lineWidth = on ? 1.1 : 0.7;
      ctx.stroke();
    }

    // nodes
    for (const n of nodes) {
      const on = !nset || nset.has(n.id);
      const r = nodeRadius(n);
      ctx.globalAlpha = on ? 1 : 0.18;
      // status ring
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 2.5, 0, Math.PI * 2);
      ctx.fillStyle = statusRing[n.status] || '#6b7785';
      ctx.fill();
      // body
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = catColor[n.cat] || '#888';
      ctx.fill();
      // label
      if (n.cat !== 'feature' || view.k > 0.85 || (nset && nset.has(n.id))) {
        ctx.globalAlpha = on ? 1 : 0.25;
        ctx.fillStyle = '#e6edf3';
        ctx.font = (n.cat === 'surface' ? 'bold 13px' : '12px') + ' -apple-system, "Noto Sans JP", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(n.label, n.x, n.y + r + 3);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function loop() { tick(); draw(); requestAnimationFrame(loop); }

  // ---- sidebar ----
  function buildSidebar() {
    const legend = document.getElementById('graph-legend');
    legend.innerHTML = DATA.categories.map((c) =>
      '<div class="legend-item"><span class="dot" style="background:' + c.color + '"></span>' + esc(c.label) + '</div>'
    ).join('') +
      '<div class="legend-item" style="margin-top:6px"><span class="dot" style="background:#3fb950"></span>外輪=実装状況</div>';

    const list = document.getElementById('graph-nodelist');
    const order = { surface: 0, domain: 1, feature: 2, external: 3 };
    const sorted = [...DATA.nodes].sort((a, b) => (order[a.cat] - order[b.cat]) || a.label.localeCompare(b.label, 'ja'));
    let html = '';
    let cur = null;
    for (const n of sorted) {
      if (n.cat !== cur) { cur = n.cat; html += '<h3>' + esc((DATA.categories.find((c) => c.id === cur) || {}).label || cur) + '</h3>'; }
      html += '<div class="node-item" data-id="' + n.id + '"><span class="dot" style="background:' + catColor[n.cat] + '"></span>' + esc(n.label) + '</div>';
    }
    list.innerHTML = html;
    list.querySelectorAll('.node-item').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        highlight = id;
        const n = nodeById.get(id);
        // recenter view on node
        view.x = -n.x * view.k; view.y = -n.y * view.k;
        alpha = Math.max(alpha, 0.3);
      });
    });
  }

  resize();
  buildSidebar();
  loop();
})();
