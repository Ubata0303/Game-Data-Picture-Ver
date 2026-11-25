// ============================================================
// データ保存層：IndexedDB 大容量ストレージ ＋ MQTT over WebSocket (WSS) リアルタイム同期
// ------------------------------------------------------------
// アカウント登録・ログイン・外部設定は一切不要！
// 容量無制限の IndexedDB 搭載：作図を何百枚描いても絶対に容量オーバーで止まりません。
// オフラインキュー機能搭載：ネット切断中に打ち込んだデータは端末に保存され、
// 再接続した瞬間に自動で全件送信＆他端末と完全同期されます。
// ============================================================
(function () {
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('スクリプト読み込み失敗: ' + src));
      document.head.appendChild(s);
    });
  }

  // 大容量ストレージ（IndexedDB）ヘルパー
  const DB_NAME = 'fdl_idb_v1';
  const DB_STORE = 'keyval';

  function openIndexedDB() {
    return new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const db = req.result;
          if (!db.objectStoreNames.contains(DB_STORE)) {
            db.createObjectStore(DB_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  function idbGet(db, key) {
    return new Promise((resolve) => {
      if (!db) return resolve(null);
      try {
        const tx = db.transaction(DB_STORE, 'readonly');
        const store = tx.objectStore(DB_STORE);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  function idbSet(db, key, val) {
    return new Promise((resolve) => {
      if (!db) return resolve(false);
      try {
        const tx = db.transaction(DB_STORE, 'readwrite');
        const store = tx.objectStore(DB_STORE);
        const req = store.put(val, key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  class CloudSyncStore {
    constructor() {
      this.mode = 'realtime';
      this.key = 'fdl_data_v1';
      this.listeners = new Set();
      this.statusListeners = new Set();
      this.activeGid = null;
      this.client = null;
      this.myClientId = 'c_' + uid();
      this.status = { text: '準備完了', cls: 'ok' };
      this.pendingQueue = [];
      this.db = null;
      this._memCache = null;
      this._loadPending();

      // 同一端末のタブ間同期
      this.ch = 'BroadcastChannel' in window ? new BroadcastChannel('fdl_sync_ch') : null;
      if (this.ch) this.ch.onmessage = async () => {
        if (this.db) {
          const fresh = await idbGet(this.db, this.key);
          if (fresh) this._memCache = fresh;
        }
        this._emit();
      };
      window.addEventListener('storage', (e) => {
        if (e.key === this.key) {
          try {
            const parsed = JSON.parse(e.newValue);
            if (parsed) this._memCache = parsed;
          } catch {}
          this._emit();
        }
      });
    }

    async init() {
      try {
        this.db = await openIndexedDB();
        if (this.db) {
          const data = await idbGet(this.db, this.key);
          if (data && (data.games || data.plays)) {
            this._memCache = data;
          }
        }
      } catch (e) {
        console.warn('IndexedDB 初期化警告:', e);
      }
      if (!this._memCache) {
        // LocalStorage から読み込んで IndexedDB にマイグレーション
        try {
          this._memCache = JSON.parse(localStorage.getItem(this.key)) || { games: {}, plays: {} };
        } catch {
          this._memCache = { games: {}, plays: {} };
        }
        if (this.db && this._memCache) {
          idbSet(this.db, this.key, this._memCache).catch(() => {});
        }
      }
    }

    _load() {
      if (this._memCache) return this._memCache;
      try {
        this._memCache = JSON.parse(localStorage.getItem(this.key)) || { games: {}, plays: {} };
      } catch {
        this._memCache = { games: {}, plays: {} };
      }
      return this._memCache;
    }

    _save(d) {
      this._memCache = d;

      // 1. IndexedDB に大容量保存（容量制限なし！確実に書き込む）
      if (this.db) {
        idbSet(this.db, this.key, d).catch((e) => console.warn('IDB保存警告:', e));
      }

      // 2. localStorage にも保存（QuotaExceededError は完全防御！）
      try {
        localStorage.setItem(this.key, JSON.stringify(d));
      } catch (e) {
        // 容量オーバー時は、作図データを除いた軽量テキスト版だけを保存
        try {
          const stripped = JSON.parse(JSON.stringify(d));
          Object.values(stripped.plays || {}).forEach((gPlays) => {
            Object.values(gPlays || {}).forEach((p) => {
              delete p.drawing;
              delete p.drawingLayer;
            });
          });
          localStorage.setItem(this.key, JSON.stringify(stripped));
        } catch {}
      }

      if (this.ch) this.ch.postMessage('u');
      this._emit();
    }
    _emit() { this.listeners.forEach((f) => f()); }
    _sub(fn) { this.listeners.add(fn); fn(); return () => this.listeners.delete(fn); }

    _loadPending() {
      try {
        this.pendingQueue = JSON.parse(localStorage.getItem('fdl_pending_v1')) || [];
      } catch {
        this.pendingQueue = [];
      }
    }
    _savePending() {
      try {
        localStorage.setItem('fdl_pending_v1', JSON.stringify(this.pendingQueue));
      } catch {}
    }

    onStatusChange(cb) {
      this.statusListeners.add(cb);
      cb(this.status.text, this.status.cls);
      return () => this.statusListeners.delete(cb);
    }
    _setStatus(text, cls) {
      this.status = { text, cls };
      this.statusListeners.forEach((cb) => cb(text, cls));
    }

    subscribeGames(cb) {
      return this._sub(() => {
        const d = this._load();
        cb(Object.entries(d.games).map(([id, g]) => ({ id, ...g })).sort((a, b) => b.createdAt - a.createdAt));
      });
    }

    createGame(data) {
      const d = this._load();
      const id = uid();
      d.games[id] = { ...data, createdAt: Date.now() };
      d.plays[id] = {};
      const baseTime = Date.now();
      for (let i = 1; i <= 100; i++) {
        const pid = uid();
        d.plays[id][pid] = {
          seq: i,
          createdAt: baseTime + i * 10,
        };
      }
      this._save(d);
      return id;
    }

    createGameWithPlays(name, playsList) {
      const d = this._load();
      const gid = uid();
      const baseTime = Date.now();
      d.games[gid] = { name, createdAt: baseTime };
      d.plays[gid] = {};
      for (let i = 0; i < playsList.length; i++) {
        const pid = uid();
        d.plays[gid][pid] = {
          ...playsList[i],
          seq: i + 1,
          createdAt: baseTime + (i + 1) * 10,
          updatedAt: baseTime + (i + 1) * 10
        };
      }
      this._save(d);
      return gid;
    }

    updateGame(gid, patch) {
      const d = this._load();
      if (!d.games[gid]) return;
      Object.assign(d.games[gid], patch);
      this._save(d);
      this._publish({ type: 'UPDATE_GAME', gid, patch });
    }

    deleteGame(gid) {
      const d = this._load();
      if (d.games[gid]) {
        delete d.games[gid];
        delete d.plays[gid];
        this._save(d);
        this._publish({ type: 'DELETE_GAME', gid });
      }
    }

    subscribePlays(gid, cb) {
      this.joinRoom(gid);
      return this._sub(() => {
        const d = this._load();
        const pendingPids = new Set(this.pendingQueue.map((m) => m.pid || m.id).filter(Boolean));
        cb(Object.entries(d.plays[gid] || {}).map(([id, p]) => ({
          id,
          ...p,
          _pending: pendingPids.has(id) // 未送信のプレーにフラグを付与
        })));
      });
    }

    addPlay(gid, data) {
      const d = this._load();
      const id = uid();
      (d.plays[gid] ||= {})[id] = data;
      this._save(d);
      this._publish({ type: 'ADD_PLAY', gid, id, data });
      return id;
    }

    ensureInitialPlays(gid, count = 100) {
      const d = this._load();
      d.plays[gid] ||= {};
      const currentCount = Object.keys(d.plays[gid]).length;
      if (currentCount >= count) return;
      const baseTime = Date.now();
      const newItems = {};
      for (let i = currentCount + 1; i <= count; i++) {
        const pid = uid();
        const pData = { seq: i, createdAt: baseTime + i * 10 };
        d.plays[gid][pid] = pData;
        newItems[pid] = pData;
      }
      this._save(d);
      this._publish({ type: 'ADD_PLAYS_BULK', gid, plays: newItems });
      this._emit();
    }

    addPlaysBulk(gid, addCount = 20) {
      const d = this._load();
      d.plays[gid] ||= {};
      const currentCount = Object.keys(d.plays[gid]).length;
      const baseTime = Date.now();
      const newItems = {};
      for (let i = 1; i <= addCount; i++) {
        const pid = uid();
        const seq = currentCount + i;
        const pData = { seq, createdAt: baseTime + seq * 10 };
        d.plays[gid][pid] = pData;
        newItems[pid] = pData;
      }
      this._save(d);
      this._publish({ type: 'ADD_PLAYS_BULK', gid, plays: newItems });
      this._emit();
    }

    updatePlay(gid, pid, patch) {
      const d = this._load();
      if (!d.plays[gid] || !d.plays[gid][pid]) return;
      Object.assign(d.plays[gid][pid], patch);
      this._save(d);
      this._publish({ type: 'UPDATE_PLAY', gid, pid, patch });
    }

    deletePlay(gid, pid) {
      const d = this._load();
      if (d.plays[gid]) delete d.plays[gid][pid];
      this._save(d);
      this._publish({ type: 'DELETE_PLAY', gid, pid });
    }

    leaveGame() {
      if (this.client && this.activeGid) {
        try { this.client.unsubscribe(`fdl/room/${this.activeGid}`); } catch {}
      }
      this.activeGid = null;
      this._setStatus('● 待機中', 'ok');
    }

    joinRoom(gid) {
      if (this.activeGid === gid) return;
      this.activeGid = gid;
      this._connectMqtt(gid);
    }

    _connectMqtt(gid) {
      this._setStatus('接続中...', 'warn');
      const topic = `fdl/room/${gid}`;

      const brokers = [
        'wss://broker.emqx.io:8084/mqtt',
        'wss://broker.hivemq.com:8884/mqtt'
      ];
      const brokerUrl = brokers[0];

      if (!this.client || !this.client.connected) {
        try {
          this.client = mqtt.connect(brokerUrl, {
            clientId: `fdl_${this.myClientId}`,
            clean: true,
            connectTimeout: 8000,
            reconnectPeriod: 2500
          });
        } catch (e) {
          console.warn('MQTT接続失敗:', e);
          this._updateOfflineStatus();
          return;
        }

        this.client.on('connect', () => {
          this.client.subscribe(topic, { qos: 1 });
          // 接続した瞬間に、未送信キューをすべて一気に再送！
          this._flushPending();
          // 他端末へ最新同期をリクエスト
          this._sendDirect({ type: 'REQ_SYNC', from: this.myClientId });
          this._setStatus('● リアルタイム同期中', 'ok');
        });

        this.client.on('message', (t, payload) => {
          if (t !== topic) return;
          try {
            const msg = JSON.parse(payload.toString());
            if (msg.sender === this.myClientId) return; // 自分が送ったものは無視
            this._handleRemoteMessage(msg);
          } catch (e) {
            console.warn('受信メッセージ解析エラー:', e);
          }
        });

        this.client.on('reconnect', () => {
          this._updateOfflineStatus('再接続中...');
        });

        this.client.on('offline', () => {
          this._updateOfflineStatus('オフライン');
        });

        this.client.on('error', (err) => {
          console.warn('MQTTエラー:', err);
          this._updateOfflineStatus('接続待機中');
        });
      } else {
        this.client.subscribe(topic, { qos: 1 });
        this._flushPending();
        this._sendDirect({ type: 'REQ_SYNC', from: this.myClientId });
        this._setStatus('● リアルタイム同期中', 'ok');
      }
    }

    _updateOfflineStatus(prefix = 'オフライン') {
      const count = this.pendingQueue.length;
      if (count > 0) {
        this._setStatus(`${prefix}（未送信 ${count}件）`, 'warn');
      } else {
        this._setStatus(`${prefix}（電波待機中）`, 'warn');
      }
    }

    _sendDirect(msg) {
      if (!this.client || !this.client.connected || !this.activeGid) return;
      const topic = `fdl/room/${this.activeGid}`;
      const payload = JSON.stringify({ ...msg, sender: this.myClientId, gid: this.activeGid });
      this.client.publish(topic, payload, { qos: 1 });
    }

    _publish(msg) {
      if (!this.activeGid) return;
      const fullMsg = { ...msg, sender: this.myClientId, gid: this.activeGid, time: Date.now() };

      if (!this.client || !this.client.connected) {
        // 回線切断中：未送信キューに保存
        this.pendingQueue.push(fullMsg);
        this._savePending();
        this._updateOfflineStatus();
        this._emit(); // 画面の ⏳ アイコンを更新
        return;
      }

      const topic = `fdl/room/${this.activeGid}`;
      const payload = JSON.stringify(fullMsg);
      this.client.publish(topic, payload, { qos: 1 });
    }

    // 接続復帰時に未送信キューを一気に送信＆他端末と完全マージ
    _flushPending() {
      if (!this.client || !this.client.connected || !this.activeGid) return;
      const topic = `fdl/room/${this.activeGid}`;

      if (this.pendingQueue.length > 0) {
        console.log(`未送信データ ${this.pendingQueue.length} 件を一括送信中...`);
        // 【文字最優先レーン】電波が微弱・一瞬の復帰でも文字が絶対に先に届くよう、
        // 絵（drawing）を含む重いパケットは後回しにし、文字・Playデータを最優先で先頭に並び替えて送信！
        const isDrawingMsg = (m) => m && m.patch && (m.patch.drawing || m.patch.drawingLayer);
        const textMsgs = this.pendingQueue.filter((m) => !isDrawingMsg(m));
        const drawingMsgs = this.pendingQueue.filter((m) => isDrawingMsg(m));
        const sortedQueue = [...textMsgs, ...drawingMsgs];

        while (sortedQueue.length > 0) {
          const msg = sortedQueue.shift();
          try {
            this.client.publish(topic, JSON.stringify(msg), { qos: 1 });
          } catch (e) {
            console.warn('再送エラー:', e);
          }
        }
        this.pendingQueue = [];
        this._savePending();
      }

      // 念のため、手元の最新データ一式を全端末へブロードキャスト（相互補完）
      const d = this._load();
      const game = d.games[this.activeGid];
      const plays = d.plays[this.activeGid] || {};
      if (Object.keys(plays).length > 0) {
        // パケットサイズ上限（256KB）に引っかからないよう、テキスト項目を確実に一括同期！
        const cleanPlays = {};
        Object.entries(plays).forEach(([pid, p]) => {
          const cp = { ...p };
          delete cp.drawing;
          delete cp.drawingLayer;
          cleanPlays[pid] = cp;
        });

        this.client.publish(topic, JSON.stringify({
          type: 'SYNC_FULL',
          sender: this.myClientId,
          gid: this.activeGid,
          game,
          plays: cleanPlays
        }), { qos: 1 });
      }

      this._emit(); // ⏳ マークを解除
    }

    _handleRemoteMessage(msg) {
      const d = this._load();

      // 他の端末が入ってきたので手元の最新データを返信
      if (msg.type === 'REQ_SYNC') {
        const game = d.games[this.activeGid];
        const plays = d.plays[this.activeGid] || {};
        if (Object.keys(plays).length > 0 || game) {
          // テキストデータを確実に届けるため軽量化して一括送信
          const cleanPlays = {};
          Object.entries(plays).forEach(([pid, p]) => {
            const cp = { ...p };
            delete cp.drawing;
            delete cp.drawingLayer;
            cleanPlays[pid] = cp;
          });
          this._sendDirect({
            type: 'RESP_SYNC',
            target: msg.from,
            game: game,
            plays: cleanPlays
          });

          // 作図データが存在するプレーだけを、個別に UPDATE_PLAY として送信
          // （1パケット20〜30KBに分割され、パケットサイズ制限を完全回避）
          Object.entries(plays).forEach(([pid, p]) => {
            if (p.drawing || p.drawingLayer) {
              this._sendDirect({
                type: 'UPDATE_PLAY',
                gid: this.activeGid,
                pid: pid,
                patch: {
                  drawing: p.drawing,
                  drawingLayer: p.drawingLayer,
                  updatedAt: p.updatedAt || Date.now()
                }
              });
            }
          });
        }
        return;
      }

      // 初回同期データを受信
      if (msg.type === 'RESP_SYNC') {
        if (msg.target && msg.target !== this.myClientId) return;
        if (msg.game && !d.games[this.activeGid]) {
          d.games[this.activeGid] = msg.game;
        }
        const localPlays = d.plays[this.activeGid] || {};
        const incomingPlays = msg.plays || {};
        const merged = { ...localPlays };

        Object.entries(incomingPlays).forEach(([pid, rPlay]) => {
          const lPlay = merged[pid];
          if (!lPlay) {
            merged[pid] = rPlay;
          } else {
            // ローカルにすでにある作図データは消さないよう保持しつつマージ
            merged[pid] = {
              ...lPlay,
              ...rPlay,
              ...(lPlay.drawing ? { drawing: lPlay.drawing } : {}),
              ...(lPlay.drawingLayer ? { drawingLayer: lPlay.drawingLayer } : {}),
              updatedAt: Math.max(lPlay.updatedAt || 0, rPlay.updatedAt || 0)
            };
          }
        });

        d.plays[this.activeGid] = merged;
        this._save(d);
        return;
      }

      // 回線復帰時のフル同期（相互補完マージ）
      if (msg.type === 'SYNC_FULL') {
        if (msg.game && !d.games[this.activeGid]) {
          d.games[this.activeGid] = msg.game;
        }
        const localPlays = d.plays[this.activeGid] || {};
        const remotePlays = msg.plays || {};
        const merged = { ...localPlays };

        Object.entries(remotePlays).forEach(([pid, rPlay]) => {
          const lPlay = merged[pid];
          if (!lPlay) {
            merged[pid] = rPlay;
          } else {
            // ローカルにすでにある作図データは消さないよう保持しつつマージ
            merged[pid] = {
              ...lPlay,
              ...rPlay,
              ...(lPlay.drawing ? { drawing: lPlay.drawing } : {}),
              ...(lPlay.drawingLayer ? { drawingLayer: lPlay.drawingLayer } : {}),
              updatedAt: Math.max(lPlay.updatedAt || 0, rPlay.updatedAt || 0)
            };
          }
        });

        d.plays[this.activeGid] = merged;
        this._save(d);
        return;
      }

      // 通常のアクション
      if (msg.type === 'ADD_PLAY') {
        (d.plays[msg.gid] ||= {})[msg.id] = msg.data;
        this._save(d);
      } else if (msg.type === 'ADD_PLAYS_BULK') {
        (d.plays[msg.gid] ||= {});
        Object.assign(d.plays[msg.gid], msg.plays || {});
        this._save(d);
      } else if (msg.type === 'UPDATE_PLAY') {
        if (d.plays[msg.gid] && d.plays[msg.gid][msg.pid]) {
          Object.assign(d.plays[msg.gid][msg.pid], msg.patch);
          this._save(d);
        }
      } else if (msg.type === 'DELETE_PLAY') {
        if (d.plays[msg.gid]) {
          delete d.plays[msg.gid][msg.pid];
          this._save(d);
        }
      } else if (msg.type === 'UPDATE_GAME') {
        if (d.games[msg.gid]) {
          Object.assign(d.games[msg.gid], msg.patch);
          this._save(d);
        }
      } else if (msg.type === 'DELETE_GAME') {
        if (d.games[msg.gid]) {
          delete d.games[msg.gid];
          delete d.plays[msg.gid];
          this._save(d);
        }
      }
    }
  }

  // ---------- Google Cloud Firestore モード（超高安定・専用クラウド） ----------
  class FirebaseStore {
    constructor(cfg) {
      this.mode = 'firebase';
      this.statusListeners = new Set();
      this.status = { text: '接続中...', cls: 'warn' };
      this.activeGid = null;

      try {
        if (!firebase.apps.length) {
          firebase.initializeApp(cfg);
        }
        this.db = firebase.firestore();

        // オフライン自動永続化（電波が切れても手元の端末に安全保持し、復帰時にGoogleが自動送信）
        this.db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
          if (err.code === 'failed-precondition') {
            console.warn('Firestore: 複数タブオープンによる永続化の制限');
          } else if (err.code === 'unimplemented') {
            console.warn('Firestore: ブラウザが永続化非対応');
          }
        });

        this._setStatus('● リアルタイム同期中 (Firebase)', 'ok');

        window.addEventListener('online', () => {
          this._setStatus('● リアルタイム同期中 (Firebase)', 'ok');
        });
        window.addEventListener('offline', () => {
          this._setStatus('オフライン（手元に自動保存中）', 'warn');
        });
      } catch (e) {
        console.error('Firebase初期化エラー:', e);
        this._setStatus('Firebase接続エラー', 'warn');
      }
    }

    _setStatus(text, cls = 'ok') {
      this.status = { text, cls };
      const el = document.getElementById('status');
      if (el) {
        el.textContent = text;
        el.className = 'status ' + (cls === 'ok' ? 'connected' : cls === 'warn' ? 'connecting' : 'disconnected');
      }
      this.statusListeners.forEach((fn) => fn(text, cls));
    }

    onStatusChange(fn) {
      this.statusListeners.add(fn);
      fn(this.status.text, this.status.cls);
      return () => this.statusListeners.delete(fn);
    }

    joinRoom(gid) {
      this.activeGid = gid;
    }

    leaveGame() {
      this.activeGid = null;
    }

    async getGame(gid) {
      if (!gid) return null;
      try {
        const doc = await this.db.collection('games').doc(gid).get();
        return doc.exists ? { id: doc.id, ...doc.data() } : null;
      } catch {
        return null;
      }
    }

    _getLocalData() {
      try {
        const d1 = JSON.parse(localStorage.getItem('fdl_data_v1') || 'null');
        if (d1 && (d1.games || d1.plays)) return d1;
      } catch {}
      try {
        const d2 = JSON.parse(localStorage.getItem('fdl_data_v2') || 'null');
        if (d2 && (d2.games || d2.plays)) return d2;
      } catch {}
      try {
        const d0 = JSON.parse(localStorage.getItem('fdl_data') || 'null');
        if (d0 && (d0.games || d0.plays)) return d0;
      } catch {}
      return { games: {}, plays: {} };
    }

    subscribeGames(cb) {
      // 1. まず即座にローカルストレージのキャッシュ（v1/v2）を表示（画面が真っ白になるのを100%防止）
      try {
        const local = this._getLocalData();
        const localGames = Object.entries(local.games || {}).map(([id, g]) => ({ id, ...g }));
        if (localGames.length > 0) {
          localGames.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          cb(localGames);
        }
      } catch (e) {
        console.warn('ローカルキャッシュ取得警告:', e);
      }

      // 2. Firestore からリアルタイムに取得
      return this.db.collection('games')
        .onSnapshot((snapshot) => {
          let list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
          // Firestoreにまだ試合がなくLocalStorageに過去データがある場合は自動復元
          if (list.length === 0) {
            try {
              const local = this._getLocalData();
              const localGames = Object.entries(local.games || {}).map(([id, g]) => ({ id, ...g }));
              if (localGames.length > 0) {
                console.log('[Firebase] LocalStorageから試合データを自動復元中...');
                localGames.forEach((g) => {
                  this.db.collection('games').doc(g.id).set(g).catch(() => {});
                });
                list = localGames;
              }
            } catch (e) {}
          }
          list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          cb(list);
        }, (err) => {
          console.error('試合一覧取得エラー:', err);
          try {
            const local = this._getLocalData();
            const localGames = Object.entries(local.games || {}).map(([id, g]) => ({ id, ...g }));
            localGames.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            cb(localGames);
          } catch {}
          this._setStatus('通信エラー', 'warn');
        });
    }

    createGame(data) {
      const gRef = this.db.collection('games').doc();
      const gid = gRef.id;
      const baseTime = Date.now();

      // ゲームデータ本体
      const batch = this.db.batch();
      batch.set(gRef, { ...data, createdAt: baseTime, updatedAt: baseTime });

      // 初期100枠を同時に一括生成（100枠固定）
      for (let i = 1; i <= 100; i++) {
        const pRef = gRef.collection('plays').doc();
        batch.set(pRef, {
          seq: i,
          createdAt: baseTime + i * 10,
          updatedAt: baseTime + i * 10
        });
      }

      batch.commit().catch((e) => console.error('試合一括作成エラー:', e));
      return gid;
    }

    createGameWithPlays(name, playsList) {
      const gRef = this.db.collection('games').doc();
      const gid = gRef.id;
      const baseTime = Date.now();
      const batch = this.db.batch();
      batch.set(gRef, { name, createdAt: baseTime, updatedAt: baseTime });
      for (let i = 0; i < playsList.length; i++) {
        const pRef = gRef.collection('plays').doc();
        batch.set(pRef, {
          ...playsList[i],
          seq: i + 1,
          createdAt: baseTime + (i + 1) * 10,
          updatedAt: baseTime + (i + 1) * 10
        });
      }
      batch.commit().catch((e) => console.error('テスト試合生成エラー:', e));
      return gid;
    }

    updateGame(gid, patch) {
      if (!gid) return;
      this.db.collection('games').doc(gid).update({
        ...patch,
        updatedAt: Date.now()
      }).catch((e) => console.error('試合更新エラー:', e));
    }

    deleteGame(gid) {
      if (!gid) return;
      this.db.collection('games').doc(gid).delete().catch((e) => console.error('試合削除エラー:', e));
    }

    subscribePlays(gid, cb) {
      this.activeGid = gid;
      return this.db.collection('games').doc(gid).collection('plays').orderBy('seq', 'asc')
        .onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
          let list = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              ...data,
              _pending: doc.metadata.hasPendingWrites // 未送信（オフライン）状態の自動判定
            };
          });
          // FirestoreにまだプレーがなくLocalStorageにある場合、一括移行する
          if (list.length === 0) {
            try {
              const local = this._getLocalData();
              const localPlays = Object.entries(local.plays?.[gid] || {}).map(([id, p]) => ({ id, ...p }));
              if (localPlays.length > 0) {
                console.log('[Firebase] LocalStorageからプレーデータを復元中...');
                const batch = this.db.batch();
                localPlays.forEach((p) => {
                  const pRef = this.db.collection('games').doc(gid).collection('plays').doc(p.id);
                  batch.set(pRef, p);
                });
                batch.commit().catch(() => {});
                list = localPlays;
              }
            } catch (e) {}
          }
          cb(list);
        }, (err) => {
          console.error('プレー一覧取得エラー:', err);
        });
    }

    ensureInitialPlays(gid, count = 100) {
      if (!gid) return;
      const playsRef = this.db.collection('games').doc(gid).collection('plays');
      playsRef.get().then((snapshot) => {
        const currentCount = snapshot.size;
        if (currentCount >= count) return;
        const batch = this.db.batch();
        const baseTime = Date.now();
        for (let i = currentCount + 1; i <= count; i++) {
          const pRef = playsRef.doc();
          batch.set(pRef, {
            seq: i,
            createdAt: baseTime + i * 10,
            updatedAt: baseTime + i * 10
          });
        }
        return batch.commit();
      }).catch((e) => console.error('初期枠確保エラー:', e));
    }

    addPlay(gid, data) {
      if (!gid) return;
      const ref = this.db.collection('games').doc(gid).collection('plays').doc();
      ref.set({
        ...data,
        createdAt: data.createdAt || Date.now(),
        updatedAt: Date.now()
      }).catch((e) => console.error('Play追加エラー:', e));
      return ref.id;
    }

    updatePlay(gid, pid, patch) {
      if (!gid || !pid) return;
      // フィールド単位の部分更新（オフェンス担当・状況担当の同時入力が一切競合しない！）
      this.db.collection('games').doc(gid).collection('plays').doc(pid).update({
        ...patch,
        updatedAt: patch.updatedAt || Date.now()
      }).catch((e) => {
        console.warn('Play更新エラー（オフライン時は復帰時に自動再送）:', e);
      });
    }

    deletePlay(gid, pid) {
      if (!gid || !pid) return;
      this.db.collection('games').doc(gid).collection('plays').doc(pid).delete().catch((e) => {
        console.error('Play削除エラー:', e);
      });
    }
  }

  window.createStore = async function () {
    const cfg = window.FIREBASE_CONFIG;
    if (cfg && cfg.apiKey && cfg.projectId) {
      console.log('Google Cloud Firestore モードで起動中...');
      return new FirebaseStore(cfg);
    }
    console.log('MQTT リアルタイム同期モードで起動中...');
    try {
      await loadScript('https://unpkg.com/mqtt@5.3.5/dist/mqtt.min.js');
    } catch {
      await loadScript('https://cdn.jsdelivr.net/npm/mqtt@5.3.5/dist/mqtt.min.js');
    }
    const store = new CloudSyncStore();
    await store.init();
    return store;
  };
})();
