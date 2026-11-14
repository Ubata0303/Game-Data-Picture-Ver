(() => {
  // 万が一エラーが起きた場合に画面に理由を表示
  window.onerror = function (msg, url, line, col, err) {
    alert(`エラーが発生しました:\n${msg}\n(行: ${line}, 列: ${col})\n${err?.stack || ''}`);
  };
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // ---------- 入力項目の定義（項目を増やすときはここに追加） ----------
  const FIELDS = [
    { key: 'qtr', label: 'Quarter（1〜4 / OT）', type: 'allowed', allowed: ['1', '2', '3', '4', 'OT'] },
    { key: 'series', label: 'Series', type: 'number', min: 1, max: 99 },
    { key: 'hash', label: 'Hash', type: 'buttons', options: ['L', 'M', 'R'] },
    { key: 'down', key2: 'dist', label: 'Down & Distance', type: 'downdist' },
    { key: 'personnel', label: 'Personnel', type: 'text', inputMode: 'numeric' },
    { key: 'formation', label: 'OFF Formation', type: 'text', capitalize: true },
    // upperWords: どう打っても全部大文字にする単語
    { key: 'play', label: 'Play', type: 'text', capitalize: true, upperWords: ['RPO', 'PAP'] },
    { key: 'defSign', label: 'Def Sign', type: 'text', capitalize: true },
  ];
  const CSV_COLS = [
    ['qtr', 'Quarter'], ['series', 'Series'], ['hash', 'Hash'],
    ['down', 'Down'], ['dist', 'Distance'], ['personnel', 'Personnel'],
    ['formation', 'OFF Formation'], ['play', 'Play'], ['defSign', 'Def Sign'],
  ];

  // ---------- 担当（役割）の定義 ----------
  // canAdd: 「＋ 次のプレー」で行を追加できる担当（同時に押して行が重複するのを防ぐ）
  const ROLES = {
    situation: { label: '状況', keys: ['qtr', 'series', 'hash', 'down', 'dist'], canAdd: true },
    offense: { label: 'オフェンス', keys: ['personnel', 'formation', 'play'], canAdd: false },
    defense: { label: 'Def Sign', keys: ['defSign'], canAdd: false },
    all: { label: '全項目', keys: null, canAdd: true },
  };
  let role = ROLES[localStorage.getItem('fdl_role')] ? localStorage.getItem('fdl_role') : 'all';
  const roleHas = (key) => !ROLES[role].keys || ROLES[role].keys.includes(key);

  // ---------- 状態 ----------
  let store;
  let me = localStorage.getItem('fdl_name') || '';
  const clientId = localStorage.getItem('fdl_client') || (() => {
    const id = Math.random().toString(36).slice(2, 10);
    localStorage.setItem('fdl_client', id);
    return id;
  })();
  let games = [];
  let plays = [];
  let currentGameId = null;
  let unsubPlays = null;
  let selectedId = null;
  let prevUpdated = {};
  let lastNewestId = null;
  let isViewOnly = false;
  const controls = {};

  // ---------- 共通 ----------
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 1800);
  }
  const selectedPlay = () => plays.find((p) => p.id === selectedId) || null;
  const newestId = () => (plays.length ? plays[plays.length - 1].id : null);
  const editorFocused = () => $('#editor').contains(document.activeElement) &&
    document.activeElement.tagName === 'INPUT';
  const ddText = (p) => (p.down || p.dist ? `${p.down || ''}-${p.dist || ''}` : '');
  // "gun ace slot +" → "Gun Ace Slot +"（各単語の1文字目だけ大文字。残りはそのまま）
  // upperWords に指定した単語は全部大文字（"rpo" → "RPO"）
  // 入力中は単語の後にスペース等が打たれた時点で変換（"paper" などを途中で "PAPer" にしないため）。保存時は末尾も変換
  const capitalizeWords = (s, upperWords = [], final = true) => {
    let out = s.replace(/(^|\s)(\S)/g, (m, sp, ch) => sp + ch.toUpperCase());
    const end = final ? '$|' : '';
    upperWords.forEach((w) => {
      out = out.replace(new RegExp(`(^|[^A-Za-z0-9])(${w})(?=${end}[^A-Za-z0-9])`, 'gi'), (m, pre) => pre + w.toUpperCase());
    });
    return out;
  };

  function save(key, value, pid = selectedId) {
    if (value === null) return; // 入力値が不正
    if (!currentGameId || !pid) { toast('編集する行を選択してください'); return; }
    const p = plays.find((x) => x.id === pid);
    if (p && (p[key] ?? '') === value) return;
    store.updatePlay(currentGameId, pid, {
      [key]: value, updatedBy: me, updatedByClient: clientId, updatedAt: Date.now(),
    });
  }

  function focusNextInputOrRow(currentKey) {
    const activeKeys = FIELDS.filter((f) => roleHas(f.key)).map((f) => f.key);
    const curIdx = activeKeys.indexOf(currentKey);
    if (curIdx === -1 || curIdx === activeKeys.length - 1) {
      // 最後の項目なら次の行へ進み、最初の入力項目にフォーカス
      const firstKey = activeKeys[0] || 'qtr';
      selectNextRow({ focusKey: firstKey });
    } else {
      // 次の入力項目へ移動
      const nextKey = activeKeys[curIdx + 1];
      controls[nextKey]?.focus?.();
    }
  }

  function selectNextRow({ focusKey, scroll = true } = {}) {
    if (!plays.length) return;
    const curIdx = plays.findIndex((p) => p.id === selectedId);
    let nextIdx = curIdx + 1;
    if (curIdx === -1) nextIdx = 0;

    // 100行に近づいたら自動で+20行拡張
    if (nextIdx >= plays.length - 5) {
      if (store.addPlaysBulk && currentGameId) {
        store.addPlaysBulk(currentGameId, 20);
      }
    }
    if (nextIdx >= plays.length) return;

    const nextPlay = plays[nextIdx];
    if (nextPlay) {
      selectPlay(nextPlay.id, { scroll: true });
      if (focusKey) {
        setTimeout(() => {
          controls[focusKey]?.focus?.();
        }, 60);
      }
    }
  }

  // フォーカス時点のプレーIDを覚えておき、途中で選択が変わっても正しい行に保存する
  function bindInput(input, key, getValue) {
    let pid = null;
    let timer = null;
    input.addEventListener('focus', () => { pid = selectedId; });
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => save(key, getValue(), pid || selectedId), 500);
    });
    input.addEventListener('change', () => {
      clearTimeout(timer);
      save(key, getValue(), pid || selectedId);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        clearTimeout(timer);
        save(key, getValue(), pid || selectedId);
        e.preventDefault();
        focusNextInputOrRow(key);
      }
    });
  }

  // ---------- 入力パネル ----------
  function buildEditor() {
    const root = $('#editor');
    root.innerHTML = '';
    Object.keys(controls).forEach((k) => delete controls[k]);
    root.classList.toggle('large', role !== 'all');
    for (const f of FIELDS) {
      if (!roleHas(f.key)) continue;
      const wrap = el('div', 'field field-' + f.type);
      wrap.appendChild(el('label', 'field-label', f.label));
      const body = el('div', 'field-body');
      wrap.appendChild(body);
      root.appendChild(wrap);
      controls[f.key] = makeControl(f, body);
    }
  }

  function makeButtons(container, options, onClick) {
    const box = el('div', 'btns');
    const btns = options.map((o) => {
      const b = el('button', 'opt', o.label ?? o);
      b.type = 'button';
      b.dataset.v = o.value ?? o;
      b.addEventListener('click', () => onClick(b.dataset.v));
      box.appendChild(b);
      return b;
    });
    container.appendChild(box);
    return (v) => btns.forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  }

  function makeControl(f, body) {
    switch (f.type) {
      case 'buttons': {
        const setOn = makeButtons(body, f.options, (v) => {
          const cur = selectedPlay()?.[f.key] ?? '';
          save(f.key, cur === v ? '' : v); // 同じボタンをもう一度押すと解除
        });
        return { set: (v) => setOn(v ?? '') };
      }
      case 'allowed': {
        // 決められた値だけ手打ちで受け付ける（小文字は大文字に変換）
        const input = el('input', 'num');
        input.maxLength = Math.max(...f.allowed.map((a) => a.length));
        input.autocapitalize = 'characters';
        input.placeholder = f.allowed.join('/');
        const getValue = () => {
          const s = input.value.normalize('NFKC').trim().toUpperCase(); // 全角「ｏｔ」も OT に
          if (s === '' || f.allowed.includes(s)) { input.classList.remove('invalid'); return s; }
          input.classList.add('invalid');
          toast(`${f.allowed.join(' / ')} のどれかを入力してください`);
          return null;
        };
        // 打った瞬間に大文字に変換して表示（ot → OT）
        input.addEventListener('input', () => {
          const up = input.value.normalize('NFKC').toUpperCase();
          if (up !== input.value) input.value = up;
        });
        bindInput(input, f.key, getValue);
        body.appendChild(input);
        return {
          set: (v) => {
            if (document.activeElement !== input) { input.value = v ?? ''; input.classList.remove('invalid'); }
          },
          focus: () => { input.focus(); input.select(); },
        };
      }
      case 'number': {
        // 数値の手打ち入力（範囲外は保存しない）
        const input = el('input', 'num');
        // type="number" だと上下矢印が出るので、テキスト入力＋数字キーボードにする
        input.inputMode = 'numeric'; input.maxLength = String(f.max).length;
        input.placeholder = `${f.min}-${f.max}`;
        const getValue = () => {
          const s = input.value.normalize('NFKC').trim(); // 全角数字も受け付ける
          if (s === '') return '';
          const n = Number(s);
          if (!Number.isInteger(n) || n < f.min || n > f.max) {
            input.classList.add('invalid');
            toast(`${f.min}〜${f.max} の数字を入力してください`);
            return null;
          }
          input.classList.remove('invalid');
          return String(n);
        };
        bindInput(input, f.key, getValue);
        body.appendChild(input);
        return {
          set: (v) => {
            if (document.activeElement !== input) { input.value = v ?? ''; input.classList.remove('invalid'); }
          },
          focus: () => { input.focus(); input.select(); },
        };
      }
      case 'downdist': {
        // [Down] − [Distance] の2マス手打ち。Downに1〜4を打つと自動でDistanceへ移動
        const down = el('input', 'num dd-down');
        down.inputMode = 'numeric'; down.maxLength = 1; down.placeholder = 'D';
        const dash = el('span', 'dd-dash', '−');
        const dist = el('input', 'num dd-dist');
        dist.inputMode = 'numeric'; dist.maxLength = 3; dist.placeholder = 'Dist';
        const getDown = () => {
          const s = down.value.trim();
          if (s === '' || /^[1-4]$/.test(s)) { down.classList.remove('invalid'); return s; }
          down.classList.add('invalid');
          toast('Down は 1〜4 で入力してください');
          return null;
        };
        bindInput(down, f.key, getDown);
        bindInput(dist, f.key2, () => dist.value.trim().toUpperCase());
        down.addEventListener('input', () => {
          if (/^[1-4]$/.test(down.value.trim())) { dist.focus(); dist.select(); }
        });
        dist.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.isComposing) {
            save(f.key2, dist.value.trim().toUpperCase(), selectedId);
            e.preventDefault();
            focusNextInputOrRow(f.key);
          }
        });
        body.append(down, dash, dist);
        return {
          set: (v, p) => {
            if (document.activeElement !== down) { down.value = v ?? ''; down.classList.remove('invalid'); }
            if (document.activeElement !== dist) dist.value = p?.[f.key2] ?? '';
          },
          focus: () => { down.focus(); down.select(); },
        };
      }
      case 'text': {
        const input = el('input', 'text');
        if (f.inputMode) input.inputMode = f.inputMode;
        const listId = 'dl_' + f.key;
        input.setAttribute('list', listId);
        input.placeholder = f.label + ' を入力';
        const dl = el('datalist');
        dl.id = listId;
        const chips = el('div', 'chips');
        const clean = (s) => (f.capitalize ? capitalizeWords(s, f.upperWords) : s).trim();
        if (f.capitalize) {
          // 打った瞬間に各単語の1文字目を大文字に（カーソル位置は維持。日本語変換中は待つ）
          input.autocapitalize = 'words';
          const apply = () => {
            const cap = capitalizeWords(input.value, f.upperWords, false);
            if (cap === input.value) return;
            const { selectionStart: s, selectionEnd: e } = input;
            input.value = cap;
            input.setSelectionRange(s, e);
          };
          input.addEventListener('input', (ev) => { if (!ev.isComposing) apply(); });
          input.addEventListener('compositionend', apply);
          // 入力を終えたら末尾の単語も含めて最終変換（"zone rpo" → "Zone RPO"）
          input.addEventListener('change', () => { input.value = capitalizeWords(input.value, f.upperWords, true); });
        }
        bindInput(input, f.key, () => clean(input.value));
        body.append(input, dl, chips);
        return {
          set: (v) => { if (document.activeElement !== input) input.value = v ?? ''; },
          focus: () => { input.focus(); input.select(); },
          // この試合でよく使われた値をワンタップ候補として表示
          refreshChoices: () => {
            const freq = {};
            plays.forEach((p) => { const v = (p[f.key] || '').trim(); if (v) freq[v] = (freq[v] || 0) + 1; });
            const sorted = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);
            dl.innerHTML = '';
            sorted.forEach((v) => { const o = el('option'); o.value = v; dl.appendChild(o); });
            chips.innerHTML = '';
            const cur = selectedPlay()?.[f.key] ?? '';
            sorted.slice(0, 10).forEach((v) => {
              const c = el('button', 'chip' + (v === cur ? ' on' : ''), v);
              c.type = 'button';
              c.onclick = () => { input.value = v; save(f.key, v); };
              chips.appendChild(c);
            });
          },
        };
      }
    }
  }

  const ORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };

  function syncEditor() {
    const p = selectedPlay();
    $('#editorPane').classList.toggle('no-selection', !p);
    if (p) {
      const idx = plays.indexOf(p) + 1;
      $('#editingLabel').textContent = `編集中: #${idx}` + (p.updatedBy ? `（最終更新: ${p.updatedBy}）` : '');
      // どのプレーを入力しているか一目でわかる状況表示
      const dd = p.down ? `${ORD[p.down] || p.down} & ${p.dist || '?'}` : '';
      const parts = [p.qtr && `Q${p.qtr}`, p.series && `S${p.series}`, dd, p.hash && `Hash ${p.hash}`];
      $('#situation').textContent = parts.filter(Boolean).join('   ') || '（状況未入力）';
    } else {
      $('#editingLabel').textContent = 'プレー未選択';
      $('#situation').textContent = '—';
    }
    for (const f of FIELDS) {
      const c = controls[f.key];
      if (!c) continue;
      c.set(p ? p[f.key] : '', p);
      if (c.refreshChoices) c.refreshChoices();
    }
  }

  function applyRole() {
    const r = ROLES[role];
    document.querySelectorAll('#roleBar button').forEach((b) => b.classList.toggle('on', b.dataset.role === role));
    // 「新シリーズ」ボタンは状況担当・全項目のみ表示（「↓ 次のプレーへ」は全員表示）
    $('#newSeriesBtn').classList.toggle('hidden', role !== 'situation' && role !== 'all');
    document.querySelectorAll('#playTable th[data-key]').forEach((th) => {
      th.classList.toggle('mine', role !== 'all' && roleHas(th.dataset.key));
    });
    $('#userBtn').textContent = '👤 ' + (me || '未設定') + (role !== 'all' ? `（${r.label}）` : '');
    buildEditor();
    renderTable();
    syncEditor();
  }

  function setRole(r) {
    if (editorFocused()) document.activeElement.blur();
    role = r;
    localStorage.setItem('fdl_role', r);
    applyRole();
  }

  function selectPlay(id, { fromUser = false, scroll = false } = {}) {
    if (editorFocused()) document.activeElement.blur();
    selectedId = id;
    renderTable();
    syncEditor();
    if (scroll) {
      setTimeout(() => {
        const selTr = $('#playTable tbody tr.selected');
        if (selTr) selTr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }, 50);
    }
  }

  // ---------- Hudl風 絞り込みフィルター（閲覧専用） ----------
  const HUDL_FILTERS = [
    { key: 'personnel', label: 'PERSONNEL' },
    { key: 'formation', label: '体型 (FORMATION)' },
    { key: 'play', label: 'PLAY名' },
    { key: 'down', label: 'DOWN', format: (v) => ORD[v] || v },
    { key: 'dist', label: 'DISTANCE' },
    { key: 'hash', label: 'HASH' },
  ];

  const activeFilters = {
    personnel: new Set(),
    formation: new Set(),
    play: new Set(),
    down: new Set(),
    dist: new Set(),
    hash: new Set(),
  };

  function hasActiveFilter() {
    return Object.values(activeFilters).some((s) => s.size > 0);
  }

  function matchesFilter(p) {
    if (!isViewOnly) return true;
    for (const f of HUDL_FILTERS) {
      const selected = activeFilters[f.key];
      if (selected.size === 0) continue; // すべて (ALL)
      const val = (p[f.key] || '').trim();
      // 同一項目内は OR（選択した値のどれかに一致すればOK）
      if (!selected.has(val)) return false;
    }
    return true;
  }

  function refreshHudlFilters() {
    if (!isViewOnly) return;
    const container = $('#hudlFilterList');
    if (!container) return;

    HUDL_FILTERS.forEach((f) => {
      const counts = {};
      plays.forEach((p) => {
        const v = (p[f.key] || '').trim();
        if (v) counts[v] = (counts[v] || 0) + 1;
      });

      let item = container.querySelector(`[data-fkey="${f.key}"]`);
      if (!item) {
        item = el('div', 'hudl-filter-item');
        item.dataset.fkey = f.key;
        item.appendChild(el('div', 'hudl-filter-label', f.label));

        const btn = el('button', 'hudl-filter-btn');
        btn.type = 'button';
        btn.innerHTML = `<span class="hudl-btn-text">すべて (ALL)</span><span class="hudl-btn-arrow">▾</span>`;
        item.appendChild(btn);

        const drop = el('div', 'hudl-dropdown hidden');
        item.appendChild(drop);

        btn.onclick = (e) => {
          e.stopPropagation();
          const isClosed = drop.classList.contains('hidden');
          document.querySelectorAll('.hudl-dropdown').forEach((d) => d.classList.add('hidden'));
          if (isClosed) drop.classList.remove('hidden');
        };

        drop.onclick = (e) => e.stopPropagation();
        container.appendChild(item);
      }

      updateFilterDropdown(item, f, counts);
    });
  }

  function updateFilterDropdown(item, f, counts) {
    const drop = item.querySelector('.hudl-dropdown');
    const selected = activeFilters[f.key];
    drop.innerHTML = '';

    // 「すべて (ALL)」行
    const allLabel = el('label', 'hudl-option hudl-option-all');
    const allCheck = el('input');
    allCheck.type = 'checkbox';
    allCheck.checked = (selected.size === 0);
    allLabel.appendChild(allCheck);
    allLabel.appendChild(el('span', 'opt-text', 'すべて (ALL)'));
    allCheck.onchange = () => {
      selected.clear();
      refreshHudlFilters();
      renderTable();
    };
    drop.appendChild(allLabel);

    // 各値の行
    const sortedKeys = Object.keys(counts).sort((a, b) => {
      if (f.key === 'down' || f.key === 'dist') {
        const na = parseInt(a, 10), nb = parseInt(b, 10);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
      }
      return counts[b] - counts[a] || a.localeCompare(b);
    });

    sortedKeys.forEach((val) => {
      const optLabel = el('label', 'hudl-option');
      const chk = el('input');
      chk.type = 'checkbox';
      chk.checked = selected.has(val);
      chk.onchange = () => {
        if (chk.checked) selected.add(val);
        else selected.delete(val);
        allCheck.checked = (selected.size === 0);
        updateFilterButton(item, f);
        renderTable();
      };
      optLabel.appendChild(chk);
      const displayVal = f.format ? f.format(val) : val;
      optLabel.appendChild(el('span', 'opt-text', displayVal));
      optLabel.appendChild(el('span', 'opt-count', `(${counts[val]})`));
      drop.appendChild(optLabel);
    });

    updateFilterButton(item, f);
  }

  function updateFilterButton(item, f) {
    const selected = activeFilters[f.key];
    const btnText = item.querySelector('.hudl-btn-text');
    const btn = item.querySelector('.hudl-filter-btn');
    if (selected.size === 0) {
      btnText.textContent = 'すべて (ALL)';
      btn.classList.remove('active');
    } else if (selected.size === 1) {
      const v = Array.from(selected)[0];
      btnText.textContent = f.format ? f.format(v) : v;
      btn.classList.add('active');
    } else {
      btnText.textContent = `${selected.size}件選択中`;
      btn.classList.add('active');
    }
  }

  function clearAllHudlFilters() {
    Object.values(activeFilters).forEach((s) => s.clear());
    refreshHudlFilters();
    renderTable();
  }

  // ---------- プレー一覧 ----------
  function renderTable() {
    const tbody = $('#playTable tbody');
    tbody.innerHTML = '';
    let visibleCount = 0;
    const isFiltering = isViewOnly && hasActiveFilter();

    plays.forEach((p, i) => {
      if (!matchesFilter(p)) return;
      visibleCount++;

      const tr = el('tr');
      if (p.id === selectedId) tr.classList.add('selected');
      const prev = prevUpdated[p.id];
      if (p.updatedByClient && p.updatedByClient !== clientId && prev !== undefined && prev !== p.updatedAt) {
        tr.classList.add('flash');
      }
      const cells = [
        ['#', i + 1], ['qtr', p.qtr], ['series', p.series], ['hash', p.hash],
        ['down', ddText(p)], ['personnel', p.personnel], ['formation', p.formation], ['play', p.play],
      ];
      cells.forEach(([k, v]) => {
        const td = el('td', null, v ?? '');
        if (role !== 'all' && k !== '#' && roleHas(k)) td.className = 'mine';
        tr.appendChild(td);
      });

      // Play図セル
      const drawTd = el('td', 'play-draw-cell');
      if (p.drawing) {
        const btn = el('button', 'draw-btn-has', '🎨 見る');
        btn.type = 'button';
        btn.onclick = (e) => {
          e.stopPropagation();
          openViewDraw(p);
        };
        drawTd.appendChild(btn);
      } else if (!isViewOnly) {
        const btn = el('button', 'draw-btn-empty', '＋ 作図');
        btn.type = 'button';
        btn.onclick = (e) => {
          e.stopPropagation();
          openDrawing(p.id);
        };
        drawTd.appendChild(btn);
      }
      tr.appendChild(drawTd);

      // Def Sign セル
      const defTd = el('td', null, p.defSign ?? '');
      if (role !== 'all' && roleHas('defSign')) defTd.className = 'mine';
      tr.appendChild(defTd);
      const who = el('td', 'who', (p._pending ? '⏳ ' : '') + (p.updatedBy || ''));
      if (p._pending) who.title = '未送信（電波復帰後に自動送信）';
      tr.appendChild(who);
      if (!isViewOnly) {
        tr.addEventListener('click', () => selectPlay(p.id, { fromUser: true }));
      }
      tbody.appendChild(tr);
    });

    if (isFiltering) {
      $('#playCount').textContent = `(${visibleCount} / 全${plays.length})`;
    } else {
      $('#playCount').textContent = `(${plays.length})`;
    }
  }

  function onPlays(list) {
    list.sort((a, b) => (a.seq || 0) - (b.seq || 0) || (a.createdAt || 0) - (b.createdAt || 0) || a.id.localeCompare(b.id));
    plays = list;

    // 初回100行を自動確保
    if (currentGameId && plays.length === 0 && !isViewOnly) {
      store.ensureInitialPlays(currentGameId, 100);
      return;
    }

    if (selectedId && !plays.find((p) => p.id === selectedId)) selectedId = null;
    // 最初の行をデフォルト選択
    if (!selectedId && plays.length > 0 && !isViewOnly) {
      selectedId = plays[0].id;
    }

    renderTable();
    syncEditor();
    plays.forEach((p) => { prevUpdated[p.id] = p.updatedAt; });

    if (isViewOnly) {
      refreshHudlFilters();
      // 入力済みの最新プレーを後ろから探す
      const lastInputPlay = [...plays].reverse().find((p) => p.down || p.play || p.series || p.defSign);
      if (lastInputPlay) {
        const idx = plays.indexOf(lastInputPlay) + 1;
        const dd = lastInputPlay.down ? `${ORD[lastInputPlay.down] || lastInputPlay.down} & ${lastInputPlay.dist || '?'}` : '';
        const parts = [`#${idx}`, lastInputPlay.qtr && `Q${lastInputPlay.qtr}`, lastInputPlay.series && `S${lastInputPlay.series}`, dd, lastInputPlay.hash && `Hash ${lastInputPlay.hash}`];
        $('#viewBanner').textContent = '現在の最新状況: ' + (parts.filter(Boolean).join('   ') || '（未入力）');
      } else {
        $('#viewBanner').textContent = 'まだプレーがありません';
      }
    }

    updateStatus();
  }

  function handleNewSeries() {
    let p = selectedPlay();
    if (!p) {
      if (plays.length > 0) {
        p = plays[0];
        selectPlay(p.id, { scroll: true });
      } else {
        return;
      }
    }
    const curIdx = plays.indexOf(p);
    let maxSeries = 0;
    for (let i = 0; i < curIdx; i++) {
      const s = parseInt(plays[i].series, 10);
      if (!isNaN(s) && s > maxSeries) maxSeries = s;
    }
    const nextSeries = String(maxSeries + 1);
    const now = Date.now();
    const patch = {
      series: nextSeries,
      down: '1',
      dist: '10',
      updatedAt: now,
      updatedBy: me,
      updatedByClient: clientId,
    };
    store.updatePlay(currentGameId, p.id, patch);
    toast(`シリーズ S${nextSeries}（1st & 10）を設定しました`);
  }

  function exportCsv() {
    const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = [['#', ...CSV_COLS.map((c) => c[1])].map(q).join(',')];
    plays.forEach((p, i) => lines.push([i + 1, ...CSV_COLS.map((c) => p[c[0]])].map(q).join(',')));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv' }); // BOM付きでExcelの文字化け防止
    const a = document.createElement('a');
    const name = (games.find((g) => g.id === currentGameId)?.name || 'game').replace(/[\\/:*?"<>|]/g, '_');
    a.href = URL.createObjectURL(blob);
    a.download = name + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- ステータス ----------
  function updateStatus(text, cls) {
    const s = $('#status');
    if (text != null) {
      s.textContent = text;
      s.className = 'status ' + (cls || 'ok');
      return;
    }
    if (!navigator.onLine) {
      s.textContent = 'オフライン';
      s.className = 'status bad';
    }
  }

  // ---------- 画面切り替え ----------
  function renderGames() {
    const ul = $('#gameList');
    ul.innerHTML = '';
    if (!games.length) ul.appendChild(el('li', 'muted', 'まだ試合がありません'));
    games.forEach((g) => {
      const li = el('li', 'game-item');
      const a = el('a', 'game-link', g.name);
      a.href = '#/game/' + g.id;

      const right = el('div', 'row game-actions');
      const time = el('span', 'muted game-time', new Date(g.createdAt).toLocaleString('ja-JP'));

      const editBtn = el('button', 'ghost-btn', '✎ 名前変更');
      editBtn.type = 'button';
      editBtn.title = '試合名を変更';
      editBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const newName = prompt('新しい試合名を入力してください:', g.name);
        if (newName && newName.trim() && newName.trim() !== g.name) {
          store.updateGame(g.id, { name: newName.trim() });
        }
      };

      const delBtn = el('button', 'ghost-btn danger-text', '削除');
      delBtn.type = 'button';
      delBtn.title = 'この試合を削除';
      delBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (confirm(`試合「${g.name}」を削除しますか？\n（入力したプレーデータもすべて削除されます）`)) {
          store.deleteGame(g.id);
        }
      };

      right.append(time, editBtn, delBtn);
      li.append(a, right);
      ul.appendChild(li);
    });
    if (currentGameId) {
      const gname = games.find((g) => g.id === currentGameId)?.name || '';
      $('#gameTitle').textContent = gname + (isViewOnly ? '（閲覧用）' : '');
    }
  }

  function route() {
    const m = location.hash.match(/^#\/(game|view)\/(.+)$/);
    if (unsubPlays) { unsubPlays(); unsubPlays = null; }
    if (m) {
      isViewOnly = (m[1] === 'view');
      document.body.classList.toggle('view-only', isViewOnly);
      currentGameId = m[2].split('?')[0];
      selectedId = null; plays = []; prevUpdated = {}; lastNewestId = null;
      clearAllHudlFilters();
      $('#home').classList.add('hidden');
      $('#game').classList.remove('hidden');
      $('#backBtn').classList.remove('hidden');
      const gname = games.find((g) => g.id === currentGameId)?.name || '';
      $('#gameTitle').textContent = gname + (isViewOnly ? '（閲覧用）' : '');
      $('#viewBanner').classList.toggle('hidden', !isViewOnly);
      $('#filterBar').classList.toggle('hidden', !isViewOnly);
      unsubPlays = store.subscribePlays(currentGameId, onPlays);
    } else {
      isViewOnly = false;
      document.body.classList.remove('view-only');
      if (store.leaveGame) store.leaveGame();
      currentGameId = null;
      $('#game').classList.add('hidden');
      $('#home').classList.remove('hidden');
      $('#backBtn').classList.add('hidden');
      $('#gameTitle').textContent = '';
      $('#viewBanner').classList.add('hidden');
      $('#filterBar').classList.add('hidden');
    }
  }

  // ---------- Play図（お絵描き）機能 ----------
  let drawTargetPlayId = null;
  let drawPaths = [];
  let currentStroke = null;
  let currentColor = '#111827';
  let currentSize = 4;
  let isEraser = false;

  const canvas = $('#fieldCanvas');
  const ctx = canvas?.getContext('2d');

  function drawFieldTemplate(tCtx, w, h) {
    tCtx.fillStyle = '#ffffff';
    tCtx.fillRect(0, 0, w, h);

    // 比率計算（ユーザー提供の1024 x 635画像完全準拠）
    const scale = w / 1024;
    const leftX = w * (39 / 1024);
    const rightX = w * (984 / 1024);
    const topY = h * (2 / 635);
    const bottomY = h * (610 / 635);
    const boxHeight = bottomY - topY;

    // 外枠（黒の実線）
    tCtx.strokeStyle = '#000000';
    tCtx.lineWidth = Math.max(2, 2.5 * scale);
    tCtx.strokeRect(leftX, topY, rightX - leftX, boxHeight);

    // ヤードライン (15, 10, 5, 0)
    // 上枠は20yd相当（間隔 116.5px）
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
      // 水平線（外枠の左端から右端まで）
      tCtx.beginPath();
      tCtx.strokeStyle = '#000000';
      tCtx.lineWidth = (l.yard === 0) ? Math.max(2, 2.5 * scale) : Math.max(1.5, 1.8 * scale);
      tCtx.moveTo(leftX, l.y);
      tCtx.lineTo(rightX, l.y);
      tCtx.stroke();

      // 左の数字（枠の外側）
      tCtx.fillStyle = '#000000';
      tCtx.textAlign = 'center';
      tCtx.fillText(String(l.yard), leftX / 2, l.y);

      // 右の数字（枠の外側）
      tCtx.fillText(String(l.yard), rightX + (w - rightX) / 2, l.y);
    });

    // オフェンスライン（OL 5人）
    // LOS (0yd) の少し下
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

  function redrawCanvas() {
    if (!ctx) return;
    drawFieldTemplate(ctx, canvas.width, canvas.height);

    drawPaths.forEach((stroke) => {
      if (stroke.points.length < 1) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    });
  }

  function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function openDrawing(playId) {
    const p = plays.find((x) => x.id === playId);
    if (!p) return;
    drawTargetPlayId = playId;
    drawPaths = [];
    isEraser = false;
    $('#drawEraserBtn').classList.remove('on');

    const idx = plays.indexOf(p) + 1;
    const dd = p.down ? `${ORD[p.down] || p.down} & ${p.dist || '?'}` : '';
    $('#drawModalTitle').textContent = `Play図作成: #${idx} ${p.qtr ? 'Q' + p.qtr : ''} ${dd}`;
    $('#drawModalSubtitle').textContent = `${p.formation || '体型未設定'} / ${p.play || 'Play未設定'} / ${p.defSign || 'Def未設定'}`;

    if (p.drawing) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = p.drawing;
    } else {
      redrawCanvas();
    }

    $('#drawDialog').showModal();
  }

  function openViewDraw(p) {
    if (!p || !p.drawing) return;
    const idx = plays.indexOf(p) + 1;
    const dd = p.down ? `${ORD[p.down] || p.down} & ${p.dist || '?'}` : '';
    $('#viewDrawTitle').textContent = `Play図: #${idx} ${p.qtr ? 'Q' + p.qtr : ''} ${dd}`;
    $('#viewDrawSubtitle').textContent = `${p.formation || '体型未設定'} / ${p.play || 'Play未設定'} / ${p.defSign || 'Def未設定'}`;
    $('#viewDrawImg').src = p.drawing;

    $('#editFromViewDrawBtn').classList.toggle('hidden', isViewOnly);
    $('#editFromViewDrawBtn').onclick = () => {
      $('#viewDrawDialog').close();
      openDrawing(p.id);
    };

    $('#viewDrawDialog').showModal();
  }

  function askName() {
    const d = $('#nameDialog');
    $('#nameInput').value = me;
    d.showModal();
    d.addEventListener('close', () => {
      me = $('#nameInput').value.trim() || me || 'ゲスト';
      localStorage.setItem('fdl_name', me);
      $('#userBtn').textContent = '👤 ' + me + (role !== 'all' ? `（${ROLES[role].label}）` : '');
    }, { once: true });
  }

  // ---------- 起動 ----------
  async function init() {
    try {
      store = await window.createStore();
    } catch (e) {
      alert('Firebase の読み込みに失敗しました。ネット接続を確認してください。\n' + e.message);
      return;
    }
    // 担当切り替えボタン
    Object.entries(ROLES).forEach(([key, r]) => {
      const b = el('button', 'role-btn', r.label);
      b.type = 'button';
      b.dataset.role = key;
      b.onclick = () => setRole(key);
      $('#roleBar').appendChild(b);
    });
    applyRole();

    $('#userBtn').onclick = askName;
    if (!me) askName();

    // 試合中ヘッダーの試合名クリックで名前変更
    $('#gameTitle').onclick = () => {
      if (!currentGameId || isViewOnly) return;
      const g = games.find((x) => x.id === currentGameId);
      if (!g) return;
      const newName = prompt('試合名を変更:', g.name);
      if (newName && newName.trim() && newName.trim() !== g.name) {
        store.updateGame(g.id, { name: newName.trim() });
      }
    };

    $('#newGameForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('#newGameName').value.trim();
      if (!name) return;
      const id = store.createGame({ name, createdBy: me });
      $('#newGameName').value = '';
      location.hash = '#/game/' + id;
    });
    $('#nextPlayBtn').onclick = () => selectNextRow();
    $('#newSeriesBtn').onclick = handleNewSeries;
    $('#deleteBtn').onclick = () => {
      const p = selectedPlay();
      if (!p) return;
      const idx = plays.indexOf(p) + 1;
      if (confirm(`#${idx} のプレー内容をクリアしますか？`)) {
        store.updatePlay(currentGameId, p.id, {
          qtr: '', series: '', hash: '', down: '', dist: '',
          personnel: '', formation: '', play: '', defSign: '', drawing: null,
          updatedAt: Date.now(), updatedBy: me, updatedByClient: clientId,
        });
        toast(`#${idx} の内容をクリアしました`);
      }
    };
    $('#csvBtn').onclick = exportCsv;
    let shareMode = 'edit';
    function updateShareDialog() {
      const base = location.href.split('#')[0];
      const targetHash = (shareMode === 'view') ? `#/view/${currentGameId}` : `#/game/${currentGameId}`;
      const url = base + targetHash;
      $('#shareUrlInput').value = url;
      $('#qrImg').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
      $('#shareModeEdit').classList.toggle('on', shareMode === 'edit');
      $('#shareModeView').classList.toggle('on', shareMode === 'view');
      $('#shareDesc').textContent = (shareMode === 'view')
        ? '閲覧用リンク：入力欄が隠れ、見るだけ専用になります（誤タップの心配なし）'
        : '編集用リンク：3人で分担して同時入力・編集ができます';
    }

    $('#shareModeEdit').onclick = () => { shareMode = 'edit'; updateShareDialog(); };
    $('#shareModeView').onclick = () => { shareMode = 'view'; updateShareDialog(); };

    $('#shareBtn').onclick = () => {
      shareMode = isViewOnly ? 'view' : 'edit';
      updateShareDialog();
      $('#shareDialog').showModal();
    };
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
    $('#openDrawBtn').onclick = () => {
      const p = selectedPlay();
      if (!p) {
        toast('先にプレーを選択してください');
        return;
      }
      openDrawing(p.id);
    };

    // お絵描きキャンバスのイベント
    if (canvas && ctx) {
      let isDrawing = false;

      canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        isDrawing = true;
        canvas.setPointerCapture(e.pointerId);
        const pos = getCanvasPos(e);
        currentStroke = {
          color: isEraser ? '#ffffff' : currentColor,
          size: isEraser ? currentSize * 3.5 : currentSize,
          points: [pos]
        };
        drawPaths.push(currentStroke);
      });

      canvas.addEventListener('pointermove', (e) => {
        if (!isDrawing || !currentStroke) return;
        e.preventDefault();
        const pos = getCanvasPos(e);
        currentStroke.points.push(pos);

        ctx.beginPath();
        ctx.strokeStyle = currentStroke.color;
        ctx.lineWidth = currentStroke.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const pts = currentStroke.points;
        const prev = pts[pts.length - 2];
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      });

      const endDrawing = (e) => {
        if (!isDrawing) return;
        isDrawing = false;
        currentStroke = null;
        try { canvas.releasePointerCapture(e.pointerId); } catch {}
      };

      canvas.addEventListener('pointerup', endDrawing);
      canvas.addEventListener('pointercancel', endDrawing);
    }

    // お絵描きツールバー
    document.querySelectorAll('.color-btn').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('.color-btn').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        currentColor = b.dataset.color;
        isEraser = false;
        $('#drawEraserBtn').classList.remove('on');
      };
    });

    document.querySelectorAll('.size-btn').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('.size-btn').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        currentSize = parseInt(b.dataset.size, 10) || 4;
      };
    });

    $('#drawEraserBtn').onclick = () => {
      isEraser = !isEraser;
      $('#drawEraserBtn').classList.toggle('on', isEraser);
    };

    $('#drawUndoBtn').onclick = () => {
      if (drawPaths.length > 0) {
        drawPaths.pop();
        redrawCanvas();
      }
    };

    $('#drawClearBtn').onclick = () => {
      if (confirm('描いた内容をすべて消去しますか？')) {
        drawPaths = [];
        redrawCanvas();
      }
    };

    $('#saveDrawBtn').onclick = () => {
      if (!currentGameId || !drawTargetPlayId) return;
      try {
        const dataUrl = canvas.toDataURL('image/webp', 0.85);
        store.updatePlay(currentGameId, drawTargetPlayId, {
          drawing: dataUrl,
          updatedBy: me,
          updatedByClient: clientId,
          updatedAt: Date.now()
        });
        toast('Play図を保存しました！');
        $('#drawDialog').close();
      } catch (e) {
        alert('保存エラー: ' + e.message);
      }
    };

    $('#cancelDrawBtn').onclick = () => {
      $('#drawDialog').close();
    };

    $('#closeViewDrawBtn').onclick = () => {
      $('#viewDrawDialog').close();
    };

    // 閲覧用画面の絞り込みイベント（Hudl風）
    $('#clearFilterBtn').onclick = clearAllHudlFilters;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.hudl-filter-item')) {
        document.querySelectorAll('.hudl-dropdown').forEach((d) => d.classList.add('hidden'));
      }
    });

    window.addEventListener('online', () => updateStatus());
    window.addEventListener('offline', () => updateStatus());
    window.addEventListener('hashchange', route);

    if (store.onStatusChange) {
      store.onStatusChange((text, cls) => updateStatus(text, cls));
    }

    store.subscribeGames((list) => { games = list; renderGames(); });
    updateStatus();
    route();
  }

  init();
})();
