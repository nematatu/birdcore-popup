(() => {
  const CONFIG = {
    baseUrl: "https://www.birdscore.live",
    sourceUrl: "https://www.birdscore.live/web/79alljapan/",
    sourceLabel: "BIRDSCORE",
    tournamentName: "第79回 全日本総合バドミントン選手権大会",
    tournamentId: "LQP3UkvciJmiVLqVsUcf",
    livePollMs: 10000,
    finishedPollMs: 60000,
    finishedLimit: 6,
    cacheTtlMs: 6 * 60 * 60 * 1000
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
    refresh: document.getElementById("refresh")
  };

  let tournament = null;
  let teamMap = new Map();
  let aliasMap = new Map();
  let aliasLoaded = false;
  let eventMap = new Map();
  let roundMap = new Map();
  let liveBusy = false;
  let finishedBusy = false;
  let detailCounter = 0;

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
    els.status.textContent = text;
    els.status.style.color = isError ? "#b42318" : "";
  };

  const setTopbarLabel = () => {
    if (!tournament || !tournament.matchGroups) return;
    const now = new Date();
    const prefix = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
    const group = tournament.matchGroups.find(item => item.matchGroupName.startsWith(prefix));
    els.topbarRight.textContent = group ? group.matchGroupName : prefix;
  };

  const setTournamentHeader = () => {
    if (els.tournamentName) {
      els.tournamentName.textContent = CONFIG.tournamentName;
    }
    if (els.tournamentLink) {
      els.tournamentLink.href = CONFIG.sourceUrl;
      els.tournamentLink.textContent = CONFIG.sourceLabel;
    }
  };

  const normalizeName = name => {
    if (!name) return "";
    return name.replace(/\u3000/g, " ").trim();
  };

  const applyAlias = name => {
    if (!name) return name;
    return aliasMap.get(name) || name;
  };

  const loadAliases = async () => {
    try {
      const res = await fetch(chrome.runtime.getURL("team-aliases.json"));
      if (!res.ok) return;
      const json = await res.json();
      const entries = Object.entries(json.aliases || {});
      aliasMap = new Map(entries);
      aliasLoaded = true;
    } catch (err) {
      console.warn("Alias map load failed", err);
      aliasLoaded = true;
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
      const current = order.orderStatus === 1 && order.gameCount === i + 1;
      chips.push({ label, current });
    }
    return chips;
  };

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
      const isCurrent = order?.orderStatus === 1 && order?.gameCount === i + 1;
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
    handle.addEventListener("click", event => {
      const targetId = event.currentTarget.dataset.target;
      const panel = targetId ? document.getElementById(targetId) : null;
      if (!panel) return;
      const isOpen = panel.classList.toggle("open");
      event.currentTarget.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
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
      if (order.orderStatus === 1 && order.gameCount === gameIndex + 1) {
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
    if (!tournament) {
      tournament = await loadCached("tournament", () =>
        fetchJson(`json/${CONFIG.tournamentId}/tournament.json`)
      );
      eventMap = buildEventMap(tournament);
      roundMap = buildRoundMap(tournament);
      setTopbarLabel();
    }

    if (!teamMap.size) {
      if (!aliasLoaded) {
        await loadAliases();
      }
      const teams = await loadCached("teams", () =>
        fetchJson(`json/${CONFIG.tournamentId}/teams.json`)
      );
      teamMap = buildTeamMap(teams);
    }
  };

  const loadLiveMatches = async () => {
    if (liveBusy) return;
    liveBusy = true;
    try {
      await ensureBaseData();
      const courts = await fetchJson(`json/${CONFIG.tournamentId}/courts.json`);
      const current = courts.courts.filter(court => court.currentMatchId && court.currentOrderId);
      const details = await Promise.all(
        current.map(async court => {
          const [match, order] = await Promise.all([
            fetchJson(`json/${CONFIG.tournamentId}/matches/${court.currentMatchId}/match.json`),
            fetchJson(
              `json/${CONFIG.tournamentId}/matches/${court.currentMatchId}/${court.currentOrderId}/order.json`
            )
          ]);
          return buildMatchCard(court, match, order);
        })
      );

      renderList(els.liveList, details, "試合中のコートはありません");
      els.liveCount.textContent = String(details.length);
      setStatus("更新完了");
    } catch (err) {
      console.error(err);
      setStatus("ライブ情報の取得に失敗しました", true);
      renderEmpty(els.liveList, "取得できませんでした");
    } finally {
      liveBusy = false;
    }
  };

  const loadFinishedMatches = async () => {
    if (finishedBusy) return;
    finishedBusy = true;
    try {
      await ensureBaseData();
      const schedule = await fetchJson(`json/${CONFIG.tournamentId}/schedule.json`);
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
            fetchJson(`json/${CONFIG.tournamentId}/matches/${item.matchId}/match.json`),
            fetchJson(
              `json/${CONFIG.tournamentId}/matches/${item.matchId}/${item.orderId}/order.json`
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

      renderList(els.finishedList, sorted, "終了試合はまだありません");
      els.finishedCount.textContent = String(sorted.length);
    } catch (err) {
      console.error(err);
      setStatus("終了試合の取得に失敗しました", true);
      renderEmpty(els.finishedList, "取得できませんでした");
    } finally {
      finishedBusy = false;
    }
  };

  const refreshAll = async () => {
    setStatus("更新中...");
    await Promise.all([loadLiveMatches(), loadFinishedMatches()]);
  };

  els.refresh.addEventListener("click", refreshAll);

  refreshAll();
  setInterval(loadLiveMatches, CONFIG.livePollMs);
  setInterval(loadFinishedMatches, CONFIG.finishedPollMs);
})();
