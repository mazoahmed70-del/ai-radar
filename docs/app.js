(() => {
  // Live data lives on GitHub Pages; fall back to the copy shipped with the site.
  const REMOTE = 'https://mazoahmed70-del.github.io/ai-radar/data/news.json';
  const sameSite = location.hostname.endsWith('github.io');
  const SOURCES = sameSite ? ['./data/news.json'] : [REMOTE, './data/news.json'];

  const $ = (id) => document.getElementById(id);
  const st = {
    data: null, cat: '', group: '', source: '', q: '', win: 72, signal: '',
    shown: 40, seen: new Set(), fresh: new Set(), lastFetched: null,
  };
  const CATS = ['Models', 'Research', 'Business', 'Policy', 'Tools', 'Hardware', 'General'];
  const NS = 'http://www.w3.org/2000/svg';

  const ago = (ts) => {
    const s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function setStatus(kind, text) {
    $('pulse').className = 'pulse ' + kind;
    $('statusText').innerHTML = text;
  }

  async function getNews() {
    let lastErr;
    for (const u of SOURCES) {
      try {
        const r = await fetch(u + '?t=' + Date.now(), { cache: 'no-store' });
        if (r.ok) return await r.json();
        lastErr = new Error('HTTP ' + r.status);
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  async function load(initial = false) {
    try {
      const d = await getNews();
      if (!d.fetched_at) {
        setStatus('busy', 'First sweep in progress…');
        setTimeout(() => load(initial), 4000);
        return;
      }
      if (st.lastFetched && d.fetched_at !== st.lastFetched) {
        st.fresh = new Set(d.items.filter((i) => !st.seen.has(i.id)).map((i) => i.id));
      }
      d.items.forEach((i) => st.seen.add(i.id));
      st.lastFetched = d.fetched_at;
      st.data = d;
      render();
      tickStatus();
    } catch (e) {
      setStatus('down', 'News file unavailable — retrying');
      if (initial || !st.data) renderError();
      setTimeout(() => load(initial), 15000);
    }
  }

  function tickStatus() {
    const d = st.data;
    if (!d) return;
    const ok = d.sources.filter((s) => s.status === 'ok').length;
    const stale = Date.now() / 1000 - d.fetched_at > 3 * 3600;
    setStatus(stale ? 'busy' : 'live', `Updated ${ago(d.fetched_at)}<span class="long"> · auto every 30 min · ${ok}/${d.sources.length} sources</span>`);
  }

  // ---------- filtering ----------
  function filtered({ ignoreCat = false } = {}) {
    if (!st.data) return [];
    const cutoff = Date.now() / 1000 - st.win * 3600;
    const q = st.q.trim().toLowerCase();
    const sig = st.signal ? new RegExp('\\b' + st.signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[ -]') + 's?\\b', 'i') : null;
    return st.data.items.filter((i) =>
      i.published >= cutoff &&
      (ignoreCat || !st.cat || i.category === st.cat) &&
      (!st.group || i.group === st.group) &&
      (!st.source || i.source === st.source) &&
      (!q || (i.title + ' ' + i.summary + ' ' + i.publisher).toLowerCase().includes(q)) &&
      (!sig || sig.test(i.title + ' ' + i.summary))
    );
  }

  // ---------- render ----------
  function render() {
    const d = st.data;
    const now = Date.now() / 1000;
    const last24 = d.items.filter((i) => i.published >= now - 86400).length;
    countUp($('kLast24'), last24);
    countUp($('kTotal'), d.items.length);
    $('kSources').textContent = `${d.sources.filter((s) => s.status === 'ok').length}/${d.sources.length}`;
    renderSignals();
    renderCats();
    renderSources();
    renderList();
    renderRadar();
  }

  function countUp(el, n) {
    const from = parseInt(el.textContent, 10) || 0;
    if (from === n || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = n; return; }
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 700);
      el.textContent = Math.round(from + (n - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderSignals() {
    const sigs = st.data.signals || [];
    const box = $('signals');
    if (!sigs.length) { box.innerHTML = '<span class="muted">No strong signals yet.</span>'; return; }
    box.innerHTML = sigs.map((s) =>
      `<button class="signal" data-term="${esc(s.term)}" aria-pressed="${st.signal === s.term}" data-testid="button-signal-${esc(s.term.toLowerCase().replace(/\s+/g, '-'))}">${esc(s.term)}<span class="n">${s.count}</span></button>`
    ).join('');
  }

  function renderCats() {
    const base = filtered({ ignoreCat: true });
    const counts = {};
    base.forEach((i) => (counts[i.category] = (counts[i.category] || 0) + 1));
    const all = [['', 'All', base.length], ...CATS.map((c) => [c, c, counts[c] || 0])];
    $('cats').innerHTML = all.map(([v, l, n]) =>
      `<button class="chip" role="tab" data-cat="${v}" aria-selected="${st.cat === v}" data-testid="tab-category-${(v || 'all').toLowerCase()}">${l}<span class="n">${n}</span></button>`
    ).join('');
  }

  function renderSources() {
    const groups = ['Labs', 'Media', 'Research', 'Newsletters', 'Community'];
    let html = '';
    groups.forEach((g) => {
      const ss = st.data.sources.filter((s) => s.group === g);
      if (!ss.length) return;
      html += `<li class="grp">${g}</li>`;
      ss.forEach((s) => {
        const bad = s.status !== 'ok';
        html += `<li><button data-src="${esc(s.name)}" aria-pressed="${st.source === s.name}" title="${bad ? esc(s.status) : 'Online'}" data-testid="button-source-${esc(s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}"><span class="st ${bad ? 'bad' : ''}"></span><span class="nm">${esc(s.name)}</span><span class="ct">${bad ? 'down' : s.count}</span></button></li>`;
      });
    });
    $('sourceList').innerHTML = html;
  }

  function renderList() {
    const items = filtered();
    const list = $('list');
    const active = st.cat || st.group || st.source || st.q || st.signal;
    $('clearBtn').hidden = !active;
    $('resultCount').textContent = `${items.length} ${items.length === 1 ? 'story' : 'stories'}` +
      (st.signal ? ` mentioning ${st.signal}` : '') + (st.source ? ` from ${st.source}` : '');
    if (!items.length) {
      list.innerHTML = `<li class="empty"><b>Nothing on the radar</b>No stories match these filters. Try a wider time window or clear filters.</li>`;
      $('moreBtn').hidden = true;
      return;
    }
    const now = Date.now() / 1000;
    list.innerHTML = items.slice(0, st.shown).map((i, idx) => {
      const isNew = st.fresh.has(i.id);
      const recent = now - i.published < 3 * 3600;
      const pub = i.publisher !== i.source ? `${esc(i.publisher)} <span class="muted">via ${esc(i.source)}</span>` : esc(i.source);
      return `<li class="item" style="animation-delay:${Math.min(idx, 12) * 25}ms" data-testid="card-story-${i.id}">
        <div>
          <div class="meta"><span class="src">${pub}</span><span class="dot"></span><time datetime="${new Date(i.published * 1000).toISOString()}" class="${recent ? 'fresh' : ''}">${ago(i.published)}</time><span class="tag">${esc(i.category)}</span>${isNew ? '<span class="fresh">● NEW</span>' : ''}</div>
          <h3><a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer" data-testid="link-story-${i.id}">${esc(i.title)}</a></h3>
          ${i.summary ? `<p>${esc(i.summary)}</p>` : ''}
        </div>
        ${i.image ? `<img class="thumb" src="${esc(i.image)}" alt="" loading="lazy" width="112" height="76" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      </li>`;
    }).join('');
    $('moreBtn').hidden = items.length <= st.shown;
    $('moreBtn').textContent = `Show more (${items.length - st.shown} left)`;
  }

  function renderError() {
    $('list').innerHTML = `<li class="empty"><b>Can't load the news file</b>It will retry automatically every 15 seconds.</li>`;
    $('resultCount').textContent = '';
  }

  function renderSkeleton() {
    $('list').innerHTML = Array.from({ length: 6 }, () => '<li class="skel"></li>').join('');
  }

  // ---------- radar ----------
  const MAX_H = 72;
  function renderRadar() {
    const svg = $('radar');
    const R = 96;
    const n = CATS.length;
    const sector = (2 * Math.PI) / n;
    let s = '';
    s += `<defs>
      <linearGradient id="sw" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5fe3a1" stop-opacity="0"/><stop offset="1" stop-color="#5fe3a1" stop-opacity=".28"/></linearGradient>
      <radialGradient id="bgg"><stop offset="0" stop-color="#5fe3a1" stop-opacity=".07"/><stop offset="1" stop-color="#5fe3a1" stop-opacity="0"/></radialGradient>
    </defs>`;
    s += `<circle r="${R}" fill="url(#bgg)"/>`;
    const rings = [[1, '1h'], [6, '6h'], [24, '24h'], [72, '72h']];
    rings.forEach(([h, l]) => {
      const r = Math.sqrt(h / MAX_H) * R;
      s += `<circle class="ring" r="${r.toFixed(1)}"/><text class="ringlabel" x="2" y="${(-r + 6).toFixed(1)}">${l}</text>`;
    });
    for (let k = 0; k < n; k++) {
      const a = k * sector - Math.PI / 2;
      s += `<line class="axis" x1="0" y1="0" x2="${(Math.cos(a) * R).toFixed(1)}" y2="${(Math.sin(a) * R).toFixed(1)}"/>`;
      const la = a + sector / 2;
      const lx = Math.cos(la) * (R + 9), ly = Math.sin(la) * (R + 9);
      const anchor = Math.abs(Math.cos(la)) < 0.2 ? 'middle' : Math.cos(la) > 0 ? 'start' : 'end';
      s += `<text class="sector-label" x="${lx.toFixed(1)}" y="${(ly + 2).toFixed(1)}" text-anchor="${anchor}">${CATS[k]}</text>`;
    }
    // sweep wedge
    const wedge = 0.55;
    const x1 = Math.cos(-wedge) * R, y1 = Math.sin(-wedge) * R;
    s += `<g class="sweep"><path d="M0 0 L${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 1 ${R} 0 Z" fill="url(#sw)"/><line x1="0" y1="0" x2="${R}" y2="0" stroke="#5fe3a1" stroke-opacity=".7" stroke-width=".8"/></g>`;

    // blips: latest 40 matching (ignoring category so the radar shows the spread)
    const now = Date.now() / 1000;
    const pool = filtered({ ignoreCat: true }).filter((i) => now - i.published < MAX_H * 3600).slice(0, 40);
    pool.forEach((i) => {
      const k = Math.max(0, CATS.indexOf(i.category));
      const h = parseInt(i.id.slice(0, 6), 16) / 0xffffff; // stable jitter
      const ageH = Math.max(0.05, (now - i.published) / 3600);
      const r = Math.min(R - 3, Math.max(5, Math.sqrt(ageH / MAX_H) * R));
      const a = k * sector - Math.PI / 2 + sector * (0.15 + 0.7 * h);
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      const fresh = ageH < 3;
      const op = fresh ? 1 : Math.max(0.35, 1 - ageH / MAX_H);
      const dim = st.cat && st.cat !== i.category ? 0.15 : op;
      s += `<circle class="blip" tabindex="0" r="2.6" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" fill="${fresh ? '#f0b44c' : '#5fe3a1'}" fill-opacity="${dim.toFixed(2)}" data-id="${i.id}" role="link" aria-label="${esc(i.title)}"/>`;
    });
    s += `<circle r="2" fill="#5fe3a1"/>`;
    svg.innerHTML = s;
    $('legend').innerHTML = `<span><i style="background:#f0b44c"></i>Under 3h</span><span><i style="background:#5fe3a1"></i>Older</span><span>Centre = newest</span>`;
  }

  function byId(id) { return st.data && st.data.items.find((i) => i.id === id); }

  // ---------- events ----------
  const radar = $('radar'), tip = $('tip');
  function showTip(el) {
    const i = byId(el.dataset.id); if (!i) return;
    tip.innerHTML = `<b>${esc(i.title)}</b><span>${esc(i.publisher)} · ${ago(i.published)}</span>`;
    tip.hidden = false;
    const box = radar.parentElement.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    let left = b.left - box.left + 10, top = b.top - box.top + 10;
    left = Math.min(left, box.width - 270); top = Math.min(top, box.height - 70);
    tip.style.left = Math.max(0, left) + 'px'; tip.style.top = Math.max(0, top) + 'px';
  }
  radar.addEventListener('mouseover', (e) => e.target.classList.contains('blip') && showTip(e.target));
  radar.addEventListener('focusin', (e) => e.target.classList.contains('blip') && showTip(e.target));
  radar.addEventListener('mouseout', () => (tip.hidden = true));
  radar.addEventListener('focusout', () => (tip.hidden = true));
  const openBlip = (el) => { const i = byId(el.dataset.id); if (i) window.open(i.url, '_blank', 'noopener'); };
  radar.addEventListener('click', (e) => e.target.classList.contains('blip') && openBlip(e.target));
  radar.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('blip')) openBlip(e.target); });

  const rerender = () => { st.shown = 40; renderCats(); renderList(); renderRadar(); };
  $('cats').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; st.cat = b.dataset.cat; rerender(); });
  $('signals').addEventListener('click', (e) => {
    const b = e.target.closest('.signal'); if (!b) return;
    st.signal = st.signal === b.dataset.term ? '' : b.dataset.term; renderSignals(); rerender();
  });
  $('sourceList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-src]'); if (!b) return;
    st.source = st.source === b.dataset.src ? '' : b.dataset.src; renderSources(); rerender();
  });
  let qt; $('q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { st.q = e.target.value; rerender(); }, 150); });
  $('group').addEventListener('change', (e) => { st.group = e.target.value; rerender(); });
  $('win').addEventListener('change', (e) => { st.win = +e.target.value; rerender(); });
  $('moreBtn').addEventListener('click', () => { st.shown += 40; renderList(); });
  $('clearBtn').addEventListener('click', () => {
    Object.assign(st, { cat: '', group: '', source: '', q: '', signal: '' });
    $('q').value = ''; $('group').value = '';
    renderSignals(); renderSources(); rerender();
  });
  $('refreshBtn').addEventListener('click', async () => {
    const b = $('refreshBtn'); b.disabled = true; b.classList.add('spin');
    setStatus('busy', 'Checking for new stories…');
    try { await load(); } catch { setStatus('down', 'Reload failed — try again'); }
    finally { b.disabled = false; b.classList.remove('spin'); }
  });

  renderSkeleton();
  renderRadar();
  load(true);
  setInterval(() => load(), 60 * 1000);
  setInterval(tickStatus, 30 * 1000);
})();
