// 드래그 → 구글 → NotebookLM : 백그라운드 서비스 워커
const DEFAULTS = {
  showBubble: true,          // 드래그 시 말풍선 버튼 표시
  searchSuffix: "",          // 검색어 뒤에 붙일 말 (예: " 뜻", " meaning")
  translateTo: "ko",         // 번역 대상 언어
  resultCount: 5,            // NotebookLM으로 보낼 검색 결과 수
  notebookUrl: "https://notebooklm.google.com/", // 특정 노트북 주소를 넣으면 그 노트북으로 바로 이동
  sendMode: "both",          // both | text | urls
  autoInsert: true           // NotebookLM 화면에서 자동으로 소스 추가 시도
};

async function getSettings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

function clean(text) {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, 1500);
}

async function openSearch(text, { toNotebook = false, tab } = {}) {
  text = clean(text);
  if (!text) return;
  const s = await getSettings();
  const q = encodeURIComponent(text + (s.searchSuffix || ""));
  const url = `https://www.google.com/search?q=${q}&hl=ko${toNotebook ? "#dl-nlm" : ""}`;
  await chrome.tabs.create({ url, index: tab ? tab.index + 1 : undefined });
}

async function openTranslate(text, tab) {
  text = clean(text);
  if (!text) return;
  const s = await getSettings();
  const url = `https://translate.google.com/?sl=auto&tl=${encodeURIComponent(s.translateTo)}&text=${encodeURIComponent(text)}&op=translate`;
  await chrome.tabs.create({ url, index: tab ? tab.index + 1 : undefined });
}

async function openLens(imageUrl, tab) {
  if (!imageUrl) return;
  const url = imageUrl.startsWith("http")
    ? `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`
    : "https://lens.google.com/"; // data:/blob: 이미지는 렌즈 페이지에서 붙여넣기(Ctrl+V)
  await chrome.tabs.create({ url, index: tab ? tab.index + 1 : undefined });
}

// payload: { query, text, urls: [] }
async function sendToNotebook(payload, tab) {
  const s = await getSettings();
  await chrome.storage.local.set({ pendingNotebook: { ...payload, createdAt: Date.now() } });
  await chrome.tabs.create({ url: s.notebookUrl || DEFAULTS.notebookUrl, index: tab ? tab.index + 1 : undefined });
}

// ---------- 우클릭 메뉴 ----------
function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "dl-search", title: "🔍 구글에서 검색: \"%s\"", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "dl-translate", title: "🌐 구글 번역", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "dl-nlm", title: "📒 구글 검색 → NotebookLM으로 보내기", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "dl-nlm-text", title: "📝 선택한 글만 NotebookLM으로 보내기", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "dl-lens", title: "🖼️ 구글 렌즈로 이미지 검색/번역", contexts: ["image"] });
    chrome.contextMenus.create({ id: "dl-page-nlm", title: "📒 이 페이지를 NotebookLM으로 보내기", contexts: ["page"] });
  });
}
// 설치/업데이트 직후: 이미 열려 있던 탭에도 바로 적용 (새로고침 없이 드래그 버튼이 뜨도록)
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*", "file:///*"] });
  for (const tab of tabs) {
    if (/^https:\/\/notebooklm\.google\.com\//.test(tab.url || "")) continue;
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["content.js"] });
    } catch (e) { /* 웹 스토어 등 주입이 금지된 페이지 */ }
  }
}
chrome.runtime.onInstalled.addListener(() => { buildMenus(); injectIntoOpenTabs(); });
chrome.runtime.onStartup.addListener(buildMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  switch (info.menuItemId) {
    case "dl-search": return openSearch(info.selectionText, { tab });
    case "dl-translate": return openTranslate(info.selectionText, tab);
    case "dl-nlm": return openSearch(info.selectionText, { toNotebook: true, tab });
    case "dl-nlm-text":
      return sendToNotebook({ query: clean(info.selectionText), text: buildSelectionText(info.selectionText, tab), urls: [] }, tab);
    case "dl-lens": return openLens(info.srcUrl, tab);
    case "dl-page-nlm":
      return sendToNotebook({ query: tab.title, text: "", urls: [tab.url] }, tab);
  }
});

function buildSelectionText(sel, tab) {
  return `[선택한 문장]\n${(sel || "").trim()}\n\n[출처] ${tab?.title || ""}\n${tab?.url || ""}\n[저장 시각] ${new Date().toLocaleString("ko-KR")}`;
}

// ---------- 단축키 ----------
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  let text = "";
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "getSelection" });
    text = res?.text || "";
  } catch (e) { /* 콘텐츠 스크립트가 없는 페이지(chrome:// 등) */ }
  if (!text) return;
  if (command === "search-selection") openSearch(text, { tab });
  if (command === "send-selection-notebooklm") openSearch(text, { toNotebook: true, tab });
});

// ---------- 콘텐츠 스크립트 메시지 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tab = sender.tab;
  (async () => {
    switch (msg.type) {
      case "search": await openSearch(msg.text, { tab }); break;
      case "searchToNotebook": await openSearch(msg.text, { toNotebook: true, tab }); break;
      case "translate": await openTranslate(msg.text, tab); break;
      case "lens": await openLens(msg.url, tab); break;
      case "toNotebook": await sendToNotebook(msg.payload, tab); break;
      case "getSettings": sendResponse(await getSettings()); return;
      case "takePending": {
        const { pendingNotebook } = await chrome.storage.local.get("pendingNotebook");
        // 10분 이상 지난 요청은 버림
        if (pendingNotebook && Date.now() - pendingNotebook.createdAt < 10 * 60 * 1000) {
          sendResponse(pendingNotebook);
        } else sendResponse(null);
        return;
      }
      case "clearPending": await chrome.storage.local.remove("pendingNotebook"); break;
    }
    sendResponse({ ok: true });
  })();
  return true;
});
