// NotebookLM 화면: 대기 중인 검색 결과를 소스로 자동 추가 (실패하면 복사 버튼 제공)
(() => {
  if (window.__dragLearnNlm) return;
  window.__dragLearnNlm = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

  function findClickable(re, scope = document) {
    const cands = scope.querySelectorAll('button, [role="button"], [role="tab"], mat-chip, mat-chip-option, .mdc-evolution-chip, a');
    for (const el of cands) {
      const label = `${el.innerText || ""} ${el.getAttribute("aria-label") || ""}`.trim();
      if (re.test(label) && visible(el) && !el.disabled) return el;
    }
    return null;
  }
  async function waitFor(fn, timeout = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(250);
    }
    return null;
  }
  function dialog() {
    const ds = [...document.querySelectorAll('mat-dialog-container, [role="dialog"], .cdk-overlay-pane')].filter(visible);
    return ds[ds.length - 1] || null;
  }
  function setValue(el, value) {
    el.focus();
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const RE = {
    addSource: /소스 추가|소스 업로드|Add source|Upload a source|Add sources/i,
    text: /복사된 텍스트|텍스트 붙여넣기|Copied text|Paste text/i,
    web: /웹사이트|Website|링크|Link/i,
    insert: /^\s*(삽입|추가|Insert|Add)\s*$/i
  };

  async function openAddDialog() {
    let d = dialog();
    if (d && (findClickable(RE.text, d) || findClickable(RE.web, d))) return d;
    const btn = await waitFor(() => findClickable(RE.addSource), 10000);
    if (!btn) throw new Error("'소스 추가' 버튼을 찾지 못했습니다");
    btn.click();
    d = await waitFor(() => { const x = dialog(); return x && (findClickable(RE.text, x) || findClickable(RE.web, x)) ? x : null; });
    if (!d) throw new Error("소스 추가 창이 열리지 않았습니다");
    return d;
  }

  async function addSource(kindRe, value) {
    const d = await openAddDialog();
    findClickable(kindRe, d).click();
    const field = await waitFor(() => {
      const x = dialog() || document;
      return [...x.querySelectorAll("textarea, input[type=text], input[type=url], input:not([type])")].find(visible);
    });
    if (!field) throw new Error("입력칸을 찾지 못했습니다");
    setValue(field, value);
    await sleep(400);
    const ins = await waitFor(() => findClickable(RE.insert, dialog() || document));
    if (!ins) throw new Error("'삽입' 버튼을 찾지 못했습니다");
    ins.click();
    await waitFor(() => !document.contains(field), 15000);
    await sleep(1200);
  }

  // ---------- 도우미 패널 ----------
  const panel = document.createElement("div");
  panel.className = "dl-panel dl-nlm";
  panel.innerHTML = `
    <div class="dl-body">
      <div class="dl-head"><b>📒 검색 결과 → NotebookLM</b><button class="dl-close" title="닫기">✕</button></div>
      <div class="dl-q"></div>
      <div class="dl-status"></div>
      <button class="dl-send dl-run">자동으로 소스 추가</button>
      <div class="dl-copy">
        <button class="dl-btn" data-c="text">📝 요약 글 복사</button>
        <button class="dl-btn" data-c="urls">🔗 링크 복사</button>
      </div>
      <div class="dl-hint">자동 추가가 안 되면: 복사 → <b>소스 추가</b> → <b>복사된 텍스트</b>(또는 <b>웹사이트</b>)에 붙여넣기(Ctrl+V)</div>
    </div>`;
  const status = (t) => (panel.querySelector(".dl-status").textContent = t);

  async function run(p, s) {
    if (!/\/notebook\//.test(location.pathname)) {
      status("노트북을 열거나 '새로 만들기'를 누르세요. 노트북이 열리면 자동으로 추가합니다.");
      return false;
    }
    try {
      if (p.text && s.sendMode !== "urls") { status("요약 글을 소스로 추가하는 중…"); await addSource(RE.text, p.text); }
      if (p.urls?.length && s.sendMode !== "text") {
        status(`웹사이트 ${p.urls.length}개를 소스로 추가하는 중…`);
        await addSource(RE.web, p.urls.join("\n"));
      }
      status("✅ 추가 완료! 이제 NotebookLM에서 질문하거나 학습 가이드를 만들어 보세요.");
      chrome.runtime.sendMessage({ type: "clearPending" });
      return true;
    } catch (e) {
      status(`⚠️ 자동 추가 실패: ${e.message}. 아래 복사 버튼을 이용하세요.`);
      return true;
    }
  }

  chrome.runtime.sendMessage({ type: "takePending" }, async (p) => {
    if (!p) return;
    const s = await new Promise((r) => chrome.runtime.sendMessage({ type: "getSettings" }, r));
    document.body.appendChild(panel);
    panel.querySelector(".dl-q").textContent = `검색어: ${p.query || "(선택한 글)"}  ·  링크 ${p.urls?.length || 0}개`;
    panel.querySelector(".dl-close").onclick = () => { panel.remove(); chrome.runtime.sendMessage({ type: "clearPending" }); };
    panel.querySelectorAll("[data-c]").forEach((b) => (b.onclick = async () => {
      await navigator.clipboard.writeText(b.dataset.c === "text" ? p.text || "" : (p.urls || []).join("\n"));
      b.textContent = "✔ 복사됨";
    }));
    panel.querySelector('[data-c="text"]').hidden = !p.text;
    panel.querySelector('[data-c="urls"]').hidden = !p.urls?.length;
    const runBtn = panel.querySelector(".dl-run");
    let busy = false;
    const go = async () => { if (busy) return; busy = true; runBtn.disabled = true; const done = await run(p, s); busy = false; runBtn.disabled = false; return done; };
    runBtn.onclick = go;
    if (s.autoInsert) {
      await sleep(1500);
      if (!(await go())) {
        // SPA 주소 변화를 감시: 노트북이 열리면 자동 실행
        let last = location.pathname;
        const timer = setInterval(async () => {
          if (location.pathname !== last) {
            last = location.pathname;
            if (/\/notebook\//.test(last)) { clearInterval(timer); await sleep(2000); go(); }
          }
        }, 700);
      }
    } else status("‘자동으로 소스 추가’를 누르거나 복사 버튼을 이용하세요.");
  });
})();
