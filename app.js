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

  // 事前登録用の隊形マスタ（未入力状態でもサジェスト候補に表示）
  const FORMATION_PRESETS = [
    'Gun Ace',
    'Gun Ace Slot',
    'Ace',
    'Ace Slot',
    'Gun Trio',
    'Gun Trio Slot',
    'Trio',
    'Trio Slot',
    'Gun Bunch',
    'Gun Bunch Open',
    'Gun Far Bunch Open',
    'Bunch',
    'Bunch Open',
    'Far Bunch Open',
    'Gun Spread',
    'Spread',
    'Gun Spread Wing',
    'Spread Wing',
    'Gun Spread Slot',
    'Spread Slot',
    'Gun Tray',
    'Tray',
    'Gun Tray Open',
    'Tray Open',
    'Gun Twin Terrier',
    'Gun Twin Warrior',
    'Twin Terrier',
    'Twin Warrior',
    'Gun Flex Terrier',
    'Gun Flex Warrior',
    'Flex Terrier',
    'Flex Warrior',
    'Gun Trips',
    'Gun Trips Slot',
    'Trips',
    'Trips Slot',
  ];

  // ---------- 入力項目の定義（項目を増やすときはここに追加） ----------
  const FIELDS = [
    { key: 'qtr', label: 'Quarter（1〜4 / OT）', type: 'allowed', allowed: ['1', '2', '3', '4', 'OT'] },
    { key: 'series', label: 'Series', type: 'number', min: 1, max: 99 },
    { key: 'hash', label: 'Hash', type: 'buttons', options: ['L', 'M', 'R'] },
    { key: 'down', key2: 'dist', label: 'Down & Distance', type: 'downdist' },
    { key: 'personnel', label: 'Personnel', type: 'text', inputMode: 'numeric' },
    { key: 'formation', label: 'OFF Formation', type: 'text', capitalize: true, presets: FORMATION_PRESETS, presetsOnly: true },
    // upperWords: どう打っても全部大文字にする単語
    { key: 'play', label: 'Play', type: 'text', capitalize: true, upperWords: ['RPO', 'PAP'] },
    { key: 'playType', label: 'Run / Pass', type: 'runpass' },
    { key: 'defSign', label: 'Def Sign', type: 'text', capitalize: true },
  ];
  const CSV_COLS = [
    ['qtr', 'Quarter'], ['series', 'Series'], ['hash', 'Hash'],
    ['down', 'Down'], ['dist', 'Distance'], ['personnel', 'Personnel'],
    ['formation', 'OFF Formation'], ['play', 'Play'], ['playType', 'Type'], ['defSign', 'Def Sign'],
  ];

  // ---------- 担当（役割）の定義 ----------
  // canAdd: 「＋ 次のプレー」で行を追加できる担当（同時に押して行が重複するのを防ぐ）
  const ROLES = {
    situation: { label: '状況', keys: ['qtr', 'series', 'hash', 'down', 'dist'], canAdd: true },
    offense: { label: 'オフェンス', keys: ['personnel', 'formation', 'play', 'playType'], canAdd: false },
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

  // プレー名からのRun/Pass先行判定（手動変更・誤認識防止用の下書きアシスト）
  function guessPlayType(name) {
    if (!name) return '';
    const upper = name.toUpperCase().trim();
    // PASS系キーワード（※"SIDE"の単体判定により"Inside"/"Outside"が誤判定されるのを単語境界で防止）
    const passKws = ['STEP', 'PAP', 'BOOTS', 'BOOT', 'NAKED', 'SCREEN', 'BUBBLE', 'SIDELINE', 'DASH', 'ROLL', 'SPRINT', 'HAIL MARY', 'PASS', 'CROSS', 'SLANT', 'HITCH', 'MESH', 'VERTICAL', 'FLOOD', 'STICK', 'STRIKE', 'CORNER', 'POST', 'FADE', 'SEAM', 'DIG'];
    const isPass = passKws.some((k) => upper.includes(k)) || /\bSIDE\b/.test(upper);
    if (isPass) return 'Pass';
    // RUN系キーワード
    const runKws = ['ZONE', 'IZ', 'MZ', 'OZ', 'POWER', 'COUNTER', 'TRAP', 'DUO', 'DIVE', 'WEDGE', 'TOSS', 'SWEEP', 'DRAW', 'OPTION', 'SNEAK', 'LOG', 'DART', 'BELLY', 'LEAD', 'ISO', 'PIN'];
    if (runKws.some((k) => upper.includes(k))) return 'Run';
    return '';
  }

  function save(key, value, pid = selectedId) {
    if (value === null) return; // 入力値が不正
    if (!currentGameId || !pid) { toast('編集する行を選択してください'); return; }
    const p = plays.find((x) => x.id === pid);
    if (p && (p[key] ?? '') === value && key !== 'play') return;

    // 手動でRun/Passボタンが押された場合（手動選択フラグを立てる）
    if (key === 'playType') {
      store.updatePlay(currentGameId, pid, {
        playType: value,
        playTypeManual: Boolean(value),
        updatedBy: me,
        updatedByClient: clientId,
        updatedAt: Date.now(),
      });
      return;
    }

    // Play名が入力・変更された時：
    // 手動ボタンで固定していない限り、入力途中の変化（"Iz" -> "Iz PAP"等）に合わせてリアルタイム再判定
    if (key === 'play') {
      if (!p?.playTypeManual) {
        const guessed = guessPlayType(value);
        if (guessed) {
          store.updatePlay(currentGameId, pid, {
            [key]: value,
            playType: guessed,
            updatedBy: me,
            updatedByClient: clientId,
            updatedAt: Date.now(),
          });
          controls['playType']?.set(guessed);
          return;
        } else if (!value) {
          store.updatePlay(currentGameId, pid, {
            [key]: value,
            playType: '',
            updatedBy: me,
            updatedByClient: clientId,
            updatedAt: Date.now(),
          });
          controls['playType']?.set('');
          return;
        }
      }
    }

    store.updatePlay(currentGameId, pid, {
      [key]: value, updatedBy: me, updatedByClient: clientId, updatedAt: Date.now(),
    });
  }

  function focusNextInputOrRow(currentKey) {
    // ボタン系項目（runpassやbuttons）はキーボードEnter移動の対象外（手動タップ用）にし、テキスト入力項目のみを順送り
    const activeKeys = FIELDS
      .filter((f) => roleHas(f.key) && f.type !== 'runpass' && f.type !== 'buttons')
      .map((f) => f.key);
    const curIdx = activeKeys.indexOf(currentKey);
    if (curIdx === -1 || curIdx === activeKeys.length - 1) {
      // 担当内の最後の入力項目（オフェンスならPlay）なら次の行へ進み、最初の入力項目にフォーカス
      const firstKey = activeKeys[0] || 'qtr';
      selectNextRow({ focusKey: firstKey });
    } else {
      // 次の入力項目へ移動
      const nextKey = activeKeys[curIdx + 1];
      controls[nextKey]?.focus?.();
    }
  }

  let lastRowJumpTime = 0;
  function selectNextRow({ focusKey, scroll = true } = {}) {
    const now = Date.now();
    if (now - lastRowJumpTime < 200) return; // 連続押下や重複イベントによる行スキップを完全に防止
    lastRowJumpTime = now;

    if (!plays.length) return;
    const curIdx = plays.findIndex((p) => p.id === selectedId);
    let nextIdx = curIdx + 1;
    if (curIdx === -1) nextIdx = 0;
    if (nextIdx >= plays.length) return; // 枠数の上限（100行）に達したら勝手に拡張しない

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
  function bindInput(input, key, getValue, { handleEnter = true } = {}) {
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
    if (handleEnter) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          clearTimeout(timer);
          save(key, getValue(), pid || selectedId);
          e.preventDefault();
          focusNextInputOrRow(key);
        }
      });
    }
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

  function makeButtons(container, options, onClick, onEnter) {
    const box = el('div', 'btns');
    const btns = options.map((o) => {
      const b = el('button', 'opt', o.label ?? o);
      b.type = 'button';
      b.dataset.v = o.value ?? o;
      b.addEventListener('click', () => onClick(b.dataset.v));
      b.addEventListener('keydown', (e) => {
        if (e.isComposing) return;
        const keyUpper = e.key.toUpperCase();
        // L, M, R などのキーを直接押した時も選択して即座にDownへ移動
        if (options.some((o) => (o.value ?? o).toUpperCase() === keyUpper)) {
          e.preventDefault();
          e.stopPropagation();
          onClick(keyUpper);
          if (onEnter) onEnter();
          else controls['down']?.focus?.();
          return;
        }
        // Enterキーを押した時にDownへ移動
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          if (onEnter) onEnter();
          else controls['down']?.focus?.();
        }
      });
      box.appendChild(b);
      return b;
    });
    container.appendChild(box);
    return (v) => btns.forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  }

  // サジェスト表示用：文字列の一致部分を <mark> でハイライトして要素に挿入
  function renderMatchText(container, text, query) {
    container.innerHTML = '';
    const q = (query || '').trim().toLowerCase();
    if (!q) {
      container.textContent = text;
      return;
    }
    const lowerText = text.toLowerCase();
    let startIdx = 0;
    let matchIdx = lowerText.indexOf(q, startIdx);

    if (matchIdx === -1) {
      container.textContent = text;
      return;
    }

    while (matchIdx !== -1) {
      if (matchIdx > startIdx) {
        container.appendChild(document.createTextNode(text.slice(startIdx, matchIdx)));
      }
      const mark = document.createElement('mark');
      mark.textContent = text.slice(matchIdx, matchIdx + q.length);
      container.appendChild(mark);
      startIdx = matchIdx + q.length;
      matchIdx = lowerText.indexOf(q, startIdx);
    }
    if (startIdx < text.length) {
      container.appendChild(document.createTextNode(text.slice(startIdx)));
    }
  }

  function makeControl(f, body) {
    switch (f.type) {
      case 'buttons': {
        const setOn = makeButtons(body, f.options, (v) => {
          const cur = selectedPlay()?.[f.key] ?? '';
          save(f.key, cur === v ? '' : v); // 同じボタンをもう一度押すと解除
        }, () => {
          controls['down']?.focus?.();
        });
        return {
          set: (v) => setOn(v ?? ''),
          focus: () => {
            const cur = selectedPlay()?.[f.key] ?? '';
            const btn = body.querySelector(`button[data-v="${cur}"]`) || body.querySelector('button');
            btn?.focus();
          }
        };
      }
      case 'runpass': {
        const box = el('div', 'runpass-box');
        const runBtn = el('button', 'runpass-btn btn-run', 'Run');
        runBtn.type = 'button';
        runBtn.tabIndex = -1;
        const passBtn = el('button', 'runpass-btn btn-pass', 'Pass');
        passBtn.type = 'button';
        passBtn.tabIndex = -1;

        const updateActive = (val) => {
          runBtn.classList.toggle('on', val === 'Run');
          passBtn.classList.toggle('on', val === 'Pass');
        };

        runBtn.onclick = () => {
          const cur = selectedPlay()?.[f.key] ?? '';
          const next = cur === 'Run' ? '' : 'Run';
          updateActive(next);
          save(f.key, next);
        };

        passBtn.onclick = () => {
          const cur = selectedPlay()?.[f.key] ?? '';
          const next = cur === 'Pass' ? '' : 'Pass';
          updateActive(next);
          save(f.key, next);
        };

        box.appendChild(runBtn);
        box.appendChild(passBtn);
        body.appendChild(box);

        return {
          set: (v) => updateActive(v ?? ''),
        };
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
        bindInput(down, f.key, getDown, { handleEnter: false });
        bindInput(dist, f.key2, () => dist.value.trim().toUpperCase(), { handleEnter: false });
        down.addEventListener('input', () => {
          if (/^[1-4]$/.test(down.value.trim())) { dist.focus(); dist.select(); }
        });
        down.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            save(f.key, getDown(), selectedId);
            dist.focus();
            dist.select();
          }
        });
        dist.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            save(f.key2, dist.value.trim().toUpperCase(), selectedId);
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
        const wrap = el('div', 'suggest-wrap');
        const input = el('input', 'text');
        input.autocomplete = 'off';
        if (f.inputMode) input.inputMode = f.inputMode;
        input.placeholder = f.label + ' を入力';
        const list = el('ul', 'suggest-list hidden');
        wrap.append(input, list);
        body.appendChild(wrap);

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

        let cachedOptions = [];
        let currentMatches = [];
        let activeIndex = -1;

        function updateCachedOptions() {
          if (f.presetsOnly && Array.isArray(f.presets)) {
            // 手打ちによる打ち間違いを学習させず、登録マスタ（36種）のみを元の順序で候補にする
            cachedOptions = f.presets.map((val) => ({ value: clean(val), count: 0 }));
            return;
          }
          const freq = {};
          if (Array.isArray(f.presets)) {
            f.presets.forEach((val) => {
              const cleaned = clean(val);
              if (cleaned) freq[cleaned] = 0;
            });
          }
          plays.forEach((p) => {
            const v = (p[f.key] || '').trim();
            if (v) freq[v] = (freq[v] || 0) + 1;
          });
          cachedOptions = Object.keys(freq)
            .sort((a, b) => (freq[b] - freq[a]) || a.localeCompare(b))
            .map((v) => ({ value: v, count: freq[v] }));
        }

        function closeList() {
          list.classList.add('hidden');
          list.innerHTML = '';
          currentMatches = [];
          activeIndex = -1;
        }

        function selectOption(val) {
          const cleaned = clean(val);
          input.value = cleaned;
          save(f.key, cleaned, selectedId);
          closeList();
          focusNextInputOrRow(f.key);
        }

        function updateHighlight() {
          const items = list.querySelectorAll('.suggest-item');
          items.forEach((it, idx) => {
            it.classList.toggle('active', idx === activeIndex);
            if (idx === activeIndex) {
              it.scrollIntoView({ block: 'nearest' });
            }
          });
        }

        function renderList(query) {
          const q = (query || '').trim().toLowerCase();
          // 部分一致（substring match）：入力文字列がどこかに含まれるものをすべて抽出
          currentMatches = q
            ? cachedOptions.filter((item) => item.value.toLowerCase().includes(q))
            : cachedOptions;

          if (currentMatches.length === 0) {
            closeList();
            return;
          }

          list.innerHTML = '';
          activeIndex = -1;
          // 上位25件を表示
          currentMatches.slice(0, 25).forEach((item) => {
            const li = el('li', 'suggest-item');
            const textSpan = el('span', 'suggest-text');
            renderMatchText(textSpan, item.value, q);
            li.appendChild(textSpan);
            if (item.count > 1 && !f.presetsOnly) {
              li.appendChild(el('span', 'suggest-count', `${item.count}回`));
            }
            li.addEventListener('mousedown', (e) => {
              e.preventDefault(); // inputのblurを防いで確実に選択
              selectOption(item.value);
            });
            list.appendChild(li);
          });
          list.classList.remove('hidden');
        }

        input.addEventListener('focus', () => {
          updateCachedOptions();
          renderList(input.value);
        });

        input.addEventListener('input', () => {
          renderList(input.value);
        });

        input.addEventListener('blur', () => {
          setTimeout(closeList, 150);
        });

        input.addEventListener('keydown', (e) => {
          if (e.isComposing) return;
          if (e.key === 'ArrowDown') {
            if (list.classList.contains('hidden')) {
              renderList(input.value);
            } else if (currentMatches.length > 0) {
              const maxIdx = Math.min(currentMatches.length, 25);
              activeIndex = (activeIndex + 1) % maxIdx;
              updateHighlight();
            }
            e.preventDefault();
          } else if (e.key === 'ArrowUp') {
            if (!list.classList.contains('hidden') && currentMatches.length > 0) {
              const maxIdx = Math.min(currentMatches.length, 25);
              activeIndex = (activeIndex - 1 + maxIdx) % maxIdx;
              updateHighlight();
            }
            e.preventDefault();
          } else if (e.key === 'Escape') {
            closeList();
          } else if (e.key === 'Enter') {
            if (!list.classList.contains('hidden') && activeIndex >= 0 && currentMatches[activeIndex]) {
              e.preventDefault();
              e.stopImmediatePropagation();
              selectOption(currentMatches[activeIndex].value);
              return;
            }
            closeList();
          }
        });

        bindInput(input, f.key, () => clean(input.value));

        return {
          set: (v) => { if (document.activeElement !== input) input.value = v ?? ''; },
          focus: () => { input.focus(); input.select(); },
          refreshChoices: () => {
            updateCachedOptions();
            if (document.activeElement === input) {
              renderList(input.value);
            }
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
    if (p && p.play && !p.playTypeManual) {
      const guessed = guessPlayType(p.play);
      if (guessed && p.playType !== guessed) {
        save('play', p.play, p.id);
      }
    }
    for (const f of FIELDS) {
      const c = controls[f.key];
      if (!c) continue;
      c.set(p ? p[f.key] : '', p);
      if (c.refreshChoices) c.refreshChoices();
    }
    if ($('#openDrawBtn')) {
      $('#openDrawBtn').textContent = p?.drawing ? '✎ 作図を編集' : '🎨 Play図を描く';
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
    { key: 'playType', label: 'TYPE (Run/Pass)' },
    { key: 'down', label: 'DOWN', format: (v) => ORD[v] || v },
    { key: 'dist', label: 'DISTANCE' },
    { key: 'hash', label: 'HASH' },
  ];

  const activeFilters = {
    personnel: new Set(),
    formation: new Set(),
    play: new Set(),
    playType: new Set(),
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

      // Type セル (Run / Pass)
      const typeTd = el('td', 'play-type-cell');
      if (p.playType === 'Run') {
        typeTd.appendChild(el('span', 'badge-run', 'Run'));
      } else if (p.playType === 'Pass') {
        typeTd.appendChild(el('span', 'badge-pass', 'Pass'));
      }
      if (role !== 'all' && roleHas('playType')) typeTd.className = 'mine';
      tr.appendChild(typeTd);

      // Play図セル
      const drawTd = el('td', 'play-draw-cell');
      if (p.drawing) {
        if (isViewOnly) {
          const btn = el('button', 'draw-btn-has', '🎨 見る');
          btn.type = 'button';
          btn.onclick = (e) => {
            e.stopPropagation();
            openViewDraw(p);
          };
          drawTd.appendChild(btn);
        } else {
          const btn = el('button', 'draw-btn-has', '✎ 作図を編集');
          btn.type = 'button';
          btn.onclick = (e) => {
            e.stopPropagation();
            openDrawing(p.id);
          };
          drawTd.appendChild(btn);
        }
      } else {
        const btn = el('button', 'draw-btn-empty', isViewOnly ? '＋ ボード' : '＋ 作図');
        btn.type = 'button';
        btn.onclick = (e) => {
          e.stopPropagation();
          if (isViewOnly) {
            openViewDraw(p);
          } else {
            openDrawing(p.id);
          }
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

  // ---------- 傾向分析 (Tendency Analysis) ----------
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
      // 4th Downは3yd以下（ショート勝負）のみを集計
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

  function filterBySituation(sit) {
    switchTab('playList');
    if (!isViewOnly) return;
    let targetDown = '';
    if (sit.startsWith('1st')) targetDown = '1';
    else if (sit.startsWith('2nd')) targetDown = '2';
    else if (sit.startsWith('3rd')) targetDown = '3';
    else if (sit.startsWith('4th')) targetDown = '4';

    if (targetDown) {
      activeFilters.down.clear();
      activeFilters.down.add(targetDown);
      refreshHudlFilters();
      renderTable();
    }
  }

  function escapeHTML(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderPersonnelHierarchy(table, validPlays) {
    // 既存のtbodyを全削除
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

    // Personnelのソート（回数が多い順、同数なら標準順）
    persKeys.sort((a, b) => persStats[b].total - persStats[a].total);

    // メモ欄（TE BP, Other）の読み込み
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
      if (total === 0 || count < 2) return '';
      const pct = (count / total) * 100;
      if (pct >= 70) {
        if (type === 'pass') return 'bg-pass-high';
        if (type === 'run') return 'bg-run-high';
      }
      return '';
    };

    const getPctText = (count, total) => {
      if (total === 0) return '<span style="color:#94a3b8;">0%</span>';
      const pct = Math.round((count / total) * 100);
      if (pct >= 70 && count >= 2) {
        return `<span style="font-weight: 800; color: #1e293b;">${pct}%</span>`;
      }
      return `${pct}%`;
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
      // 各Formation 2行（Pass & Run）+ 全体合計 2行
      const personnelRowspan = 2 + (forms.length * 2);

      const tbody = document.createElement('tbody');
      tbody.className = 'personnel-tbody';

      // 1行目: Personnel Badge, Notes, 合計(2行結合), Pass行
      const tr1 = document.createElement('tr');
      tr1.style.borderTop = '2.5px solid #333333';

      const tdPer = document.createElement('td');
      tdPer.rowSpan = personnelRowspan;
      tdPer.className = 'personnel-cell';
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

      const tdSummaryForm = document.createElement('td');
      tdSummaryForm.rowSpan = 2;
      tdSummaryForm.className = 'pers-summary-cell';
      tdSummaryForm.style.fontWeight = '700';
      tdSummaryForm.style.textAlign = 'center';
      tdSummaryForm.innerHTML = `全体合計<br><span class="stat-count">(${data.total}/${totalPersPlays})</span>`;

      const tdSummaryRatio = document.createElement('td');
      tdSummaryRatio.rowSpan = 2;
      tdSummaryRatio.className = 'pers-summary-cell';
      tdSummaryRatio.style.textAlign = 'center';
      tdSummaryRatio.style.fontWeight = '700';
      tdSummaryRatio.innerHTML = `${Math.round((data.total / totalPersPlays) * 100)}%`;

      const tdPassType = el('td', `type-cell type-pass ${getBgClass('pass', data.categories.pass, data.total)}`, 'Pass');
      const tdPassPct = document.createElement('td');
      tdPassPct.className = `percent-cell ${getBgClass('pass', data.categories.pass, data.total)}`;
      tdPassPct.innerHTML = getPctText(data.categories.pass, data.total);
      const tdPassPlays = el('td', `plays-cell ${getBgClass('pass', data.categories.pass, data.total)}`, '');

      tr1.append(tdPer, tdTebp, tdOther, tdSummaryForm, tdSummaryRatio, tdPassType, tdPassPct, tdPassPlays);
      tbody.appendChild(tr1);

      // 2行目: Run全体
      const tr2 = document.createElement('tr');
      tr2.className = 'pers-summary-end';
      const tdRunType = el('td', `type-cell type-run ${getBgClass('run', data.categories.run, data.total)}`, 'Run');
      const tdRunPct = document.createElement('td');
      tdRunPct.className = `percent-cell ${getBgClass('run', data.categories.run, data.total)}`;
      tdRunPct.innerHTML = getPctText(data.categories.run, data.total);
      const tdRunPlays = el('td', `plays-cell ${getBgClass('run', data.categories.run, data.total)}`, '');
      tr2.append(tdRunType, tdRunPct, tdRunPlays);
      tbody.appendChild(tr2);

      // 各Formationのブロック
      forms.forEach((form, fIdx) => {
        const fData = data.formations[form];
        const fPct = Math.round((fData.total / data.total) * 100);
        const isLastForm = fIdx === forms.length - 1;

        // Formation Pass行
        const trForm1 = document.createElement('tr');
        const tdFormName = document.createElement('td');
        tdFormName.rowSpan = 2;
        tdFormName.className = 'formation-name';
        tdFormName.textContent = form;

        const tdFormPct = document.createElement('td');
        tdFormPct.rowSpan = 2;
        tdFormPct.className = 'formation-percent';
        tdFormPct.innerHTML = `<span style="${fPct >= 70 ? 'font-weight:800; color:#1e293b;' : ''}">${fPct}%</span><br><span class="stat-count">(${fData.total}/${data.total})</span>`;

        const tdFPassType = el('td', `type-cell type-pass ${getBgClass('pass', fData.categories.pass.count, fData.total)}`, 'Pass');
        const tdFPassPct = document.createElement('td');
        tdFPassPct.className = `percent-cell ${getBgClass('pass', fData.categories.pass.count, fData.total)}`;
        tdFPassPct.innerHTML = getPctText(fData.categories.pass.count, fData.total);
        const tdFPassPlays = document.createElement('td');
        tdFPassPlays.className = `plays-cell ${getBgClass('pass', fData.categories.pass.count, fData.total)}`;
        tdFPassPlays.innerHTML = formatPlays(fData.categories.pass.plays);

        trForm1.append(tdFormName, tdFormPct, tdFPassType, tdFPassPct, tdFPassPlays);
        tbody.appendChild(trForm1);

        // Formation Run行
        const trForm2 = document.createElement('tr');
        if (isLastForm) trForm2.className = 'border-bottom-thick';
        const tdFRunType = el('td', `type-cell type-run ${getBgClass('run', fData.categories.run.count, fData.total)}`, 'Run');
        const tdFRunPct = document.createElement('td');
        tdFRunPct.className = `percent-cell ${getBgClass('run', fData.categories.run.count, fData.total)}`;
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
      const order = ['11', '10', '12', '12+OL', '21', '22', '13'];
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
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
      if (isTotal) tr.className = 'total-row';

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

    // 有効なプレー
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

    // 表1: Down & Distance 傾向分析 (dd.htmlスタイル)
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
      if (isTotal) tr.className = 'total-row';

      const tdSit = el('td', 'td-situation', label);
      const tdTotal = el('td', '', String(stat.total));
      tr.append(tdSit, tdTotal);

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

      tr.append(
        formatCell(stat.run, runPct),
        formatCell(stat.pass, passPct)
      );

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
      tr.appendChild(tdBar);

      runPassTbody.appendChild(tr);
    };

    SITUATIONS.forEach((s) => renderRunPassRow(s, sitStats[s]));
    renderRunPassRow('全プレー合計', totalStat, true);

    // 表2: Personnel 階層表 (personnel.html スタイル)
    if (persHierarchyTable) {
      renderPersonnelHierarchy(persHierarchyTable, validPlays);
    }

    // 表3: Personnel 状況別マトリクス
    if (persHeadRow && persTbody) {
      renderPersonnelMatrix(persHeadRow, persTbody, allPersSet, sitStats, totalStat);
    }
  }

  function onPlays(list) {
    list.sort((a, b) => (a.seq || 0) - (b.seq || 0) || (a.createdAt || 0) - (b.createdAt || 0) || a.id.localeCompare(b.id));

    // 100枠制限：100枠で十分なため、101枠目以降の無駄な空行は非表示にしてスッキリ100枠に収める
    if (list.length > 100) {
      const hasData = (p) => p.qtr || p.series || p.hash || p.down || p.dist || p.personnel || p.formation || p.play || p.playType || p.defSign || p.drawing || p.drawingLayer;
      list = list.filter((p, idx) => idx < 100 || hasData(p));
    }
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
    if (activeTab === 'tendency') {
      renderTendency();
    }
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
    if (typeof text === 'object' && text !== null) {
      cls = text.cls;
      text = text.text;
    }
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
  let drawBaseImg = null;
  let savedStrokeImg = null;

  // 手書き専用の透明レイヤー（背景と手書きを完全分離し、本物の消しゴムを実現）
  const paintCanvas = document.createElement('canvas');
  paintCanvas.width = 1024;
  paintCanvas.height = 635;
  const pCtx = paintCanvas.getContext('2d');

  // 白背景の描画
  function drawFieldBg(tCtx, w, h) {
    tCtx.fillStyle = '#ffffff';
    tCtx.fillRect(0, 0, w, h);
  }

  // フィールドの枠線・ヤード線・OL（手書き線の上から常に保護描画）
  function drawFieldLines(tCtx, w, h) {
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

  function drawFieldTemplate(tCtx, w, h) {
    drawFieldBg(tCtx, w, h);
    drawFieldLines(tCtx, w, h);
  }

  function redrawCanvas() {
    if (!ctx || !pCtx) return;
    // 1. メインキャンバスの背景を白で塗りつぶす
    drawFieldBg(ctx, canvas.width, canvas.height);

    // 2. 透明手書きレイヤーをクリア
    pCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);

    // 3. 前回保存された手書き線（過去の画像または手書きレイヤー）があれば下地として描画
    if (savedStrokeImg) {
      pCtx.drawImage(savedStrokeImg, 0, 0, paintCanvas.width, paintCanvas.height);
    }

    // 4. 今回のセッションで描いたストロークを透明レイヤーに描画（消しゴムは前回の線ごと消去！）
    drawPaths.forEach((stroke) => {
      if (stroke.points.length < 1) return;
      pCtx.save();
      pCtx.beginPath();
      if (stroke.isEraser) {
        pCtx.globalCompositeOperation = 'destination-out';
        if (stroke.points.length === 1) {
          pCtx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
          pCtx.fill();
        } else {
          pCtx.lineWidth = stroke.size;
          pCtx.lineCap = 'round';
          pCtx.lineJoin = 'round';
          pCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
          for (let i = 1; i < stroke.points.length; i++) {
            pCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
          }
          pCtx.stroke();
        }
      } else {
        pCtx.globalCompositeOperation = 'source-over';
        if (stroke.points.length === 1) {
          pCtx.fillStyle = stroke.color;
          pCtx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
          pCtx.fill();
        } else {
          pCtx.strokeStyle = stroke.color;
          pCtx.lineWidth = stroke.size;
          pCtx.lineCap = 'round';
          pCtx.lineJoin = 'round';
          pCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
          for (let i = 1; i < stroke.points.length; i++) {
            pCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
          }
          pCtx.stroke();
        }
      }
      pCtx.restore();
    });

    // 5. 手書きレイヤーをメインキャンバスに合成
    ctx.drawImage(paintCanvas, 0, 0);

    // 6. フィールドの枠線・ヤード線・OLを最前面に保護描画（消しゴムで絶対に消えない！）
    drawFieldLines(ctx, canvas.width, canvas.height);
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
    currentColor = '#111827'; // 作図画面は黒がデフォルト
    $('#drawEraserBtn').classList.remove('on');
    document.querySelectorAll('#drawDialog .color-btn').forEach((b) => {
      b.classList.toggle('on', b.dataset.color === '#111827');
    });

    const idx = plays.indexOf(p) + 1;
    const dd = p.down ? `${ORD[p.down] || p.down} & ${p.dist || '?'}` : '';
    $('#drawModalTitle').textContent = `Play図作成: #${idx} ${p.qtr ? 'Q' + p.qtr : ''} ${dd}`;
    $('#drawModalSubtitle').textContent = `${p.formation || '体型未設定'} / ${p.play || 'Play未設定'} / ${p.defSign || 'Def未設定'}`;

    drawBaseImg = null;
    savedStrokeImg = null;

    // 過去の作図データ（drawingLayer があればそれを優先、なければ以前の drawing 画像）
    const targetUrl = p.drawingLayer || p.drawing;
    if (targetUrl) {
      const img = new Image();
      img.onload = () => {
        savedStrokeImg = img;
        redrawCanvas();
      };
      img.src = targetUrl;
    } else {
      redrawCanvas();
    }

    if (!$('#drawDialog').open) {
      $('#drawDialog').showModal();
    }
  }

  // ---------- 閲覧用ホワイトボード（一時メモ共有） ----------
  let viewBaseImg = null;
  let viewDrawPaths = [];
  let currentViewStroke = null;
  let currentViewColor = '#dc2626'; // 赤
  let currentViewSize = 4;
  let isViewEraser = false;

  const viewCanvas = $('#viewCanvas');
  const viewCtx = viewCanvas?.getContext('2d');

  // 閲覧用ホワイトボード専用の透明レイヤー（元のPlay図を削らず、メモだけを綺麗に消去）
  const viewPaintCanvas = document.createElement('canvas');
  viewPaintCanvas.width = 1024;
  viewPaintCanvas.height = 635;
  const vpCtx = viewPaintCanvas.getContext('2d');

  function redrawViewCanvas() {
    if (!viewCtx || !vpCtx || !viewCanvas) return;
    // 1. 背景を描画（元のPlay図、または白紙フィールド）
    if (viewBaseImg) {
      viewCtx.clearRect(0, 0, viewCanvas.width, viewCanvas.height);
      viewCtx.drawImage(viewBaseImg, 0, 0, viewCanvas.width, viewCanvas.height);
    } else {
      drawFieldTemplate(viewCtx, viewCanvas.width, viewCanvas.height);
    }

    // 2. 透明手書きレイヤーをクリア
    vpCtx.clearRect(0, 0, viewPaintCanvas.width, viewPaintCanvas.height);

    // 3. すべてのメモストロークを透明レイヤーに描画（消しゴムはdestination-outでくり抜き）
    viewDrawPaths.forEach((stroke) => {
      if (stroke.points.length < 1) return;
      vpCtx.save();
      vpCtx.beginPath();
      if (stroke.isEraser) {
        vpCtx.globalCompositeOperation = 'destination-out';
        if (stroke.points.length === 1) {
          vpCtx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
          vpCtx.fill();
        } else {
          vpCtx.lineWidth = stroke.size;
          vpCtx.lineCap = 'round';
          vpCtx.lineJoin = 'round';
          vpCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
          for (let i = 1; i < stroke.points.length; i++) {
            vpCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
          }
          vpCtx.stroke();
        }
      } else {
        vpCtx.globalCompositeOperation = 'source-over';
        if (stroke.points.length === 1) {
          vpCtx.fillStyle = stroke.color;
          vpCtx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
          vpCtx.fill();
        } else {
          vpCtx.strokeStyle = stroke.color;
          vpCtx.lineWidth = stroke.size;
          vpCtx.lineCap = 'round';
          vpCtx.lineJoin = 'round';
          vpCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
          for (let i = 1; i < stroke.points.length; i++) {
            vpCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
          }
          vpCtx.stroke();
        }
      }
      vpCtx.restore();
    });

    // 4. メインキャンバスに重ねて合成
    viewCtx.drawImage(viewPaintCanvas, 0, 0);
  }

  function getViewCanvasPos(e) {
    const rect = viewCanvas.getBoundingClientRect();
    const scaleX = viewCanvas.width / rect.width;
    const scaleY = viewCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function openViewDraw(p) {
    if (!p) return;
    const idx = plays.indexOf(p) + 1;
    const dd = p.down ? `${ORD[p.down] || p.down} & ${p.dist || '?'}` : '';
    $('#viewDrawTitle').textContent = `Play図: #${idx} ${p.qtr ? 'Q' + p.qtr : ''} ${dd}`;
    $('#viewDrawSubtitle').textContent = `${p.formation || '体型未設定'} / ${p.play || 'Play未設定'} / ${p.defSign || 'Def未設定'}`;

    viewDrawPaths = [];
    isViewEraser = false;
    currentViewColor = '#dc2626'; // 閲覧用は赤がデフォルト
    $('#viewDrawEraserBtn')?.classList.remove('on');
    document.querySelectorAll('#viewDrawDialog .v-color').forEach((b) => {
      b.classList.toggle('on', b.dataset.color === '#dc2626');
    });

    if (p.drawing) {
      const img = new Image();
      img.onload = () => {
        viewBaseImg = img;
        redrawViewCanvas();
      };
      img.src = p.drawing;
    } else {
      viewBaseImg = null;
      redrawViewCanvas();
    }

    $('#editFromViewDrawBtn').classList.toggle('hidden', isViewOnly);
    $('#editFromViewDrawBtn').onclick = () => {
      $('#viewDrawDialog').close();
      openDrawing(p.id);
    };

    if (!$('#viewDrawDialog').open) {
      $('#viewDrawDialog').showModal();
    }
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

  // ---------- 100プレー一括テスト生成ヘルパー ----------
  const REAL_PLAY_DATABASE = [
    { formation: 'Gun Ace', play: 'Inside Zone', type: 'Run', pers: '11', def: 'Cover 3' },
    { formation: 'Gun Ace Slot', play: 'IZ', type: 'Run', pers: '11', def: 'Cover 1' },
    { formation: 'Gun Trio', play: 'Outside Zone', type: 'Run', pers: '11', def: 'Cover 2' },
    { formation: 'Gun Trio Slot', play: 'OZ', type: 'Run', pers: '11', def: 'Cover 4 Quarters' },
    { formation: 'Ace', play: 'Super Power', type: 'Run', pers: '12', def: 'Fire Zone 3' },
    { formation: 'Ace Slot', play: 'Power G', type: 'Run', pers: '12', def: 'Cover 1 Blitz' },
    { formation: 'Gun Bunch', play: 'Counter GT', type: 'Run', pers: '11', def: 'Tampa 2' },
    { formation: 'Gun Bunch Open', play: 'Back Counter', type: 'Run', pers: '11', def: 'Cover 3 Sky' },
    { formation: 'Bunch', play: 'Duo', type: 'Run', pers: '12', def: 'Cover 1 Hole' },
    { formation: 'Gun Spread', play: 'Inside Trap', type: 'Run', pers: '10', def: 'Cover 2 Man' },
    { formation: 'Gun Spread Wing', play: 'Pin & Pull', type: 'Run', pers: '11', def: 'Cover 3 Cloud' },
    { formation: 'Spread Slot', play: 'QB Draw', type: 'Run', pers: '10', def: 'Cover 4' },
    { formation: 'Gun Tray Open', play: 'Jet Sweep', type: 'Run', pers: '11', def: 'Cover 1' },
    { formation: 'Gun Twin Terrier', play: 'Toss Crack', type: 'Run', pers: '21', def: 'Cover 3' },
    { formation: 'Gun Twin Warrior', play: 'Iso Lead', type: 'Run', pers: '21', def: 'Cover 0 All Out' },
    { formation: 'Twin Terrier', play: 'Belly', type: 'Run', pers: '22', def: 'Cover 1' },
    { formation: 'Twin Warrior', play: 'Dive', type: 'Run', pers: '22', def: 'Cover 3' },
    { formation: 'Gun Flex Terrier', play: 'Zone Read', type: 'Run', pers: '21', def: 'Cover 2' },
    { formation: 'Gun Trips Slot', play: 'Speed Option', type: 'Run', pers: '11', def: 'Fire Zone 3' },
    { formation: 'Trips Slot', play: 'QB Sneak', type: 'Run', pers: '12', def: 'Goal Line' },
    { formation: 'Gun Ace', play: 'Iz PAP', type: 'Pass', pers: '11', def: 'Cover 3' },
    { formation: 'Gun Ace Slot', play: 'Oz PAP', type: 'Pass', pers: '11', def: 'Cover 1' },
    { formation: 'Gun Trio Slot', play: 'Counter PAP', type: 'Pass', pers: '11', def: 'Cover 2' },
    { formation: 'Gun Bunch', play: 'Power PAP Post', type: 'Pass', pers: '11', def: 'Cover 4' },
    { formation: 'Gun Spread', play: '3 Step Slant', type: 'Pass', pers: '10', def: 'Cover 1' },
    { formation: 'Gun Spread Wing', play: '5 Step Out', type: 'Pass', pers: '11', def: 'Cover 3' },
    { formation: 'Gun Trips', play: 'Quick Hitch', type: 'Pass', pers: '11', def: 'Cover 2' },
    { formation: 'Gun Trips Slot', play: 'Mesh Cross', type: 'Pass', pers: '11', def: 'Cover 1 Man' },
    { formation: 'Gun Tray', play: '4 Verticals', type: 'Pass', pers: '11', def: 'Cover 3 Deep' },
    { formation: 'Gun Tray Open', play: 'Sail Flood', type: 'Pass', pers: '11', def: 'Cover 2' },
    { formation: 'Gun Bunch Open', play: 'Y-Stick', type: 'Pass', pers: '11', def: 'Cover 4 Quarters' },
    { formation: 'Ace Slot', play: 'Corner Strike', type: 'Pass', pers: '12', def: 'Cover 1' },
    { formation: 'Bunch Open', play: 'Sprint Out Flood', type: 'Pass', pers: '11', def: 'Fire Zone 3' },
    { formation: 'Gun Far Bunch Open', play: 'Bootleg Cross', type: 'Pass', pers: '11', def: 'Cover 3' },
    { formation: 'Far Bunch Open', play: 'Naked Boot', type: 'Pass', pers: '12', def: 'Cover 1' },
    { formation: 'Gun Twin Terrier', play: 'RB Screen', type: 'Pass', pers: '21', def: 'Cover 2 Blitz' },
    { formation: 'Gun Twin Warrior', play: 'Bubble Screen', type: 'Pass', pers: '21', def: 'Cover 3' },
    { formation: 'Flex Terrier', play: 'Middle Screen', type: 'Pass', pers: '21', def: 'Cover 1' },
    { formation: 'Spread', play: 'Roll Out Pass', type: 'Pass', pers: '10', def: 'Cover 2' },
    { formation: 'Gun Spread Slot', play: 'Hail Mary', type: 'Pass', pers: '10', def: 'Prevent 3-Man' }
  ];

  function createSampleDrawingBase64(seq) {
    const header = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA4QAAAH0CAYAAAC1C9tKAAAAAXNSR0IArs4c6Q';
    let body = '';
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const targetBytes = 18 * 1024;
    for (let i = 0; i < targetBytes; i++) {
      body += alphabet[(i * 13 + seq * 17) % alphabet.length];
    }
    return header + body;
  }

  function createSampleDrawingLayer(seq, playItem) {
    const strokes = [];
    strokes.push({ tool: 'line', color: '#2563eb', width: 2, points: [{ x: 50, y: 350 }, { x: 850, y: 350 }] });
    const routeCount = playItem.type === 'Pass' ? 4 : 2;
    for (let r = 0; r < routeCount; r++) {
      const pts = [];
      const startX = 150 + r * 160;
      pts.push({ x: startX, y: 350 });
      pts.push({ x: startX, y: 220 });
      if (r % 2 === 0) pts.push({ x: startX + 60, y: 150 });
      else pts.push({ x: startX - 40, y: 160 });
      strokes.push({
        tool: 'arrow',
        color: playItem.type === 'Pass' ? '#2563eb' : '#dc2626',
        width: 3,
        points: pts
      });
    }
    strokes.push({ tool: 'text', color: '#000000', text: playItem.play, x: 400, y: 420 });
    return strokes;
  }

  function generate100RealPlays() {
    const plays = [];
    let currentQtr = 1;
    let currentSeries = 1;
    let currentDown = 1;
    let currentDist = 10;
    const hashes = ['L', 'M', 'R'];

    for (let i = 1; i <= 100; i++) {
      if (i === 26) { currentQtr = 2; currentSeries++; currentDown = 1; currentDist = 10; }
      if (i === 51) { currentQtr = 3; currentSeries++; currentDown = 1; currentDist = 10; }
      if (i === 76) { currentQtr = 4; currentSeries++; currentDown = 1; currentDist = 10; }

      const tpl = REAL_PLAY_DATABASE[(i - 1) % REAL_PLAY_DATABASE.length];
      const hash = hashes[(i * 2 + currentDown) % 3];

      plays.push({
        qtr: String(currentQtr),
        series: String(currentSeries),
        hash: hash,
        down: String(currentDown),
        dist: String(currentDist),
        personnel: tpl.pers,
        formation: tpl.formation,
        play: tpl.play,
        playType: tpl.type,
        playTypeManual: false,
        defSign: tpl.def,
        drawing: createSampleDrawingBase64(i),
        drawingLayer: createSampleDrawingLayer(i, tpl),
        updatedBy: me || '山田（検証員）'
      });

      const gain = (i * 7) % 15 - 3;
      if (gain >= currentDist) {
        currentDown = 1; currentDist = 10;
      } else if (currentDown === 4) {
        currentSeries++; currentDown = 1; currentDist = 10;
      } else {
        currentDown++;
        currentDist = Math.max(1, currentDist - Math.max(0, gain));
      }
    }
    return plays;
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

    if ($('#test100Btn')) {
      $('#test100Btn').onclick = () => {
        if (!confirm('実在する100プレー（全項目・全件作図付き）を一括注入したテスト試合を作成しますか？\n（動作速度や傾向表・CSV出力の検証ができます）')) return;
        toast('100プレーと作図データを一括生成中...');
        const testPlays = generate100RealPlays();
        const testGameName = `100Play検証 (${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })})`;
        const gid = store.createGameWithPlays ? store.createGameWithPlays(testGameName, testPlays) : store.createGame({ name: testGameName, createdBy: me });
        toast('✅ 100プレーの注入が完了しました！');
        location.hash = '#/game/' + gid;
      };
    }
    $('#nextPlayBtn').onclick = () => selectNextRow();
    $('#newSeriesBtn').onclick = handleNewSeries;
    $('#deleteBtn').onclick = () => {
      const p = selectedPlay();
      if (!p) return;
      const idx = plays.indexOf(p) + 1;
      if (confirm(`#${idx} のプレー内容をクリアしますか？`)) {
        store.updatePlay(currentGameId, p.id, {
          qtr: '', series: '', hash: '', down: '', dist: '',
          personnel: '', formation: '', play: '', playType: '', playTypeManual: false, defSign: '', drawing: null, drawingLayer: null,
          updatedAt: Date.now(), updatedBy: me, updatedByClient: clientId,
        });
        toast(`#${idx} の内容をクリアしました`);
      }
    };
    $('#csvBtn').onclick = exportCsv;
    $('#tabPlayList')?.addEventListener('click', () => switchTab('playList'));
    $('#tabTendency')?.addEventListener('click', () => switchTab('tendency'));
    let shareMode = 'edit';
    function updateShareDialog() {
      const base = location.href.split('#')[0];
      let url = '';
      if (shareMode === 'mobile') {
        let mobileBase = '';
        if (base.endsWith('/index.html')) {
          mobileBase = base.replace(/\/index\.html$/, '/mobile.html');
        } else if (base.endsWith('/')) {
          mobileBase = base + 'mobile.html';
        } else {
          const lastSlash = base.lastIndexOf('/');
          mobileBase = base.slice(0, lastSlash + 1) + 'mobile.html';
        }
        url = mobileBase + '#/view/' + currentGameId;
      } else if (shareMode === 'view') {
        url = base + '#/view/' + currentGameId;
      } else {
        url = base + '#/game/' + currentGameId;
      }
      $('#shareUrlInput').value = url;
      $('#qrImg').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
      $('#shareModeEdit').classList.toggle('on', shareMode === 'edit');
      $('#shareModeView').classList.toggle('on', shareMode === 'view');
      $('#shareModeMobile')?.classList.toggle('on', shareMode === 'mobile');
      if (shareMode === 'mobile') {
        $('#shareDesc').textContent = 'スマホ閲覧用：スマホの縦画面サイズに特化した専用画面です（見るだけ専用）';
      } else if (shareMode === 'view') {
        $('#shareDesc').textContent = 'タブレット閲覧用：大画面・タブレットで見渡せる閲覧専用リンクです';
      } else {
        $('#shareDesc').textContent = '編集用リンク：3人で分担して同時入力・編集ができます';
      }
    }

    $('#shareModeEdit').onclick = () => { shareMode = 'edit'; updateShareDialog(); };
    $('#shareModeView').onclick = () => { shareMode = 'view'; updateShareDialog(); };
    if ($('#shareModeMobile')) {
      $('#shareModeMobile').onclick = () => { shareMode = 'mobile'; updateShareDialog(); };
    }

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

      // 文字選択・長押しメニュー・ジェスチャー等のブラウザ標準動作を完全無効化
      canvas.addEventListener('selectstart', (e) => e.preventDefault());
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
      canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

      canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        // 万が一周囲の文字が選択状態になっていれば即解除
        if (window.getSelection) {
          try { window.getSelection().removeAllRanges(); } catch {}
        }
        isDrawing = true;
        canvas.setPointerCapture(e.pointerId);
        const pos = getCanvasPos(e);
        currentStroke = {
          isEraser: isEraser,
          color: currentColor,
          size: isEraser ? currentSize * 4 : currentSize,
          points: [pos]
        };
        drawPaths.push(currentStroke);

        // タップした瞬間も点（ドット）または消去を即時反映
        pCtx.save();
        pCtx.beginPath();
        if (currentStroke.isEraser) {
          pCtx.globalCompositeOperation = 'destination-out';
          pCtx.arc(pos.x, pos.y, currentStroke.size / 2, 0, Math.PI * 2);
          pCtx.fill();
        } else {
          pCtx.globalCompositeOperation = 'source-over';
          pCtx.fillStyle = currentStroke.color;
          pCtx.arc(pos.x, pos.y, currentStroke.size / 2, 0, Math.PI * 2);
          pCtx.fill();
        }
        pCtx.restore();

        // メインキャンバスを再合成（白背景 + 手書き + 最前面フィールド線）
        drawFieldBg(ctx, canvas.width, canvas.height);
        ctx.drawImage(paintCanvas, 0, 0);
        drawFieldLines(ctx, canvas.width, canvas.height);
      });

      canvas.addEventListener('pointermove', (e) => {
        if (!isDrawing || !currentStroke) return;
        e.preventDefault();
        const pos = getCanvasPos(e);
        currentStroke.points.push(pos);

        pCtx.save();
        pCtx.beginPath();
        if (currentStroke.isEraser) {
          pCtx.globalCompositeOperation = 'destination-out';
          pCtx.lineWidth = currentStroke.size;
        } else {
          pCtx.globalCompositeOperation = 'source-over';
          pCtx.strokeStyle = currentStroke.color;
          pCtx.lineWidth = currentStroke.size;
        }
        pCtx.lineCap = 'round';
        pCtx.lineJoin = 'round';
        const pts = currentStroke.points;
        const prev = pts[pts.length - 2];
        pCtx.moveTo(prev.x, prev.y);
        pCtx.lineTo(pos.x, pos.y);
        pCtx.stroke();
        pCtx.restore();

        // メインキャンバスを再合成（白背景 + 手書き + 最前面フィールド線）
        drawFieldBg(ctx, canvas.width, canvas.height);
        ctx.drawImage(paintCanvas, 0, 0);
        drawFieldLines(ctx, canvas.width, canvas.height);
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
        drawBaseImg = null;
        savedStrokeImg = null;
        redrawCanvas();
      }
    };

    // 透明手書きレイヤーに何か描かれているかを判定（1ピクセルでも描画があれば false、完全白紙なら true）
    function isPaintCanvasBlank() {
      try {
        const imgData = pCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height);
        const data32 = new Uint32Array(imgData.data.buffer);
        for (let i = 0; i < data32.length; i++) {
          if (data32[i] !== 0) return false;
        }
        return true;
      } catch {
        return false;
      }
    }

    function saveCurrentDrawing() {
      if (!currentGameId || !drawTargetPlayId) return false;
      try {
        const curPlay = plays.find((p) => p.id === drawTargetPlayId);
        const isBlank = isPaintCanvasBlank();

        if (isBlank) {
          // 何も描かれていない（白紙）の場合：
          // もともと絵があった場合は削除して未作図に戻す。元から白紙なら画像保存せず未作図のまま維持。
          if (curPlay && (curPlay.drawing || curPlay.drawingLayer)) {
            store.updatePlay(currentGameId, drawTargetPlayId, {
              drawing: null,
              drawingLayer: null,
              updatedBy: me,
              updatedByClient: clientId,
              updatedAt: Date.now()
            });
          }
          return true;
        }

        // 何か手書き線が描かれている場合のみ画像データを保存
        // 合体画像（一覧・閲覧用）は高圧縮WebPで約20KB
        const fullDataUrl = canvas.toDataURL('image/webp', 0.65);
        // 手書き線のみの透明レイヤーはPNGで保存（全ブラウザ・Safariで透明度を100%完全保持。余白が透明なので容量はわずか2〜5KB!）
        const strokeLayerUrl = paintCanvas.toDataURL('image/png');
        store.updatePlay(currentGameId, drawTargetPlayId, {
          drawing: fullDataUrl,
          drawingLayer: strokeLayerUrl,
          updatedBy: me,
          updatedByClient: clientId,
          updatedAt: Date.now()
        });
        return true;
      } catch (e) {
        alert('保存エラー: ' + e.message);
        return false;
      }
    }

    // 保存して次のPlayへ
    $('#saveDrawBtn').onclick = () => {
      if (!saveCurrentDrawing()) return;
      const curIdx = plays.findIndex((p) => p.id === drawTargetPlayId);
      let nextIdx = curIdx + 1;
      const nextPlay = plays[nextIdx];
      if (nextPlay) {
        toast(`#${curIdx + 1} の作図を保存し、次の #${nextIdx + 1} へ進みました`);
        selectPlay(nextPlay.id, { scroll: true });
        openDrawing(nextPlay.id);
      } else {
        toast(`作図を保存しました（全${plays.length}枠完了）`);
        $('#drawDialog').close();
      }
    };

    // 保存して閉じる
    if ($('#saveAndCloseDrawBtn')) {
      $('#saveAndCloseDrawBtn').onclick = () => {
        if (!saveCurrentDrawing()) return;
        toast('Play図を保存しました！');
        $('#drawDialog').close();
      };
    }

    // 閲覧用ホワイトボードキャンバスのイベント
    if (viewCanvas && viewCtx) {
      let isDrawing = false;
      viewCanvas.addEventListener('selectstart', (e) => e.preventDefault());
      viewCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
      viewCanvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
      viewCanvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

      viewCanvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (window.getSelection) {
          try { window.getSelection().removeAllRanges(); } catch {}
        }
        isDrawing = true;
        viewCanvas.setPointerCapture(e.pointerId);
        const pos = getViewCanvasPos(e);
        currentViewStroke = {
          isEraser: isViewEraser,
          color: currentViewColor,
          size: isViewEraser ? currentViewSize * 4 : currentViewSize,
          points: [pos]
        };
        viewDrawPaths.push(currentViewStroke);

        vpCtx.save();
        vpCtx.beginPath();
        if (currentViewStroke.isEraser) {
          vpCtx.globalCompositeOperation = 'destination-out';
          vpCtx.arc(pos.x, pos.y, currentViewStroke.size / 2, 0, Math.PI * 2);
          vpCtx.fill();
        } else {
          vpCtx.globalCompositeOperation = 'source-over';
          vpCtx.fillStyle = currentViewStroke.color;
          vpCtx.arc(pos.x, pos.y, currentViewStroke.size / 2, 0, Math.PI * 2);
          vpCtx.fill();
        }
        vpCtx.restore();

        if (viewBaseImg) {
          viewCtx.clearRect(0, 0, viewCanvas.width, viewCanvas.height);
          viewCtx.drawImage(viewBaseImg, 0, 0, viewCanvas.width, viewCanvas.height);
        } else {
          drawFieldTemplate(viewCtx, viewCanvas.width, viewCanvas.height);
        }
        viewCtx.drawImage(viewPaintCanvas, 0, 0);
      });

      viewCanvas.addEventListener('pointermove', (e) => {
        if (!isDrawing || !currentViewStroke) return;
        e.preventDefault();
        const pos = getViewCanvasPos(e);
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

        // 閲覧用メインキャンバスを再合成（背景 + 透明メモレイヤー）
        if (viewBaseImg) {
          viewCtx.clearRect(0, 0, viewCanvas.width, viewCanvas.height);
          viewCtx.drawImage(viewBaseImg, 0, 0, viewCanvas.width, viewCanvas.height);
        } else {
          drawFieldTemplate(viewCtx, viewCanvas.width, viewCanvas.height);
        }
        viewCtx.drawImage(viewPaintCanvas, 0, 0);
      });

      const endDrawing = (e) => {
        if (!isDrawing) return;
        isDrawing = false;
        currentViewStroke = null;
        try { viewCanvas.releasePointerCapture(e.pointerId); } catch {}
      };

      viewCanvas.addEventListener('pointerup', endDrawing);
      viewCanvas.addEventListener('pointercancel', endDrawing);
    }

    // 閲覧用ツールバー
    document.querySelectorAll('.v-color').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('.v-color').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        currentViewColor = b.dataset.color;
        isViewEraser = false;
        $('#viewDrawEraserBtn')?.classList.remove('on');
      };
    });

    document.querySelectorAll('.v-size').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('.v-size').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        currentViewSize = parseInt(b.dataset.size, 10) || 4;
      };
    });

    if ($('#viewDrawEraserBtn')) {
      $('#viewDrawEraserBtn').onclick = () => {
        isViewEraser = !isViewEraser;
        $('#viewDrawEraserBtn').classList.toggle('on', isViewEraser);
      };
    }

    if ($('#viewDrawUndoBtn')) {
      $('#viewDrawUndoBtn').onclick = () => {
        if (viewDrawPaths.length > 0) {
          viewDrawPaths.pop();
          redrawViewCanvas();
        }
      };
    }

    if ($('#viewDrawClearBtn')) {
      $('#viewDrawClearBtn').onclick = () => {
        viewDrawPaths = [];
        redrawViewCanvas();
      };
    }

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
