(() => {
  'use strict';

  // ==================================================================
  // Helpers
  // ==================================================================
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('tamiltv.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('tamiltv.' + k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem('tamiltv.' + k); } catch { /* ignore */ } },
  };
  const cleanName = (n) => String(n).replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s+/g, ' ').trim();
  const initials = (name) => {
    const w = cleanName(name).split(' ').filter(Boolean);
    if (!w.length) return 'TV';
    return (w.length === 1 ? w[0].slice(0, 3) : w.slice(0, 2).map((x) => x[0]).join('')).toUpperCase();
  };
  const logoHTML = (ch, cls = '', id = '') =>
    `<div ${id ? `id="${id}" ` : ''}class="logo ${cls}" data-initial="${esc(initials(ch.name))}">` +
    (ch.logo ? `<img src="${esc(ch.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '') + '</div>';
  const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dayLabel = (t) => {
    const d = new Date(t), today = new Date();
    const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 864e5);
    return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const mins = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim() : `${m} min`; };

  const IORG = 'https://iptv-org.github.io/iptv/';
  const PRESETS = [
    { name: 'All Tamil channels', url: IORG + 'languages/tam.m3u' },
  ];
  const DEFAULT_EPG = 'https://epg.pw/xmltv/epg_IN.xml';
  const ALL = 'All';
  const FAV = '★ Favorites';
  const EPG_MAX_AGE = 6 * 3600e3;

  const el = {
    tv: $('#tv'), stage: $('#stage'), side: $('#side'), video: $('#video'), noise: $('#noise'),
    status: $('#status'), statusLogo: $('#status-logo'), statusSpinner: $('#status-spinner'),
    statusTitle: $('#status-title'), statusSub: $('#status-sub'),
    num: $('#numentry'), volOsd: $('#volume-osd'), volIcon: $('#volume-icon'), volFill: $('#volume-fill'), volVal: $('#volume-val'),
    osd: $('#osd'), osdNum: $('#osd-num'), osdLogo: $('#osd-logo'), osdName: $('#osd-name'), osdFav: $('#osd-fav'),
    osdGroup: $('#osd-group'), osdQuality: $('#osd-quality'), osdClock: $('#osd-clock'), osdDate: $('#osd-date'), osdEpg: $('#osd-epg'),
    search: $('#search'), chips: $('#chips'), channels: $('#channels'), listCount: $('#list-count'), epgStatus: $('#epg-status'),
    remote: $('#remote'), favBtn: $('#fav-btn'), muteBtn: $('#mute-btn'), listBtn: $('#list-btn'),
    chbadge: $('#chbadge'), cbNum: $('#cb-num'), cbName: $('#cb-name'),
    epg: $('#epg'), epgScroll: $('#epg-scroll'), epgInner: $('#epg-inner'), epgDetail: $('#epg-detail'), epgOnly: $('#epg-only'),
    settings: $('#settings'), help: $('#help'), plUrl: $('#pl-url'), plLoad: $('#pl-load'), plFile: $('#pl-file'),
    plCurrent: $('#pl-current'), presets: $('#presets'), epgUrl: $('#epg-url'), epgLoad: $('#epg-load'),
    start: $('#start'), toast: $('#toast'),
    audioBtn: $('#audio-btn'), audioMenu: $('#audio-menu'), audioItems: $('#audio-items'), osdAudio: $('#osd-audio'),
    tamilOnly: $('#tamil-only'), hiddenCount: $('#hidden-count'), hiddenList: $('#hidden-list'), unhideAll: $('#unhide-all'),
    addName: $('#add-name'), addUrl: $('#add-url'), addLogo: $('#add-logo'), addBtn: $('#add-btn'), customList: $('#custom-list'),
  };

  // ==================================================================
  // State
  // ==================================================================
  const S = {
    channels: [],          // {num, name, logo, group, groups[], url, id}
    groups: [],            // [{name, count}]
    view: [],              // channels shown in the list
    group: LS.get('group', ALL),
    query: '',
    cur: -1,
    last: -1,
    favs: new Set(LS.get('favs', [])),
    hidden: new Set(LS.get('hidden', [])),     // channels the user hid
    unhidden: new Set(LS.get('unhidden', [])), // auto-hidden channels the user chose to keep
    tamilOnly: LS.get('tamilOnly', true),
    source: LS.get('source', null),
    playlistEpg: [],       // x-tvg-url from the playlist header
    epg: new Map(),        // channel url -> [{s, e, t, d, c}]
    epgUrl: LS.get('epgUrl', ''),
    epgLoading: false,
  };

  // ==================================================================
  // M3U parsing
  // ==================================================================
  function splitExtinf(line) {
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQ = !inQ;
      else if (c === ',' && !inQ) return [line.slice(0, i), line.slice(i + 1)];
    }
    return [line, ''];
  }

  function parseM3U(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    const out = [];
    const epgUrls = [];
    let cur = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXTM3U')) {
        const m = line.match(/(?:x-tvg-url|url-tvg)\s*=\s*"([^"]+)"/i);
        if (m) epgUrls.push(...m[1].split(',').map((s) => s.trim()).filter(Boolean));
      } else if (line.startsWith('#EXTINF')) {
        const [head, name] = splitExtinf(line);
        const attrs = {};
        head.replace(/([\w-]+)\s*=\s*"([^"]*)"/g, (_, k, v) => { attrs[k.toLowerCase()] = v.trim(); });
        cur = { name: name.trim() || attrs['tvg-name'] || '', logo: attrs['tvg-logo'] || '', group: attrs['group-title'] || '', id: attrs['tvg-id'] || '' };
      } else if (line.startsWith('#EXTGRP:')) {
        if (cur && !cur.group) cur.group = line.slice(8).trim();
      } else if (line.startsWith('#')) {
        continue;
      } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line)) {
        const c = cur || { name: '', logo: '', group: '', id: '' };
        c.url = line;
        if (!c.name) c.name = line.split('/').filter(Boolean).pop() || 'Channel';
        out.push(c);
        cur = null;
      }
    }
    out.forEach((c, i) => {
      c.num = i + 1;
      c.groups = (c.group || '').split(';').map((g) => g.trim()).filter((g) => g && g.toLowerCase() !== 'undefined');
      if (!c.groups.length) c.groups = ['Other'];
      c.group = c.groups.join(' · ');
    });
    out.epgUrls = epgUrls;
    return out;
  }

  // ==================================================================
  // Playlist loading
  // ==================================================================
  async function loadFromUrl(url) {
    url = url.trim();
    if (!url) return false;
    el.plLoad.disabled = true;
    toast('Loading channels…', 0);
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      if (/#EXT-X-(TARGETDURATION|STREAM-INF)/.test(text)) {
        const one = [{ num: 1, name: 'Stream', logo: '', group: 'Other', groups: ['Other'], url, id: '' }];
        one.epgUrls = [];
        applyChannels(one, { type: 'url', url });
      } else {
        applyChannels(parseM3U(text), { type: 'url', url });
      }
      return true;
    } catch (err) {
      console.error(err);
      toast(`Couldn't load playlist (${err.message}). The server may block browser access (CORS).`, 6000);
      return false;
    } finally {
      el.plLoad.disabled = false;
    }
  }

  function applyChannels(list, source) {
    if (!list.length) { toast('No channels found in that playlist.', 5000); return; }
    S.base = list;
    S.channels = withCustom(list);
    S.playlistEpg = list.epgUrls || [];
    S.source = source;
    if (!LS.set('source', source)) { LS.del('source'); toast('Loaded, but the playlist is too large to remember after reload.', 5000); }
    buildGroups();
    if (!S.groups.some((g) => g.name === S.group)) S.group = ALL;
    S.cur = -1; S.last = -1;
    updatePlCurrent();
    computeView();
    renderChips();
    renderList();
    toast(`${list.length} channels loaded`, 2500);

    const lastUrl = LS.get('lastUrl', null);
    let idx = lastUrl ? S.channels.findIndex((c) => c.url === lastUrl) : -1;
    if (idx < 0 || isHidden(S.channels[idx])) idx = Math.max(0, S.channels.findIndex((c) => !isHidden(c)));
    tune(idx);
    loadEpg(false);
  }

  // ---------- Custom ("My channels") ----------
  const MY = 'My channels';
  const getCustom = () => LS.get('custom', []);
  // Channels missing from the public playlist, always included
  const EXTRA_CHANNELS = [
    { name: 'Nijayam TV', url: 'https://nijamtv.nijamtv.org/live/nijamtv/index.m3u8', logo: '', group: 'Religious', id: 'NijamTV.in' },
  ];
  function withCustom(base) {
    const have = new Set(base.map((c) => c.url));
    const builtIn = EXTRA_CHANNELS.filter((c) => !have.has(c.url))
      .map((c) => ({ ...c, groups: [c.group] }));
    const custom = getCustom().filter((c) => !have.has(c.url))
      .map((c) => ({ name: c.name, logo: c.logo || '', url: c.url, id: '', group: MY, groups: [MY], custom: true }));
    const all = base.concat(builtIn, custom);
    all.forEach((c, i) => { if (i >= base.length) c.num = i + 1; });
    return all;
  }
  function rebuildChannels(tuneUrl) {
    const curUrl = S.channels[S.cur]?.url;
    const lastUrl = S.channels[S.last]?.url;
    S.channels = withCustom(S.base || []);
    S.cur = S.channels.findIndex((c) => c.url === curUrl);
    S.last = S.channels.findIndex((c) => c.url === lastUrl);
    buildGroups();
    computeView();
    renderChips();
    renderList();
    renderCustomList();
    if (tuneUrl) tune(S.channels.findIndex((c) => c.url === tuneUrl));
    else markPlaying(false);
  }
  function renderCustomList() {
    const list = withCustom(S.base || []).filter((c) => c.custom);
    el.customList.innerHTML = list.map((c, i) =>
      `<li>${logoHTML(c)}<b>${esc(c.name)}</b><span class="u" title="${esc(c.url)}">${esc(c.url)}</span>` +
      `<button class="icon-btn" data-watch="${i}" title="Watch">▶</button>` +
      `<button class="icon-btn" data-remove="${i}" title="Remove">✕</button></li>`).join('');
  }
  function addCustomChannel() {
    const name = el.addName.value.trim();
    const url = el.addUrl.value.trim();
    const logo = el.addLogo.value.trim();
    if (!name) { toast('Enter the channel name'); el.addName.focus(); return; }
    if (!/^https?:\/\/\S+$/i.test(url)) { toast('Enter a valid stream URL starting with http:// or https://'); el.addUrl.focus(); return; }
    if (/youtube\.com|youtu\.be/i.test(url)) { toast('YouTube links can\'t be played here — a direct stream link (.m3u8) is needed', 5000); return; }
    const list = getCustom();
    if (list.some((c) => c.url === url) || S.channels.some((c) => c.url === url)) { toast('That stream is already in the list'); return; }
    list.push({ name, url, logo });
    LS.set('custom', list);
    el.addName.value = el.addUrl.value = el.addLogo.value = '';
    closeModals();
    rebuildChannels(url);
    toast(`Added ${name} to My channels`);
  }
  function removeCustomChannel(i) {
    const list = getCustom();
    const [gone] = list.splice(i, 1);
    if (!gone) return;
    if (!confirm(`Remove ${gone.name} from your channels?`)) return;
    LS.set('custom', list);
    S.favs.delete(gone.url);
    LS.set('favs', [...S.favs]);
    const wasPlaying = S.channels[S.cur]?.url === gone.url;
    rebuildChannels();
    if (wasPlaying) tune(0);
    toast(`Removed ${gone.name}`);
  }

  function updatePlCurrent() {
    const s = S.source;
    el.plCurrent.textContent = s?.type === 'url' ? `Current: ${s.url.replace(/^https?:\/\//, '')}` : s ? `Current: ${s.label || 'local file'}` : '';
    el.presets.querySelectorAll('button').forEach((b) => b.classList.toggle('active', s?.type === 'url' && s.url === b.dataset.url));
  }

  // ---------- Hidden channels ----------
  // Feeds in the Tamil playlist whose free streams carry no Tamil audio (Hindi / English / Malay / Sinhala)
  const NON_TAMIL = new Set([
    'animalplanet.in', 'cartoonnetwork.in', 'discoverychannel.in', 'discoverykids.in', 'disneychannel.in',
    'disneyjunior.in', 'historytv18.in', 'moviesnow.in', 'nickelodeon.in', 'pogo.in', 'sonic.in',
    'sonybbcearth.in', 'sonypix.in', 'starsports2.in', 'ddsports.in', 'ndtvgoodtimes.in',
    'travelxp.in@hd', 'angeltv.in@america', 'angeltv.in@indochina', 'angeltv.in@indonesia',
    'beritartm.my', 'okey.my', 'tv2.my', 'ndtvlanka.lk', 'monaratv.lk',
  ]);
  const isNonTamil = (c) => {
    const id = (c.id || '').toLowerCase();
    return !!id && (NON_TAMIL.has(id) || NON_TAMIL.has(id.split('@')[0]));
  };
  const autoHidden = (c) => S.tamilOnly && isNonTamil(c) && !S.unhidden.has(c.url);
  const isHidden = (c) => S.hidden.has(c.url) || autoHidden(c);
  const visible = () => S.channels.filter((c) => !isHidden(c));

  function hideChannel(ch) {
    if (!ch) return;
    S.hidden.add(ch.url);
    S.unhidden.delete(ch.url);
    saveHidden();
    toast(`Hidden ${cleanName(ch.name)} — bring it back in ⚙ Settings`, 3500);
    afterVisibilityChange();
    if (S.channels[S.cur] === ch) zap(1);
  }
  function showChannel(ch) {
    S.hidden.delete(ch.url);
    if (autoHidden(ch)) S.unhidden.add(ch.url);
    saveHidden();
    afterVisibilityChange();
  }
  function saveHidden() {
    LS.set('hidden', [...S.hidden]);
    LS.set('unhidden', [...S.unhidden]);
  }
  function afterVisibilityChange() {
    buildGroups();
    if (!S.groups.some((g) => g.name === S.group)) S.group = ALL;
    computeView();
    renderChips();
    renderList();
    markPlaying(false);
    renderHiddenList();
  }
  function renderHiddenList() {
    const list = S.channels.filter(isHidden);
    el.hiddenCount.textContent = list.length ? `${list.length} hidden channel${list.length > 1 ? 's' : ''}` : 'No hidden channels';
    el.unhideAll.hidden = !list.length;
    el.hiddenList.innerHTML = list.map((c) =>
      `<li>${logoHTML(c)}<b>${c.num} ${esc(cleanName(c.name))}</b>` +
      `<span class="u">${S.hidden.has(c.url) ? 'hidden by you' : 'no Tamil audio'}</span>` +
      `<button class="icon-btn small-btn" data-show="${esc(c.url)}" title="Show in the list">Show</button></li>`).join('');
  }

  function buildGroups() {
    const counts = new Map();
    const vis = visible();
    for (const c of vis) for (const g of c.groups) counts.set(g, (counts.get(g) || 0) + 1);
    const names = [...counts.keys()].sort((a, b) => (a === 'Other') - (b === 'Other') || counts.get(b) - counts.get(a) || a.localeCompare(b));
    S.groups = [
      { name: ALL, count: vis.length },
      { name: FAV, count: vis.filter((c) => S.favs.has(c.url)).length },
      ...names.map((n) => ({ name: n, count: counts.get(n) })),
    ];
  }

  const inGroup = (g) => (c) => g === ALL || (g === FAV ? S.favs.has(c.url) : c.groups.includes(g));

  function computeView() {
    const q = S.query.trim().toLowerCase();
    S.view = q
      ? visible().filter((c) => String(c.num) === q || c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q) || (nowNext(c).now?.t || '').toLowerCase().includes(q))
      : visible().filter(inGroup(S.group));
  }

  // ==================================================================
  // Channel list (docked)
  // ==================================================================
  function renderChips() {
    el.chips.innerHTML = S.groups
      .filter((g) => g.count > 0 || g.name === FAV)
      .map((g) => `<button data-g="${esc(g.name)}" class="${!S.query && g.name === S.group ? 'on' : ''}">${esc(g.name)}<span class="n">${g.count}</span></button>`)
      .join('');
  }

  function rowSub(c) {
    const { now } = nowNext(c);
    if (now) {
      const p = Math.min(100, Math.max(0, ((Date.now() - now.s) / (now.e - now.s)) * 100));
      return `<div class="sub"><b>${esc(now.t)}</b> · ${hhmm(now.s)}–${hhmm(now.e)}</div><div class="pbar"><i style="width:${p.toFixed(1)}%"></i></div>`;
    }
    return `<div class="sub">${esc(c.group)}</div>`;
  }

  function renderList() {
    const cur = S.channels[S.cur];
    const q = S.query.trim();
    el.listCount.textContent = q ? `${S.view.length} found` : `${S.view.length} channels`;
    if (!S.view.length) {
      el.channels.innerHTML = `<li class="empty">${S.group === FAV && !q ? 'No favorites yet.<br>Press ☆ or S on a channel to add it.' : 'No channels match.'}</li>`;
      return;
    }
    el.channels.innerHTML = S.view.map((c, i) =>
      `<li data-i="${i}" class="ch ${c === cur ? 'playing' : ''}" title="${esc(c.name)}">` +
      `<span class="num">${c.num}</span>${logoHTML(c)}` +
      `<div class="info"><div class="name">${esc(cleanName(c.name) || c.name)}</div>${rowSub(c)}</div>` +
      `<span class="acts"><span class="hide-btn" data-hide title="Hide this channel">⊘</span>` +
      `<span class="star ${S.favs.has(c.url) ? 'on' : ''}" data-star title="Favorite">★</span></span></li>`).join('');
  }

  function refreshListEpg() {
    el.channels.querySelectorAll('li.ch').forEach((li) => {
      const c = S.view[+li.dataset.i];
      const info = li.querySelector('.info');
      if (c && info) info.innerHTML = `<div class="name">${esc(cleanName(c.name) || c.name)}</div>${rowSub(c)}`;
    });
  }

  function markPlaying(scroll = true) {
    const cur = S.channels[S.cur];
    let target = null;
    el.channels.querySelectorAll('li.ch').forEach((li) => {
      const on = S.view[+li.dataset.i] === cur;
      li.classList.toggle('playing', on);
      if (on) target = li;
    });
    if (target && scroll && el.tv.classList.contains('list-on')) target.scrollIntoView({ block: 'nearest' });
  }

  function selectGroup(name) {
    S.group = name;
    LS.set('group', name);
    S.query = '';
    el.search.value = '';
    computeView();
    renderChips();
    renderList();
    el.channels.scrollTop = 0;
    markPlaying();
  }

  let listPeek = false, listCloseTimer = 0;
  function setListVisible(on, peek = false) {
    clearTimeout(listCloseTimer);
    listPeek = on && peek;
    el.tv.classList.toggle('list-on', on);
    if (!on && el.side.contains(document.activeElement)) { document.activeElement.blur(); el.tv.focus(); }
    el.listBtn.classList.toggle('active', on);
    if (on) markPlaying();
  }
  const listOpen = () => el.tv.classList.contains('list-on');
  const toggleList = () => setListVisible(!listOpen());
  // Reveal by moving the mouse to the left edge; hide again when it leaves the list
  $('#edge').addEventListener('mouseenter', () => { if (!listOpen()) setListVisible(true, true); });
  el.side.addEventListener('mouseenter', () => clearTimeout(listCloseTimer));
  el.side.addEventListener('mouseleave', () => {
    if (!listPeek || document.activeElement === el.search) return;
    listCloseTimer = setTimeout(() => setListVisible(false), 500);
  });

  el.chips.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-g]');
    if (b) selectGroup(b.dataset.g);
  });
  el.channels.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    const ch = S.view[+li.dataset.i];
    if (e.target.closest('[data-star]')) { toggleFav(ch); return; }
    if (e.target.closest('[data-hide]')) { hideChannel(ch); return; }
    tune(ch.num - 1, { scroll: false });
    setListVisible(false);   // picked a channel: get out of the way
  });
  document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('broken'); }, true);

  el.search.addEventListener('input', () => {
    S.query = el.search.value;
    computeView();
    renderChips();
    renderList();
    el.channels.scrollTop = 0;
    if (!S.query.trim()) markPlaying();
  });
  el.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const ch = S.view[0]; if (ch) { tune(ch.num - 1); el.search.blur(); setListVisible(false); } }
    else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (el.search.value) { el.search.value = ''; el.search.dispatchEvent(new Event('input')); } else el.search.blur();
    }
  });

  // ==================================================================
  // Player engines: hls.js → native → mpegts.js
  // ==================================================================
  let engine = null, engineKind = '', engineFail = null, tuneToken = 0, tuneTimer = 0, bufferTimer = 0;

  function stopEngine() {
    clearTimeout(tuneTimer);
    if (engine) { try { engine.destroy(); } catch { /* ignore */ } }
    engine = null; engineKind = ''; engineFail = null;
    el.video.pause();
    el.video.removeAttribute('src');
    el.video.load();
  }

  function enginesFor(url) {
    const path = url.split(/[?#]/)[0].toLowerCase();
    const hasHls = !!(window.Hls && Hls.isSupported());
    const hasMpegts = !!(window.mpegts && mpegts.getFeatureList().mseLivePlayback);
    const nativeHls = !!el.video.canPlayType('application/vnd.apple.mpegurl');
    if (/\.(mp4|webm|ogv|mov|m4v|mp3|aac)$/.test(path)) return ['native'];
    const list = [];
    if (/\.(ts|flv)$/.test(path) && hasMpegts) list.push('mpegts');
    if (hasHls) list.push('hls');
    if (nativeHls) list.push('native');
    if (hasMpegts) list.push('mpegts');
    list.push('native');
    return [...new Set(list)];
  }

  function play(ch) {
    const token = ++tuneToken;
    const url = ch.url;
    const list = enginesFor(url);
    let k = 0;
    const fail = (why) => {
      if (token !== tuneToken) return;
      console.warn(`[${engineKind}] failed for ${ch.name}:`, why);
      if (++k < list.length) start(list[k]); else noSignal(ch, why);
    };
    const start = (kind) => {
      stopEngine();
      closeAudioMenu();
      engineKind = kind;
      syncAudioUI();
      engineFail = fail;
      tuneTimer = setTimeout(() => fail('timeout'), 20000);
      const v = el.video;
      try {
        if (kind === 'hls') {
          const h = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 3 });
          engine = h;
          let recovered = false;
          h.on(Hls.Events.ERROR, (_e, d) => {
            if (token !== tuneToken || !d.fatal) return;
            if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) { recovered = true; h.recoverMediaError(); return; }
            fail(d.details || d.type);
          });
          h.on(Hls.Events.MANIFEST_PARSED, () => tryPlay(token));
          h.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => { if (token === tuneToken) onAudioTracks(); });
          h.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => { if (token === tuneToken) syncAudioUI(); });
          h.loadSource(url);
          h.attachMedia(v);
        } else if (kind === 'mpegts') {
          const type = /\.flv(\?|$)/i.test(url) ? 'flv' : 'mpegts';
          const p = mpegts.createPlayer({ type, isLive: true, url }, { enableWorker: true, liveBufferLatencyChasing: true });
          engine = { destroy() { try { p.pause(); p.unload(); p.detachMediaElement(); } finally { p.destroy(); } } };
          p.on(mpegts.Events.ERROR, (t, d) => fail(`${t}: ${d}`));
          p.attachMediaElement(v);
          p.load();
          tryPlay(token);
        } else {
          v.src = url;
          tryPlay(token);
        }
      } catch (err) { fail(err.message); }
    };
    setStatus('tuning', ch);
    start(list[0]);
  }

  function tryPlay(token) {
    const p = el.video.play();
    if (p && p.catch) p.catch((err) => { if (token === tuneToken && err.name === 'NotAllowedError') el.start.hidden = false; });
  }
  function startFromGate() { el.start.hidden = true; el.video.play().catch(() => {}); }

  el.video.addEventListener('playing', () => { clearTimeout(tuneTimer); clearTimeout(bufferTimer); setStatus(null); updateQuality(); });
  el.video.addEventListener('waiting', () => {
    clearTimeout(bufferTimer);
    bufferTimer = setTimeout(() => { if (el.status.hidden) setStatus('buffering'); }, 600);
  });
  el.video.addEventListener('resize', updateQuality);
  el.video.addEventListener('error', () => {
    if (engineKind === 'native' && engineFail && el.video.getAttribute('src')) engineFail(el.video.error?.message || 'media error');
  });

  // ==================================================================
  // Audio language (multi-audio streams)
  // ==================================================================
  const LANGS = {
    ta: 'tam', tam: 'tam', tamil: 'tam', hi: 'hin', hin: 'hin', hindi: 'hin', en: 'eng', eng: 'eng', english: 'eng',
    te: 'tel', tel: 'tel', telugu: 'tel', ml: 'mal', mal: 'mal', malayalam: 'mal', kn: 'kan', kan: 'kan', kannada: 'kan',
    bn: 'ben', ben: 'ben', bengali: 'ben', bangla: 'ben', mr: 'mar', mar: 'mar', marathi: 'mar', ur: 'urd', urd: 'urd', urdu: 'urd',
    ar: 'ara', ara: 'ara', arabic: 'ara', id: 'ind', ind: 'ind', indonesian: 'ind', si: 'sin', sin: 'sin', sinhala: 'sin',
    mul: 'mul', original: 'mul',
  };
  const LANG_NAMES = {
    tam: 'தமிழ் Tamil', hin: 'Hindi', eng: 'English', tel: 'Telugu', mal: 'Malayalam', kan: 'Kannada', ben: 'Bengali',
    mar: 'Marathi', urd: 'Urdu', ara: 'Arabic', ind: 'Indonesian', sin: 'Sinhala', mul: 'Original',
  };
  const langKey = (t) => LANGS[(t.lang || '').toLowerCase()] || LANGS[(t.name || '').toLowerCase().trim()] ||
    Object.entries(LANGS).find(([k]) => k.length > 3 && (t.name || '').toLowerCase().includes(k))?.[1] || '';
  function audioTracks() {
    if (engineKind === 'hls' && engine?.audioTracks) return engine.audioTracks.map((t, i) => ({ i, lang: t.lang || '', name: t.name || '' }));
    const at = el.video.audioTracks;
    if (engineKind === 'native' && at && at.length) return Array.from({ length: at.length }, (_, i) => ({ i, lang: at[i].language || '', name: at[i].label || '' }));
    return [];
  }
  function currentAudio() {
    if (engineKind === 'hls' && engine) return engine.audioTrack;
    const at = el.video.audioTracks;
    if (engineKind === 'native' && at) { for (let i = 0; i < at.length; i++) if (at[i].enabled) return i; }
    return -1;
  }
  function audioLabel(t, all) {
    const k = langKey(t);
    if (k && LANG_NAMES[k]) {
      const same = all.filter((x) => langKey(x) === k);
      return same.length > 1 ? `${LANG_NAMES[k]} ${same.indexOf(t) + 1}` : LANG_NAMES[k];
    }
    const n = (t.name || '').trim();
    return n && !/^und/i.test(n) && !/^(audio|track)?\s*\d*$/i.test(n) && all.filter((x) => x.name === n).length === 1 ? n : `Audio ${t.i + 1}`;
  }
  const shortLabel = (t, all) => audioLabel(t, all).replace(/^தமிழ் /, '');
  function setAudio(i, remember) {
    const tracks = audioTracks();
    const t = tracks[i];
    if (!t) return;
    if (engineKind === 'hls') engine.audioTrack = i;
    else { const at = el.video.audioTracks; for (let j = 0; j < at.length; j++) at[j].enabled = j === i; }
    if (remember) {
      const k = langKey(t);
      if (k) LS.set('audioLang', k);
      toast(`Audio: ${audioLabel(t, tracks)}  (${i + 1}/${tracks.length})`);
    }
    syncAudioUI();
  }
  function onAudioTracks() {
    const tracks = audioTracks();
    if (tracks.length > 1) {
      const pref = LS.get('audioLang', 'tam');
      const want = tracks.findIndex((t) => langKey(t) === pref);
      if (want >= 0 && want !== currentAudio()) setAudio(want, false);
    }
    syncAudioUI();
  }
  function syncAudioUI() {
    const tracks = audioTracks();
    const multi = tracks.length > 1;
    const cur = tracks[currentAudio()];
    el.audioBtn.hidden = !multi;
    el.osdAudio.hidden = !multi;
    if (multi && cur) {
      el.audioBtn.textContent = `🗣 ${shortLabel(cur, tracks)}`;
      el.osdAudio.textContent = `🗣 ${shortLabel(cur, tracks).toUpperCase()} · ${tracks.length} LANGUAGES`;
    }
    if (!multi) closeAudioMenu();
    else if (!el.audioMenu.hidden) renderAudioMenu();
  }
  function renderAudioMenu() {
    const tracks = audioTracks(), cur = currentAudio();
    el.audioItems.innerHTML = tracks.map((t) =>
      `<button data-track="${t.i}" class="${t.i === cur ? 'on' : ''}"><span>${esc(audioLabel(t, tracks))}` +
      `${t.lang && !/^und/i.test(t.lang) ? `<span class="code">${esc(t.lang)}</span>` : ''}</span></button>`).join('');
  }
  function toggleAudioMenu() {
    if (!el.audioMenu.hidden) { closeAudioMenu(); return; }
    if (audioTracks().length < 2) { toast('This channel has only one audio language'); return; }
    renderAudioMenu();
    el.audioMenu.hidden = false;
  }
  function closeAudioMenu() { el.audioMenu.hidden = true; }
  function cycleAudio() {
    const tracks = audioTracks();
    if (tracks.length < 2) { toast('This channel has only one audio language'); return; }
    setAudio((currentAudio() + 1) % tracks.length, true);
  }
  el.audioItems.addEventListener('click', (e) => {
    const b = e.target.closest('[data-track]');
    if (b) { setAudio(+b.dataset.track, true); closeAudioMenu(); }
  });
  document.addEventListener('click', (e) => {
    if (!el.audioMenu.hidden && !e.target.closest('#audio-menu, #audio-btn')) closeAudioMenu();
  });
  if (el.video.audioTracks) {
    ['addtrack', 'removetrack', 'change'].forEach((ev) =>
      el.video.audioTracks.addEventListener(ev, () => { if (engineKind === 'native') (ev === 'change' ? syncAudioUI : onAudioTracks)(); }));
  }

  function updateQuality() {
    const h = el.video.videoHeight;
    el.osdQuality.hidden = !h;
    if (!h) return;
    el.osdQuality.textContent = h >= 2000 ? '4K' : h >= 1000 ? 'FHD' : h >= 700 ? 'HD' : 'SD';
    el.osdQuality.title = `${el.video.videoWidth}×${h}`;
  }

  // ==================================================================
  // Status card + static noise
  // ==================================================================
  let noiseRAF = 0;
  function setStatus(mode, ch) {
    clearTimeout(bufferTimer);
    if (!mode) { el.status.hidden = true; stopNoise(); return; }
    el.status.hidden = false;
    el.status.className = mode;
    if (mode === 'tuning') {
      stopNoise();
      el.statusLogo.outerHTML = logoHTML(ch, 'status-logo', 'status-logo');
      el.statusLogo = $('#status-logo');
      el.statusSpinner.hidden = false;
      el.statusTitle.textContent = `${ch.num}  ${cleanName(ch.name)}`;
      el.statusSub.textContent = 'Tuning…';
    } else if (mode === 'buffering') {
      el.statusLogo.hidden = true;
      el.statusSpinner.hidden = false;
      el.statusTitle.textContent = '';
      el.statusSub.textContent = '';
    } else if (mode === 'nosignal') {
      el.statusLogo.hidden = true;
      el.statusSpinner.hidden = true;
      el.statusTitle.textContent = 'No Signal';
      el.statusSub.textContent = `${ch.num} ${cleanName(ch.name)} is unavailable right now. Press ↑ / ↓ or pick another channel.`;
      startNoise();
    }
  }
  function noSignal(ch, why) {
    stopEngine();
    setStatus('nosignal', ch);
    el.osdQuality.hidden = true;
    console.info('No signal:', ch.url, why);
  }
  function startNoise() {
    el.noise.hidden = false;
    if (noiseRAF) return;
    const ctx = el.noise.getContext('2d');
    const img = ctx.createImageData(el.noise.width, el.noise.height);
    const buf = new Uint32Array(img.data.buffer);
    let frame = 0;
    const draw = () => {
      if ((frame++ & 1) === 0) {
        for (let i = 0; i < buf.length; i++) { const v = (Math.random() * 255) | 0; buf[i] = 0xff000000 | (v << 16) | (v << 8) | v; }
        ctx.putImageData(img, 0, 0);
      }
      noiseRAF = requestAnimationFrame(draw);
    };
    draw();
  }
  function stopNoise() { cancelAnimationFrame(noiseRAF); noiseRAF = 0; el.noise.hidden = true; }

  // ==================================================================
  // Tuning / zapping
  // ==================================================================
  function tune(i, { scroll = true } = {}) {
    const n = S.channels.length;
    if (!n) return;
    i = ((i % n) + n) % n;
    if (i !== S.cur && S.cur >= 0) S.last = S.cur;
    S.cur = i;
    const ch = S.channels[i];
    LS.set('lastUrl', ch.url);
    el.osdQuality.hidden = true;
    play(ch);
    showChBadge(ch);
    showOsd();
    markPlaying(scroll);
    updateFavUI();
    document.title = `${ch.num} · ${cleanName(ch.name)} — Tamil TV`;
  }

  function zapList() {
    const vis = visible();
    const all = vis.length ? vis : S.channels;
    if (S.group === ALL) return all;
    const l = all.filter(inGroup(S.group));
    return l.length ? l : all;
  }
  function neighbour(dir, from = S.channels[S.cur]) {
    const l = zapList();
    if (!l.length) return null;
    let pos = l.indexOf(from);
    if (pos < 0) {
      const curNum = from?.num ?? 0;
      pos = dir > 0 ? l.findIndex((c) => c.num > curNum) - 1 : l.findIndex((c) => c.num >= curNum);
      if (pos < -1) pos = dir > 0 ? l.length - 1 : 0;
    }
    return l[(pos + dir + l.length) % l.length];
  }
  // TV-like zapping: the first press tunes at once; quick repeated presses just flip
  // the number on screen and tune when you stop (like a set-top box).
  let zapTarget = null, zapTimer = 0, lastZapAt = 0;
  function zap(dir) {
    const next = neighbour(dir, zapTarget || S.channels[S.cur]);
    if (!next) return;
    const quick = Date.now() - lastZapAt < 700;
    lastZapAt = Date.now();
    clearTimeout(zapTimer);
    if (!quick && !zapTarget) { tune(next.num - 1); return; }
    zapTarget = next;
    showChBadge(next, true);
    zapTimer = setTimeout(() => { const t = zapTarget; zapTarget = null; if (t) tune(t.num - 1); }, 550);
  }

  let cbTimer = 0;
  function showChBadge(ch, pending = false) {
    if (!el.num.hidden) return;              // digits being typed take that corner
    el.cbNum.textContent = ch.num;
    el.cbName.textContent = cleanName(ch.name) || ch.name;
    el.chbadge.classList.toggle('pending', pending);
    el.chbadge.hidden = false;
    clearTimeout(cbTimer);
    cbTimer = setTimeout(() => { el.chbadge.hidden = true; }, pending ? 2000 : 3500);
  }
  function lastChannel() { if (S.last >= 0) tune(S.last); else toast('No previous channel yet'); }

  let numBuf = '', numTimer = 0;
  function numKey(d) {
    if (!S.channels.length) return;
    const maxLen = String(S.channels.length).length;
    numBuf = (numBuf + d).slice(-maxLen);
    el.chbadge.hidden = true;
    el.num.hidden = false;
    el.num.classList.remove('bad');
    el.num.textContent = numBuf.padEnd(maxLen, '-');
    clearTimeout(numTimer);
    numTimer = setTimeout(commitNum, numBuf.length >= maxLen ? 400 : 1600);
  }
  function commitNum() {
    clearTimeout(numTimer);
    if (!numBuf) return;
    const n = parseInt(numBuf, 10);
    numBuf = '';
    if (n >= 1 && n <= S.channels.length) { el.num.hidden = true; tune(n - 1); }
    else {
      el.num.textContent = `${n} ✕`;
      el.num.classList.add('bad');
      numTimer = setTimeout(() => { el.num.hidden = true; }, 1200);
    }
  }

  // ==================================================================
  // Info banner (with Now / Next)
  // ==================================================================
  let osdTimer = 0, osdExpanded = false;
  function showOsd(ms = 5000, expanded = false) {
    const ch = S.channels[S.cur];
    if (!ch) return;
    osdExpanded = expanded;
    el.osdNum.textContent = ch.num;
    el.osdLogo.outerHTML = logoHTML(ch, 'osd-logo', 'osd-logo');
    el.osdLogo = $('#osd-logo');
    el.osdName.textContent = cleanName(ch.name) || ch.name;
    el.osdGroup.textContent = ch.group;
    el.osdFav.hidden = !S.favs.has(ch.url);
    renderOsdEpg();
    tickClock();
    el.osd.classList.remove('off');
    clearTimeout(osdTimer);
    if (ms) osdTimer = setTimeout(hideOsd, ms);
  }
  function renderOsdEpg() {
    const ch = S.channels[S.cur];
    if (!ch) return;
    const { now, next } = nowNext(ch);
    if (!now && !next) {
      const p = neighbour(-1), n = neighbour(1);
      el.osdEpg.innerHTML = S.epg.size
        ? `<div class="prog-line"><span class="tag">INFO</span><span class="time"></span><span class="title muted">No programme information for this channel</span></div>`
        : (p && n ? `<div class="prog-line"><span class="tag">▲</span><span class="time">CH ${n.num}</span><span class="title">${esc(cleanName(n.name))}</span></div>` : '');
      return;
    }
    let h = '';
    if (now) {
      const pct = Math.min(100, Math.max(0, ((Date.now() - now.s) / (now.e - now.s)) * 100));
      h += `<div class="prog-line now"><span class="tag">NOW</span><span class="time">${hhmm(now.s)} – ${hhmm(now.e)}</span><span class="title">${esc(now.t)}</span>` +
        `<span></span><div class="osd-pbar"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
      if (osdExpanded && now.d) h += `<div class="osd-desc">${esc(now.d)}</div>`;
    }
    if (next) h += `<div class="prog-line"><span class="tag">NEXT</span><span class="time">${hhmm(next.s)} – ${hhmm(next.e)}</span><span class="title">${esc(next.t)}</span></div>`;
    el.osdEpg.innerHTML = h;
  }
  function hideOsd() { el.osd.classList.add('off'); }
  function toggleOsd() { el.osd.classList.contains('off') || !osdExpanded ? showOsd(10000, true) : hideOsd(); }
  function tickClock() {
    const d = new Date();
    el.osdClock.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    el.osdDate.textContent = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  }

  // ==================================================================
  // Volume / favorites
  // ==================================================================
  let volTimer = 0;
  const volLevel = () => Math.round(el.video.volume * 100);
  function stepVolume(d) {
    if (el.video.muted && d > 0) { el.video.muted = false; LS.set('muted', false); }
    setVolume((volLevel() + d) / 100);
  }
  function setVolume(v, show = true) {
    v = Math.max(0, Math.min(1, Math.round(v * 100) / 100));
    el.video.volume = v;
    if (v > 0 && el.video.muted) { el.video.muted = false; LS.set('muted', false); }
    LS.set('volume', v);
    syncVolumeUI(show);
  }
  function toggleMute() { el.video.muted = !el.video.muted; LS.set('muted', el.video.muted); syncVolumeUI(true); }
  function syncVolumeUI(show) {
    const v = el.video.volume, m = el.video.muted || v === 0;
    const icon = m ? '🔇' : v < 0.4 ? '🔈' : v < 0.75 ? '🔉' : '🔊';
    el.volIcon.textContent = icon;
    el.muteBtn.textContent = icon;
    el.volFill.style.height = (m ? 0 : v * 100) + '%';
    el.volVal.textContent = m ? 'MUTE' : Math.round(v * 100);
    el.volVal.classList.toggle('mute', m);
    if (show) { el.volOsd.hidden = false; clearTimeout(volTimer); volTimer = setTimeout(() => { el.volOsd.hidden = true; }, 2500); }
  }

  function toggleFav(ch) {
    if (!ch) return;
    const name = cleanName(ch.name);
    if (S.favs.has(ch.url)) { S.favs.delete(ch.url); toast(`Removed ${name} from favorites`); }
    else { S.favs.add(ch.url); toast(`★ Added ${name} to favorites`); }
    LS.set('favs', [...S.favs]);
    buildGroups();
    computeView();
    renderChips();
    renderList();
    markPlaying(false);
    updateFavUI();
  }
  function updateFavUI() {
    const ch = S.channels[S.cur];
    const on = !!ch && S.favs.has(ch.url);
    el.favBtn.textContent = on ? '★' : '☆';
    el.favBtn.classList.toggle('on', on);
    el.osdFav.hidden = !on;
  }

  // ==================================================================
  // EPG (XMLTV) — streamed, matched to channels by tvg-id or name
  // ==================================================================
  const compact = (s) => cleanName(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
  const loose = (s) => cleanName(s).toLowerCase().normalize('NFKD')
    .replace(/\b(hd|sd|fhd|uhd|4k|tv|channel|india|in)\b/g, ' ').replace(/[^a-z0-9]/g, '');
  const idBase = (id) => String(id).split('@')[0].toLowerCase();

  function parseXmltvTime(s) {
    const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-])?(\d\d)?(\d\d)?/.exec(s || '');
    if (!m) return NaN;
    let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    if (m[7]) t -= (m[7] === '-' ? -1 : 1) * ((+m[8] || 0) * 60 + (+m[9] || 0)) * 60000;
    return t;
  }
  const decodeXml = (s) => (s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
  const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag); return m ? decodeXml(m[1]) : ''; };
  const firstTag = (block, name) => { const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(block); return m ? decodeXml(m[1]) : ''; };

  async function parseXmltvStream(url, onProgress) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    let stream = res.body;
    const gz = /\.gz(\?|#|$)/i.test(url) || /gzip/i.test(res.headers.get('content-type') || '');
    if (gz && !res.headers.get('content-encoding')) {
      if (!('DecompressionStream' in window)) throw new Error('This browser cannot unzip .gz guides');
      stream = stream.pipeThrough(new DecompressionStream('gzip'));
    }
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();

    // Playlist lookup keys
    const byId = new Map(), byIdBase = new Map(), byCompact = new Map(), byLoose = new Map();
    const add = (m, k, c) => { if (k && !m.has(k)) m.set(k, c); };
    for (const c of S.channels) {
      if (c.id) { add(byId, c.id.toLowerCase(), c); add(byIdBase, idBase(c.id), c); add(byCompact, compact(c.id.split('.')[0]), c); }
      add(byCompact, compact(c.name), c);
      add(byLoose, loose(c.name), c);
    }

    const xmlChannels = new Map();   // xmltv id -> [display names]
    let mapping = null;              // xmltv id -> [playlist channels]
    const result = new Map();        // channel url -> programmes
    const from = Date.now() - 3 * 3600e3, to = Date.now() + 36 * 3600e3;
    let progCount = 0;

    const finalizeMapping = () => {
      mapping = new Map();
      const taken = new Set();
      const assign = (xid, ch) => {
        if (!ch || taken.has(ch.url)) return;
        taken.add(ch.url);
        if (!mapping.has(xid)) mapping.set(xid, []);
        mapping.get(xid).push(ch);
      };
      // Pass 1: exact ids.  Pass 2: exact names.  Pass 3: loose names.
      for (const [xid] of xmlChannels) assign(xid, byId.get(xid.toLowerCase()) || byIdBase.get(idBase(xid)));
      for (const [xid, names] of xmlChannels) for (const n of names) assign(xid, byCompact.get(compact(n)));
      for (const [xid, names] of xmlChannels) for (const n of names) assign(xid, byLoose.get(loose(n)));
      // Also let every playlist channel sharing the same matched name/id get the data (e.g. SD + HD feeds)
      for (const c of S.channels) {
        if (taken.has(c.url)) continue;
        for (const [xid, chans] of mapping) {
          const ref = chans[0];
          if ((c.id && ref.id && idBase(c.id) === idBase(ref.id)) || (loose(c.name) && loose(c.name) === loose(ref.name))) { chans.push(c); taken.add(c.url); break; }
        }
      }
    };

    const onChannel = (block) => {
      const open = block.slice(0, block.indexOf('>') + 1);
      const id = attr(open, 'id');
      if (!id) return;
      const names = [...block.matchAll(/<display-name\b[^>]*>([\s\S]*?)<\/display-name>/g)].map((m) => decodeXml(m[1]));
      xmlChannels.set(id, names.length ? names : [id]);
    };
    const onProgramme = (block) => {
      if (!mapping) finalizeMapping();
      const open = block.slice(0, block.indexOf('>') + 1);
      const chans = mapping.get(attr(open, 'channel'));
      if (!chans) return;
      const s = parseXmltvTime(attr(open, 'start'));
      const e = parseXmltvTime(attr(open, 'stop'));
      if (!(e > from && s < to)) return;
      const p = { s, e, t: firstTag(block, 'title') || 'Untitled' };
      const d = firstTag(block, 'desc'); if (d) p.d = d.slice(0, 400);
      const c = firstTag(block, 'category'); if (c) p.c = c;
      progCount++;
      for (const ch of chans) {
        if (!result.has(ch.url)) result.set(ch.url, []);
        result.get(ch.url).push(p);
      }
    };

    let buf = '', bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (value) { buf += value; bytes += value.length; }
      let pos = 0, ci = -2, pi = -2;
      for (;;) {
        // -1 means "none left in this buffer": don't rescan for it
        if (ci !== -1 && ci < pos) ci = buf.indexOf('<channel', pos);
        if (pi !== -1 && pi < pos) pi = buf.indexOf('<programme', pos);
        if (ci < 0 && pi < 0) { pos = Math.max(pos, buf.length - 16); break; }
        const isProg = ci < 0 || (pi >= 0 && pi < ci);
        const i = isProg ? pi : ci;
        const endTag = isProg ? '</programme>' : '</channel>';
        const gt = buf.indexOf('>', i);
        if (gt < 0) { pos = i; break; }
        let end;
        if (buf[gt - 1] === '/') end = gt + 1;                 // self-closing
        else { const j = buf.indexOf(endTag, gt); if (j < 0) { pos = i; break; } end = j + endTag.length; }
        const block = buf.slice(i, end);
        pos = end;
        isProg ? onProgramme(block) : onChannel(block);
      }
      buf = buf.slice(pos);
      onProgress?.(bytes);
      if (done) break;
    }
    if (!mapping) finalizeMapping();
    for (const list of result.values()) {
      list.sort((a, b) => a.s - b.s);
      for (let i = list.length - 1; i > 0; i--) if (list[i].s === list[i - 1].s) list.splice(i, 1);
    }
    return { result, progCount, matched: result.size };
  }

  function epgUrls() {
    const custom = S.epgUrl.split(',').map((s) => s.trim()).filter(Boolean);
    if (custom.length) return custom;
    if (S.playlistEpg.length) return S.playlistEpg;
    return [DEFAULT_EPG];
  }

  async function loadEpg(force) {
    if (!S.channels.length || S.epgLoading) return;
    const urls = epgUrls();
    const cacheKey = urls.join(',') + '|' + (S.source?.url || S.source?.label || '');
    const cached = LS.get('epgCache', null);
    if (!force && cached && cached.key === cacheKey && Date.now() - cached.at < EPG_MAX_AGE) {
      S.epg = new Map(cached.data);
      epgUpdated(`Guide: ${S.epg.size} channels · updated ${hhmm(cached.at)}`);
      return;
    }
    S.epgLoading = true;
    el.epgLoad.disabled = true;
    const merged = new Map();
    const errors = [];
    for (const url of urls) {
      try {
        el.epgStatus.textContent = 'Loading TV guide…';
        const { result } = await parseXmltvStream(url, (b) => { el.epgStatus.textContent = `Loading TV guide… ${(b / 1e6).toFixed(1)} MB`; });
        for (const [k, v] of result) if (!merged.has(k)) merged.set(k, v);
      } catch (err) {
        console.error('EPG', url, err);
        errors.push(`${url.replace(/^https?:\/\//, '').slice(0, 40)}: ${err.message === 'Failed to fetch' ? 'blocked (CORS) or offline' : err.message}`);
      }
    }
    S.epgLoading = false;
    el.epgLoad.disabled = false;
    S.epg = merged;
    if (merged.size) {
      LS.set('epgCache', { key: cacheKey, at: Date.now(), data: [...merged] }) || LS.del('epgCache');
      epgUpdated(`Guide: ${merged.size} of ${S.channels.length} channels have listings`);
      if (force) toast(`TV guide loaded for ${merged.size} channels`);
    } else {
      epgUpdated(errors.length ? `Guide unavailable — ${errors[0]}` : 'Guide loaded, but no channels matched this playlist');
      if (force) toast(errors.length ? 'Could not load the TV guide' : 'No guide data matched these channels', 4000);
    }
  }

  function epgUpdated(msg) {
    el.epgStatus.textContent = msg;
    el.epgOnly.checked = S.epg.size > 0 && LS.get('epgOnly', true);
    refreshListEpg();
    if (!el.osd.classList.contains('off')) renderOsdEpg();
    if (!el.epg.hidden) renderEpgGrid();
  }

  function nowNext(ch, t = Date.now()) {
    const list = ch && S.epg.get(ch.url);
    if (!list) return {};
    let lo = 0, hi = list.length - 1, idx = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].s <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    const now = idx >= 0 && list[idx].e > t ? list[idx] : null;
    const next = list[idx + 1] || null;
    return { now, next };
  }

  // Keep now/next fresh
  setInterval(() => {
    tickClock();
    if (S.epg.size) {
      refreshListEpg();
      if (!el.osd.classList.contains('off')) renderOsdEpg();
      if (!el.epg.hidden) positionNowLine();
    }
  }, 30000);

  // ==================================================================
  // TV Guide grid
  // ==================================================================
  const G = { HOUR: 300, ROW: 62, CH: 230, t0: 0, t1: 0, rows: [], row: 0, prog: null };

  function openEpg() {
    if (!S.channels.length) return;
    closeModals();
    el.epg.hidden = false;
    const now = Date.now();
    G.t0 = Math.floor((now - 3600e3) / 1800e3) * 1800e3;
    G.t1 = G.t0 + 26 * 3600e3;
    G.prog = null;
    renderEpgGrid();
    const curRow = G.rows.indexOf(S.channels[S.cur]);
    selectCell(curRow >= 0 ? curRow : 0, now);
    scrollToTime(now);
  }
  function closeEpg() { el.epg.hidden = true; el.tv.focus(); }

  function epgRows() {
    const base = visible().filter(inGroup(S.query ? ALL : S.group));
    const list = el.epgOnly.checked ? base.filter((c) => S.epg.has(c.url)) : base;
    return list.length ? list : base;
  }

  function renderEpgGrid() {
    G.rows = epgRows();
    const W = ((G.t1 - G.t0) / 3600e3) * G.HOUR;
    const x = (t) => ((t - G.t0) / 3600e3) * G.HOUR;
    const cur = S.channels[S.cur];
    const now = Date.now();

    let ticks = '';
    for (let t = G.t0; t < G.t1; t += 1800e3) {
      const midnight = new Date(t).getHours() === 0 && new Date(t).getMinutes() === 0;
      ticks += `<span class="${midnight ? 'day' : ''}" style="left:${x(t)}px;width:${G.HOUR / 2}px">${midnight ? dayLabel(t) + ' ' : ''}${hhmm(t)}</span>`;
    }
    let rows = '';
    G.rows.forEach((c, r) => {
      const list = S.epg.get(c.url) || [];
      let progs = '';
      let any = false;
      list.forEach((p, k) => {
        if (p.e <= G.t0 || p.s >= G.t1) return;
        any = true;
        const l = Math.max(0, x(p.s)), w = Math.max(4, x(Math.min(p.e, G.t1)) - l - 3);
        const cls = p.e <= now ? 'past' : p.s <= now ? 'live' : '';
        progs += `<div class="prog ${cls}" data-r="${r}" data-k="${k}" style="left:${l}px;width:${w}px" title="${esc(p.t)}">` +
          `<div class="pt">${esc(p.t)}</div><div class="ps">${hhmm(p.s)} – ${hhmm(p.e)}</div></div>`;
      });
      if (!any) progs = `<div class="prog none" data-r="${r}" style="left:0;width:${W - 4}px"><div class="pt">No programme information — ${esc(cleanName(c.name))}</div></div>`;
      rows += `<div class="epg-row ${c === cur ? 'playing' : ''}" style="height:${G.ROW}px">` +
        `<div class="epg-ch" data-r="${r}" style="width:${G.CH}px" title="Watch ${esc(c.name)}"><span class="num">${c.num}</span>${logoHTML(c)}<span class="nm">${esc(cleanName(c.name))}</span></div>` +
        `<div class="epg-track" style="width:${W}px">${progs}</div></div>`;
    });
    el.epgInner.style.width = G.CH + W + 'px';
    el.epgInner.innerHTML =
      `<div class="epg-ruler"><div class="epg-corner" style="width:${G.CH}px">${dayLabel(now)}</div><div class="epg-times" style="width:${W}px">${ticks}</div></div>` +
      rows + `<div class="epg-nowline" id="epg-nowline"></div>`;
    positionNowLine();
    if (G.prog) highlightSel();
  }

  function positionNowLine() {
    const line = $('#epg-nowline');
    if (!line) return;
    const t = Date.now();
    line.hidden = t < G.t0 || t > G.t1;
    line.style.left = G.CH + ((t - G.t0) / 3600e3) * G.HOUR + 'px';
  }

  function progAt(r, t) {
    const list = S.epg.get(G.rows[r]?.url) || [];
    let best = -1;
    for (let k = 0; k < list.length; k++) {
      const p = list[k];
      if (p.e <= G.t0 || p.s >= G.t1) continue;
      if (p.s <= t && p.e > t) return k;
      if (best < 0 || Math.abs(p.s - t) < Math.abs(list[best].s - t)) best = k;
    }
    return best;
  }

  function selectCell(r, t, k) {
    if (!G.rows.length) { el.epgDetail.innerHTML = '<div class="d-title">No channels</div>'; return; }
    r = Math.max(0, Math.min(G.rows.length - 1, r));
    if (k === undefined) k = progAt(r, t);
    const ch = G.rows[r];
    const p = k >= 0 ? S.epg.get(ch.url)?.[k] : null;
    G.row = r;
    G.prog = { r, k, t: p ? Math.max(p.s, G.t0) : t };
    if (p && t >= p.s && t < p.e) G.prog.t = t;  // keep vertical focus time when moving up/down
    highlightSel();
    renderDetail(ch, p);
  }

  function highlightSel() {
    el.epgInner.querySelectorAll('.prog.sel').forEach((n) => n.classList.remove('sel'));
    const { r, k } = G.prog;
    const node = k >= 0 ? el.epgInner.querySelector(`.prog[data-r="${r}"][data-k="${k}"]`) : el.epgInner.querySelector(`.prog.none[data-r="${r}"]`);
    if (!node) return;
    node.classList.add('sel');
    // Keep selection visible (account for sticky ruler + channel column)
    const sc = el.epgScroll;
    const top = 36 + r * G.ROW, bottom = top + G.ROW;
    if (top < sc.scrollTop + 36) sc.scrollTop = top - 36;
    else if (bottom > sc.scrollTop + sc.clientHeight) sc.scrollTop = bottom - sc.clientHeight;
    if (k >= 0) {
      const left = G.CH + node.offsetLeft, right = left + Math.min(node.offsetWidth, sc.clientWidth - G.CH - 20);
      if (left < sc.scrollLeft + G.CH) sc.scrollLeft = left - G.CH - 10;
      else if (right > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = right - sc.clientWidth + 10;
    }
  }

  function renderDetail(ch, p) {
    const now = Date.now();
    const name = esc(cleanName(ch.name));
    if (!p) {
      el.epgDetail.innerHTML = `<div class="d-ch">${ch.num} · ${name}</div><div class="d-title">No programme information</div>` +
        `<div class="d-time">Press Enter to watch this channel</div>`;
      return;
    }
    const live = p.s <= now && p.e > now;
    const when = live ? `<span class="badge" style="border-color:var(--live);color:var(--live)">● ON NOW</span> ${mins(p.e - now)} left`
      : p.s > now ? `Starts in ${mins(p.s - now)}` : 'Ended';
    el.epgDetail.innerHTML =
      `<div class="d-ch">${ch.num} · ${name}</div>` +
      `<div class="d-title">${esc(p.t)}</div>` +
      `<div class="d-time">${dayLabel(p.s)} ${hhmm(p.s)} – ${hhmm(p.e)} · ${mins(p.e - p.s)} · ${when}${p.c ? ` · ${esc(p.c)}` : ''}</div>` +
      (p.d ? `<div class="d-desc">${esc(p.d)}</div>` : '');
  }

  function scrollToTime(t) {
    el.epgScroll.scrollLeft = Math.max(0, ((t - G.t0) / 3600e3) * G.HOUR - G.HOUR * 0.5);
  }

  function epgKey(e) {
    const sel = G.prog || { r: 0, k: -1, t: Date.now() };
    const list = S.epg.get(G.rows[sel.r]?.url) || [];
    switch (e.key) {
      case 'ArrowUp': selectCell(sel.r - 1, sel.t); break;
      case 'ArrowDown': selectCell(sel.r + 1, sel.t); break;
      case 'PageUp': selectCell(sel.r - 8, sel.t); break;
      case 'PageDown': selectCell(sel.r + 8, sel.t); break;
      case 'ArrowLeft': {
        if (sel.k > 0 && list[sel.k - 1].e > G.t0) selectCell(sel.r, list[sel.k - 1].s, sel.k - 1);
        break;
      }
      case 'ArrowRight': {
        if (sel.k >= 0 && list[sel.k + 1] && list[sel.k + 1].s < G.t1) selectCell(sel.r, list[sel.k + 1].s, sel.k + 1);
        break;
      }
      case 'Enter': {
        const ch = G.rows[sel.r];
        if (ch) { closeEpg(); tune(ch.num - 1); }
        break;
      }
      case 'n': case 'N': selectCell(sel.r, Date.now()); scrollToTime(Date.now()); break;
      case 'Escape': case 'e': case 'E': case 'Backspace': closeEpg(); break;
      default: return false;
    }
    return true;
  }

  el.epgInner.addEventListener('click', (e) => {
    const chCell = e.target.closest('.epg-ch');
    if (chCell) { const ch = G.rows[+chCell.dataset.r]; closeEpg(); tune(ch.num - 1); return; }
    const pr = e.target.closest('.prog');
    if (!pr) return;
    const r = +pr.dataset.r, k = pr.dataset.k === undefined ? -1 : +pr.dataset.k;
    const already = G.prog && G.prog.r === r && G.prog.k === k;
    const p = k >= 0 ? S.epg.get(G.rows[r].url)[k] : null;
    if (already && (!p || (p.s <= Date.now() && p.e > Date.now()))) { closeEpg(); tune(G.rows[r].num - 1); return; }
    selectCell(r, p ? p.s : Date.now(), k);
  });
  el.epgInner.addEventListener('dblclick', (e) => {
    const pr = e.target.closest('.prog');
    if (pr) { closeEpg(); tune(G.rows[+pr.dataset.r].num - 1); }
  });
  $('#epg-close').addEventListener('click', closeEpg);
  $('#epg-now').addEventListener('click', () => { selectCell(G.row, Date.now()); scrollToTime(Date.now()); });
  el.epgOnly.addEventListener('change', () => {
    LS.set('epgOnly', el.epgOnly.checked);
    const ch = G.rows[G.row];
    renderEpgGrid();
    const r = G.rows.indexOf(ch);
    selectCell(r >= 0 ? r : 0, G.prog?.t ?? Date.now());
  });

  // ==================================================================
  // Modals, toast, fullscreen
  // ==================================================================
  function openModal(m) {
    m.hidden = false;
    if (m === el.settings) {
      el.plUrl.value = S.source?.type === 'url' && !PRESETS.some((p) => p.url === S.source.url) ? S.source.url : '';
      el.epgUrl.value = S.epgUrl;
      el.tamilOnly.checked = S.tamilOnly;
      renderHiddenList();
      renderCustomList();
      el.epgUrl.placeholder = S.playlistEpg[0] || DEFAULT_EPG;
      updatePlCurrent();
    }
  }
  function closeModals() {
    let closed = false;
    [el.settings, el.help].forEach((m) => { if (!m.hidden) { m.hidden = true; closed = true; } });
    if (closed) el.tv.focus();
    return closed;
  }
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModals(); });
  });

  let toastTimer = 0;
  function toast(msg, ms = 2200) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
  }

  function toggleFullscreen() {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else if (el.tv.requestFullscreen) el.tv.requestFullscreen().catch(() => {});
    else if (el.tv.webkitRequestFullscreen) el.tv.webkitRequestFullscreen();
    else if (el.video.webkitEnterFullscreen) el.video.webkitEnterFullscreen();
  }

  // ==================================================================
  // Settings wiring
  // ==================================================================
  el.presets.innerHTML = PRESETS.map((p) => `<button data-url="${esc(p.url)}">${esc(p.name)}</button>`).join('');
  el.presets.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-url]');
    if (b && await loadFromUrl(b.dataset.url)) closeModals();
  });
  el.plLoad.addEventListener('click', async () => { if (await loadFromUrl(el.plUrl.value)) closeModals(); });
  el.plUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.plLoad.click(); });
  el.plFile.addEventListener('change', async () => {
    const f = el.plFile.files[0];
    if (!f) return;
    const text = await f.text();
    applyChannels(parseM3U(text), { type: 'text', label: f.name, text });
    el.plFile.value = '';
    closeModals();
  });
  el.epgLoad.addEventListener('click', () => {
    S.epgUrl = el.epgUrl.value.trim();
    LS.set('epgUrl', S.epgUrl);
    LS.del('epgCache');
    loadEpg(true);
    closeModals();
  });
  el.epgUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.epgLoad.click(); });
  el.tamilOnly.addEventListener('change', () => {
    S.tamilOnly = el.tamilOnly.checked;
    LS.set('tamilOnly', S.tamilOnly);
    afterVisibilityChange();
    toast(S.tamilOnly ? 'Hiding channels without Tamil audio' : 'Showing all channels');
  });
  el.hiddenList.addEventListener('click', (e) => {
    const b = e.target.closest('[data-show]');
    if (!b) return;
    const ch = S.channels.find((c) => c.url === b.dataset.show);
    if (ch) { showChannel(ch); toast(`${cleanName(ch.name)} is back in the list`); }
  });
  el.unhideAll.addEventListener('click', () => {
    S.channels.filter(isHidden).forEach((c) => { S.hidden.delete(c.url); if (autoHidden(c)) S.unhidden.add(c.url); });
    saveHidden();
    afterVisibilityChange();
    toast('All channels are visible');
  });
  el.addBtn.addEventListener('click', addCustomChannel);
  [el.addName, el.addUrl, el.addLogo].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCustomChannel(); }));
  el.customList.addEventListener('click', (e) => {
    const w = e.target.closest('[data-watch]'), r = e.target.closest('[data-remove]');
    if (w) { const c = S.channels.filter((x) => x.custom)[+w.dataset.watch]; if (c) { closeModals(); tune(c.num - 1); } }
    if (r) removeCustomChannel(+r.dataset.remove);
  });
  $('#clear-favs').addEventListener('click', () => {
    if (!S.favs.size) { toast('No favorites to clear'); return; }
    if (!confirm(`Remove all ${S.favs.size} favorites?`)) return;
    S.favs.clear();
    LS.set('favs', []);
    buildGroups(); computeView(); renderChips(); renderList(); updateFavUI();
    toast('Favorites cleared');
  });

  // ==================================================================
  // Remote bar, idle, touch
  // ==================================================================
  const actions = {
    up: () => zap(1), down: () => zap(-1), last: lastChannel, list: toggleList, epg: openEpg, info: toggleOsd,
    fav: () => toggleFav(S.channels[S.cur]), mute: toggleMute, fullscreen: toggleFullscreen,
    settings: () => openModal(el.settings), help: () => openModal(el.help), audio: toggleAudioMenu,
    add: () => { openModal(el.settings); $('#add-section').scrollIntoView({ block: 'start' }); el.addName.focus(); },
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (b) { actions[b.dataset.act](); b.blur(); }
  });
  // Rocker keys: press once to step, hold to repeat (volume repeats faster, like a TV)
  const holdActs = { up: () => zap(1), down: () => zap(-1), volup: () => stepVolume(1), voldown: () => stepVolume(-1) };
  let holdTimer = 0;
  const stopHold = () => clearTimeout(holdTimer);
  el.remote.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-hold]');
    if (!b || e.button > 0) return;
    e.preventDefault();
    wake();
    const act = holdActs[b.dataset.hold];
    const every = b.dataset.hold.startsWith('vol') ? 70 : 300;
    act();
    stopHold();
    holdTimer = setTimeout(function rep() { act(); holdTimer = setTimeout(rep, every); }, 450);
    try { b.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => el.remote.addEventListener(ev, stopHold));
  window.addEventListener('blur', stopHold);
  el.remote.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hold]');
    if (b && e.detail === 0) holdActs[b.dataset.hold]();   // keyboard activation
  });

  let idleTimer = 0, overRemote = false;
  el.remote.addEventListener('mouseenter', () => { overRemote = true; });
  el.remote.addEventListener('mouseleave', () => { overRemote = false; });
  function wake() {
    el.stage.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function sleep() {
      if (overRemote) { idleTimer = setTimeout(sleep, 1000); return; }
      el.stage.classList.add('idle');
    }, 3000);
  }
  ['mousemove', 'pointerdown', 'touchstart'].forEach((ev) => el.stage.addEventListener(ev, wake, { passive: true }));

  el.video.addEventListener('click', () => { if (listOpen()) setListVisible(false); else showOsd(); });
  el.video.addEventListener('dblclick', toggleFullscreen);
  el.noise.addEventListener('click', () => showOsd());
  $('#start-btn').addEventListener('click', startFromGate);

  let touchY = null;
  el.video.addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
  el.video.addEventListener('touchend', (e) => {
    if (touchY === null) return;
    const dy = e.changedTouches[0].clientY - touchY;
    touchY = null;
    if (Math.abs(dy) > 60) zap(dy < 0 ? 1 : -1);
  });

  // ==================================================================
  // Keyboard (TV remote)
  // ==================================================================
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (!el.start.hidden) { e.preventDefault(); startFromGate(); return; }

    const inField = e.target instanceof Element && e.target.matches('input:not([type=range]):not([type=checkbox]), textarea');
    if (inField) {
      if (k === 'Escape') { e.target.blur(); if (e.target !== el.search) closeModals(); }
      return;
    }
    if (!el.settings.hidden || !el.help.hidden) {
      if (k === 'Escape' || (k.toLowerCase() === 'h' && !el.help.hidden)) { e.preventDefault(); closeModals(); }
      return;
    }
    if (!el.epg.hidden) { if (epgKey(e)) e.preventDefault(); return; }

    wake();
    if (/^[0-9]$/.test(k)) { e.preventDefault(); numKey(k); return; }
    if (numBuf && k === 'Enter') { e.preventDefault(); commitNum(); return; }

    let handled = true;
    switch (k) {
      case 'ArrowUp': case 'PageUp': case 'ChannelUp': case 'MediaTrackNext': zap(1); break;
      case 'ArrowDown': case 'PageDown': case 'ChannelDown': case 'MediaTrackPrevious': zap(-1); break;
      case 'ArrowRight': case '+': case '=': case 'AudioVolumeUp': stepVolume(1); break;
      case 'ArrowLeft': case '-': case '_': case 'AudioVolumeDown': stepVolume(-1); break;
      case 'e': case 'E': case 'Enter': case 'Guide': openEpg(); break;
      case 'g': case 'G': case 'c': case 'C': toggleList(); break;
      case '/': if (!listOpen()) setListVisible(true); el.search.focus(); break;
      case 'i': case 'I': case 'Info': toggleOsd(); break;
      case 'm': case 'M': case 'AudioVolumeMute': toggleMute(); break;
      case 'a': case 'A': case 'Audio': case 'AudioTrack': cycleAudio(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 's': case 'S': case '*': toggleFav(S.channels[S.cur]); break;
      case 'x': case 'X': hideChannel(S.channels[S.cur]); break;
      case 'l': case 'L': case 'Backspace': lastChannel(); break;
      case 'o': case 'O': openModal(el.settings); break;
      case 'h': case 'H': case '?': openModal(el.help); break;
      case 'Escape':
        if (!el.audioMenu.hidden) closeAudioMenu();
        else if (listOpen()) setListVisible(false);
        else if (!el.osd.classList.contains('off')) hideOsd();
        else handled = false;
        break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });

  // ==================================================================
  // Boot
  // ==================================================================
  el.video.volume = LS.get('volume', 1);
  el.video.muted = LS.get('muted', false);
  syncVolumeUI(false);
  setListVisible(false);
  wake();
  el.tv.focus();
  if (!window.Hls) console.warn('hls.js failed to load; only native playback is available.');

  const src = S.source;
  if (src?.type === 'text' && src.text) applyChannels(parseM3U(src.text), src);
  else loadFromUrl(src?.type === 'url' ? src.url : PRESETS[0].url);
})();
