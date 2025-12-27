(() => {
  const CONFIG = {
    baseUrl: "https://www.birdscore.live",
    sourceUrl: "https://www.birdscore.live/",
    sourceLabel: "BIRDSCORE",
    tournamentName: "大会情報取得中",
    tournamentId: "LQP3UkvciJmiVLqVsUcf",
    livePollMs: 10000,
    finishedPollMs: 60000,
    finishedLimit: 6,
    cacheTtlMs: 6 * 60 * 60 * 1000,
    tournamentCacheTtlMs: 90 * 24 * 60 * 60 * 1000,
    remoteConfigUrl: "https://raw.githubusercontent.com/nematatu/birdscore-popup/main/config.json",
    tournamentDiscoveryPaths: [
      "json/tournaments.json",
      "json/tournament_list.json",
      "json/tournamentList.json",
      "json/tournaments/list.json",
      "json/index.json"
    ]
  };

  const els = {
    topbarRight: document.getElementById("topbar-right"),
    tournamentName: document.getElementById("tournament-name"),
    tournamentLink: document.getElementById("tournament-link"),
    liveList: document.getElementById("live-list"),
    liveCount: document.getElementById("live-count"),
    finishedList: document.getElementById("finished-list"),
    finishedCount: document.getElementById("finished-count"),
    status: document.getElementById("status"),
    openWindow: document.getElementById("open-window"),
    refresh: document.getElementById("refresh")
  };

  const isWindowMode = new URLSearchParams(window.location.search).get("mode") === "window";
  if (isWindowMode) {
    document.body.classList.add("window-mode");
    if (els.openWindow) {
      els.openWindow.style.display = "none";
    }
  }

  let tournament = null;
  let currentTournament = {
    id: CONFIG.tournamentId,
    name: CONFIG.tournamentName,
    sourceUrl: CONFIG.sourceUrl
  };
  let teamMap = new Map();
  let aliasMap = new Map();
  let aliasLoaded = false;
  let courtYoutubeMap = new Map();
  let courtYoutubeLoaded = false;
  let eventMap = new Map();
  let roundMap = new Map();
  let liveBusy = false;
  let finishedBusy = false;
  let detailCounter = 0;
  let hasCachedView = false;

  const VIEW_CACHE_KEYS = {
    liveHtml: "cachedLiveHtml",
    finishedHtml: "cachedFinishedHtml",
    liveCount: "cachedLiveCount",
    finishedCount: "cachedFinishedCount",
    topbarRight: "cachedTopbarRight",
    tournamentName: "cachedTournamentName",
    tournamentLink: "cachedTournamentLink"
  };

  const REMOTE_CONFIG_KEY = "remoteConfig";

  const storageGet = key =>
    new Promise(resolve => {
      chrome.storage.local.get([key], result => resolve(result[key]));
    });

  const storageSet = value =>
    new Promise(resolve => {
      chrome.storage.local.set(value, () => resolve());
    });

  const loadCached = async (key, loader) => {
    const cached = await storageGet(key);
    if (cached && Date.now() - cached.ts < CONFIG.cacheTtlMs) {
      return cached.data;
    }
    const data = await loader();
    await storageSet({ [key]: { ts: Date.now(), data } });
    return data;
  };

  const fetchJson = async path => {
    const url = `${CONFIG.baseUrl}/${path}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status}`);
    }
    return res.json();
  };

  const fetchText = async url => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status}`);
    }
    return res.text();
  };

  const getTournamentId = () => currentTournament?.id || CONFIG.tournamentId;
  const cacheKey = key => `${getTournamentId()}:${key}`;

  const formatClock = ts => {
    if (!ts) return "--:--";
    const date = new Date(ts);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  };

  const formatDuration = (startTs, endTs = Date.now()) => {
    if (!startTs) return "";
    const minutes = Math.max(0, Math.round((endTs - startTs) / 60000));
    return `${minutes}分`;
  };

  const setStatus = (text, isError = false) => {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.style.color = isError ? "#b42318" : "";
  };

  const handleToggleDetails = event => {
    const targetId = event.currentTarget?.dataset?.target;
    const panel = targetId ? document.getElementById(targetId) : null;
    if (!panel) return;
    const isOpen = panel.classList.toggle("open");
    event.currentTarget.setAttribute("aria-expanded", isOpen ? "true" : "false");
  };

  const bindToggleHandlers = root => {
    if (!root) return;
    root.querySelectorAll(".match-handle").forEach(button => {
      if (button.dataset.bound === "true") return;
      button.dataset.bound = "true";
      const targetId = button.dataset.target;
      const panel = targetId ? document.getElementById(targetId) : null;
      if (panel) {
        button.setAttribute("aria-expanded", panel.classList.contains("open") ? "true" : "false");
      }
      button.addEventListener("click", handleToggleDetails);
    });
  };

  const hydrateCachedView = async () => {
    const keys = Object.values(VIEW_CACHE_KEYS);
    const cached = await new Promise(resolve => {
      chrome.storage.local.get(keys, resolve);
    });
    if (els.liveList && cached[VIEW_CACHE_KEYS.liveHtml]) {
      els.liveList.innerHTML = cached[VIEW_CACHE_KEYS.liveHtml];
      bindToggleHandlers(els.liveList);
      hasCachedView = true;
    }
    if (els.finishedList && cached[VIEW_CACHE_KEYS.finishedHtml]) {
      els.finishedList.innerHTML = cached[VIEW_CACHE_KEYS.finishedHtml];
      bindToggleHandlers(els.finishedList);
      hasCachedView = true;
    }
    if (els.liveCount && cached[VIEW_CACHE_KEYS.liveCount] !== undefined) {
      els.liveCount.textContent = String(cached[VIEW_CACHE_KEYS.liveCount]);
    }
    if (els.finishedCount && cached[VIEW_CACHE_KEYS.finishedCount] !== undefined) {
      els.finishedCount.textContent = String(cached[VIEW_CACHE_KEYS.finishedCount]);
    }
    if (els.topbarRight && cached[VIEW_CACHE_KEYS.topbarRight]) {
      els.topbarRight.textContent = cached[VIEW_CACHE_KEYS.topbarRight];
    }
    if (els.tournamentName && cached[VIEW_CACHE_KEYS.tournamentName]) {
      els.tournamentName.textContent = cached[VIEW_CACHE_KEYS.tournamentName];
    }
    if (els.tournamentLink && cached[VIEW_CACHE_KEYS.tournamentLink]) {
      els.tournamentLink.href = cached[VIEW_CACHE_KEYS.tournamentLink];
    }
    if (hasCachedView) {
      setStatus("キャッシュ表示中");
    }
  };

  const cacheHeader = () => {
    storageSet({
      [VIEW_CACHE_KEYS.topbarRight]: els.topbarRight?.textContent || "",
      [VIEW_CACHE_KEYS.tournamentName]: els.tournamentName?.textContent || "",
      [VIEW_CACHE_KEYS.tournamentLink]: els.tournamentLink?.href || ""
    });
  };

  const cacheListHtml = (key, countKey, container, count) => {
    if (!container) return;
    storageSet({
      [key]: container.innerHTML,
      [countKey]: count
    });
  };

  const setTopbarLabel = () => {
    if (!tournament || !tournament.matchGroups) return;
    const now = new Date();
    const prefix = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
    const group = tournament.matchGroups.find(item => item.matchGroupName.startsWith(prefix));
    if (els.topbarRight) {
      els.topbarRight.textContent = group ? group.matchGroupName : prefix;
    }
    cacheHeader();
  };

  const setTournamentHeader = () => {
    if (!currentTournament) return;
    if (els.tournamentName) {
      els.tournamentName.textContent = currentTournament.name || CONFIG.tournamentName;
    }
    if (els.tournamentLink) {
      els.tournamentLink.href = currentTournament.sourceUrl || CONFIG.sourceUrl;
      els.tournamentLink.textContent = CONFIG.sourceLabel;
    }
    cacheHeader();
  };

  const normalizeName = name => {
    if (!name) return "";
    return name.replace(/\u3000/g, " ").trim();
  };

  const applyAlias = name => {
    if (!name) return name;
    return aliasMap.get(name) || name;
  };

  const decodeEscapes = value => {
    if (!value) return value;
    try {
      return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
    } catch (err) {
      return value;
    }
  };

  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  const pickConfigSection = (data, keys) => {
    if (!data || typeof data !== "object") return { present: false, value: null };
    for (const key of keys) {
      if (hasOwn(data, key)) {
        return { present: true, value: data[key] };
      }
    }
    return { present: false, value: null };
  };

  const buildRemoteConfigUrl = (force = false) => {
    if (!CONFIG.remoteConfigUrl) return "";
    if (!force) return CONFIG.remoteConfigUrl;
    try {
      const url = new URL(CONFIG.remoteConfigUrl);
      url.searchParams.set("_", String(Date.now()));
      return url.toString();
    } catch (err) {
      const sep = CONFIG.remoteConfigUrl.includes("?") ? "&" : "?";
      return `${CONFIG.remoteConfigUrl}${sep}_=${Date.now()}`;
    }
  };

  const applyConfigData = data => {
    if (!data || typeof data !== "object") {
      return { aliases: false, courts: false };
    }
    const aliasSection = pickConfigSection(data, ["aliases", "teamAliases", "team_aliases"]);
    const courtSection = pickConfigSection(data, ["courts", "courtYoutube", "court_youtube"]);
    let aliasApplied = false;
    let courtApplied = false;
    if (aliasSection.present) {
      const entries = Object.entries(aliasSection.value || {});
      aliasMap = new Map(entries);
      aliasLoaded = true;
      aliasApplied = true;
    }
    if (courtSection.present) {
      const entries = Object.entries(courtSection.value || {}).map(([key, value]) => [
        String(key).trim(),
        value
      ]);
      courtYoutubeMap = new Map(entries);
      courtYoutubeLoaded = true;
      courtApplied = true;
    }
    return { aliases: aliasApplied, courts: courtApplied };
  };

  const loadRemoteConfig = async force => {
    const url = buildRemoteConfigUrl(force);
    if (!url) return null;
    const cached = await storageGet(REMOTE_CONFIG_KEY);
    if (!force) {
      if (cached?.data) return cached.data;
      return null;
    }
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      const json = await res.json();
      await storageSet({ [REMOTE_CONFIG_KEY]: { ts: Date.now(), data: json } });
      return json;
    } catch (err) {
      console.warn("Remote config load failed", err);
      return null;
    }
  };

  const fetchRemoteConfig = async (force = false) => {
    const url = buildRemoteConfigUrl(force);
    if (!url) return null;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.warn("Remote config fetch failed", err);
      return null;
    }
  };

  const loadLocalAliases = async () => {
    try {
      const res = await fetch(chrome.runtime.getURL("team-aliases.json"));
      if (!res.ok) {
        aliasLoaded = true;
        return false;
      }
      const json = await res.json();
      const entries = Object.entries(json.aliases || {});
      aliasMap = new Map(entries);
      aliasLoaded = true;
      return true;
    } catch (err) {
      console.warn("Alias map load failed", err);
      aliasLoaded = true;
      return false;
    }
  };

  const loadLocalCourtYoutube = async () => {
    try {
      const res = await fetch(chrome.runtime.getURL("court-youtube.json"));
      if (!res.ok) {
        courtYoutubeLoaded = true;
        return false;
      }
      const json = await res.json();
      const entries = Object.entries(json.courts || {}).map(([key, value]) => [
        String(key).trim(),
        value
      ]);
      courtYoutubeMap = new Map(entries);
      courtYoutubeLoaded = true;
      return true;
    } catch (err) {
      console.warn("Court YouTube map load failed", err);
      courtYoutubeLoaded = true;
      return false;
    }
  };

  const loadConfigMaps = async ({ forceRemote = false } = {}) => {
    let applied = { aliases: false, courts: false };
    const remote = await loadRemoteConfig(forceRemote);
    if (remote) {
      applied = applyConfigData(remote);
    }
    if (!applied.aliases && !aliasLoaded) {
      await loadLocalAliases();
    }
    if (!applied.courts && !courtYoutubeLoaded) {
      await loadLocalCourtYoutube();
    }
  };

  const refreshRemoteConfigIfChanged = async () => {
    const cached = await storageGet(REMOTE_CONFIG_KEY);
    const latest = await fetchRemoteConfig();
    if (!latest) return;
    const prevText = cached?.data ? JSON.stringify(cached.data) : null;
    const nextText = JSON.stringify(latest);
    if (prevText === nextText) return;
    await storageSet({ [REMOTE_CONFIG_KEY]: { ts: Date.now(), data: latest } });
    const applied = applyConfigData(latest);
    if (!applied.aliases && !aliasLoaded) {
      await loadLocalAliases();
    }
    if (!applied.courts && !courtYoutubeLoaded) {
      await loadLocalCourtYoutube();
    }
    teamMap = new Map();
    await refreshAll();
  };

  const getCourtYoutubeUrl = courtLabel => {
    if (!courtLabel) return "";
    const raw = String(courtLabel).trim();
    if (courtYoutubeMap.has(raw)) {
      return courtYoutubeMap.get(raw) || "";
    }
    const noCourt = raw.replace(/コート/g, "").trim();
    if (courtYoutubeMap.has(noCourt)) {
      return courtYoutubeMap.get(noCourt) || "";
    }
    const digits = raw.match(/\d+/)?.[0];
    if (digits && courtYoutubeMap.has(digits)) {
      return courtYoutubeMap.get(digits) || "";
    }
    return "";
  };

  const parseDate = value => {
    if (!value) return null;
    if (typeof value === "number") return new Date(value);
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed);
  };

  const normalizeTournamentEntry = entry => {
    if (!entry || typeof entry !== "object") return null;
    const id =
      entry.tournamentId ||
      entry.tournamentID ||
      entry.id ||
      entry.tournament_id ||
      entry.tournament?.tournamentId ||
      entry.tournament?.id;
    const name = entry.tournamentName || entry.name || entry.title || entry.tournament?.name;
    const webUrl = entry.webUrl || entry.url || entry.tournamentUrl || entry.tournament?.url;
    const slug =
      entry.webId ||
      entry.webSlug ||
      entry.slug ||
      entry.urlPath ||
      (typeof webUrl === "string" ? webUrl.match(/\/web\/([^/]+)\//)?.[1] : null);
    const start =
      parseDate(entry.startTime) ||
      parseDate(entry.startDate) ||
      parseDate(entry.startAt) ||
      parseDate(entry.startedAt);
    const end =
      parseDate(entry.endTime) ||
      parseDate(entry.endDate) ||
      parseDate(entry.endAt) ||
      parseDate(entry.finishedAt);
    const status = entry.status || entry.state || entry.tournamentStatus || entry.progress;
    const isLive = entry.isLive || entry.live || entry.isCurrent || entry.inProgress;
    const sourceUrl = webUrl || (slug ? `${CONFIG.baseUrl}/web/${slug}/` : "");
    return id ? { id: String(id), name: name || "", sourceUrl, status, isLive, start, end } : null;
  };

  const scoreTournament = entry => {
    if (!entry) return -1;
    const now = Date.now();
    let score = 0;
    if (entry.isLive === true) score += 100;
    if (typeof entry.status === "string") {
      const normalized = entry.status.toLowerCase();
      if (["live", "ongoing", "in_progress", "inprogress", "playing"].includes(normalized)) {
        score += 80;
      }
    } else if (typeof entry.status === "number") {
      if (entry.status === 1 || entry.status === 2) score += 80;
    }
    if (entry.end && entry.end.getTime() >= now) score += 20;
    if (entry.start) {
      const delta = now - entry.start.getTime();
      if (delta >= 0 && delta <= 7 * 24 * 60 * 60 * 1000) score += 10;
    }
    return score;
  };

  const pickTournament = candidates => {
    const normalized = candidates.map(normalizeTournamentEntry).filter(Boolean);
    if (!normalized.length) return null;
    const scored = normalized
      .map(item => ({ item, score: scoreTournament(item) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const endA = a.item.end?.getTime() || 0;
        const endB = b.item.end?.getTime() || 0;
        if (endB !== endA) return endB - endA;
        const startA = a.item.start?.getTime() || 0;
        const startB = b.item.start?.getTime() || 0;
        return startB - startA;
      });
    return scored[0]?.item || null;
  };

  const extractTournamentList = data => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.tournaments)) return data.tournaments;
    if (Array.isArray(data.list)) return data.list;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.data)) return data.data;
    return [];
  };

  const tryFetchJson = async path => {
    try {
      return await fetchJson(path);
    } catch (err) {
      return null;
    }
  };

  const pickHomeMainScript = html => {
    const match = html.match(/<script[^>]+src=\"([^\"]*\/static\/js\/main\.[^\"]+\.js)\"/i);
    if (!match) return null;
    return new URL(match[1], CONFIG.baseUrl).toString();
  };

  const extractVsArray = jsText => {
    const match = jsText.match(/var vS=\\[(.*?)]\\s*;/s);
    return match ? match[1] : null;
  };

  const parseHomeTournaments = vsText => {
    if (!vsText) return [];
    const entries = [];
    const entryRegex =
      /\{title:\"(.*?)\",startDate:\"(\d{4}-\d{2}-\d{2})\",finishDate:\"(\d{4}-\d{2}-\d{2})\",place:\"(.*?)\",links:\[(.*?)\]\}/gs;
    let match;
    while ((match = entryRegex.exec(vsText))) {
      const urls = [];
      const linkRaw = match[5] || "";
      const urlMatches = linkRaw.match(/\"(https?:\/\/[^\"]+)\"/g) || [];
      urlMatches.forEach(raw => {
        const url = raw.replace(/\"/g, "");
        if (url) urls.push(url);
      });
      entries.push({
        title: decodeEscapes(match[1]),
        startDate: match[2],
        finishDate: match[3],
        place: decodeEscapes(match[4]),
        urls
      });
    }
    return entries;
  };

  const pickActiveTournamentFromHome = entries => {
    if (!entries.length) return null;
    const now = Date.now();
    const candidates = entries
      .map(entry => {
        const start = parseDate(entry.startDate);
        const end = parseDate(entry.finishDate);
        return {
          ...entry,
          start,
          end
        };
      })
      .filter(entry => entry.start && entry.end && entry.start.getTime() <= now && entry.end.getTime() >= now)
      .map(entry => ({
        id: entry.urls.find(url => url.includes("/web/")) || entry.urls[0] || "",
        name: entry.title,
        start: entry.start,
        end: entry.end
      }))
      .filter(entry => entry.id);
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const startA = a.start?.getTime() || 0;
      const startB = b.start?.getTime() || 0;
      return startB - startA;
    });
    return candidates[0];
  };

  const pickTournamentConfigFromWeb = async webUrl => {
    if (!webUrl) return null;
    const html = await fetchText(webUrl);
    const baseMatch = html.match(/<base[^>]+href=\"([^\"]+)\"/i);
    const baseHref = baseMatch ? baseMatch[1] : webUrl;
    const mainMatch = html.match(/<script[^>]+src=\"([^\"]*main\.[^\"]+\.js)\"/i);
    if (!mainMatch) return null;
    const jsUrl = new URL(mainMatch[1], new URL(baseHref, webUrl)).toString();
    const jsText = await fetchText(jsUrl);
    const configMatch = jsText.match(
      /tournamentId:\"([^\"]+)\",tournamentName:\"([^\"]*)\",ownerId:\"([^\"]*)\",siteUrl:\"([^\"]*)\"/
    );
    if (!configMatch) return null;
    return {
      id: configMatch[1],
      name: decodeEscapes(configMatch[2]),
      sourceUrl: configMatch[4] || webUrl
    };
  };

  const resolveTournamentFromHome = async () => {
    try {
      const homeHtml = await fetchText(CONFIG.sourceUrl);
      const mainJsUrl = pickHomeMainScript(homeHtml);
      if (!mainJsUrl) return null;
      const mainJsText = await fetchText(mainJsUrl);
      const vsText = extractVsArray(mainJsText);
      const entries = parseHomeTournaments(vsText);
      const active = pickActiveTournamentFromHome(entries);
      if (!active?.id) return null;
      const config = await pickTournamentConfigFromWeb(active.id);
      return config || null;
    } catch (err) {
      return null;
    }
  };

  const resolveTournamentConfig = async () => {
    const cached = await storageGet("currentTournament");
    if (cached?.data?.id) {
      return cached.data;
    }
    const homeConfig = await resolveTournamentFromHome();
    if (homeConfig) {
      await storageSet({ currentTournament: { ts: Date.now(), data: homeConfig } });
      return homeConfig;
    }
    for (const path of CONFIG.tournamentDiscoveryPaths) {
      const data = await tryFetchJson(path);
      const list = extractTournamentList(data);
      const picked = pickTournament(list);
      if (picked) {
        await storageSet({ currentTournament: { ts: Date.now(), data: picked } });
        return picked;
      }
    }
    return null;
  };

  const applyTournamentConfig = next => {
    if (!next || !next.id) return;
    const prevId = currentTournament?.id;
    currentTournament = {
      id: next.id,
      name: next.name || currentTournament?.name || CONFIG.tournamentName,
      sourceUrl: next.sourceUrl || currentTournament?.sourceUrl || CONFIG.sourceUrl
    };
    if (prevId && prevId !== currentTournament.id) {
      tournament = null;
      teamMap = new Map();
      eventMap = new Map();
      roundMap = new Map();
    }
  };

  const buildTeamMap = teamsJson => {
    const map = new Map();
    teamsJson.teams.forEach(team => {
      const players = team.players.map(player => ({
        name: normalizeName(player.playerName),
        belong: applyAlias(normalizeName(player.belong))
      }));
      const names = players.map(player => player.name).filter(value => value);
      map.set(team.teamId, {
        label: names.length ? names.join(" / ") : "TBD",
        players: players.length ? players : []
      });
    });
    return map;
  };

  const buildEventMap = tournamentJson => {
    const map = new Map();
    tournamentJson.tournamentEvents.forEach(group => {
      group.events.forEach(ev => {
        map.set(ev.eventId, group.title || ev.class || "");
      });
    });
    return map;
  };

  const buildRoundMap = tournamentJson => {
    const map = new Map();
    tournamentJson.rounds.forEach(round => {
      map.set(round.roundId, round.roundName);
    });
    return map;
  };

  const getTodayGroupIds = tournamentJson => {
    const now = new Date();
    const prefix = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
    return tournamentJson.matchGroups
      .filter(group => group.matchGroupName.startsWith(prefix))
      .map(group => group.matchGroupId);
  };

  const buildScoreChips = order => {
    if (!order || !order.teams || order.teams.length < 2) return [];
    const [teamA, teamB] = order.teams;
    const games = Math.max(teamA.gameInfos?.length || 0, teamB.gameInfos?.length || 0);
    const chips = [];
    for (let i = 0; i < games; i += 1) {
      const scoreA = teamA.gameInfos?.[i]?.point ?? "-";
      const scoreB = teamB.gameInfos?.[i]?.point ?? "-";
      const label = `G${i + 1} ${scoreA}-${scoreB}`;
      const current = isOrderLive(order) && order.gameCount === i + 1;
      chips.push({ label, current });
    }
    return chips;
  };

  const isOrderLive = order => !!order && order.orderStatus !== 4;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const renderEmpty = (container, message) => {
    container.innerHTML = "";
    container.appendChild(el("div", "empty", message));
  };

  const renderList = (container, items, emptyMessage) => {
    container.innerHTML = "";
    if (!items.length) {
      renderEmpty(container, emptyMessage);
      return;
    }
    items.forEach(item => {
      if (item.element) {
        container.appendChild(item.element);
        return;
      }
      const card = el("div", "card");
      if (item.header) {
        card.appendChild(item.header);
      }
      if (item.scoreTable) {
        card.appendChild(item.scoreTable);
      }
      container.appendChild(card);
    });
  };

  const buildTeamBlock = (teamMeta, alignRight) => {
    const block = el("div", alignRight ? "team-block right" : "team-block");
    const players = teamMeta?.players?.length ? teamMeta.players : [];
    if (!players.length) {
      block.appendChild(el("div", "player-name", teamMeta?.label || "-"));
      return block;
    }
    players.forEach(player => {
      block.appendChild(el("div", "player-name", player.name || "-"));
      if (player.belong && player.belong !== "　") {
        block.appendChild(el("div", "player-belong", player.belong));
      }
    });
    return block;
  };

  const buildMatchCardView = ({ match, order, courtLabel, timeText, durationText, detailsId }) => {
    const card = el("div", "match-card");
    const band = el("div", "match-band");
    const bandLeft = el("div", "band-left");
    const eventLabel = eventMap.get(match.eventId) || "";
    const roundLabel = roundMap.get(match.roundId) || "";
    const title = [eventLabel, roundLabel].filter(Boolean).join(" ");
    bandLeft.appendChild(el("div", "band-title", title || match.matchNo || ""));
    if (match.matchNo) {
      bandLeft.appendChild(el("div", "band-sub", match.matchNo));
    }
    band.appendChild(bandLeft);

    const bandRight = el("div", "band-right");
    if (timeText || durationText) {
      const timeCol = el("div", "band-timecol");
      if (timeText) timeCol.appendChild(el("div", "band-time", timeText));
      if (durationText) timeCol.appendChild(el("div", "band-duration", durationText));
      bandRight.appendChild(timeCol);
    }
    if (courtLabel) {
      const court = el("div", "band-court");
      court.appendChild(el("div", "band-court-num", courtLabel));
      court.appendChild(el("div", "band-court-label", "コート"));
      bandRight.appendChild(court);
      const youtubeUrl = getCourtYoutubeUrl(courtLabel);
      if (youtubeUrl) {
        const link = el("a", "court-youtube");
        link.href = youtubeUrl;
        link.target = "_blank";
        link.rel = "noopener";
        link.innerHTML =
          '<svg class="youtube-icon" viewBox="0 0 24 24" aria-hidden="true">' +
          '<path d="M22 8.2c0-1.2-.8-2.2-2-2.4C18.3 5.5 12 5.5 12 5.5s-6.3 0-8 .3C2.8 6 2 7 2 8.2v7.6c0 1.2.8 2.2 2 2.4 1.7.3 8 .3 8 .3s6.3 0 8-.3c1.2-.2 2-1.2 2-2.4V8.2z" fill="currentColor"/>' +
          '<polygon points="10,9 16,12 10,15" fill="#ffffff"/></svg>' +
          '<svg class="link-icon" viewBox="0 0 24 24" aria-hidden="true">' +
          '<path d="M14 3h7v7M10 14L21 3M20 14v6H4V4h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        bandRight.appendChild(link);
      }
    }
    band.appendChild(bandRight);
    card.appendChild(band);

    const body = el("div", "match-body");
    const teamAId = order?.teams?.[0]?.teamId;
    const teamBId = order?.teams?.[1]?.teamId;
    const teamA = teamMap.get(teamAId);
    const teamB = teamMap.get(teamBId);
    body.appendChild(buildTeamBlock(teamA, false));

    const scoreCenter = el("div", "score-center");
    const gameInfosA = order?.teams?.[0]?.gameInfos || [];
    const gameInfosB = order?.teams?.[1]?.gameInfos || [];
    const maxGames = Math.max(gameInfosA.length, gameInfosB.length, order?.gameCount || 0, 1);
    for (let i = 0; i < maxGames; i += 1) {
      const scoreA = gameInfosA[i]?.point ?? 0;
      const scoreB = gameInfosB[i]?.point ?? 0;
      const winner =
        scoreA === scoreB ? null : scoreA > scoreB ? "a" : "b";
      const line = el("div", "score-line");
      const isCurrent = isOrderLive(order) && order?.gameCount === i + 1;
      if (!isCurrent) {
        line.classList.add("past");
      }
      if (isCurrent) {
        line.classList.add("current");
      }
      line.appendChild(el("span", "score-set", `${i + 1}G`));
      const value = el("span", "score-value");
      const left = el(
        "span",
        winner === "a" ? "score-point win" : winner === "b" ? "score-point lose" : "score-point",
        `${scoreA}`
      );
      const right = el(
        "span",
        winner === "b" ? "score-point win" : winner === "a" ? "score-point lose" : "score-point",
        `${scoreB}`
      );
      value.appendChild(left);
      value.appendChild(el("span", "score-sep", "-"));
      value.appendChild(right);
      line.appendChild(value);
      scoreCenter.appendChild(line);
    }
    body.appendChild(scoreCenter);
    body.appendChild(buildTeamBlock(teamB, true));
    card.appendChild(body);

    const handle = el("button", "match-handle", "≡");
    handle.type = "button";
    handle.dataset.target = detailsId;
    handle.setAttribute("aria-expanded", "false");
    handle.addEventListener("click", handleToggleDetails);
    card.appendChild(handle);

    return card;
  };

  const buildScoreTables = (order, isLive) => {
    if (!order || !order.teams || order.teams.length < 2) return null;
    const config = tournament?.config || { gamePoint: 21 };
    const deuceIndex = config.gamePoint ? config.gamePoint - 1 : null;
    const teams = order.teams;
    const maxGames = Math.max(
      order.gameInfos?.length || 0,
      ...teams.flatMap(team => (team.players || []).map(player => player.scores?.length || 0))
    );

    const stack = el("div", "score-stack");
    for (let gameIndex = maxGames - 1; gameIndex >= 0; gameIndex -= 1) {
      const section = el("div", "score-section");
      const label = el("div", "score-label");
      const matchEnded = order.orderStatus === 4;
      label.textContent = `${gameIndex + 1}G`;
      if (matchEnded && gameIndex === maxGames - 1) {
        label.classList.add("final");
      }
      if (isOrderLive(order) && order.gameCount === gameIndex + 1) {
        label.classList.add("current");
      }
      section.appendChild(label);

      const wrapper = el("div", "table-wrapper");
      const table = el("table", "table");
      wrapper.appendChild(table);
      section.appendChild(wrapper);

      const isDoubles = teams.some(team => (team.players || []).length > 1);
      if (isDoubles) {
        table.classList.add("doubles");
      }

      const maxLen = Math.max(
        ...teams.flatMap(team =>
          (team.players || []).map(player => (player.scores?.[gameIndex] || []).length)
        ),
        0
      );

      const teamWinCounts = teams.map(team => team.winGameCount || 0);
      const winnerIndex =
        matchEnded && teamWinCounts[0] !== teamWinCounts[1]
          ? teamWinCounts[0] > teamWinCounts[1]
            ? 0
            : 1
          : null;

      let rowIndex = 0;
      teams.forEach((team, teamIndex) => {
        const players = team.players?.length ? team.players : [{ scores: [] }];
        const teamMeta = teamMap.get(team.teamId);
        const labelList = teamMeta?.players?.length ? teamMeta.players : [teamMeta?.label || "-"];

        players.forEach((player, playerIndex) => {
          const row = el("tr");
          if (rowIndex % 2 === 1) row.classList.add("alternate");
          if (winnerIndex !== null) {
            row.classList.add(winnerIndex === teamIndex ? "win" : "lose");
          }

          const nameEntry =
            labelList[playerIndex] !== undefined
              ? labelList[playerIndex]
              : teamMeta?.label ?? "-";
          const nameLabel =
            typeof nameEntry === "string" ? nameEntry : nameEntry?.name || teamMeta?.label || "-";
          const nameCell = el("td", null, nameLabel);
          row.appendChild(nameCell);

          if (playerIndex === 0) {
            const resultCell = el("td", "result", String(team.winGameCount ?? 0));
            if (players.length > 1) {
              resultCell.rowSpan = players.length;
            }
            row.appendChild(resultCell);
          }

          const scores = player.scores?.[gameIndex] || [];
          for (let i = 0; i < maxLen; i += 1) {
            const value = scores[i] ?? "";
            const cell = el("td", null, value);
            if (deuceIndex !== null && i === deuceIndex) {
              cell.classList.add("deuce");
            }
            row.appendChild(cell);
          }

          if (playerIndex === 0) {
            const finalPoint = team.gameInfos?.[gameIndex]?.point;
            const finalCell = el("td", "final-score", finalPoint !== undefined ? String(finalPoint) : "");
            if (players.length > 1) {
              finalCell.rowSpan = players.length;
            }
            row.appendChild(finalCell);
          }

          table.appendChild(row);
          rowIndex += 1;
        });

        if (teamIndex === 0) {
          const sep = el("tr", "sep");
          const sepCells = 3 + maxLen;
          for (let i = 0; i < sepCells; i += 1) {
            sep.appendChild(el("td"));
          }
          table.appendChild(sep);
          rowIndex += 1;
        }
      });

      stack.appendChild(section);
    }

    return stack;
  };

  const buildMatchCard = (court, match, order) => {
    const detailsId = `score-details-${detailCounter++}`;
    const scoreTable = buildScoreTables(order, true);
    const details = el("div", "score-details");
    details.id = detailsId;
    if (scoreTable) details.appendChild(scoreTable);
    const timeText = match.scheduleTime || "";
    const durationText = formatDuration(order?.startTime);
    const courtLabel = court?.courtName ? String(court.courtName) : "";
    const card = buildMatchCardView({
      match,
      order,
      courtLabel,
      timeText,
      durationText,
      detailsId
    });
    card.appendChild(details);
    return { element: card };
  };

  const buildFinishedCard = (match, order) => {
    const detailsId = `score-details-${detailCounter++}`;
    const scoreTable = buildScoreTables(order, false);
    const details = el("div", "score-details");
    details.id = detailsId;
    if (scoreTable) details.appendChild(scoreTable);
    const timeText = match.scheduleTime || (order.endTime ? formatClock(order.endTime) : "");
    const durationText = formatDuration(order?.startTime, order?.endTime || Date.now());
    const card = buildMatchCardView({
      match,
      order,
      courtLabel: "",
      timeText,
      durationText,
      detailsId
    });
    card.appendChild(details);
    return { element: card };
  };

  const ensureBaseData = async () => {
    setTournamentHeader();
    const discovered = await resolveTournamentConfig();
    if (discovered) {
      applyTournamentConfig(discovered);
    } else {
      setStatus("大会自動選択に失敗。既定大会を表示中", true);
    }
    setTournamentHeader();
    if (!tournament) {
      tournament = await loadCached(cacheKey("tournament"), () =>
        fetchJson(`json/${getTournamentId()}/tournament.json`)
      );
      if (tournament?.tournamentName) {
        currentTournament.name = tournament.tournamentName;
      }
      setTournamentHeader();
      eventMap = buildEventMap(tournament);
      roundMap = buildRoundMap(tournament);
      setTopbarLabel();
    }

    if (!teamMap.size) {
      if (!aliasLoaded || !courtYoutubeLoaded) {
        await loadConfigMaps();
      }
      const teams = await loadCached(cacheKey("teams"), () =>
        fetchJson(`json/${getTournamentId()}/teams.json`)
      );
      teamMap = buildTeamMap(teams);
    }
  };

  const loadLiveMatches = async () => {
    if (liveBusy) return;
    liveBusy = true;
    try {
      await ensureBaseData();
      const courts = await fetchJson(`json/${getTournamentId()}/courts.json`);
      const current = courts.courts.filter(court => court.currentMatchId && court.currentOrderId);
      const details = await Promise.all(
        current.map(async court => {
          const [match, order] = await Promise.all([
            fetchJson(`json/${getTournamentId()}/matches/${court.currentMatchId}/match.json`),
            fetchJson(
              `json/${getTournamentId()}/matches/${court.currentMatchId}/${court.currentOrderId}/order.json`
            )
          ]);
          return buildMatchCard(court, match, order);
        })
      );

      if (els.liveList) {
        renderList(els.liveList, details, "試合中のコートはありません");
        bindToggleHandlers(els.liveList);
      }
      if (els.liveCount) {
        els.liveCount.textContent = String(details.length);
      }
      cacheListHtml(
        VIEW_CACHE_KEYS.liveHtml,
        VIEW_CACHE_KEYS.liveCount,
        els.liveList,
        details.length
      );
      setStatus("更新完了");
    } catch (err) {
      console.error(err);
      setStatus("ライブ情報の取得に失敗しました", true);
      if (els.liveList) {
        renderEmpty(els.liveList, "取得できませんでした");
      }
    } finally {
      liveBusy = false;
    }
  };

  const loadFinishedMatches = async () => {
    if (finishedBusy) return;
    finishedBusy = true;
    try {
      await ensureBaseData();
      const schedule = await fetchJson(`json/${getTournamentId()}/schedule.json`);
      const todayGroupIds = getTodayGroupIds(tournament);
      const groupIds = todayGroupIds.length ? todayGroupIds : Object.keys(schedule.matches || {});
      const finishedOrders = [];

      groupIds.forEach(groupId => {
        const matches = schedule.matches[groupId] || [];
        matches.forEach(match => {
          match.orders.forEach(order => {
            if (order.orderStatus === 4) {
              finishedOrders.push({ matchId: match.matchId, orderId: order.orderId });
            }
          });
        });
      });

      const candidates = finishedOrders.slice(-CONFIG.finishedLimit);
      const details = await Promise.all(
        candidates.map(async item => {
          const [match, order] = await Promise.all([
            fetchJson(`json/${getTournamentId()}/matches/${item.matchId}/match.json`),
            fetchJson(
              `json/${getTournamentId()}/matches/${item.matchId}/${item.orderId}/order.json`
            )
          ]);
          return { match, order };
        })
      );

      const sorted = details
        .filter(item => item.order.endTime)
        .sort((a, b) => b.order.endTime - a.order.endTime)
        .slice(0, CONFIG.finishedLimit)
        .map(item => buildFinishedCard(item.match, item.order));

      if (els.finishedList) {
        renderList(els.finishedList, sorted, "終了試合はまだありません");
        bindToggleHandlers(els.finishedList);
      }
      if (els.finishedCount) {
        els.finishedCount.textContent = String(sorted.length);
      }
      cacheListHtml(
        VIEW_CACHE_KEYS.finishedHtml,
        VIEW_CACHE_KEYS.finishedCount,
        els.finishedList,
        sorted.length
      );
    } catch (err) {
      console.error(err);
      setStatus("終了試合の取得に失敗しました", true);
      if (els.finishedList) {
        renderEmpty(els.finishedList, "取得できませんでした");
      }
    } finally {
      finishedBusy = false;
    }
  };

  const refreshAll = async ({ forceRemote = false } = {}) => {
    if (!hasCachedView) {
      setStatus("更新中...");
    }
    if (forceRemote) {
      await loadConfigMaps({ forceRemote: true });
    }
    await Promise.all([loadLiveMatches(), loadFinishedMatches()]);
  };

  if (els.refresh) {
    els.refresh.addEventListener("click", () => refreshAll({ forceRemote: true }));
  }

  if (els.openWindow) {
    els.openWindow.addEventListener("click", () => {
      if (!chrome?.windows?.create) return;
      const url = chrome.runtime.getURL("popup.html?mode=window");
      chrome.windows.create({
        url,
        type: "popup",
        width: 520,
        height: 780
      });
    });
  }

  hydrateCachedView();
  refreshAll();
  refreshRemoteConfigIfChanged();
  setInterval(loadLiveMatches, CONFIG.livePollMs);
  setInterval(loadFinishedMatches, CONFIG.finishedPollMs);
})();
