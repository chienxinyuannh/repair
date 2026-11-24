(function () {
  'use strict';

  // ===== 儲存 =====
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var K_TOKEN = 'rp_token', K_DATA = 'rp_data';

  var S = {
    token: store.get(K_TOKEN) || '',
    data: parseJSON(store.get(K_DATA)),
    tab: null,
    form: null,
    photos: [],          // 這次要上傳的照片 dataUrl
    photoCache: {},      // 已下載的照片
    doneId: '',          // 剛送出的單號
    allFloor: '',
    detailId: '',
    work: {},            // 總務處理表單（依單號暫存，避免重畫時輸入不見）
    extra: {},           // 查詢結果裡、不在首頁資料中的單
    km: {},              // 各單「以前類似的處理」
    sq: { q: '', status: '' }, sRes: null,   // 查詢
    st: { range: 'month', from: '', to: '' }, sData: null   // 統計
  };

  var $app = document.getElementById('app');
  var $who = document.getElementById('who');
  var $modal = document.getElementById('modal');
  var $mbody = document.getElementById('modalBody');
  var $viewer = document.getElementById('viewer');

  // ===== 共用 =====
  function parseJSON(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, err) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast hidden'; }, err ? 4500 : 2200);
  }
  function busy(on, text) {
    if (on) { clearTimeout(toast._t); document.getElementById('toast').className = 'toast hidden'; }
    document.getElementById('busy').className = on ? 'busy' : 'busy hidden';
    document.getElementById('busyText').textContent = on && text ? text : '';
  }

  function api(action, payload, quiet, text) {
    if (!window.CONFIG || !window.CONFIG.API_URL) { toast('尚未設定系統網址（config.js）', true); return Promise.reject({}); }
    var body = Object.assign({ action: action, token: S.token }, payload || {});
    if (!quiet) busy(true, text);
    return fetch(window.CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: '連線失敗，請確認網路後再試', net: true }; })
      .then(function (res) {
        if (!quiet) busy(false);
        if (!res.ok) {
          if (res.code === 'AUTH') { resetLocal(); toast(res.error, true); return Promise.reject(res); }
          if (!quiet) toast(res.error, true);
          return Promise.reject(res);
        }
        return res.data;
      });
  }

  function setData(d) {
    S.data = d;
    store.set(K_DATA, JSON.stringify(d));
  }
  // 正在輸入時不重畫，免得游標跑掉
  function safeRender() {
    var a = document.activeElement;
    if (a && $app.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
    if (!$modal.classList.contains('hidden')) return;
    render();
  }
  function refresh() {
    if (!S.token) return Promise.resolve();
    return api('bootstrap', null, true).then(function (d) { setData(d); safeRender(); }, function () {});
  }

  function ymd(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function diff(a, b) { return Math.round((ymd(b) - ymd(a)) / 86400000); }
  var WK = ['日', '一', '二', '三', '四', '五', '六'];
  function md(s) { if (!s) return ''; var d = new Date(ymd(s.slice(0, 10))); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '（' + WK[d.getUTCDay()] + '）'; }
  function mdt(s) { return s ? md(s) + ' ' + s.slice(11, 16) : ''; }
  function today() { return S.data ? S.data.today : ''; }

  function openModal(html) { $mbody.innerHTML = html; $modal.className = 'modal'; }
  function closeModal() { $modal.className = 'modal hidden'; $mbody.innerHTML = ''; S.detailId = ''; }
  $modal.addEventListener('click', function (e) { if (e.target === $modal) closeModal(); });
  $viewer.addEventListener('click', function () { $viewer.className = 'viewer hidden'; });
  function viewPhoto(src) { document.getElementById('viewerImg').src = src; $viewer.className = 'viewer'; }

  var FINAL = { '已結案': 1, '報廢': 1, '退回': 1 };
  function role() { return S.data ? S.data.user.role : ''; }
  function tickets() { return S.data ? S.data.tickets : []; }
  function byId(id) { return tickets().filter(function (t) { return t.id === id; })[0] || S.extra[id]; }

  // ===== 驗證 =====
  function resetLocal() {
    store.del(K_TOKEN); store.del(K_DATA);
    S.token = ''; S.data = null;
    closeModal();
    renderVerify();
  }

  function renderVerify() {
    $who.innerHTML = '';
    $app.innerHTML =
      '<form class="verify" id="vf">' +
      '<h1>第一次使用，請確認身分</h1>' +
      '<p class="muted small">驗證一次，這支手機或電腦就會記住你，之後打開直接使用。</p>' +
      '<label for="vn">姓名</label><input type="text" id="vn" autocomplete="name" required>' +
      '<label for="vp">手機號碼</label><input type="tel" id="vp" inputmode="numeric" autocomplete="tel" placeholder="09xxxxxxxx" required>' +
      '<button class="btn primary block" type="submit">確認</button>' +
      '<p class="muted small" style="margin-top:14px">名單由主任建立。輸入正確仍無法通過，請洽主任。</p>' +
      '</form>';
    document.getElementById('vf').onsubmit = function (e) {
      e.preventDefault();
      var name = document.getElementById('vn').value, phone = document.getElementById('vp').value;
      api('login', { name: name, phone: phone }, false, '確認中…').then(function (r) {
        S.token = r.token;
        store.set(K_TOKEN, r.token);
        setData(r.data);
        S.tab = null;
        render();
        toast('驗證完成，歡迎 ' + r.data.user.name);
      }, function () {});
    };
  }

  function switchUser() {
    openModal('<h2>換人使用</h2><p>這台裝置會忘記「' + esc(S.data.user.name) + '」，下次要重新驗證身分。</p>' +
      '<p class="muted small">公用電腦或手機交給別人用時才需要。</p>' +
      '<div class="foot"><button class="btn" id="cx">取消</button><button class="btn danger" id="ok">確定</button></div>');
    document.getElementById('cx').onclick = closeModal;
    document.getElementById('ok').onclick = function () {
      api('logout', null, true).then(resetLocal, resetLocal);
    };
  }

  // ===== 主畫面 =====
  // 總務的清單分組
  var GA_LISTS = {
    gaNew: ['待接單'],
    gaWork: ['處理中', '待料', '委外處理中'],
    gaSign: ['待主任核示', '待結案簽核']
  };
  function inStatus(list) { return tickets().filter(function (t) { return list.indexOf(t.status) >= 0; }); }

  function tabsFor() {
    var mineOpen = tickets().filter(function (t) { return t.mine && !FINAL[t.status]; }).length;
    var open = tickets().filter(function (t) { return !FINAL[t.status]; }).length;
    if (role() === '總務') {
      var nNew = inStatus(GA_LISTS.gaNew).length;
      return [
        { k: 'gaNew', label: '待接單', n: nNew, alert: nNew > 0 },
        { k: 'gaWork', label: '處理中', n: inStatus(GA_LISTS.gaWork).length },
        { k: 'gaSign', label: '待簽核', n: inStatus(GA_LISTS.gaSign).length },
        { k: 'search', label: '查詢' },
        { k: 'stats', label: '統計' }
      ];
    }
    return [
      { k: 'new', label: '我要報修' },
      { k: 'mine', label: '我的報修', n: mineOpen },
      { k: 'all', label: '進行中', n: open }
    ];
  }

  function defaultTab() {
    if (role() === '總務') return inStatus(GA_LISTS.gaNew).length ? 'gaNew' : 'gaWork';
    return 'new';
  }

  function render() {
    if (!S.token || !S.data) { renderVerify(); return; }
    var u = S.data.user;
    $who.innerHTML = (canWorkRole() ? '<button class="hbtn' + (S.tab === 'new' ? ' on' : '') + '" id="hNew">＋報修</button>' : '') +
      esc(u.name) + (u.role !== '一般' ? '<span class="role">' + esc(u.role) + '</span>' : '');
    var hn = document.getElementById('hNew');
    if (hn) hn.onclick = function () { S.tab = 'new'; S.tabAuto = false; S.doneId = ''; render(); window.scrollTo(0, 0); };
    if (!S.tab || S.tabAuto) { S.tab = defaultTab(); S.tabAuto = true; }
    var tabs = tabsFor();
    var html = '<div class="nav">' + tabs.map(function (t) {
      return '<button data-tab="' + t.k + '" class="' + (S.tab === t.k ? 'on' : '') + '">' + t.label +
        (t.n ? '<span class="n' + (t.alert ? ' alert' : '') + '">' + t.n + '</span>' : '') + '</button>';
    }).join('') + '</div>';
    if (S.tab !== 'new' && !tabs.some(function (t) { return t.k === S.tab; })) S.tab = defaultTab();
    if (S.tab === 'new') html += S.doneId ? viewDone() : viewForm();
    else if (S.tab === 'mine') html += viewMine();
    else if (S.tab === 'all') html += viewAll();
    else if (GA_LISTS[S.tab]) html += viewGaList(S.tab);
    else if (S.tab === 'search') html += viewSearch();
    else if (S.tab === 'stats') html += viewStats();
    html += '<div class="foot-note">' + esc(u.name) + ' 使用中　<button class="link" id="switchUser">換人使用</button></div>';
    $app.innerHTML = html;
    bind();
  }

  function bind() {
    Array.prototype.forEach.call($app.querySelectorAll('[data-tab]'), function (b) {
      b.onclick = function () { S.tab = b.getAttribute('data-tab'); S.tabAuto = false; S.doneId = ''; render(); window.scrollTo(0, 0); };
    });
    Array.prototype.forEach.call($app.querySelectorAll('.card[data-id]'), function (c) {
      c.onclick = function () { openDetail(c.getAttribute('data-id')); };
    });
    var su = document.getElementById('switchUser');
    if (su) su.onclick = switchUser;
    if (S.tab === 'new') bindForm();
    var af = document.getElementById('allFloor');
    if (af) af.onchange = function () { S.allFloor = af.value; render(); };
    // 卡片上的快速接單
    Array.prototype.forEach.call($app.querySelectorAll('[data-accept]'), function (b) {
      b.onclick = function (e) { e.stopPropagation(); doAccept(b.getAttribute('data-accept')); };
    });
    if (S.tab === 'search') bindSearch();
    if (S.tab === 'stats') bindStats();
  }

  // ===== 報修表單 =====
  function blankForm() {
    return { urgency: '', floor: '', location: '', category: '', item: '', problem: '', needDate: '' };
  }

  function viewForm() {
    if (!S.form) S.form = blankForm();
    var f = S.form, o = S.data.options, U = S.data.urgency;
    var uDesc = { '一般': '7 天內', '急件': '3 天內', '立即處理': '1 天內，影響住民安全' };
    var h = '<div class="form">';
    h += '<label>報修人員</label><div class="fixed">' + esc(S.data.user.name) + '　<span class="muted small">報修日期 ' + md(today()) + '</span></div>';

    h += '<label>緊急程度<span class="req">*</span></label><div class="choices u3">' +
      ['一般', '急件', '立即處理'].filter(function (k) { return U[k]; }).map(function (k) {
        return '<button type="button" class="choice u-' + k + (f.urgency === k ? ' on' : '') + '" data-u="' + k + '">' + k + '<small>' + uDesc[k] + '</small></button>';
      }).join('') + '</div>';
    if (f.urgency === '立即處理') h += '<div class="alertbox bad">影響住民安全的狀況，送出後請同時當面或打電話告知總務。</div>';

    h += '<div class="grid2"><div><label for="fFloor">樓層區域<span class="req">*</span></label><select id="fFloor"><option value="">請選擇</option>' +
      o['樓層區域'].map(function (v) { return '<option' + (f.floor === v ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') + '</select></div>' +
      '<div><label for="fLoc">地點描述<span class="req">*</span></label><input type="text" id="fLoc" maxlength="100" placeholder="例如：護理站旁洗手台、305 房" value="' + esc(f.location) + '"></div></div>';

    h += sameFloorBox(f.floor);

    h += '<label>報修類別<span class="req">*</span></label><div class="choices">' +
      o['報修類別'].map(function (v) {
        return '<button type="button" class="choice' + (f.category === v ? ' on' : '') + '" data-c="' + esc(v) + '">' + esc(v) + '</button>';
      }).join('') + '</div>';

    h += '<label for="fItem">報修項目<span class="req">*</span></label><input type="text" id="fItem" maxlength="100" placeholder="例如：水龍頭、電動床、門鎖" value="' + esc(f.item) + '">';
    h += '<label for="fProb">簡述問題<span class="req">*</span></label><textarea id="fProb" maxlength="1000" placeholder="例如：關不緊，一直滴水">' + esc(f.problem) + '</textarea>';

    h += '<label>照片<span class="opt">選填，最多 5 張</span></label><div class="photos" id="newPhotos">' +
      S.photos.map(function (p, i) {
        return '<div class="ph"><img src="' + p + '" data-view="' + i + '"><button type="button" class="x" data-rm="' + i + '">✕</button></div>';
      }).join('') +
      (S.photos.length < 5 ? '<label class="addph" for="fPhoto"><b>＋</b>拍照</label>' : '') +
      '</div><input type="file" id="fPhoto" accept="image/*" multiple class="hidden">' +
      '<div class="hint">拍下損壞的地方，總務不用先跑一趟就能判斷。</div>';

    h += '<label for="fNeed">需求日期<span class="opt">選填</span></label><input type="date" id="fNeed" min="' + today() + '" value="' + esc(f.needDate) + '">';

    h += '<button class="btn primary block" id="fSend" type="button">送出報修</button>';
    h += '</div>';
    return h;
  }

  // 同一樓層區域還沒結束的單，避免重複報修
  function sameFloorBox(floor) {
    if (!floor) return '';
    var list = tickets().filter(function (t) { return t.floor === floor && !FINAL[t.status]; });
    if (!list.length) return '';
    return '<div class="alertbox">' + esc(floor) + ' 目前有 ' + list.length + ' 件報修還在處理，先看看是不是同一件：' +
      list.slice(0, 5).map(card).join('') + '</div>';
  }

  function bindForm() {
    var f = S.form;
    if (!f) {   // 完成畫面
      var again = document.getElementById('again');
      if (again) again.onclick = function () { S.doneId = ''; render(); };
      var seeMine = document.getElementById('seeMine');
      if (seeMine) seeMine.onclick = function () { S.doneId = ''; S.tab = 'mine'; S.tabAuto = false; render(); };
      return;
    }
    Array.prototype.forEach.call($app.querySelectorAll('[data-u]'), function (b) {
      b.onclick = function () { f.urgency = b.getAttribute('data-u'); render(); };
    });
    Array.prototype.forEach.call($app.querySelectorAll('[data-c]'), function (b) {
      b.onclick = function () { f.category = b.getAttribute('data-c'); render(); };
    });
    var bindVal = function (id, k, rerender) {
      var el = document.getElementById(id);
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () { f[k] = el.value; if (rerender) render(); });
    };
    bindVal('fFloor', 'floor', true);
    bindVal('fLoc', 'location');
    bindVal('fItem', 'item');
    bindVal('fProb', 'problem');
    bindVal('fNeed', 'needDate');
    document.getElementById('fPhoto').onchange = function (e) { addFiles(e.target.files, S.photos, 5, render); e.target.value = ''; };
    Array.prototype.forEach.call($app.querySelectorAll('[data-rm]'), function (b) {
      b.onclick = function () { S.photos.splice(+b.getAttribute('data-rm'), 1); render(); };
    });
    Array.prototype.forEach.call($app.querySelectorAll('#newPhotos [data-view]'), function (im) {
      im.onclick = function () { viewPhoto(im.src); };
    });
    document.getElementById('fSend').onclick = submit;
  }

  function submit() {
    var f = S.form;
    var miss = [];
    if (!f.urgency) miss.push('緊急程度');
    if (!f.floor) miss.push('樓層區域');
    if (!f.location.trim()) miss.push('地點描述');
    if (!f.category) miss.push('報修類別');
    if (!f.item.trim()) miss.push('報修項目');
    if (!f.problem.trim()) miss.push('簡述問題');
    if (miss.length) { toast('還沒填：' + miss.join('、'), true); return; }
    var photos = S.photos.map(function (p) { return { dataUrl: p }; });
    api('createTicket', { fields: f, photos: photos }, false, photos.length ? '上傳照片中…' : '送出中…').then(function (d) {
      setData(d);
      S.doneId = d.result.id;
      S.form = null;
      S.photos = [];
      render();
      window.scrollTo(0, 0);
    }, function () {});
  }

  function viewDone() {
    var t = byId(S.doneId) || {};
    return '<div class="done-box"><div class="muted">報修已送出</div><div class="big">' + esc(S.doneId) + '</div>' +
      '<div>' + esc(t.floor || '') + ' ' + esc(t.location || '') + '　' + esc(t.item || '') + '</div>' +
      '<p class="muted small">總務打開系統就會看到。要知道處理進度，到「我的報修」查看。</p>' +
      (t.urgency === '立即處理' ? '<div class="alertbox bad">這是「立即處理」，請記得當面或打電話告知總務。</div>' : '') +
      '<div class="foot" style="display:flex;gap:8px;margin-top:18px"><button class="btn" id="seeMine" style="flex:1">我的報修</button><button class="btn primary" id="again" style="flex:1">再報一件</button></div></div>';
  }

  // 照片壓縮：長邊 1600px、JPEG 品質 0.8，手機照片大約剩 200～400 KB
  function compress(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1600, w = img.naturalWidth, h = img.naturalHeight, r = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.round(w * r); c.height = Math.round(h * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('讀不到這張照片')); };
      img.src = url;
    });
  }
  function addFiles(files, target, max, done) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var room = max - target.length;
    if (list.length > room) toast('最多 ' + max + ' 張，多的沒有加入', true);
    list = list.slice(0, room);
    busy(true, '處理照片中…');
    Promise.all(list.map(function (f) { return compress(f).catch(function () { return null; }); })).then(function (urls) {
      busy(false);
      var bad = 0;
      urls.forEach(function (u) { if (u) target.push(u); else bad++; });
      if (bad) toast(bad + ' 張照片讀不到，請換一張', true);
      done();
    });
  }

  // ===== 清單 =====
  function card(t) {
    var cls = 'card' + (t.overdue ? ' overdue' : '') + (FINAL[t.status] ? ' done' : '');
    var due = '';
    if (t.overdue) due = '<div class="meta bad">逾期 ' + diff(t.dueDate, today()) + ' 天（應完成 ' + md(t.dueDate) + '）</div>';
    else if (!FINAL[t.status] && t.dueDate) due = '<div class="meta">應完成 ' + md(t.dueDate) + '</div>';
    return '<div class="' + cls + '" data-id="' + esc(t.id) + '">' +
      '<h3><span class="no">' + esc(t.id) + '</span>' + esc(t.item) +
      ' <span class="tag s-' + esc(t.status) + '">' + esc(t.status) + '</span>' +
      (t.urgency !== '一般' && !FINAL[t.status] ? '<span class="tag u-' + esc(t.urgency) + '">' + esc(t.urgency) + '</span>' : '') +
      '</h3>' +
      '<div class="meta">' + esc(t.floor) + '　' + esc(t.location) + '　' + esc(t.category) + (t.asset && role() !== '一般' ? '　<span class="tag">' + esc(t.asset) + '</span>' : '') + '</div>' +
      '<div class="meta">' + esc(t.reporterName) + ' ' + md(t.reportDate) + ' 報修' +
      (t.acceptedBy && t.status !== '待接單' && role() !== '一般' ? '　' + esc(t.acceptedBy) + ' 處理' : '') + '</div>' + due +
      (t.status === '待接單' && canWorkRole() ? '<div class="acts"><button class="btn primary sm" data-accept="' + esc(t.id) + '">接單</button></div>' : '') +
      '</div>';
  }

  function canWorkRole() { return role() === '總務' || role() === '主任'; }

  var RANK = { '立即處理': 0, '急件': 1, '一般': 2 };
  function byUrgent(a, b) {
    return (b.overdue - a.overdue) || (RANK[a.urgency] - RANK[b.urgency]) || (a.reportDate < b.reportDate ? -1 : a.reportDate > b.reportDate ? 1 : 0);
  }

  function viewGaList(k) {
    var list = inStatus(GA_LISTS[k]).sort(byUrgent);
    var hint = {
      gaNew: '新進的報修單。按「接單」開始處理，報修內容有誤可以退回。',
      gaWork: '已接的單。點開填維修紀錄、送核示或送結案。',
      gaSign: '等主任簽核的單，不用處理。主任退回的會回到「處理中」。'
    }[k];
    var late = list.filter(function (t) { return t.overdue; }).length;
    var h = '<div class="muted small" style="margin:0 2px 10px">' + hint + (late ? '　<b style="color:var(--bad)">逾期 ' + late + ' 件</b>' : '') + '</div>';
    if (k === 'gaWork') {
      var back = list.filter(function (t) { return t.status === '處理中' && (t.approvalResult === '退回' || t.closeResult === '退回'); });
      if (back.length) h += '<div class="alertbox bad">主任退回 ' + back.length + ' 件，請看單上的退回意見。</div>';
    }
    h += list.length ? list.map(card).join('') : '<div class="empty">目前沒有</div>';
    return h;
  }

  function viewMine() {
    var mine = tickets().filter(function (t) { return t.mine; });
    if (!mine.length) return '<div class="empty">你還沒有報修過</div>';
    var open = mine.filter(function (t) { return !FINAL[t.status]; });
    var done = mine.filter(function (t) { return FINAL[t.status]; });
    var h = '';
    if (open.length) h += '<div class="group">處理中 ' + open.length + ' 件</div>' + open.map(card).join('');
    if (done.length) h += '<div class="group">已結束（近半年）</div>' + done.map(card).join('');
    return h;
  }

  function viewAll() {
    var floors = S.data.options['樓層區域'];
    var list = tickets().filter(function (t) { return !FINAL[t.status] && (!S.allFloor || t.floor === S.allFloor); });
    list.sort(byUrgent);   // 逾期與緊急的排前面
    var h = '<div class="toolbar"><select id="allFloor"><option value="">全部樓層區域</option>' +
      floors.map(function (v) { return '<option' + (S.allFloor === v ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') +
      '</select><span class="muted small">共 ' + list.length + ' 件</span></div>';
    h += list.length ? list.map(card).join('') : '<div class="empty">沒有進行中的報修</div>';
    return h;
  }

  // ===== 單據明細 =====
  function openDetail(id) {
    var t = byId(id);
    if (!t) return;
    S.detailId = id;
    openModal(detailHtml(t, null));
    bindDetail(t, null);
    api('getTicket', { id: id }, true).then(function (d) {
      if (S.detailId !== id) return;
      openModal(detailHtml(d.ticket, d));
      bindDetail(d.ticket, d);
    }, function (err) { if (S.detailId === id) toast(err && err.error ? err.error : '讀取失敗', true); });
  }

  function kv(label, v) { return v ? '<dt>' + label + '</dt><dd>' + esc(v) + '</dd>' : ''; }
  function money(v) { return v === '' || v == null ? '' : Number(v).toLocaleString('zh-TW') + ' 元'; }

  var WORKABLE = { '處理中': 1, '待料': 1, '委外處理中': 1 };
  function canWork(t) { return canWorkRole() && WORKABLE[t.status]; }

  function detailHtml(t, d) {
    var h = '<h2><span class="muted" style="font-weight:500">' + esc(t.id) + '</span>' + esc(t.item) +
      '<span class="tag s-' + esc(t.status) + '">' + esc(t.status) + '</span>' +
      (t.overdue ? '<span class="tag late">逾期</span>' : '') + '</h2>';
    if (t.status === '退回' && t.returnReason) h += '<div class="note bad">退回原因：' + esc(t.returnReason) + '</div>';
    if (t.status === '處理中' && t.closeResult === '退回' && t.closeComment) h += '<div class="note bad">主任結案退回：' + esc(t.closeComment) + '</div>';
    else if (t.status === '處理中' && t.approvalResult === '退回' && t.approvalComment) h += '<div class="note bad">主任核示退回：' + esc(t.approvalComment) + '</div>';
    if (t.status === '委外處理中' && t.approvalComment) h += '<div class="note">主任核准委外：' + esc(t.approvalComment) + '</div>';
    h += '<dl class="kv">' +
      kv('地點', t.floor + '　' + t.location) +
      kv('報修類別', t.category) +
      kv('緊急程度', t.urgency + (t.dueDate && !FINAL[t.status] ? '（應完成 ' + md(t.dueDate) + '）' : '')) +
      kv('簡述問題', t.problem) +
      kv('報修人員', t.reporterName + '　' + md(t.reportDate)) +
      kv('需求日期', t.needDate ? md(t.needDate) : '') +
      '</dl>';

    var editing = d && canWork(t);
    if (!editing) {
      var work = kv('設備品項', t.asset) + kv('處理方式', t.method) + kv('接單', t.acceptedBy ? t.acceptedBy + '　' + mdt(t.acceptedAt) : '') +
        kv('維修紀錄', t.record) + kv('廠商', [t.vendor, t.vendorContact, t.vendorPhone].filter(Boolean).join('　')) +
        kv('估價金額', money(t.quote)) + kv('評估說明', t.assessment) +
        kv('材料費', money(t.materialCost)) + kv('工時', t.laborHours ? t.laborHours + ' 小時' : '') + kv('委外費用', money(t.vendorCost)) +
        kv('結案結果', FINAL[t.status] || t.status === '待結案簽核' ? t.result : '') + kv('備註', t.note);
      if (work) h += '<div class="sec">處理情形</div><dl class="kv">' + work + '</dl>';
    }

    h += '<div class="sec">照片</div>';
    if (!d) h += '<div class="muted small">讀取中…</div>';
    else {
      h += '<div class="photos" id="dPhotos">' + d.photos.map(function (p) {
        var src = S.photoCache[p.id];
        return '<div class="ph' + (src ? '' : ' load') + '" data-pid="' + esc(p.id) + '">' +
          (src ? '<img src="' + src + '">' : '載入中') + '<span class="k">' + esc(p.kind) + '</span></div>';
      }).join('') + (canAddPhoto(t) ? '<label class="addph" for="dPhoto"><b>＋</b>' + (role() === '一般' ? '加照片' : '處理後照片') + '</label>' : '') + '</div>' +
        '<input type="file" id="dPhoto" accept="image/*" multiple class="hidden">';
      if (!d.photos.length && !canAddPhoto(t)) h += '<div class="muted small">沒有照片</div>';

      if (editing) h += workHtml(t, d);

      h += '<div class="sec">處理紀錄</div><ul class="timeline">' + d.history.map(function (x) {
        return '<li><b>' + esc(x.to) + '</b>　' + esc(x.by) + ' <span class="t">' + mdt(x.at) + '</span>' +
          (x.comment ? '<div class="small">' + esc(x.comment) + '</div>' : '') + '</li>';
      }).join('') + '</ul>';
    }

    h += '<div id="ask"></div><div class="foot" id="dFoot">';
    if (t.mine && t.status === '待接單') h += '<button class="btn danger" id="dCancel">撤回這張單</button>';
    if (canWorkRole() && t.status === '待接單') h += '<button class="btn danger" id="dReturn">退回</button><button class="btn primary" id="dAccept">接單</button>';
    h += '<button class="btn" id="dClose">關閉</button></div>';
    return h;
  }

  // ===== 總務處理表單 =====
  function workOf(t) {
    if (!S.work[t.id]) {
      var w = {};
      ['asset', 'method', 'record', 'vendor', 'vendorContact', 'vendorPhone', 'quote', 'assessment', 'materialCost', 'laborHours', 'vendorCost', 'note']
        .forEach(function (k) { w[k] = t[k] || ''; });
      S.work[t.id] = w;
    }
    return S.work[t.id];
  }

  function wInput(k, label, opts) {
    opts = opts || {};
    var w = S.work[S.detailId];
    var tag = opts.area ? '<textarea' : '<input type="text"' + (opts.num ? ' inputmode="decimal"' : '');
    return '<label for="w_' + k + '">' + label + (opts.req ? '<span class="req">*</span>' : '') + (opts.opt ? '<span class="opt">' + opts.opt + '</span>' : '') + '</label>' +
      tag + ' id="w_' + k + '" data-w="' + k + '"' + (opts.ph ? ' placeholder="' + opts.ph + '"' : '') +
      (opts.area ? '>' + esc(w[k]) + '</textarea>' : ' value="' + esc(w[k]) + '">');
  }

  function workHtml(t) {
    var w = workOf(t);
    var out = w.method === '委外修繕' || t.status === '委外處理中';
    var h = '<div class="sec">以前類似的處理</div><div id="km">' + kmHtml(S.km[t.id]) + '</div>';
    h += '<div class="sec">處理</div>';
    h += '<label for="w_asset">設備品項<span class="req">*</span><span class="opt">統計與查詢用，選以前用過的名稱</span></label>' +
      '<input type="text" id="w_asset" data-w="asset" list="assetList" placeholder="例如：水龍頭、電動床、冷氣" value="' + esc(w.asset) + '">' +
      '<datalist id="assetList">' + (S.data.assets || []).map(function (a) { return '<option value="' + esc(a) + '">'; }).join('') + '</datalist>';
    h += '<label>處理方式<span class="req">*</span></label><div class="choices">' +
      ['內部修繕', '委外修繕'].map(function (m) {
        var dis = t.status === '委外處理中' && m === '內部修繕';
        return '<button type="button" class="choice' + (w.method === m ? ' on' : '') + '" data-m="' + m + '"' + (dis ? ' disabled' : '') + '>' + m + '</button>';
      }).join('') + '</div>';
    h += wInput('record', '維修紀錄', { area: true, req: true, ph: '做了什麼、換了什麼零件' });
    if (out) {
      h += '<div class="grid2">' + wInput('vendor', '廠商名稱', { req: true }) + '<div>' + wInput('vendorContact', '聯絡人') + '</div></div>';
      h += '<div class="grid2"><div>' + wInput('vendorPhone', '電話') + '</div><div>' + wInput('quote', '估價金額（元）', { num: true, req: true }) + '</div></div>';
    }
    h += wInput('assessment', '評估說明', { area: true, opt: '送委外或報廢核示時必填', ph: '為什麼要委外或報廢、比價情形' });
    h += '<div class="grid2"><div>' + wInput('materialCost', '材料費（元）', { num: true }) + '</div><div>' + wInput('laborHours', '工時（小時）', { num: true }) + '</div></div>';
    if (out) h += wInput('vendorCost', '委外費用（元）', { num: true, opt: '委外完工送結案時必填' });
    h += wInput('note', '備註');

    h += '<div class="acts" style="margin-top:14px">';
    h += '<button class="btn" id="wSave">儲存</button>';
    if (t.status === '處理中') h += '<button class="btn" id="wWait">改待料</button>';
    if (t.status === '待料') h += '<button class="btn" id="wResume">料到了，回處理中</button>';
    if (t.status !== '委外處理中') {
      h += '<button class="btn" id="wOut">送委外核示</button><button class="btn" id="wScrap">送報廢核示</button>';
    }
    h += '<button class="btn primary" id="wClose">送結案簽核</button>';
    if (t.status !== '委外處理中') h += '<button class="btn danger" id="wReturn">退回</button>';
    h += '</div>';
    return h;
  }

  // 在明細裡展開一個確認區，取代跳出視窗
  function ask(opts) {
    var box = document.getElementById('ask');
    box.innerHTML = '<div class="askbox' + (opts.danger ? ' bad' : '') + '"><b>' + esc(opts.title) + '</b>' +
      (opts.body || '') +
      (opts.input ? '<textarea id="askText" placeholder="' + esc(opts.placeholder || '') + '"></textarea>' : '') +
      '<div class="foot"><button class="btn" id="askNo">取消</button><button class="btn ' + (opts.danger ? 'danger' : 'primary') + '" id="askOk">' + esc(opts.ok || '確定') + '</button></div></div>';
    document.getElementById('dFoot').classList.add('hidden');
    box.scrollIntoView({ block: 'center' });
    var txt = document.getElementById('askText');
    if (txt) txt.focus();
    document.getElementById('askNo').onclick = function () { box.innerHTML = ''; document.getElementById('dFoot').classList.remove('hidden'); };
    document.getElementById('askOk').onclick = function () {
      var v = txt ? txt.value.trim() : '';
      if (opts.input && opts.required && !v) { toast(opts.requiredMsg || '請填寫', true); return; }
      opts.onOk(v);
    };
  }

  function checkRow(okFlag, text) { return '<li class="' + (okFlag ? 'ok' : 'no') + '">' + (okFlag ? '✓ ' : '！') + esc(text) + '</li>'; }

  function after(r, msg, keepOpen, id) {
    setData(r);
    if (id) delete S.work[id];
    toast(msg);
    if (keepOpen) openDetail(id); else { closeModal(); render(); }
  }

  function doAccept(id) {
    api('accept', { id: id }, false, '接單中…').then(function (r) {
      after(r, '已接單 ' + id, true, id);
    }, function () {});
  }

  function bindWork(t, d) {
    var w = workOf(t);
    Array.prototype.forEach.call($mbody.querySelectorAll('[data-w]'), function (el) {
      el.addEventListener('input', function () { w[el.getAttribute('data-w')] = el.value; });
    });
    Array.prototype.forEach.call($mbody.querySelectorAll('[data-m]'), function (b) {
      b.onclick = function () {
        w.method = b.getAttribute('data-m');
        var y = $mbody.scrollTop;
        openModal(detailHtml(t, d)); bindDetail(t, d);
        $mbody.scrollTop = y;
      };
    });
    var assetEl = document.getElementById('w_asset');
    assetEl.addEventListener('change', function () { loadKm(t, true); });
    if (!S.km[t.id]) loadKm(t); else bindKm();
    var fields = function () { return Object.assign({}, w); };
    var afterPhotos = d.photos.filter(function (p) { return p.kind === '處理後'; }).length;

    document.getElementById('wSave').onclick = function () {
      api('saveWork', { id: t.id, fields: fields() }, false, '儲存中…').then(function (r) { after(r, '已儲存', true, t.id); }, function () {});
    };
    var wait = document.getElementById('wWait');
    if (wait) wait.onclick = function () {
      ask({ title: '改成待料', input: true, placeholder: '等什麼料、預計何時到（選填）', ok: '改待料', onOk: function (v) {
        api('setWaiting', { id: t.id, waiting: true, comment: v, fields: fields() }, false).then(function (r) { after(r, '已改成待料', false, t.id); }, function () {});
      } });
    };
    var resume = document.getElementById('wResume');
    if (resume) resume.onclick = function () {
      api('setWaiting', { id: t.id, waiting: false, fields: fields() }, false).then(function (r) { after(r, '回到處理中', true, t.id); }, function () {});
    };
    var out = document.getElementById('wOut');
    if (out) out.onclick = function () {
      var miss = [];
      if (!w.asset.trim()) miss.push('設備品項');
      if (!w.vendor.trim()) miss.push('廠商名稱');
      if (!String(w.quote).trim()) miss.push('估價金額');
      if (!w.assessment.trim()) miss.push('評估說明');
      if (miss.length) {
        if (w.method !== '委外修繕') { w.method = '委外修繕'; openModal(detailHtml(t, d)); bindDetail(t, d); }
        toast('送委外核示要先填：' + miss.join('、'), true);
        return;
      }
      ask({ title: '送主任核示：委外修繕', ok: '送出',
        body: '<ul class="check">' + checkRow(true, '廠商：' + w.vendor) + checkRow(true, '估價：' + money(String(w.quote).replace(/,/g, ''))) + checkRow(true, '評估：' + w.assessment) + '</ul>',
        onOk: function () {
          api('submitApproval', { id: t.id, type: '委外', fields: fields() }, false, '送出中…').then(function (r) { after(r, '已送主任核示', false, t.id); }, function () {});
        } });
    };
    var scrap = document.getElementById('wScrap');
    if (scrap) scrap.onclick = function () {
      if (!w.asset.trim()) { toast('送報廢核示要先填設備品項', true); assetEl.focus(); return; }
      if (!w.assessment.trim()) { toast('送報廢核示要先填評估說明', true); document.getElementById('w_assessment').focus(); return; }
      ask({ title: '送主任核示：報廢', ok: '送出', danger: true,
        body: '<ul class="check">' + checkRow(true, '評估：' + w.assessment) + '</ul><div class="small">主任核准後直接進「待結案簽核」，結案結果為報廢。</div>',
        onOk: function () {
          api('submitApproval', { id: t.id, type: '報廢', fields: fields() }, false, '送出中…').then(function (r) { after(r, '已送主任核示', false, t.id); }, function () {});
        } });
    };
    document.getElementById('wClose').onclick = function () {
      var isOut = t.status === '委外處理中';
      var miss = [];
      if (!w.asset.trim()) miss.push('設備品項');
      if (!w.method) miss.push('處理方式');
      if (!w.record.trim()) miss.push('維修紀錄');
      if (isOut && !String(w.vendorCost).trim()) miss.push('委外費用');
      if (miss.length) { toast('送結案要先填：' + miss.join('、'), true); return; }
      var hasCost = String(w.materialCost).trim() || String(w.vendorCost).trim() || String(w.laborHours).trim();
      ask({ title: '送主任結案簽核', ok: '送出',
        body: '<ul class="check">' +
          checkRow(true, '設備品項：' + w.asset) +
          checkRow(true, '處理方式：' + w.method) +
          checkRow(true, '維修紀錄已填') +
          checkRow(!!hasCost, hasCost ? '費用或工時已填' : '沒有填費用或工時，確定不用嗎？') +
          checkRow(afterPhotos > 0, afterPhotos ? '處理後照片 ' + afterPhotos + ' 張' : '沒有處理後照片，建議先拍一張') +
          checkRow(true, '現場已恢復、報修人知道修好了') +
          '</ul>',
        onOk: function () {
          api('submitClose', { id: t.id, fields: fields() }, false, '送出中…').then(function (r) { after(r, '已送主任結案簽核', false, t.id); }, function () {});
        } });
    };
    var ret = document.getElementById('wReturn');
    if (ret) ret.onclick = function () { askReturn(t); };
  }

  function askReturn(t) {
    ask({ title: '退回 ' + t.id, input: true, required: true, requiredMsg: '請填退回原因', danger: true, ok: '退回',
      placeholder: '例如：重複報修（同 RP-0012）、不需處理',
      body: '<div class="small">退回後這張單就結束了，報修人會看到退回原因。</div>',
      onOk: function (v) {
        api('returnTicket', { id: t.id, reason: v }, false).then(function (r) { after(r, '已退回 ' + t.id, false, t.id); }, function () {});
      } });
  }

  function canAddPhoto(t) {
    if (FINAL[t.status]) return false;
    return role() !== '一般' || t.mine;
  }

  function bindDetail(t, d) {
    document.getElementById('dClose').onclick = closeModal;
    var c = document.getElementById('dCancel');
    if (c) c.onclick = function () {
      if (!confirmInline(c, '確定撤回？')) return;
      api('cancelTicket', { id: t.id }, false, '撤回中…').then(function (r) {
        setData(r); closeModal(); render(); toast('已撤回 ' + t.id);
      }, function () {});
    };
    var acc = document.getElementById('dAccept');
    if (acc) acc.onclick = function () { doAccept(t.id); };
    var dr = document.getElementById('dReturn');
    if (dr) dr.onclick = function () { askReturn(t); };
    if (!d) return;
    if (canWork(t)) bindWork(t, d);
    Array.prototype.forEach.call($mbody.querySelectorAll('[data-pid]'), function (el) {
      var pid = el.getAttribute('data-pid');
      el.onclick = function () { if (S.photoCache[pid]) viewPhoto(S.photoCache[pid]); };
      if (!S.photoCache[pid]) {
        api('getPhoto', { photoId: pid }, true).then(function (p) {
          S.photoCache[pid] = p.dataUrl;
          if (S.detailId !== t.id) return;
          el.className = 'ph';
          el.innerHTML = '<img src="' + p.dataUrl + '"><span class="k">' + esc(el.querySelector('.k') ? el.querySelector('.k').textContent : '') + '</span>';
        }, function () { el.textContent = '讀取失敗'; });
      }
    });
    var inp = document.getElementById('dPhoto');
    if (inp) inp.onchange = function (e) {
      var tmp = [];
      addFiles(e.target.files, tmp, 5, function () {
        if (!tmp.length) return;
        var kind = role() === '一般' ? '報修' : '處理後';
        // 先存表單，避免重新讀取時輸入不見
        var pre = canWork(t) ? api('saveWork', { id: t.id, fields: Object.assign({}, workOf(t)) }, true) : Promise.resolve();
        pre.then(function () {
          return api('addPhotos', { id: t.id, kind: kind, photos: tmp.map(function (p) { return { dataUrl: p }; }) }, false, '上傳照片中…');
        }).then(function (r) {
          setData(r); delete S.work[t.id]; toast('已加入 ' + tmp.length + ' 張照片'); openDetail(t.id);
        }, function () {});
      });
      e.target.value = '';
    };
  }

  // 按一次變「確定？」，再按一次才執行
  function confirmInline(btn, text) {
    if (btn.getAttribute('data-armed')) return true;
    var orig = btn.textContent;
    btn.setAttribute('data-armed', '1');
    btn.textContent = text;
    setTimeout(function () { if (btn.isConnected) { btn.removeAttribute('data-armed'); btn.textContent = orig; } }, 4000);
    return false;
  }


  // ===== KM：以前類似的處理 =====
  function loadKm(t, force) {
    var w = workOf(t);
    var q = w.asset.trim() ? { asset: w.asset.trim() } : { q: t.item };
    var key = JSON.stringify(q);
    if (!force && S.km[t.id] && S.km[t.id].key === key) return;
    S.km[t.id] = { key: key, loading: true };
    var box = document.getElementById('km');
    if (box) box.innerHTML = kmHtml(S.km[t.id]);
    api('search', Object.assign({ done: true, excludeId: t.id, limit: 5 }, q), true).then(function (r) {
      S.km[t.id] = { key: key, by: q.asset ? '品項「' + q.asset + '」' : '項目「' + q.q + '」', items: r.items, total: r.total };
      r.items.forEach(function (x) { S.extra[x.id] = x; });
      var b = document.getElementById('km');
      if (b && S.detailId === t.id) { b.innerHTML = kmHtml(S.km[t.id]); bindKm(); }
    }, function () {
      S.km[t.id] = { key: key, error: true };
      var b = document.getElementById('km');
      if (b) b.innerHTML = kmHtml(S.km[t.id]);
    });
  }

  function kmHtml(k) {
    if (!k || k.loading) return '<div class="muted small">查詢中…</div>';
    if (k.error) return '<div class="muted small">查詢失敗</div>';
    if (!k.items.length) return '<div class="muted small">依' + esc(k.by) + '找不到以前的處理紀錄。填好設備品項會再查一次。</div>';
    return '<div class="muted small">依' + esc(k.by) + '找到 ' + k.total + ' 筆，最近的 ' + k.items.length + ' 筆：</div>' +
      k.items.map(kmItem).join('');
  }

  function kmItem(x) {
    var cost = [x.materialCost ? '材料 ' + money(x.materialCost) : '', x.vendorCost ? '委外 ' + money(x.vendorCost) : '', x.laborHours ? x.laborHours + ' 小時' : ''].filter(Boolean).join('、');
    return '<div class="km">' +
      '<div class="kmh"><b>' + esc(x.asset || x.item) + '</b>　' + esc(x.floor) + ' ' + esc(x.location) +
      '<span class="muted small">　' + esc(x.id) + '　' + md(x.reportDate) + '</span></div>' +
      '<div class="small muted">' + esc(x.method || '') + (x.status === '報廢' ? '　報廢' : '') + (x.days === 0 ? '　當天完工' : x.days !== '' ? '　' + x.days + ' 天完工' : '') +
      (x.vendor ? '　廠商：' + esc(x.vendor) + (x.vendorPhone ? ' ' + esc(x.vendorPhone) : '') : '') + '</div>' +
      '<div class="kmr">' + esc(x.record) + '</div>' +
      (cost ? '<div class="small muted">' + cost + '</div>' : '') +
      (x.afterPhotos && x.afterPhotos.length ? '<div class="photos">' + x.afterPhotos.map(function (pid) {
        var src = S.photoCache[pid];
        return '<div class="ph sm' + (src ? '' : ' load') + '" data-kpid="' + esc(pid) + '">' + (src ? '<img src="' + src + '">' : '…') + '</div>';
      }).join('') + '</div>' : '') +
      '</div>';
  }

  function bindKm() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-kpid]'), function (el) {
      var pid = el.getAttribute('data-kpid');
      el.onclick = function () { if (S.photoCache[pid]) viewPhoto(S.photoCache[pid]); };
      if (S.photoCache[pid]) return;
      api('getPhoto', { photoId: pid }, true).then(function (p) {
        S.photoCache[pid] = p.dataUrl;
        el.className = 'ph sm'; el.innerHTML = '<img src="' + p.dataUrl + '">';
      }, function () {});
    });
  }

  // ===== 查詢 =====
  function viewSearch() {
    var sts = ['進行中', '逾期'].concat(S.data.statuses);
    var h = '<form class="toolbar" id="sForm"><input type="search" id="sQ" placeholder="品項、地點、維修紀錄、廠商、單號…" value="' + esc(S.sq.q) + '">' +
      '<select id="sStatus"><option value="">全部狀態</option>' +
      sts.map(function (x) { return '<option' + (S.sq.status === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') +
      '</select><button class="btn primary" type="submit">查詢</button></form>';
    h += '<div class="muted small" style="margin:0 2px 10px">查全部歷史資料。多個關鍵字用空白隔開，例如「水龍頭 3F」。</div>';
    if (!S.sRes) h += '<div class="empty">查詢中…</div>';
    else if (S.sRes.error) h += '<div class="empty">查詢失敗</div>';
    else {
      h += '<div class="muted small" style="margin:0 2px 8px">共 ' + S.sRes.total + ' 件' + (S.sRes.total > S.sRes.items.length ? '，顯示最近 ' + S.sRes.items.length + ' 件' : '') + '</div>';
      h += S.sRes.items.length ? S.sRes.items.map(function (x) {
        return card(x).replace(/<\/div>$/, (x.record ? '<div class="kmr small">' + esc(x.record) + '</div>' : '') + '</div>');
      }).join('') : '<div class="empty">找不到</div>';
    }
    return h;
  }

  function runSearch() {
    var mine = S.sq.q + '|' + S.sq.status;
    S.sRes = null;
    api('search', { q: S.sq.q, status: S.sq.status, limit: 100 }, true).then(function (r) {
      if (S.sq.q + '|' + S.sq.status !== mine) return;
      r.items.forEach(function (x) { S.extra[x.id] = x; });
      S.sRes = r; if (S.tab === 'search') safeRender();
    }, function () { S.sRes = { error: true }; if (S.tab === 'search') safeRender(); });
  }

  function bindSearch() {
    if (!S.sRes) runSearch();
    document.getElementById('sForm').onsubmit = function (e) {
      e.preventDefault();
      S.sq.q = document.getElementById('sQ').value.trim();
      document.getElementById('sQ').blur();
      runSearch(); render();
    };
    document.getElementById('sStatus').onchange = function (e) { S.sq.status = e.target.value; runSearch(); render(); };
  }

  // ===== 統計 =====
  var RANGES = [['month', '本月'], ['last', '上月'], ['q', '近三個月'], ['year', '今年'], ['custom', '自訂']];
  function rangeDates(k) {
    var t = today(), y = +t.slice(0, 4), m = +t.slice(5, 7);
    var pad = function (n) { return ('0' + n).slice(-2); };
    var first = function (yy, mm) { while (mm < 1) { mm += 12; yy--; } return yy + '-' + pad(mm) + '-01'; };
    if (k === 'month') return [first(y, m), t];
    if (k === 'last') { var f = first(y, m - 1); return [f, addDaysStr(first(y, m), -1)]; }
    if (k === 'q') return [first(y, m - 2), t];
    if (k === 'year') return [y + '-01-01', t];
    return [S.st.from || first(y, m), S.st.to || t];
  }
  function addDaysStr(s, n) {
    var d = new Date(ymd(s) + n * 86400000);
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }

  function loadStats() {
    var r = rangeDates(S.st.range);
    var key = r.join('~');
    S.sData = { key: key, loading: true };
    api('stats', { from: r[0], to: r[1] }, true).then(function (d) {
      if (!S.sData || S.sData.key !== key) return;
      d.key = key; S.sData = d; if (S.tab === 'stats') safeRender();
    }, function (e) { S.sData = { key: key, error: e && e.error ? e.error : '讀取失敗' }; if (S.tab === 'stats') safeRender(); });
  }

  function tile(label, value, sub) {
    return '<div class="tile"><div class="tl">' + label + '</div><div class="tv">' + value + '</div>' + (sub ? '<div class="ts">' + sub + '</div>' : '') + '</div>';
  }

  // 單一數列的橫條排行（一個顏色，不需要圖例；數字寫在條尾）
  function ranking(title, list, total, opts) {
    opts = opts || {};
    if (!list.length) return '';
    var show = opts.all ? list : list.slice(0, 10);
    var max = Math.max.apply(null, show.map(function (x) { return x.n; }));
    return '<div class="panel"><div class="ptitle">' + title + '</div><div class="rank">' +
      show.map(function (x) {
        var pct = total ? Math.round(x.n / total * 100) : 0;
        return '<div class="rk"' + (opts.drill ? ' data-drill="' + esc(x.name) + '"' : '') + ' title="' + esc(x.name) + '：' + x.n + ' 件（' + pct + '%）">' +
          '<span class="nm">' + esc(x.name) + '</span><span class="bar"><i style="width:' + Math.max(2, x.n / max * 100) + '%"></i></span>' +
          '<span class="v">' + x.n + '</span></div>';
      }).join('') + '</div>' +
      (list.length > show.length ? '<div class="muted small" style="margin-top:6px">另有 ' + (list.length - show.length) + ' 項較少的沒有列出</div>' : '') +
      (opts.drill ? '<div class="muted small" style="margin-top:6px">點一項可查以前的處理紀錄</div>' : '') +
      '</div>';
  }

  function viewStats() {
    var r = rangeDates(S.st.range);
    var h = '<div class="choices" style="margin-bottom:10px">' + RANGES.map(function (x) {
      return '<button type="button" class="choice' + (S.st.range === x[0] ? ' on' : '') + '" data-range="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div>';
    if (S.st.range === 'custom') {
      h += '<div class="toolbar"><input type="date" id="stFrom" value="' + r[0] + '"><span>到</span><input type="date" id="stTo" value="' + r[1] + '"><button class="btn primary" id="stGo">查看</button></div>';
    }
    var d = S.sData;
    if (!d || d.key !== r.join('~') || d.loading) return h + '<div class="empty">統計中…</div>';
    if (d.error) return h + '<div class="empty">' + esc(d.error) + '</div>';
    h += '<div class="muted small" style="margin:0 2px 10px">' + md(d.from) + ' 到 ' + md(d.to) + ' 報修的單' + (d.returned ? '（退回 ' + d.returned + ' 件不列入）' : '') + '</div>';
    if (!d.total) return h + '<div class="empty">這段期間沒有報修</div>';
    h += '<div class="tiles">' +
      tile('報修件數', d.total, '已結案 ' + d.done + '　進行中 ' + d.open) +
      tile('逾期率', d.lateRate + '%', '逾期 ' + d.late + ' 件') +
      tile('平均完工天數', d.avgDays === '' ? '－' : d.avgDays + ' 天', '報修日到完工日') +
      tile('費用合計', money(d.cost.total) || '0 元', '材料 ' + (money(d.cost.material) || '0 元') + '　委外 ' + (money(d.cost.vendor) || '0 元')) +
      tile('委外', d.outsource + ' 件', '報廢 ' + d.scrapped + ' 件') +
      tile('內部工時', d.cost.hours + ' 小時', '') +
      '</div>';
    h += '<div class="panel"><div class="ptitle">依緊急程度</div><table class="tbl"><thead><tr><th>緊急程度</th><th>時限</th><th>件數</th><th>逾期</th><th>平均天數</th></tr></thead><tbody>' +
      d.byUrgency.map(function (u) {
        return '<tr><td>' + u.urgency + '</td><td>' + u.limit + ' 天</td><td>' + u.n + '</td><td' + (u.late ? ' class="bad"' : '') + '>' + u.late + '</td><td>' + (u.avgDays === '' ? '－' : u.avgDays) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    h += '<div class="panels">' +
      ranking('最常損壞的設備品項', d.byAsset, d.total, { drill: true }) +
      ranking('樓層區域', d.byFloor, d.total, { all: true, drill: true }) +
      ranking('報修人', d.byReporter, d.total) +
      ranking('報修類別', d.byCategory, d.total, { all: true }) +
      (d.byMonth.length > 1 ? ranking('每月件數', d.byMonth.map(function (x) { return { name: +x.name.slice(5) + ' 月', n: x.n }; }), d.total, { all: true }) : '') +
      '</div>';
    return h;
  }

  function bindStats() {
    var r = rangeDates(S.st.range);
    if (!S.sData || S.sData.key !== r.join('~')) loadStats();
    Array.prototype.forEach.call($app.querySelectorAll('[data-range]'), function (b) {
      b.onclick = function () { S.st.range = b.getAttribute('data-range'); render(); };
    });
    var go = document.getElementById('stGo');
    if (go) go.onclick = function () {
      S.st.from = document.getElementById('stFrom').value; S.st.to = document.getElementById('stTo').value;
      render();
    };
    Array.prototype.forEach.call($app.querySelectorAll('[data-drill]'), function (el) {
      el.onclick = function () {
        var name = el.getAttribute('data-drill');
        S.sq = { q: name.charAt(0) === '（' ? '' : name, status: '' };
        S.tab = 'search'; S.tabAuto = false; runSearch(); render(); window.scrollTo(0, 0);
      };
    });
  }

  // ===== 啟動 =====
  render();
  refresh();
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refresh(); });
  setInterval(function () { if (document.visibilityState === 'visible') refresh(); }, 60000);
})();
