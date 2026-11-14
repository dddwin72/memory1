// 구글 검색 결과 페이지: 결과를 모아 NotebookLM으로 보내는 패널
(() => {
  if (window.__dragLearnGoogle) return;
  window.__dragLearnGoogle = true;

  const query = new URLSearchParams(location.search).get("q") || "";
  const auto = location.hash.includes("dl-nlm");

  function collectResults() {
    const seen = new Set();
    const out = [];
    document.querySelectorAll("#search a h3, #rso a h3").forEach((h3) => {
      const a = h3.closest("a");
      if (!a || !a.href) return;
      let url;
      try { url = new URL(a.href); } catch { return; }
      if (/(^|\.)google\./.test(url.hostname) && !url.pathname.startsWith("/url")) return;
      if (url.pathname === "/url") url = new URL(url.searchParams.get("q") || url.searchParams.get("url") || a.href);
      const href = url.href;
      if (seen.has(href)) return;
      seen.add(href);
      const box = a.closest("[data-hveid], .g, .MjjYud") || a.parentElement;
      let snippet = "";
      if (box) {
        snippet = box.innerText.replace(h3.innerText, "").replace(/\s+/g, " ").trim();
        snippet = snippet.replace(href, "").slice(0, 400);
      }
      out.push({ title: h3.innerText.trim(), url: href, snippet });
    });
    return out;
  }

  function collectAnswerBox() {
    const parts = [];
    // 사전 상자(단어 뜻, 발음, 예문)
    document.querySelectorAll('[data-dobid="hdw"], [data-dobid="dfn"], .lr_dct_ent, [jsname="r5Nvmf"]').forEach((el) => {
      const t = el.innerText.trim();
      if (t && !parts.includes(t)) parts.push(t);
    });
    // 추천 스니펫 / 번역 상자
    document.querySelectorAll(".hgKElc, .IZ6rdc, #tw-target-text, [data-attrid='wa:/description']").forEach((el) => {
      const t = el.innerText.trim();
      if (t && !parts.includes(t)) parts.push(t);
    });
    return parts.join("\n").slice(0, 4000);
  }

  function buildText(results, answer) {
    const lines = [`[학습 검색어] ${query}`, `[검색 시각] ${new Date().toLocaleString("ko-KR")}`, `[구글 검색] ${location.href.split("#")[0]}`, ""];
    if (answer) lines.push("[구글 요약/사전]", answer, "");
    lines.push("[검색 결과]");
    results.forEach((r, i) => lines.push(`${i + 1}. ${r.title}`, `   ${r.url}`, r.snippet ? `   ${r.snippet}` : "", ""));
    return lines.join("\n");
  }

  const panel = document.createElement("div");
  panel.className = "dl-panel";
  panel.innerHTML = `
    <button class="dl-fab" title="검색 결과를 NotebookLM으로 보내기">📒 NotebookLM으로 보내기</button>
    <div class="dl-body" hidden>
      <div class="dl-head"><b>NotebookLM으로 보내기</b><button class="dl-close" title="닫기">✕</button></div>
      <div class="dl-q"></div>
      <label class="dl-row">보낼 방식
        <select class="dl-mode">
          <option value="both">요약 글 + 웹사이트 링크</option>
          <option value="text">요약 글만 (검색어·사전·결과 정리)</option>
          <option value="urls">웹사이트 링크만</option>
        </select>
      </label>
      <div class="dl-list"></div>
      <button class="dl-send">📒 선택한 내용 보내기</button>
      <div class="dl-hint">NotebookLM 탭이 열리고 소스 추가가 자동으로 진행됩니다.</div>
    </div>`;
  document.body.appendChild(panel);

  const body = panel.querySelector(".dl-body");
  const list = panel.querySelector(".dl-list");
  const mode = panel.querySelector(".dl-mode");
  panel.querySelector(".dl-q").textContent = `검색어: ${query}`;

  let settings = { resultCount: 5, sendMode: "both" };

  function render() {
    const results = collectResults();
    list.innerHTML = "";
    if (!results.length) list.textContent = "검색 결과를 찾지 못했습니다. (요약 글은 보낼 수 있어요)";
    results.slice(0, 15).forEach((r, i) => {
      const row = document.createElement("label");
      row.className = "dl-item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = i < settings.resultCount;
      cb.dataset.idx = i;
      const span = document.createElement("span");
      span.innerHTML = `<b></b><small></small>`;
      span.querySelector("b").textContent = r.title;
      span.querySelector("small").textContent = new URL(r.url).hostname;
      row.append(cb, span);
      list.appendChild(row);
    });
    return results;
  }

  let results = [];
  function open() { results = render(); body.hidden = false; }

  panel.querySelector(".dl-fab").onclick = () => (body.hidden ? open() : (body.hidden = true));
  panel.querySelector(".dl-close").onclick = () => (body.hidden = true);
  panel.querySelector(".dl-send").onclick = () => {
    const picked = [...list.querySelectorAll("input:checked")].map((cb) => results[+cb.dataset.idx]).filter(Boolean);
    const m = mode.value;
    const payload = {
      query,
      text: m === "urls" ? "" : buildText(picked.length ? picked : results.slice(0, settings.resultCount), collectAnswerBox()),
      urls: m === "text" ? [] : picked.map((r) => r.url)
    };
    chrome.runtime.sendMessage({ type: "toNotebook", payload });
    body.hidden = true;
  };

  chrome.runtime.sendMessage({ type: "getSettings" }, (s) => {
    if (s) settings = s;
    mode.value = settings.sendMode || "both";
    if (auto) {
      // 결과가 다 그려질 때까지 잠깐 기다린 뒤 패널 열기
      setTimeout(open, 800);
      history.replaceState(null, "", location.href.split("#")[0]);
    }
  });
})();
