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
    { key: 'playType', label: 'Type' },
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
    playType: new Set(),
    defSign: new Set(),
  };

  // URLハッシュから GameId 抽出
  function parseGameId() {
    const raw = (location.hash || '').replace(/^#\/?(view\/|game\/)?/, '').split('?')[0].trim();
    return raw || null;
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

      // 8.5 Type (Run / Pass)
      const tdType = el('td');
      if (p.playType === 'Run') {
        tdType.appendChild(el('span', 'badge-run', 'Run'));
      } else if (p.playType === 'Pass') {
        tdType.appendChild(el('span', 'badge-pass', 'Pass'));
      }
      tr.appendChild(tdType);

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

    try {
      if (typeof window.createStore !== 'function') {
        throw new Error('store.js が読み込まれていません');
      }
      store = await window.createStore();
    } catch (e) {
      alert('通信の初期化に失敗しました。ネット接続を確認してください。\n' + e.message);
      return;
    }

    store.onStatusChange((text, cls) => {
      const b = $('#connStatus');
      if (!b) return;
      if (typeof text === 'object' && text !== null) {
        cls = text.cls;
        text = text.text;
      }
      b.className = 'status-badge ' + (cls || 'ok');
      b.textContent = text;
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
      list.sort((a, b) => (a.seq || 0) - (b.seq || 0) || (a.createdAt || 0) - (b.createdAt || 0) || a.id.localeCompare(b.id));
      plays = list || [];
      renderFilterBar();
      renderTable();
      if (activeTab === 'tendency') {
        renderTendency();
      }
    });

    initViewCanvas();
    initShareModal();

    $('#tabPlayList')?.addEventListener('click', () => switchTab('playList'));
    $('#tabTendency')?.addEventListener('click', () => switchTab('tendency'));

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

  // ---------- 傾向分析ロジック (mobile) ----------
  const escapeHTML = (s) => (s || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  let activeTab = 'playList';

  function switchTab(tab) {
    activeTab = tab;
    $('#tabPlayList')?.classList.toggle('active', tab === 'playList');
    $('#tabTendency')?.classList.toggle('active', tab === 'tendency');
    $('#playListView')?.classList.toggle('hidden', tab !== 'playList');
    $('#tendencyView')?.classList.toggle('hidden', tab !== 'tendency');
    if (tab === 'tendency') {
      renderTendency();
    }
  }

  function getSituationGroup(p) {
    const d = parseInt(p.down, 10);
    const dst = parseInt(p.dist, 10);
    if (isNaN(d) || d < 1 || d > 4) return null;
    if (d === 1) return '1st Down';
    if (d === 2) {
      if (isNaN(dst)) return '2nd Down';
      if (dst <= 3) return '2nd & Short (1-3)';
      if (dst <= 6) return '2nd & Medium (4-6)';
      return '2nd & Long (7+)';
    }
    if (d === 3) {
      if (isNaN(dst)) return '3rd Down';
      if (dst <= 3) return '3rd & Short (1-3)';
      if (dst <= 6) return '3rd & Medium (4-6)';
      return '3rd & Long (7+)';
    }
    if (d === 4) {
      if (!isNaN(dst) && dst <= 3) return '4th Down ≤3';
      return null;
    }
    return null;
  }

  const SITUATIONS = [
    '1st Down',
    '2nd & Short (1-3)',
    '2nd & Medium (4-6)',
    '2nd & Long (7+)',
    '3rd & Short (1-3)',
    '3rd & Medium (4-6)',
    '3rd & Long (7+)',
    '4th Down ≤3',
  ];

  function renderPersonnelHierarchy(table, validPlays) {
    const existingTbodys = table.querySelectorAll('tbody');
    existingTbodys.forEach((tb) => tb.remove());

    const persStats = {};
    let totalPersPlays = 0;

    validPlays.forEach((p) => {
      let pers = (p.personnel || '').trim();
      if (!pers) return;
      totalPersPlays++;
      let form = (p.formation || '').trim() || '(未入力)';
      let playName = (p.play || '').trim() || '(未入力)';

      const typeUpper = (p.playType || '').toUpperCase().trim();
      const isRun = typeUpper === 'RUN' || typeUpper === 'R';
      const isPass = typeUpper === 'PASS' || typeUpper === 'P';
      const category = isPass ? 'pass' : (isRun ? 'run' : 'other');

      if (!persStats[pers]) {
        persStats[pers] = {
          total: 0,
          categories: { run: 0, pass: 0, other: 0 },
          formations: {},
        };
      }
      persStats[pers].total++;
      if (persStats[pers].categories[category] !== undefined) {
        persStats[pers].categories[category]++;
      }

      if (!persStats[pers].formations[form]) {
        persStats[pers].formations[form] = {
          total: 0,
          categories: {
            run: { count: 0, plays: {} },
            pass: { count: 0, plays: {} },
          },
        };
      }
      persStats[pers].formations[form].total++;
      if (persStats[pers].formations[form].categories[category]) {
        persStats[pers].formations[form].categories[category].count++;
        const playsMap = persStats[pers].formations[form].categories[category].plays;
        playsMap[playName] = (playsMap[playName] || 0) + 1;
      }
    });

    const persKeys = Object.keys(persStats);
    if (persKeys.length === 0) {
      const emptyTbody = document.createElement('tbody');
      emptyTbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 2rem; color: #64748b; font-weight: 600;">Personnelデータが入力されると、ここにFormation・Play傾向が集計されます</td></tr>';
      table.appendChild(emptyTbody);
      return;
    }

    persKeys.sort((a, b) => persStats[b].total - persStats[a].total);

    let notes = {};
    try {
      notes = JSON.parse(localStorage.getItem('fdl_pers_notes_' + currentGameId) || '{}');
    } catch (_) {}

    const saveNote = (key, val) => {
      notes[key] = val;
      try {
        localStorage.setItem('fdl_pers_notes_' + currentGameId, JSON.stringify(notes));
      } catch (_) {}
    };

    const getBgClass = (type, count, total) => {
      if (total === 0 || count === 0) return '';
      const pct = Math.round((count / total) * 100);
      if (pct >= 70 && count >= 2) {
        return type === 'run' ? 'bg-run-high' : 'bg-pass-high';
      }
      return '';
    };

    const getPctText = (count, total) => {
      if (total === 0) return '<span style="color:#94a3b8;">—</span>';
      const pct = Math.round((count / total) * 100);
      const isHigh = pct >= 70 && count >= 2;
      const highlight = isHigh ? 'highlight-red' : '';
      return `<span class="${highlight}">${pct}%</span>`;
    };

    const formatPlays = (playsObj) => {
      const sorted = Object.entries(playsObj).sort((a, b) => b[1] - a[1]);
      if (sorted.length === 0) return '<span style="color:#94a3b8;">—</span>';
      return sorted
        .map(([play, count]) => `<span class="play-item"><strong>${escapeHTML(play)}</strong> <span class="play-count">(${count})</span></span>`)
        .join(', ');
    };

    persKeys.forEach((per) => {
      const data = persStats[per];
      const forms = Object.keys(data.formations).sort((a, b) => data.formations[b].total - data.formations[a].total);
      const personnelRowspan = 2 + (forms.length * 2);

      const tbody = document.createElement('tbody');
      tbody.className = 'personnel-tbody';

      const tr1 = document.createElement('tr');
      tr1.style.borderTop = '2.5px solid #333333';

      const tdPer = document.createElement('td');
      tdPer.rowSpan = personnelRowspan;
      tdPer.className = 'personnel-cell';
      if (per.length >= 6) {
        tdPer.classList.add('pers-cell-xl');
      } else if (per.length >= 4) {
        tdPer.classList.add('pers-cell-long');
      }
      tdPer.textContent = per;

      const tdTebp = document.createElement('td');
      tdTebp.rowSpan = personnelRowspan;
      tdTebp.className = 'input-cell';
      const taTebp = document.createElement('textarea');
      taTebp.className = 'editable-field';
      taTebp.placeholder = 'メモ...';
      taTebp.value = notes[per + '_tebp'] || '';
      taTebp.oninput = (e) => saveNote(per + '_tebp', e.target.value);
      tdTebp.appendChild(taTebp);

      const tdOther = document.createElement('td');
      tdOther.rowSpan = personnelRowspan;
      tdOther.className = 'input-cell';
      const taOther = document.createElement('textarea');
      taOther.className = 'editable-field';
      taOther.placeholder = 'メモ...';
      taOther.value = notes[per + '_other'] || '';
      taOther.oninput = (e) => saveNote(per + '_other', e.target.value);
      tdOther.appendChild(taOther);

      const tdTotForm = document.createElement('td');
      tdTotForm.rowSpan = 2;
      tdTotForm.className = 'formation-name pers-summary-cell';
      tdTotForm.innerHTML = `<div style="font-weight:800; color:#1e293b;">全体合計</div><span style="font-size:0.75rem; color:#64748b;">(${data.total}/${totalPersPlays})</span>`;

      const tdTotShare = document.createElement('td');
      tdTotShare.rowSpan = 2;
      tdTotShare.className = 'stat-share pers-summary-cell';
      const overallPct = totalPersPlays > 0 ? Math.round((data.total / totalPersPlays) * 100) : 0;
      tdTotShare.innerHTML = `<strong>${overallPct}%</strong>`;

      const tdTotPassType = document.createElement('td');
      tdTotPassType.className = 'type-cell type-pass';
      tdTotPassType.textContent = 'Pass';

      const tdTotPassPct = document.createElement('td');
      tdTotPassPct.className = 'pct-cell';
      tdTotPassPct.innerHTML = getPctText(data.categories.pass, data.total);

      const tdTotPassPlays = document.createElement('td');
      tdTotPassPlays.className = `plays-cell ${getBgClass('pass', data.categories.pass, data.total)}`;
      tdTotPassPlays.innerHTML = '';

      tr1.append(tdPer, tdTebp, tdOther, tdTotForm, tdTotShare, tdTotPassType, tdTotPassPct, tdTotPassPlays);
      tbody.appendChild(tr1);

      const trTotRun = document.createElement('tr');
      trTotRun.className = 'pers-summary-end';

      const tdTotRunType = document.createElement('td');
      tdTotRunType.className = 'type-cell type-run';
      tdTotRunType.textContent = 'Run';

      const tdTotRunPct = document.createElement('td');
      tdTotRunPct.className = 'pct-cell';
      tdTotRunPct.innerHTML = getPctText(data.categories.run, data.total);

      const tdTotRunPlays = document.createElement('td');
      tdTotRunPlays.className = `plays-cell ${getBgClass('run', data.categories.run, data.total)}`;
      tdTotRunPlays.innerHTML = '';

      trTotRun.append(tdTotRunType, tdTotRunPct, tdTotRunPlays);
      tbody.appendChild(trTotRun);

      forms.forEach((formName) => {
        const fData = data.formations[formName];
        const formSharePct = data.total > 0 ? Math.round((fData.total / data.total) * 100) : 0;

        const trForm1 = document.createElement('tr');
        const tdFName = document.createElement('td');
        tdFName.rowSpan = 2;
        tdFName.className = 'formation-name';
        tdFName.textContent = formName;

        const tdFShare = document.createElement('td');
        tdFShare.rowSpan = 2;
        tdFShare.className = 'stat-share';
        tdFShare.innerHTML = `<strong>${formSharePct}%</strong> <span style="font-size:0.75rem; color:#64748b;">(${fData.total}/${data.total})</span>`;

        const tdFPassType = document.createElement('td');
        tdFPassType.className = 'type-cell type-pass';
        tdFPassType.textContent = 'Pass';

        const tdFPassPct = document.createElement('td');
        tdFPassPct.className = 'pct-cell';
        tdFPassPct.innerHTML = getPctText(fData.categories.pass.count, fData.total);

        const tdFPassPlays = document.createElement('td');
        tdFPassPlays.className = `plays-cell ${getBgClass('pass', fData.categories.pass.count, fData.total)}`;
        tdFPassPlays.innerHTML = formatPlays(fData.categories.pass.plays);

        trForm1.append(tdFName, tdFShare, tdFPassType, tdFPassPct, tdFPassPlays);
        tbody.appendChild(trForm1);

        const trForm2 = document.createElement('tr');
        const tdFRunType = document.createElement('td');
        tdFRunType.className = 'type-cell type-run';
        tdFRunType.textContent = 'Run';

        const tdFRunPct = document.createElement('td');
        tdFRunPct.className = 'pct-cell';
        tdFRunPct.innerHTML = getPctText(fData.categories.run.count, fData.total);

        const tdFRunPlays = document.createElement('td');
        tdFRunPlays.className = `plays-cell ${getBgClass('run', fData.categories.run.count, fData.total)}`;
        tdFRunPlays.innerHTML = formatPlays(fData.categories.run.plays);

        trForm2.append(tdFRunType, tdFRunPct, tdFRunPlays);
        tbody.appendChild(trForm2);
      });

      table.appendChild(tbody);
    });
  }

  function renderPersonnelMatrix(persHeadRow, persTbody, allPersSet, sitStats, totalStat) {
    const sortedPers = Array.from(allPersSet).sort((a, b) => {
      const cntA = (totalStat.pers[a] && totalStat.pers[a].total) || 0;
      const cntB = (totalStat.pers[b] && totalStat.pers[b].total) || 0;
      if (cntB !== cntA) return cntB - cntA;
      return a.localeCompare(b, undefined, { numeric: true });
    });

    persHeadRow.innerHTML = '<th class="th-situation">状況 (D&amp;D)</th><th style="width:70px;">Total</th>';
    sortedPers.forEach((pers) => {
      persHeadRow.appendChild(el('th', '', pers));
    });
    if (sortedPers.length === 0) {
      persHeadRow.appendChild(el('th', '', 'Personnel未入力'));
    }

    persTbody.innerHTML = '';
    const renderPersRow = (label, stat, isTotal = false) => {
      const tr = document.createElement('tr');
      let downNum = 'total';
      if (!isTotal) {
        if (label.startsWith('1st')) downNum = '1';
        else if (label.startsWith('2nd')) downNum = '2';
        else if (label.startsWith('3rd')) downNum = '3';
        else if (label.startsWith('4th')) downNum = '4';
      }
      tr.setAttribute('data-down', downNum);
      if (isTotal) {
        tr.className = 'total-row';
      } else if (label === '1st Down' || label.includes('Long') || label.startsWith('4th')) {
        tr.classList.add('down-group-end');
      }

      tr.appendChild(el('td', 'td-situation', label));
      tr.appendChild(el('td', '', String(stat.total)));

      if (sortedPers.length === 0) {
        tr.appendChild(el('td', 'empty-cell', '—'));
      } else {
        sortedPers.forEach((pers) => {
          const pInfo = stat.pers[pers];
          const td = document.createElement('td');
          if (!pInfo || pInfo.total === 0) {
            td.innerHTML = '<span class="empty-cell">—</span>';
          } else {
            const cnt = pInfo.total;
            const sitPct = stat.total > 0 ? Math.round((cnt / stat.total) * 100) : 0;
            const runCnt = pInfo.run;
            const passCnt = pInfo.pass;
            const runPct = cnt > 0 ? Math.round((runCnt / cnt) * 100) : 0;
            const passPct = cnt > 0 ? Math.round((passCnt / cnt) * 100) : 0;

            if (cnt >= 2) {
              if (runPct >= 70) td.className = 'bg-run-high';
              else if (passPct >= 70) td.className = 'bg-pass-high';
            }

            td.innerHTML = `
              <div style="font-weight:700; font-size:0.95rem; line-height:1.2;">
                ${cnt}回 <span class="stat-count">(${sitPct}%)</span>
              </div>
              <div style="font-size:0.8rem; margin-top:3px; line-height:1.2; white-space:nowrap;">
                <span style="color:#b91c1c; font-weight:700;">R ${runCnt}</span> <span style="font-size:0.75rem; color:#475569;">(${runPct}%)</span>
                <span style="color:#cbd5e1; margin:0 2px;">/</span>
                <span style="color:#1d4ed8; font-weight:700;">P ${passCnt}</span> <span style="font-size:0.75rem; color:#475569;">(${passPct}%)</span>
              </div>
            `;
          }
          tr.appendChild(td);
        });
      }
      persTbody.appendChild(tr);
    };

    SITUATIONS.forEach((s) => renderPersRow(s, sitStats[s]));
    renderPersRow('全プレー合計', totalStat, true);
  }

  function renderTendency() {
    const runPassTbody = $('#runPassTable tbody');
    const persHierarchyTable = $('#personnelHierarchyTable');
    const persTbody = $('#personnelTable tbody');
    const persHeadRow = $('#personnelTableHeadRow');
    if (!runPassTbody) return;

    const validPlays = plays.filter((p) => p.down || p.play || p.personnel || p.playType || p.formation);

    const sitStats = {};
    SITUATIONS.forEach((s) => {
      sitStats[s] = { total: 0, run: 0, pass: 0, pers: {} };
    });
    const totalStat = { total: 0, run: 0, pass: 0, pers: {} };
    const allPersSet = new Set();

    validPlays.forEach((p) => {
      const sit = getSituationGroup(p);
      const typeUpper = (p.playType || '').toUpperCase().trim();
      const isRun = typeUpper === 'RUN' || typeUpper === 'R';
      const isPass = typeUpper === 'PASS' || typeUpper === 'P';
      const pers = (p.personnel || '').trim();

      if (pers) {
        allPersSet.add(pers);
        if (sit && sitStats[sit]) {
          if (!sitStats[sit].pers[pers]) {
            sitStats[sit].pers[pers] = { total: 0, run: 0, pass: 0 };
          }
          sitStats[sit].pers[pers].total++;
          if (isRun) sitStats[sit].pers[pers].run++;
          if (isPass) sitStats[sit].pers[pers].pass++;
        }
        if (!totalStat.pers[pers]) {
          totalStat.pers[pers] = { total: 0, run: 0, pass: 0 };
        }
        totalStat.pers[pers].total++;
        if (isRun) totalStat.pers[pers].run++;
        if (isPass) totalStat.pers[pers].pass++;
      }

      if (sit && sitStats[sit]) {
        sitStats[sit].total++;
        if (isRun) sitStats[sit].run++;
        if (isPass) sitStats[sit].pass++;
      }
      totalStat.total++;
      if (isRun) totalStat.run++;
      if (isPass) totalStat.pass++;
    });

    // 表1: Down & Distance 傾向分析 (Play Type別)
    runPassTbody.innerHTML = '';
    const renderRunPassRow = (label, stat, isTotal = false) => {
      const tr = document.createElement('tr');
      let downNum = 'total';
      if (!isTotal) {
        if (label.startsWith('1st')) downNum = '1';
        else if (label.startsWith('2nd')) downNum = '2';
        else if (label.startsWith('3rd')) downNum = '3';
        else if (label.startsWith('4th')) downNum = '4';
      }
      tr.setAttribute('data-down', downNum);
      if (isTotal) {
        tr.className = 'total-row';
      } else if (label === '1st Down' || label.includes('Long') || label.startsWith('4th')) {
        tr.classList.add('down-group-end');
      }

      const tdSit = el('td', 'td-situation', label);
      const tdTotal = el('td', '', String(stat.total));

      const runPct = stat.total > 0 ? Math.round((stat.run / stat.total) * 100) : 0;
      const passPct = stat.total > 0 ? Math.round((stat.pass / stat.total) * 100) : 0;

      const formatCell = (count, pct) => {
        const td = document.createElement('td');
        if (stat.total === 0) {
          td.innerHTML = '<span class="empty-cell">—</span>';
        } else {
          const isHigh = pct >= 70 && count >= 2;
          const highClass = isHigh ? 'highlight-red' : '';
          td.innerHTML = `<span class="stat-pct ${highClass}">${pct}%</span> <span class="stat-count">(${count}/${stat.total})</span>`;
        }
        return td;
      };

      // 比率バー (Run: 赤, Pass: 青)
      const tdBar = el('td', 'tendency-bar-cell');
      if (stat.total > 0 && (stat.run > 0 || stat.pass > 0)) {
        const barWrap = el('div', 'tendency-bar');
        if (stat.run > 0) {
          const runPart = el('div', 'tendency-bar-run');
          runPart.style.width = `${runPct}%`;
          barWrap.appendChild(runPart);
        }
        if (stat.pass > 0) {
          const passPart = el('div', 'tendency-bar-pass');
          passPart.style.width = `${passPct}%`;
          barWrap.appendChild(passPart);
        }
        tdBar.appendChild(barWrap);
      } else {
        tdBar.innerHTML = '<span class="empty-cell">—</span>';
      }

      tr.append(
        tdSit,
        formatCell(stat.run, runPct),
        formatCell(stat.pass, passPct),
        tdBar,
        tdTotal
      );

      runPassTbody.appendChild(tr);
    };

    SITUATIONS.forEach((s) => renderRunPassRow(s, sitStats[s]));
    renderRunPassRow('全プレー合計', totalStat, true);

    // 表2: Personnel 階層表
    if (persHierarchyTable) {
      renderPersonnelHierarchy(persHierarchyTable, validPlays);
    }

    // 表3: Personnel × 状況別マトリクス
    if (persHeadRow && persTbody) {
      renderPersonnelMatrix(persHeadRow, persTbody, allPersSet, sitStats, totalStat);
    }
  }

  window.addEventListener('DOMContentLoaded', init);
})();
