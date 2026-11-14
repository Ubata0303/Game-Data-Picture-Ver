// ========================================================
// 試合中速データ - スマホ閲覧専用スクリプト (mobile.js)
// ========================================================

(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2000);
  }

  // フィルター定義
  const HUDL_FILTERS = [
    { key: 'qtr', label: 'Qtr' },
    { key: 'down', label: 'Down' },
    { key: 'dist', label: 'Dist' },
    { key: 'hash', label: 'Hash' },
    { key: 'personnel', label: 'Personnel' },
    { key: 'formation', label: 'Formation' },
    { key: 'play', label: 'Play' },
    { key: 'defSign', label: 'Def Sign' },
  ];

  let store;
  let currentGameId = null;
  let plays = [];
  let games = [];
  let unsubPlays = null;
  let unsubGames = null;

  // フィルター状態
  const activeFilters = {
    qtr: new Set(),
    down: new Set(),
    dist: new Set(),
    hash: new Set(),
    personnel: new Set(),
    formation: new Set(),
    play: new Set(),
    defSign: new Set(),
  };

  // URLハッシュから GameId 抽出
  function parseGameId() {
    const hash = location.hash || '';
    const m = hash.match(/^#\/?(view\/)?([a-zA-Z0-9_-]+)/);
    return m ? m[2] : null;
  }

  function matchesFilter(p) {
    for (const f of HUDL_FILTERS) {
      const selected = activeFilters[f.key];
      if (selected.size === 0) continue;
      const val = (p[f.key] || '').trim();
      if (!selected.has(val)) return false;
    }
    return true;
  }

  // フィルターバーの構築
  function renderFilterBar() {
    const wrap = $('#filterScroll');
    if (!wrap) return;
    wrap.innerHTML = '';

    HUDL_FILTERS.forEach((f) => {
      const pill = el('div', 'filter-pill');
      const btn = el('button', 'filter-btn');
      btn.type = 'button';
      const selected = activeFilters[f.key];
      const hasActive = selected.size > 0;
      btn.classList.toggle('active', hasActive);

      let text = f.label;
      if (hasActive) {
        text = Array.from(selected).join(', ');
      }
      btn.innerHTML = `<span class="pill-text">${escapeHtml(text)}</span> <span class="arrow">▾</span>`;

      btn.onclick = () => openFilterDropdown(f);
      pill.appendChild(btn);
      wrap.appendChild(pill);
    });
  }

  let activeDropdownKey = null;

  function openFilterDropdown(f) {
    activeDropdownKey = f.key;
    const dropdown = $('#filterDropdown');
    const backdrop = $('#dropdownBackdrop');
    const title = $('#dropdownTitle');
    const optionsWrap = $('#dropdownOptions');

    title.textContent = `${f.label} で絞り込み`;
    optionsWrap.innerHTML = '';

    // 出現頻度を集計
    const counts = {};
    plays.forEach((p) => {
      const v = (p[f.key] || '').trim();
      if (v) counts[v] = (counts[v] || 0) + 1;
    });

    const selected = activeFilters[f.key];

    // 「すべて (ALL)」行
    const allRow = el('div', 'dropdown-option dropdown-option-all');
    const allCb = el('input');
    allCb.type = 'checkbox';
    allCb.checked = selected.size === 0;
    const allLabel = el('span', 'opt-label', 'すべて (ALL)');
    const allCount = el('span', 'opt-count', `${plays.length}件`);
    allRow.append(allCb, allLabel, allCount);
    allRow.onclick = (e) => {
      if (e.target !== allCb) allCb.checked = !allCb.checked;
      if (allCb.checked) {
        selected.clear();
        updateFilterUI();
      }
    };
    optionsWrap.appendChild(allRow);

    // 各選択肢
    const sortedVals = Object.keys(counts).sort((a, b) => {
      if (!isNaN(a) && !isNaN(b)) return Number(a) - Number(b);
      return a.localeCompare(b);
    });

    sortedVals.forEach((val) => {
      const row = el('div', 'dropdown-option');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(val);
      const label = el('span', 'opt-label', val);
      const count = el('span', 'opt-count', `${counts[val]}件`);
      row.append(cb, label, count);
      row.onclick = (e) => {
        if (e.target !== cb) cb.checked = !cb.checked;
        if (cb.checked) {
          selected.add(val);
        } else {
          selected.delete(val);
        }
        allCb.checked = (selected.size === 0);
        updateFilterUI();
      };
      optionsWrap.appendChild(row);
    });

    dropdown.classList.remove('hidden');
    backdrop.classList.remove('hidden');
  }

  function closeFilterDropdown() {
    $('#filterDropdown')?.classList.add('hidden');
    $('#dropdownBackdrop')?.classList.add('hidden');
    activeDropdownKey = null;
  }

  function updateFilterUI() {
    renderFilterBar();
    renderTable();
  }

  function clearAllFilters() {
    Object.values(activeFilters).forEach((s) => s.clear());
    updateFilterUI();
    toast('絞り込み条件をリセットしました');
  }

  // テーブル描画
  function renderTable() {
    const tbody = $('#playTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filtered = plays.filter(matchesFilter);
    $('#filteredCount').textContent = `全${plays.length}件 / 表示: ${filtered.length}件`;

    filtered.forEach((p) => {
      const idx = plays.indexOf(p) + 1;
      const tr = el('tr');
      tr.dataset.id = p.id;

      // 1. # (左端固定)
      tr.appendChild(el('td', 'col-seq', String(idx)));

      // 2. Q
      tr.appendChild(el('td', '', p.qtr ? `Q${p.qtr}` : ''));

      // 3. Series
      tr.appendChild(el('td', '', p.series ? `S${p.series}` : ''));

      // 4. Hash
      tr.appendChild(el('td', '', p.hash || ''));

      // 5. D&D
      const dd = (p.down || p.dist) ? `${p.down || '?'}-${p.dist || '?'}` : '';
      tr.appendChild(el('td', '', dd));

      // 6. Personnel
      tr.appendChild(el('td', '', p.personnel || ''));

      // 7. OFF Formation
      tr.appendChild(el('td', 'col-bold', p.formation || ''));

      // 8. Play
      tr.appendChild(el('td', 'col-bold', p.play || ''));

      // 9. Play図ボタン
      const tdDraw = el('td');
      const hasDraw = Boolean(p.drawing);
      const drawBtn = el('button', hasDraw ? 'draw-btn-has' : 'draw-btn-empty');
      drawBtn.type = 'button';
      drawBtn.innerHTML = hasDraw ? '✎ 作図を見る' : '作図なし';
      drawBtn.onclick = (e) => {
        e.stopPropagation();
        openViewDrawModal(p);
      };
      tdDraw.appendChild(drawBtn);
      tr.appendChild(tdDraw);

      // 10. Def Sign
      tr.appendChild(el('td', '', p.defSign || ''));

      // 11. 更新者
      tr.appendChild(el('td', 'col-muted', p.updatedBy || ''));

      tbody.appendChild(tr);
    });
  }

  // ---------- 作図フィールドテンプレート描画 ----------
  function drawFieldTemplate(tCtx, w, h) {
    tCtx.fillStyle = '#ffffff';
    tCtx.fillRect(0, 0, w, h);

    const scale = w / 1024;
    const leftX = w * (39 / 1024);
    const rightX = w * (984 / 1024);
    const topY = h * (2 / 635);
    const bottomY = h * (610 / 635);
    const boxHeight = bottomY - topY;

    // 外枠
    tCtx.strokeStyle = '#000000';
    tCtx.lineWidth = Math.max(2, 2.5 * scale);
    tCtx.strokeRect(leftX, topY, rightX - leftX, boxHeight);

    // ヤードライン (15, 10, 5, 0)
    const yardSpacing = boxHeight * (116.5 / 608);
    const lines = [
      { yard: 15, y: topY + yardSpacing },
      { yard: 10, y: topY + yardSpacing * 2 },
      { yard: 5, y: topY + yardSpacing * 3 },
      { yard: 0, y: topY + yardSpacing * 4 },
    ];

    tCtx.textBaseline = 'middle';
    tCtx.font = `bold ${Math.round(18 * scale)}px -apple-system, BlinkMacSystemFont, sans-serif`;

    lines.forEach((l) => {
      tCtx.beginPath();
      tCtx.strokeStyle = '#000000';
      tCtx.lineWidth = (l.yard === 0) ? Math.max(2, 2.5 * scale) : Math.max(1.5, 1.8 * scale);
      tCtx.moveTo(leftX, l.y);
      tCtx.lineTo(rightX, l.y);
      tCtx.stroke();

      tCtx.fillStyle = '#000000';
      tCtx.textAlign = 'center';
      tCtx.fillText(String(l.yard), leftX / 2, l.y);
      tCtx.fillText(String(l.yard), rightX + (w - rightX) / 2, l.y);
    });

    // オフェンスライン（OL 5人）
    const losY = topY + yardSpacing * 4;
    const olY = losY + (19 * scale);
    const r = 11 * scale;
    const olSpacing = 29.5 * scale;
    const centerX = (leftX + rightX) / 2;

    tCtx.lineWidth = Math.max(1.5, 2 * scale);
    const positions = [
      { x: centerX - olSpacing * 2, type: 'O' },
      { x: centerX - olSpacing, type: 'O' },
      { x: centerX, type: 'C' },
      { x: centerX + olSpacing, type: 'O' },
      { x: centerX + olSpacing * 2, type: 'O' },
    ];

    positions.forEach((pos) => {
      if (pos.type === 'C') {
        const size = r * 2;
        tCtx.fillStyle = '#ffffff';
        tCtx.fillRect(pos.x - r, olY - r, size, size);
        tCtx.strokeStyle = '#000000';
        tCtx.strokeRect(pos.x - r, olY - r, size, size);
        tCtx.beginPath();
        tCtx.moveTo(pos.x - r, olY - r);
        tCtx.lineTo(pos.x + r, olY + r);
        tCtx.moveTo(pos.x + r, olY - r);
        tCtx.lineTo(pos.x - r, olY + r);
        tCtx.stroke();
      } else {
        tCtx.beginPath();
        tCtx.arc(pos.x, olY, r, 0, Math.PI * 2);
        tCtx.fillStyle = '#ffffff';
        tCtx.fill();
        tCtx.strokeStyle = '#000000';
        tCtx.stroke();
      }
    });
  }

  // ---------- 作図閲覧モーダル & ベンチ共有ボード ----------
  let viewCanvas, viewCtx;
  let viewPaintCanvas, vpCtx;
  let viewBaseImg = null;
  let viewDrawPaths = [];
  let currentViewStroke = null;
  let currentViewColor = '#dc2626'; // 閲覧用デフォルトは赤
  let currentViewSize = 4;
  let isViewEraser = false;

  function initViewCanvas() {
    viewCanvas = $('#viewCanvas');
    if (!viewCanvas) return;
    viewCtx = viewCanvas.getContext('2d');

    viewPaintCanvas = document.createElement('canvas');
    viewPaintCanvas.width = viewCanvas.width;
    viewPaintCanvas.height = viewCanvas.height;
    vpCtx = viewPaintCanvas.getContext('2d');

    function getViewPos(e) {
      const rect = viewCanvas.getBoundingClientRect();
      const scaleX = viewCanvas.width / rect.width;
      const scaleY = viewCanvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    }

    let isDrawing = false;
    viewCanvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    viewCanvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

    viewCanvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      isDrawing = true;
      viewCanvas.setPointerCapture(e.pointerId);
      const pos = getViewPos(e);
      currentViewStroke = {
        isEraser: isViewEraser,
        color: currentViewColor,
        size: isViewEraser ? currentViewSize * 4 : currentViewSize,
        points: [pos],
      };
      viewDrawPaths.push(currentViewStroke);
    });

    viewCanvas.addEventListener('pointermove', (e) => {
      if (!isDrawing || !currentViewStroke) return;
      e.preventDefault();
      const pos = getViewPos(e);
      currentViewStroke.points.push(pos);

      vpCtx.save();
      vpCtx.beginPath();
      if (currentViewStroke.isEraser) {
        vpCtx.globalCompositeOperation = 'destination-out';
        vpCtx.lineWidth = currentViewStroke.size;
      } else {
        vpCtx.globalCompositeOperation = 'source-over';
        vpCtx.strokeStyle = currentViewStroke.color;
        vpCtx.lineWidth = currentViewStroke.size;
      }
      vpCtx.lineCap = 'round';
      vpCtx.lineJoin = 'round';
      const pts = currentViewStroke.points;
      const prev = pts[pts.length - 2];
      vpCtx.moveTo(prev.x, prev.y);
      vpCtx.lineTo(pos.x, pos.y);
      vpCtx.stroke();
      vpCtx.restore();

      // 合成
      if (viewBaseImg) {
        viewCtx.clearRect(0, 0, viewCanvas.width, viewCanvas.height);
        viewCtx.drawImage(viewBaseImg, 0, 0, viewCanvas.width, viewCanvas.height);
      } else {
        drawFieldTemplate(viewCtx, viewCanvas.width, viewCanvas.height);
      }
      viewCtx.drawImage(viewPaintCanvas, 0, 0);
    });

    const endDraw = (e) => {
      if (!isDrawing) return;
      isDrawing = false;
      currentViewStroke = null;
      try { viewCanvas.releasePointerCapture(e.pointerId); } catch {}
    };

    viewCanvas.addEventListener('pointerup', endDraw);
    viewCanvas.addEventListener('pointercancel', endDraw);

    // ツールバー操作
    document.querySelectorAll('.v-color').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('.v-color').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        currentViewColor = b.dataset.color;
        isViewEraser = false;
        $('#viewEraserBtn')?.classList.remove('on');
      };
    });

    document.querySelectorAll('.v-size').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('.v-size').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        currentViewSize = parseInt(b.dataset.size, 10) || 4;
      };
    });

    $('#viewEraserBtn').onclick = () => {
      isViewEraser = !isViewEraser;
      $('#viewEraserBtn').classList.toggle('on', isViewEraser);
    };

    $('#viewUndoBtn').onclick = () => {
      if (viewDrawPaths.length > 0) {
        viewDrawPaths.pop();
        redrawViewCanvas();
      }
    };

    $('#viewClearBtn').onclick = () => {
      viewDrawPaths = [];
      redrawViewCanvas();
    };

    $('#closeViewModalBtn').onclick = () => {
      $('#viewDrawModal').close();
    };
  }

  function redrawViewCanvas() {
    if (!viewCtx || !vpCtx) return;
    if (viewBaseImg) {
      viewCtx.clearRect(0, 0, viewCanvas.width, viewCanvas.height);
      viewCtx.drawImage(viewBaseImg, 0, 0, viewCanvas.width, viewCanvas.height);
    } else {
      drawFieldTemplate(viewCtx, viewCanvas.width, viewCanvas.height);
    }
    vpCtx.clearRect(0, 0, viewPaintCanvas.width, viewPaintCanvas.height);

    viewDrawPaths.forEach((stroke) => {
      if (stroke.points.length < 1) return;
      vpCtx.save();
      vpCtx.beginPath();
      if (stroke.isEraser) {
        vpCtx.globalCompositeOperation = 'destination-out';
        vpCtx.lineWidth = stroke.size;
      } else {
        vpCtx.globalCompositeOperation = 'source-over';
        vpCtx.strokeStyle = stroke.color;
        vpCtx.lineWidth = stroke.size;
      }
      vpCtx.lineCap = 'round';
      vpCtx.lineJoin = 'round';
      vpCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        vpCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      vpCtx.stroke();
      vpCtx.restore();
    });

    viewCtx.drawImage(viewPaintCanvas, 0, 0);
  }

  function openViewDrawModal(play) {
    const idx = plays.indexOf(play) + 1;
    $('#modalTitle').textContent = `Play #${idx} 作図`;
    const dd = (play.down || play.dist) ? `${play.down || '?'}-${play.dist || '?'}` : '';
    const parts = [play.qtr && `Q${play.qtr}`, play.series && `S${play.series}`, dd, play.formation, play.play];
    $('#modalSubtitle').textContent = parts.filter(Boolean).join(' / ');

    viewDrawPaths = [];
    viewBaseImg = null;
    isViewEraser = false;
    $('#viewEraserBtn')?.classList.remove('on');

    if (play.drawing) {
      const img = new Image();
      img.onload = () => {
        viewBaseImg = img;
        redrawViewCanvas();
      };
      img.src = play.drawing;
    } else {
      redrawViewCanvas();
    }

    $('#viewDrawModal').showModal();
  }

  // ---------- 共有リンクモーダル ----------
  let shareMode = 'mobile';
  function updateShareDialog() {
    const base = location.href.split('#')[0];
    let url = '';
    let mobileBase = '';
    if (base.endsWith('/mobile.html')) {
      mobileBase = base;
    } else if (base.endsWith('/')) {
      mobileBase = base + 'mobile.html';
    } else {
      const lastSlash = base.lastIndexOf('/');
      mobileBase = base.slice(0, lastSlash + 1) + 'mobile.html';
    }

    const indexBase = mobileBase.replace(/mobile\.html$/, 'index.html');

    if (shareMode === 'mobile') {
      url = mobileBase + '#/view/' + currentGameId;
    } else if (shareMode === 'view') {
      url = indexBase + '#/view/' + currentGameId;
    } else {
      url = indexBase + '#/game/' + currentGameId;
    }

    $('#shareUrlInput').value = url;
    $('#qrImg').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
    $('#shareModeEdit').classList.toggle('on', shareMode === 'edit');
    $('#shareModeView').classList.toggle('on', shareMode === 'view');
    $('#shareModeMobile').classList.toggle('on', shareMode === 'mobile');

    if (shareMode === 'mobile') {
      $('#shareDesc').textContent = 'スマホ閲覧用：スマホの縦画面サイズに特化した専用画面です';
    } else if (shareMode === 'view') {
      $('#shareDesc').textContent = 'タブレット閲覧用：大画面・タブレットで見渡せる閲覧専用リンクです';
    } else {
      $('#shareDesc').textContent = '編集用リンク：3人で分担して同時入力・編集ができます';
    }
  }

  function initShareModal() {
    $('#shareBtn').onclick = () => {
      shareMode = 'mobile';
      updateShareDialog();
      $('#shareDialog').showModal();
    };
    $('#shareModeEdit').onclick = () => { shareMode = 'edit'; updateShareDialog(); };
    $('#shareModeView').onclick = () => { shareMode = 'view'; updateShareDialog(); };
    $('#shareModeMobile').onclick = () => { shareMode = 'mobile'; updateShareDialog(); };
    $('#copyShareUrlBtn').onclick = async () => {
      const url = $('#shareUrlInput').value;
      try {
        await navigator.clipboard.writeText(url);
        toast('URLをコピーしました！');
      } catch {
        $('#shareUrlInput').select();
        document.execCommand('copy');
        toast('URLをコピーしました！');
      }
    };
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 初期化
  async function init() {
    currentGameId = parseGameId();
    if (!currentGameId) {
      alert('試合IDが指定されていません。URLを確認してください。');
      return;
    }

    if (typeof window.initStore !== 'function') {
      alert('store.js が読み込まれていません');
      return;
    }

    store = window.initStore({
      onStatus: (st) => {
        const b = $('#connStatus');
        if (!b) return;
        b.className = 'status-badge ' + (st === 'online' ? 'ok' : (st === 'syncing' ? 'warn' : 'bad'));
        b.textContent = (st === 'online' ? '🟢 接続中' : (st === 'syncing' ? '🟡 同期中' : '🔴 切断'));
      },
    });

    // 試合一覧監視（試合名表示）
    unsubGames = store.subscribeGames((list) => {
      games = list || [];
      const g = games.find((x) => x.id === currentGameId);
      if (g) {
        $('#gameTitle').textContent = `${g.name}（スマホ閲覧）`;
        document.title = `${g.name} - スマホ閲覧`;
      }
    });

    // プレーデータ監視
    unsubPlays = store.subscribePlays(currentGameId, (list) => {
      plays = list || [];
      renderFilterBar();
      renderTable();
    });

    initViewCanvas();
    initShareModal();

    $('#clearFilterBtn').onclick = clearAllFilters;
    $('#dropdownCloseBtn').onclick = closeFilterDropdown;
    $('#dropdownBackdrop').onclick = closeFilterDropdown;

    window.addEventListener('hashchange', () => {
      const newId = parseGameId();
      if (newId && newId !== currentGameId) {
        location.reload();
      }
    });
  }

  window.addEventListener('DOMContentLoaded', init);
})();
