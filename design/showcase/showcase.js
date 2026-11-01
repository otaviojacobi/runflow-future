/* Runflow design showcase (DS1). Renders from window.RunflowTokens + window.RunflowColor.
 * Code and comments in English; every visible string in pt-BR (root.md §4.7).
 * Club colors: 0, 1 or 2 (primary/secondary), resolved by RunflowColor.resolveClubColors. */
(function () {
  "use strict";
  const T = window.RunflowTokens;
  const C = window.RunflowColor;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };
  const WHITE = T.palette.neutral["0"];
  const INK = T.palette.neutral["950"];
  const DEFAULTS = { brand: T.seeds.brand, accent: T.seeds.accent };
  const HEX = /^#?[0-9a-f]{6}$/i;
  const normHex = (h) => ("#" + String(h).trim().replace("#", "")).toUpperCase();
  const onColor = (hex) => (C.contrast(hex, WHITE) >= C.contrast(hex, INK) ? WHITE : INK);
  const num = (n, d) => n.toFixed(d).replace(".", ",");
  const ratio = (a, b) => num(C.contrast(a, b), 2) + ":1";

  // ---------- icons (placeholder set; final icons in D2) ----------
  const ICONS = {
    home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
    calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    activity: "M3 12h4l3-8 4 16 3-8h4",
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    bell: "M6 9a6 6 0 1 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9M10 21h4",
    check: "M5 12.5l4.5 4.5L19 7.5",
    x: "M6 6l12 12M18 6 6 18",
    plus: "M12 5v14M5 12h14",
    copy: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/>',
    filter: "M3 5h18l-7 8.5V20l-4-2v-4.5z",
    upload: "M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
    chevron: "M9 6l6 6-6 6",
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>',
    swap: "M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7",
    trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3",
    flame: "M12 22c4 0 7-2.7 7-7 0-3.5-2.2-6-4-8 0 2.5-1.5 4-3 4 0-3-1.5-6-4-8.5C8 6.5 5 9.5 5 15c0 4.3 3 7 7 7z",
    grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.2.6 3.5 2.6 3.5 6"/>',
    book: "M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5zM4 19.5A1.5 1.5 0 0 0 5.5 21H20",
    message: "M4 5h16v11H9l-5 4z",
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    signal: "M4 18v-2M9 18v-5M14 18v-8M19 18V7",
    battery: '<rect x="2" y="7" width="18" height="10" rx="2.5"/><path d="M22 10.5v3"/><rect x="4.5" y="9.5" width="11" height="5" rx="1" fill="currentColor" stroke="none"/>',
    sport_run: "M2.5 17.5h17.5a2 2 0 0 0 .3-4l-5.8-1.2-3.2-4.3-2.3 1 .8 3.2H6.5L4.6 9.6 2.5 10.6zM2.5 21h19",
    sport_swim: '<circle cx="16.5" cy="6.5" r="2"/><path d="M5 12.5 9.5 9l3 3 3-2M2 16.5c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M2 20.5c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/>',
    sport_bike: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9.5 9h5.5l3.5 7.5M9.5 9 8.5 6h-2M15 9l-3 7.5h-6.5"/>',
    sport_strength: "M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11",
    sport_mobility: '<circle cx="12" cy="5" r="2"/><path d="M4 20c3-.5 5.5-3 8-8 2.5 5 5 7.5 8 8M7.5 11.5h9"/>',
    sport_other: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  };
  function icon(name) {
    const d = ICONS[name];
    const body = d.charAt(0) === "<" ? d : '<path d="' + d + '"/>';
    return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";
  }
  // Placeholder Runflow mark: a "flow" wave + runner dot. Always Runflow's colors (never club-themed).
  const runflowMark = (size) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="${T.seeds.brand}"/><path d="M6.5 21c3.2 0 4.4-8.5 8.7-8.5S20 21 25.5 21" fill="none" stroke="${T.seeds.accent}" stroke-width="3.2" stroke-linecap="round"/><circle cx="24.4" cy="9.8" r="2.5" fill="${T.seeds.accent}"/></svg>`;

  // ---------- sample clubs: 0, 1 or 2 colors ----------
  const CLUBS = [
    { id: "runflow", name: "Runflow", label: "Runflow · sem cores", short: "RF", primary: null, secondary: null, runflow: true },
    { id: "paceforte", name: "Pace Forte Assessoria", short: "PF", primary: "#D62828", secondary: "#FFB703" },
    { id: "mare", name: "Equipe Maré Natação", short: "EM", primary: "#0096C7", secondary: null },
    { id: "solar", name: "Academia Solar", short: "AS", primary: "#FFC300", secondary: "#111111" },
    { id: "noturnos", name: "Noturnos Run Club", short: "NR", primary: "#111111", secondary: "#7CFFCB" },
    { id: "trilha", name: "Trilha Verde Corrida", short: "TV", primary: "#2D6A4F", secondary: null },
    { id: "laranja", name: "Ritmo Laranja Tri", short: "RL", primary: "#FF6B00", secondary: "#1D3557" },
    { id: "rosa", name: "Rosa Run", short: "RR", primary: "#E91E63", secondary: "#FFD166" },
  ];
  let club = Object.assign({}, CLUBS[0]);
  let res = C.resolveClubColors(club, DEFAULTS);
  let suggestions = [];
  const colorCount = (c) => (c.primary ? 1 : 0) + (c.secondary ? 1 : 0);

  function clubLogo(size) {
    const st = `width:${size}px;height:${size}px`;
    if (club.logo) return `<img class="club-logo" src="${club.logo}" alt="" style="${st}">`;
    if (club.runflow) return `<span class="club-logo is-mark" style="${st}">${runflowMark(size)}</span>`;
    return `<span class="club-logo" style="${st};font-size:${Math.round(size * 0.36)}px">${esc(club.short)}</span>`;
  }
  const dots = (c) => {
    const r = C.resolveClubColors(c, DEFAULTS);
    return `<span class="preset-dots"><span class="preset-dot" style="background:${r.primary}"></span><span class="preset-dot" style="background:${r.secondary}"></span></span>`;
  };

  // ---------- domain sample data (pt-BR) ----------
  const ZONE_H = { 1: 30, 2: 46, 3: 62, 4: 82, 5: 100 };
  const INTERVAL = [[10, 2]].concat(...Array.from({ length: 6 }, (_, i) => (i < 5 ? [[4.5, 4], [2, 1]] : [[4.5, 4]])), [[10, 1]]);
  const LONG = [[15, 2], [35, 2], [20, 3], [10, 4], [5, 1]];
  const FARTLEK = [[10, 2], [1, 5], [2, 2], [2, 4], [2, 2], [3, 3], [2, 2], [1, 5], [2, 2], [2, 4], [2, 2], [11, 1]];
  const profile = (segs) =>
    '<div class="profile" role="img" aria-label="Perfil de intensidade">' +
    segs.map(([m, z]) => `<span class="seg" style="flex:${m} 1 0;height:${ZONE_H[z]}%;background:var(--rf-zone-${z}-solid)"></span>`).join("") +
    "</div>";
  const SPORTS = [["run", "Corrida"], ["swim", "Natação"], ["bike", "Ciclismo"], ["strength", "Musculação"], ["mobility", "Mobilidade"], ["other", "Outros"]];
  const WEEK = [["S", 2, "done"], ["T", 3, "today"], ["Q", 4, "planned"], ["Q", 5, "planned"], ["S", 6, "rest"], ["S", 7, "planned"], ["D", 8, "rest"]];

  function phone(theme) {
    const tabs = [["home", "Hoje", 1], ["calendar", "Agenda"], ["activity", "Atividades"], ["user", "Perfil"]];
    return `<div class="phone"${theme ? ` data-theme="${theme}"` : ""}>
  <div class="phone-screen">
    <div class="ph-status"><span>9:41</span><span class="ph-icons">${icon("signal")}${icon("battery")}</span></div>
    <div class="ph-body">
      <header class="ph-head">${clubLogo(38)}<div><div class="ph-club">${esc(club.name)}</div><div class="rf-text-title-lg">Bom dia, Ana</div></div><span class="icon-btn" aria-label="Notificações">${icon("bell")}<span class="pip-badge"></span></span></header>
      <div class="week">${WEEK.map(([d, n, s]) => `<div class="day ${s}"><span>${d}</span><span class="num">${n}</span><i class="pip"></i></div>`).join("")}</div>
      <div class="row between"><span class="rf-text-overline muted">Hoje · ter, 3 nov</span><span class="chip accent-chip">${icon("flame")}12 semanas</span></div>
      <article class="card workout">
        <div class="row between"><span class="chip sport-run">${icon("sport_run")}Corrida</span><span class="meta">≈ 59 min · 10,4 km</span></div>
        <div class="rf-text-title-md">Intervalado 6×1 km</div>
        ${profile(INTERVAL)}
        <ul class="steps">
          <li><i style="background:var(--rf-zone-2-solid)"></i>10′ aquecimento<b>Z2</b></li>
          <li><i style="background:var(--rf-zone-4-solid)"></i>6× 1 km<b>4:30 /km</b></li>
          <li><i style="background:var(--rf-zone-1-solid)"></i>2′ trote entre os tiros<b>Z1</b></li>
          <li><i style="background:var(--rf-zone-1-solid)"></i>10′ desaquecimento<b>Z1</b></li>
        </ul>
        <span class="btn btn-primary btn-block">Ver treino${icon("chevron")}</span>
      </article>
      <article class="card last">
        <div class="row between"><span class="label">Última atividade</span><span class="via">via Strava</span></div>
        <div class="stats"><div><span class="metric">5,0</span><span class="unit">km</span></div><div><span class="metric">4:18</span><span class="unit">/km</span></div><div><span class="metric">168</span><span class="unit">bpm</span></div></div>
        <div class="row gap wrap"><span class="badge badge-success">${icon("check")}Concluído</span><span class="badge badge-accent">${icon("trophy")}Recorde nos 5 km</span></div>
        <span class="meta">seg, 2 nov · Teste de 5 km</span>
      </article>
    </div>
    <nav class="ph-tabs">${tabs.map(([i, l, a]) => `<span class="tab${a ? " active" : ""}"><span class="tab-ic">${icon(i)}</span>${l}</span>`).join("")}</nav>
  </div>
</div>`;
  }

  const PLAN = [
    { name: "Ana Souza", ini: "AS", comp: 92, days: [["run", "Teste 5 km", "done"], ["run", "Intervalado 6×1 km", "today"], ["mobility", "Mobilidade 20′"], ["run", "Ritmo 5 km"], null, ["run", "Longão 18 km"], null] },
    { name: "Bruno Lima", ini: "BL", comp: 68, days: [["run", "Rodagem 6 km", "done"], ["strength", "Força A", "today"], ["run", "Fartlek 40′"], null, ["strength", "Força B"], ["run", "Longão 14 km"], null] },
    { name: "Carla Mendes", ini: "CM", comp: 41, days: [["swim", "Natação 2.000 m", "missed"], ["run", "Rodagem 8 km", "today"], ["bike", "Bike 60′"], ["run", "Intervalado 8×400 m"], null, ["run", "Longão 21 km"], null] },
    { name: "Diego Rocha", ini: "DR", comp: 85, days: [["run", "Regenerativo 5 km", "done"], null, ["run", "Tempo run 30′"], ["swim", "Natação 1.500 m"], ["run", "Rodagem 10 km"], ["bike", "Pedal 2h"], null] },
  ];
  const DAYS = ["Seg 2", "Ter 3", "Qua 4", "Qui 5", "Sex 6", "Sáb 7", "Dom 8"];
  function desktop() {
    const nav = [["grid", "Painel"], ["users", "Alunos"], ["calendar", "Planejamento", 1], ["book", "Biblioteca"], ["message", "Feedbacks"], ["clock", "Aulas"]];
    const level = (c) => (c >= 80 ? "success" : c >= 60 ? "warning" : "danger");
    const cell = (d, i) => {
      if (!d) return `<td${i === 1 ? ' class="today"' : ""}><div class="rest-cell">Descanso</div></td>`;
      const ic = d[2] === "done" ? icon("check") : d[2] === "missed" ? icon("x") : "";
      return `<td${i === 1 ? ' class="today"' : ""}><div class="wchip sport-${d[0]} ${d[2] || ""}">${d[1]}${ic}</div></td>`;
    };
    return `<div class="desk-wrap"><div class="desk">
  <aside class="desk-side">
    <div class="desk-club">${clubLogo(32)}<span>${esc(club.name)}</span></div>
    ${nav.map(([i, l, a]) => `<span class="nav-item${a ? " active" : ""}">${icon(i)}${l}</span>`).join("")}
  </aside>
  <div class="desk-main">
    <div class="desk-top">
      <div><div class="rf-text-overline muted">Semana 45</div><div class="rf-text-title-lg">Planejamento · 2–8 nov</div></div>
      <div class="row gap"><span class="btn btn-ghost">${icon("filter")}Filtros</span><span class="btn btn-secondary">${icon("copy")}Copiar semana</span><span class="btn btn-primary">${icon("plus")}Novo treino</span></div>
    </div>
    <table class="plan">
      <colgroup><col style="width:150px">${DAYS.map(() => "<col>").join("")}<col style="width:96px"></colgroup>
      <thead><tr><th>Aluno</th>${DAYS.map((d, i) => `<th${i === 1 ? ' class="today"' : ""}>${d}</th>`).join("")}<th>Aderência</th></tr></thead>
      <tbody>${PLAN.map((p) => `<tr><td><div class="student"><span class="avatar">${p.ini}</span>${p.name}</div></td>${p.days.map(cell).join("")}<td><div class="comp ${level(p.comp)}"><span>${p.comp}%</span><span class="comp-bar"><i style="width:${p.comp}%"></i></span></div></td></tr>`).join("")}</tbody>
    </table>
    <div class="row gap wrap">
      <span class="badge badge-success">${icon("check")}Concluído</span><span class="badge badge-warning">Parcial</span><span class="badge badge-danger">${icon("x")}Não realizado</span><span class="badge badge-info">3 novos feedbacks</span><span class="badge badge-accent">${icon("trophy")}2 recordes na semana</span><span class="chip brand-chip">Grupo Maratona SP</span><span class="link">Ver todos os alunos${icon("chevron")}</span>
    </div>
  </div>
</div></div>`;
  }

  // ---------- palettes ----------
  function tiles(scale, anchor, note) {
    return Object.keys(scale)
      .filter((k) => k !== "anchor")
      .map((k) => {
        const hex = scale[k];
        const seed = anchor !== undefined && String(k) === String(anchor);
        const x = note ? `<span class="sw-x">${num(C.contrast(hex, WHITE), 1)} vs branco</span>` : "";
        return `<div class="sw${seed ? " seed" : ""}" style="background:${hex};color:${onColor(hex)}"><span class="sw-t">${k}${seed ? " · semente" : ""}</span><span class="sw-h">${hex}</span>${x}</div>`;
      })
      .join("");
  }

  const SPECIMEN = {
    brand: () => `<span class="btn btn-primary">${icon("plus")}Novo treino</span><span class="btn btn-secondary">Cancelar</span><span class="chip brand-chip">Grupo Maratona SP</span><span class="link">Ver planilha${icon("chevron")}</span><span class="fake-input focus">Rodagem leve</span>`,
    accent: () => `<span class="badge badge-accent">${icon("trophy")}Recorde pessoal</span><span class="chip accent-chip">${icon("flame")}12 semanas seguidas</span><span class="accent-text">Novo recorde nos 10 km</span><span class="hl-sample">Meta da semana batida</span>`,
  };
  function modePanel(kind, seed, mode) {
    const e = T.env[mode];
    const r = C.roles(seed, mode, e);
    const origin =
      res.source === "default" ? "padrão do Runflow"
      : kind === "brand" ? "cor primária exata"
      : res.source === "derived" ? "derivada da primária"
      : "cor secundária exata";
    const fillNote = r.meta.solidAdjusted ? "clareada para o modo escuro" : origin;
    const rows = [
      ["solid", "Preenchimento", kind === "brand" ? "botões, estados ativos" : "selos de recorde, conquistas", r.solid, fillNote],
      ["onSolid", "Texto sobre o preenchimento", "", r.onSolid, ratio(r.onSolid, r.solid)],
      ["solidBorder", "Borda do preenchimento", "contra o fundo da página", r.solidBorder, ratio(r.solidBorder, e.canvas)],
      ["text", kind === "brand" ? "Texto da marca" : "Texto de destaque", kind === "brand" ? "links, destaques" : "títulos de conquistas", r.text, ratio(r.text, e.surface)],
      ["subtle", "Tom suave", kind === "brand" ? "linhas selecionadas, chips" : "chips de sequência", r.subtle, ""],
      ["subtleFg", "Texto sobre o tom suave", "", r.subtleFg, ratio(r.subtleFg, r.subtle)],
      ["border", "Borda com tom", "", r.border, ""],
      ["ring", "Anel de foco", "", r.ring, ratio(r.ring, e.surface)],
    ];
    return `<div class="mode-panel" data-theme="${mode}">
  <div class="mode-head"><span class="rf-text-title-sm">${mode === "light" ? "Claro" : "Escuro"}</span><span class="meta">fundo ${e.canvas} · superfície ${e.surface}</span></div>
  <div class="specimen">${SPECIMEN[kind]()}</div>
  <ul class="roles">${rows
    .map(([k, n, d, hex, note]) => `<li><span class="role-dot" style="background:${hex}"></span><span><span class="role-n">${n}<code>${k}</code></span>${d ? `<span class="role-d">${d}</span>` : ""}</span><span class="role-v"><code>${hex}</code>${note ? `<span class="role-c">${note}</span>` : ""}</span></li>`)
    .join("")}</ul>
</div>`;
  }

  const SOURCE_TEXT = {
    default: "O clube não definiu cores, então usa o padrão do Runflow: Azul Flow + Volt.",
    derived: "O clube definiu só a cor primária, então o motor derivou esta secundária a partir dela: mesmo matiz, luminosidade oposta. Primárias neutras (preto, branco, cinza) ganham o Volt.",
    club: "Escolhida pelo clube.",
  };
  function renderColors() {
    const ps = C.scale(res.primary);
    const ss = C.scale(res.secondary);
    $("#brand-name").textContent = res.source === "default" ? "Azul Flow (padrão do Runflow)" : club.name;
    $("#brand-seed").textContent = res.primary;
    $("#brand-scale").innerHTML = tiles(ps, ps.anchor, true);
    $("#brand-modes").innerHTML = modePanel("brand", res.primary, "light") + modePanel("brand", res.primary, "dark");
    $("#accent-name").textContent = res.source === "default" ? "Volt (padrão do Runflow)" : res.source === "derived" ? "derivada pelo motor" : club.name;
    $("#accent-seed").textContent = res.secondary;
    $("#accent-source").textContent = SOURCE_TEXT[res.source];
    $("#accent-scale").innerHTML = tiles(ss, ss.anchor, true);
    $("#accent-modes").innerHTML = modePanel("accent", res.secondary, "light") + modePanel("accent", res.secondary, "dark");
  }

  function renderStatic() {
    $("#runflow-mark").innerHTML = runflowMark(30);
    $("#upload-ic").innerHTML = icon("upload");
    $("#swap-ic").innerHTML = icon("swap");

    $("#accent-demo").innerHTML = `
      <div class="pr-card on-dark"><span class="pr-badge">PR</span><div><div class="rf-text-title-sm">Novo recorde nos 10 km</div><div class="meta">41:52 · 32 s mais rápido</div></div></div>
      <div class="pr-card on-light"><span class="pr-badge">12</span><div><div class="rf-text-title-sm">12 semanas seguidas</div><div class="meta">Sequência de treinos concluídos</div></div></div>`;

    $("#neutral-scale").innerHTML = tiles(T.palette.neutral);

    const tpl = $("#surfaces-tpl");
    $("#surfaces-modes").innerHTML = "";
    ["light", "dark"].forEach((m) => {
      const panel = document.createElement("div");
      panel.className = "mode-panel";
      panel.setAttribute("data-theme", m);
      panel.innerHTML = `<div class="mode-head"><span class="rf-text-title-sm">${m === "light" ? "Claro" : "Escuro"}</span></div>`;
      panel.appendChild(tpl.content.cloneNode(true));
      $("#surfaces-modes").appendChild(panel);
    });

    const STATUS = [["success", "Sucesso", "Concluído"], ["warning", "Atenção", "Parcial"], ["danger", "Erro", "Não realizado"], ["info", "Informação", "Novo feedback"]];
    $("#status-grid").innerHTML = STATUS.map(
      ([k, n, ex]) => `<div class="card status-card"><div class="status-sw" style="background:var(--rf-${k}-solid);color:var(--rf-${k}-on-solid)"><span>${n}</span><code>${T.seeds[k]}</code></div>
      <div class="status-body"><span class="badge badge-solid-${k}">${ex}</span><span class="badge badge-${k}">${ex}</span><span class="status-text" style="color:var(--rf-${k}-text)">${ex}: texto sobre a superfície</span></div></div>`,
    ).join("");
    $("#status-scales").innerHTML = STATUS.map(([k, n]) => `<h4>${n}</h4><div class="swatches">${tiles(T.palette[k], C.scale(T.seeds[k]).anchor, true)}</div>`).join("");

    const ZONES = [[1, "Recuperação", "50–60% FC máx"], [2, "Aeróbico leve", "60–70% FC máx"], [3, "Moderado", "70–80% FC máx"], [4, "Limiar", "80–90% FC máx"], [5, "VO2 máx", "90–100% FC máx"]];
    $("#zone-grid").innerHTML = ZONES.map(
      ([z, n, d]) => `<div class="zone-tile"><span class="zone-sw" style="background:var(--rf-zone-${z}-solid);color:var(--rf-zone-${z}-on-solid)">Z${z}</span><span class="zn">${n}</span><span class="zd">${d}</span><code>${T.palette.zone[z]}</code></div>`,
    ).join("");
    const P = [["Intervalado 6×1 km", "≈ 59 min · 10,4 km", INTERVAL], ["Longão progressivo", "1h25 · 16 km", LONG], ["Fartlek 40′", "40 min · 7,5 km", FARTLEK]];
    $("#profiles").innerHTML = P.map(([t, m, s]) => `<div class="card profile-card"><div class="row between"><span class="rf-text-title-sm">${t}</span><span class="meta">${m}</span></div>${profile(s)}</div>`).join("");

    $("#sport-grid").innerHTML = SPORTS.map(
      ([k, n]) => `<div class="card sport-tile"><span class="sport-ic" style="background:var(--rf-sport-${k}-solid);color:var(--rf-sport-${k}-on-solid)">${icon("sport_" + k)}</span><span class="sn">${n}</span><code>${T.palette.sport[k]}</code><span class="chip sport-${k}">${icon("sport_" + k)}${n}</span></div>`,
    ).join("");

    const SAMPLES = {
      displayLg: "Corra no seu ritmo.", displayMd: "Planilha da semana", displaySm: "Intervalado 6×1 km",
      titleLg: "Bom dia, Ana", titleMd: "Treino de hoje", titleSm: "Aquecimento",
      bodyLg: "Seu treinador ajustou o treino de amanhã para recuperação.", bodyMd: "Mantenha um ritmo confortável, em que dá para conversar.",
      bodySm: "Sincronizado do Strava há 5 min", labelMd: "Salvar treino", labelSm: "Enviar feedback",
      caption: "ter, 3 nov · 06:30", overline: "Hoje", metricXl: "4:32", metricLg: "10,2", metricMd: "152",
    };
    const UNITS = { metricXl: "/km", metricLg: "km", metricMd: "bpm" };
    $("#type-table").innerHTML = Object.entries(T.text)
      .map(([k, t]) => `<div class="type-row"><div class="type-name"><code>${k}</code><span>${t.family === "display" ? "Archivo" : "Inter"}</span></div><div class="rf-text-${C.kebab(k)} type-sample">${SAMPLES[k] || k}${UNITS[k] ? `<span class="unit">${UNITS[k]}</span>` : ""}</div><div class="type-spec">${t.size}/${t.lineHeight} · ${t.weight}${t.width ? ` · largura ${t.width}%` : ""}${t.numeric ? " · tabular" : ""}${t.transform ? " · maiúsculas" : ""}</div></div>`)
      .join("");

    $("#space-list").innerHTML = Object.entries(T.space)
      .sort((a, b) => a[1] - b[1])
      .map(([k, v]) => `<div class="space-row"><code>space.${k}</code><span class="space-bar" style="width:${(v / 80) * 100}%"></span><span>${v}px</span></div>`)
      .join("");
    $("#radius-list").innerHTML = Object.entries(T.radius)
      .sort((a, b) => a[1] - b[1])
      .map(([k, v]) => `<div class="radius-item"><span class="radius-box" style="border-radius:${Math.min(v, 28)}px"></span><span>${k} · ${v > 999 ? "total" : v}</span></div>`)
      .join("");
    $("#shadow-list").innerHTML = ["sm", "md", "lg"].map((k) => `<div class="shadow-item"><span class="shadow-box" style="box-shadow:var(--rf-shadow-${k})"></span><span>shadow.${k}</span></div>`).join("");
    $("#size-list").innerHTML = [["controlSm", "Pequeno"], ["controlMd", "Web padrão"], ["controlLg", "Mobile primário"]]
      .map(([k, l]) => `<div class="size-item"><span class="size-box" style="height:${T.size[k]}px">${l}</span><span>${k} · ${T.size[k]}px</span></div>`)
      .join("");

    const D = T.motion.duration;
    const E = T.motion.easing;
    const items = Object.keys(D).map((k) => [`duration.${k}`, `${D[k]} ms · curva standard`, `${D[k]}ms`, "var(--rf-easing-standard)"])
      .concat(Object.keys(E).map((k) => [`easing.${k}`, `${D.slow} ms · cubic-bezier(${E[k].join(", ")})`, `${D.slow}ms`, `var(--rf-easing-${k})`]));
    $("#motion-grid").innerHTML = items
      .map(([n, d, dur, ease]) => `<div class="card motion-item"><div class="row between"><code>${n}</code><span class="meta">${d}</span></div><button type="button" class="track" aria-label="Tocar ${n}"><span class="ball" style="transition-duration:${dur};transition-timing-function:${ease}"></span></button></div>`)
      .join("");
  }

  // ---------- club lab ----------
  function renderReport() {
    const L = C.roles(res.primary, "light", T.env.light);
    const Dk = C.roles(res.primary, "dark", T.env.dark);
    const SL = C.roles(res.secondary, "light", T.env.light);
    const wv = C.whiteTextVariant(res.primary, WHITE);
    const name = (hex) => (hex === WHITE ? "branco" : hex === "#000000" ? "preto" : "escuro");
    const item = (kind, title, detail) => `<li class="${kind}">${icon(kind === "ok" ? "check" : "info")}<div><b>${title}</b><span>${detail}</span></div></li>`;
    const lightOk = L.meta.solidVsCanvas >= 3;
    const neutralPrimary = C.toOklch(res.primary)[1] < 0.04;
    const head = {
      default: item("note", "Nenhuma cor: tema padrão do Runflow", "Azul Flow como primária e Volt como secundária."),
      derived: item("note", "Uma cor: secundária derivada", neutralPrimary ? `A primária é neutra, então a secundária é o Volt <code>${res.secondary}</code>.` : `<code>${res.secondary}</code>: mesmo matiz da primária, ${C.toOklch(res.primary)[0] > 0.72 ? "mais escura" : "mais clara"}.`),
      club: item("note", "Duas cores escolhidas pelo clube", `Primária <code>${res.primary}</code> · secundária <code>${res.secondary}</code>`),
    }[res.source];
    const swapHint =
      res.source === "club" && !lightOk && C.roles(res.secondary, "light", T.env.light).meta.solidVsCanvas >= 3
        ? item("warn", "A secundária funciona melhor para botões", "Experimente “Trocar primária e secundária”.")
        : "";
    $("#report").innerHTML =
      `<ul class="report">
        ${head}
        ${item("ok", `Primária: texto sobre ela fica ${name(L.onSolid)}`, `${ratio(L.onSolid, L.solid)} no modo claro${Dk.onSolid !== L.onSolid ? `, ${name(Dk.onSolid)} no escuro` : ""} (o AA exige 4,5:1)`)}
        ${item(lightOk ? "ok" : "warn", lightOk ? "Primária se destaca em fundos claros" : "Primária muito clara em fundos claros", lightOk ? ratio(L.solid, T.env.light.canvas) : `${ratio(L.solid, T.env.light.canvas)}; por isso os botões ganham uma borda mais escura <code>${L.solidBorder}</code>`)}
        ${item(L.meta.textAdjusted ? "warn" : "ok", L.meta.textAdjusted ? "Tom mais escuro para textos e links (claro)" : "A primária funciona como texto (claro)", `<code>${L.text}</code> · ${ratio(L.text, T.env.light.surface)}`)}
        ${item(Dk.meta.solidAdjusted ? "warn" : "ok", Dk.meta.solidAdjusted ? "Primária clareada para o modo escuro" : "Primária mantida no modo escuro", Dk.meta.solidAdjusted ? `escura demais sobre o fundo escuro; o preenchimento vira <code>${Dk.solid}</code>` : ratio(Dk.solid, T.env.dark.canvas))}
        ${item("ok", `Secundária: texto sobre ela fica ${name(SL.onSolid)}`, `${ratio(SL.onSolid, SL.solid)} · selos e conquistas`)}
        ${swapHint}
      </ul>` +
      (wv
        ? `<div class="wv"><span>Prefere texto branco nos botões? Este é o tom mais escuro e mais próximo da primária que passa no AA:</span><button type="button" class="btn btn-secondary" id="use-wv"><span class="preset-dot" style="background:${wv}"></span>Usar ${wv}</button></div>`
        : "");
    const b = $("#use-wv");
    if (b) b.addEventListener("click", () => setClub(custom({ primary: wv })));
  }

  function renderLab() {
    $("#presets").innerHTML = CLUBS.map(
      (c) => `<button type="button" class="preset${c.id === club.id ? " on" : ""}" data-id="${c.id}">${dots(c)}<span><span class="preset-name">${esc(c.name)}</span><span class="preset-count">${["sem cores", "1 cor", "2 cores"][colorCount(c)]}</span></span></button>`,
    ).join("");
    $("#primary-picker").value = res.primary.toLowerCase();
    $("#secondary-picker").value = res.secondary.toLowerCase();
    if (document.activeElement !== $("#primary-hex")) $("#primary-hex").value = club.primary || "";
    if (document.activeElement !== $("#secondary-hex")) $("#secondary-hex").value = club.secondary || "";
    const noPrimary = !club.primary;
    ["#secondary-picker", "#secondary-hex", "#secondary-clear"].forEach((s) => ($(s).disabled = noPrimary));
    $("#primary-clear").disabled = noPrimary;
    $("#secondary-clear").disabled = !club.secondary;
    $("#swap").disabled = !(club.primary && club.secondary);
    $("#colors-mode").textContent = [
      "Sem cores: o clube usa o padrão do Runflow. Defina uma primária para começar.",
      "Uma cor: a secundária é derivada automaticamente. Defina uma secundária para escolher você.",
      "Duas cores: primária para ações, secundária para destaques.",
    ][colorCount(club)];
    $("#suggestions").innerHTML = suggestions.length
      ? `<span class="meta">Do seu logo (clique para usar como primária):</span>` + suggestions.map((h) => `<button type="button" class="sugg" data-seed="${h}"><span style="background:${h}"></span>${h}</button>`).join("")
      : "";
    $("#lab-previews").innerHTML = phone("light") + phone("dark");
    renderReport();
  }

  /** A custom club keeping the current custom name/logo, with the given color changes applied. */
  function custom(change) {
    const keep = club.id === "custom";
    const next = {
      id: "custom",
      name: keep ? club.name : "Seu clube",
      short: keep ? club.short : "SC",
      logo: keep ? club.logo : undefined,
      primary: club.primary || null,
      secondary: club.secondary || null,
    };
    Object.assign(next, change);
    if (!next.primary && next.secondary) { next.primary = next.secondary; next.secondary = null; }
    return next;
  }

  function setClub(c) {
    club = Object.assign({}, c);
    res = C.resolveClubColors(club, DEFAULTS);
    $("#club-theme").textContent = C.clubThemeCss(club, T.env, DEFAULTS);
    const sel = $("#club-select");
    let opt = sel.querySelector('option[value="custom"]');
    if (club.id === "custom") {
      if (!opt) {
        opt = document.createElement("option");
        opt.value = "custom";
        sel.appendChild(opt);
      }
      opt.textContent = `${club.name} · ${[club.primary, club.secondary].filter(Boolean).join(" + ") || "sem cores"}`;
    }
    sel.value = club.id;
    $("#club-dot").innerHTML = dots(club);
    renderColors();
    $("#ctx-phone").innerHTML = phone();
    $("#ctx-desk").innerHTML = desktop();
    renderLab();
    store.set("rf.club", JSON.stringify({ id: club.id, name: club.name, short: club.short, primary: club.primary, secondary: club.secondary }));
  }

  function setMode(m) {
    if (m === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", m);
    $$("#mode button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    store.set("rf.mode", m);
  }

  function readLogo(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const s = 96;
        const cv = document.createElement("canvas");
        cv.width = s;
        cv.height = s;
        const ctx = cv.getContext("2d");
        const w0 = img.width || s, h0 = img.height || s;
        const r = Math.min(s / w0, s / h0);
        ctx.drawImage(img, (s - w0 * r) / 2, (s - h0 * r) / 2, w0 * r, h0 * r);
        try {
          suggestions = C.suggestFromPixels(ctx.getImageData(0, 0, s, s).data, 3);
        } catch (e) {
          suggestions = [];
        }
        setClub({ id: "custom", name: "Seu clube", short: "SC", logo: reader.result, primary: suggestions[0] || null, secondary: suggestions[1] || null });
        if (!suggestions.length) $("#suggestions").innerHTML = '<span class="meta">Não encontramos cores neste logo. Escolha as cores acima.</span>';
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // ---------- wiring ----------
  function init() {
    $("#club-select").innerHTML = CLUBS.map((c) => `<option value="${c.id}">${esc(c.label || c.name)}</option>`).join("");
    renderStatic();

    const params = new URLSearchParams(location.search);
    const mode = params.get("mode") || store.get("rf.mode") || "system";
    setMode(["light", "dark", "system"].includes(mode) ? mode : "system");

    let initial = CLUBS[0];
    let saved = null;
    try { saved = JSON.parse(store.get("rf.club") || "null"); } catch (e) { saved = null; }
    const qp = params.get("primary"), qs = params.get("secondary"), qc = params.get("club");
    if (qp && HEX.test(qp)) initial = { id: "custom", name: "Seu clube", short: "SC", primary: normHex(qp), secondary: qs && HEX.test(qs) ? normHex(qs) : null };
    else if (qc) initial = CLUBS.find((c) => c.id === qc) || initial;
    else if (saved && saved.id === "custom") initial = { id: "custom", name: saved.name || "Seu clube", short: saved.short || "SC", primary: saved.primary || null, secondary: saved.secondary || null };
    else if (saved) initial = CLUBS.find((c) => c.id === saved.id) || initial;
    setClub(initial);

    $("#mode").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-mode]");
      if (b) setMode(b.dataset.mode);
    });
    $("#club-select").addEventListener("change", (e) => {
      const c = CLUBS.find((x) => x.id === e.target.value);
      if (c) setClub(c);
    });
    $("#presets").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-id]");
      const c = b && CLUBS.find((x) => x.id === b.dataset.id);
      if (c) setClub(c);
    });
    $("#suggestions").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-seed]");
      if (!b) return;
      const seed = b.dataset.seed;
      setClub(custom(club.secondary === seed ? { primary: seed, secondary: club.primary } : { primary: seed }));
    });
    let raf = 0;
    const live = (fn) => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fn); };
    $("#primary-picker").addEventListener("input", (e) => { const v = normHex(e.target.value); live(() => setClub(custom({ primary: v }))); });
    $("#secondary-picker").addEventListener("input", (e) => { const v = normHex(e.target.value); live(() => setClub(custom({ secondary: v }))); });
    $("#primary-hex").addEventListener("input", (e) => { if (HEX.test(e.target.value.trim())) setClub(custom({ primary: normHex(e.target.value) })); });
    $("#secondary-hex").addEventListener("input", (e) => { if (HEX.test(e.target.value.trim())) setClub(custom({ secondary: normHex(e.target.value) })); });
    $("#primary-clear").addEventListener("click", () => setClub(custom({ primary: club.secondary || null, secondary: null })));
    $("#secondary-clear").addEventListener("click", () => setClub(custom({ secondary: null })));
    $("#swap").addEventListener("click", () => setClub(custom({ primary: club.secondary, secondary: club.primary })));
    $("#logo-file").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) readLogo(f);
    });
    $("#motion-grid").addEventListener("click", (e) => {
      const t = e.target.closest(".track");
      if (t) t.classList.toggle("go");
    });

    if ("IntersectionObserver" in window) {
      const links = new Map($$(".toc a").map((a) => [a.getAttribute("href").slice(1), a]));
      const io = new IntersectionObserver(
        (entries) => entries.forEach((en) => {
          if (!en.isIntersecting) return;
          links.forEach((a) => a.classList.remove("on"));
          const a = links.get(en.target.id);
          if (a) a.classList.add("on");
        }),
        { rootMargin: "-30% 0px -65% 0px" },
      );
      $$("main section[id]").forEach((s) => io.observe(s));
    }
  }

  init();
})();
