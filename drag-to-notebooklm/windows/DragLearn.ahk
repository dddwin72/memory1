; 드래그 → 구글 → NotebookLM  (Windows 프로그램용, AutoHotkey v2)
; 브라우저 밖의 프로그램(PDF 뷰어, 메모장, 워드, 설치 화면 등)에서 글을 드래그하면
; 마우스 옆에 [검색] [번역] [NotebookLM] 버튼이 잠깐 나타납니다.
#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent
CoordMode "Mouse", "Screen"

; ---------------- 설정 ----------------
global TranslateTo   := "ko"      ; 번역할 언어
global SearchSuffix  := ""        ; 검색어 뒤에 붙일 말 (예: " 뜻")
global BarSeconds    := 4         ; 버튼이 떠 있는 시간(초)
global DragEnabled   := true
; 확장 프로그램이 직접 처리하는 브라우저에서는 버튼을 띄우지 않음
global SkipApps := ["chrome.exe", "msedge.exe", "whale.exe", "brave.exe"]

; ---------------- 트레이 메뉴 ----------------
A_IconTip := "드래그 학습 도우미 (구글/NotebookLM)"
tray := A_TrayMenu
tray.Delete()
tray.Add("드래그 버튼 켜기/끄기", ToggleDrag)
tray.Check("드래그 버튼 켜기/끄기")
tray.Add("화면 캡처 → 구글 렌즈  (Ctrl+Alt+L)", (*) => CaptureToLens())
tray.Add()
tray.Add("종료", (*) => ExitApp())

ToggleDrag(*) {
    global DragEnabled := !DragEnabled
    A_TrayMenu.ToggleCheck("드래그 버튼 켜기/끄기")
}

; ---------------- 버튼 막대 ----------------
; WS_EX_NOACTIVATE(0x08000000): 눌러도 원래 프로그램의 선택이 풀리지 않음
global bar := Gui("+AlwaysOnTop -Caption +ToolWindow +E0x08000000")
bar.BackColor := "202124"
bar.MarginX := 4, bar.MarginY := 4
bar.SetFont("s10 cWhite", "Malgun Gothic")
AddBtn("검색", "search", 56)
AddBtn("번역", "translate", 56)
AddBtn("NotebookLM", "nlm", 96)

AddBtn(label, kind, w) {
    static nextX := 4
    c := bar.AddText("x" nextX " y4 w" w " h28 Center +0x200 Background3C4043", label)
    nextX += w + 2
    c.OnEvent("Click", (*) => Act(kind))
}

global downX := 0, downY := 0

~LButton:: {
    global downX, downY
    MouseGetPos &downX, &downY, &win
    if (win != bar.Hwnd)
        HideBar()
}

~LButton Up:: {
    if !DragEnabled
        return
    MouseGetPos &x, &y, &win
    if (win = bar.Hwnd)
        return
    dragged := Abs(x - downX) > 12 || Abs(y - downY) > 12
    dbl := (A_PriorHotkey = "~LButton Up" && A_TimeSincePriorHotkey < 450)   ; 더블클릭 = 단어 선택
    if !(dragged || dbl)
        return
    try exe := WinGetProcessName("A")
    catch
        return
    for app in SkipApps
        if (exe = app)
            return
    ShowBar(x, y)
}

ShowBar(x, y) {
    bar.Show("NoActivate AutoSize x" (x + 10) " y" (y + 16))
    SetTimer HideBar, -BarSeconds * 1000
}
HideBar() {
    SetTimer HideBar, 0
    bar.Hide()
}

; ---------------- 단축키 (어디서나) ----------------
^!g:: Act("search")
^!t:: Act("translate")
^!n:: Act("nlm")
^!l:: CaptureToLens()

; ---------------- 동작 ----------------
Act(kind) {
    HideBar()
    text := GetSelection()
    if (text = "") {
        Tip("선택된 글이 없습니다")
        return
    }
    q := UriEncode(text . (kind = "translate" ? "" : SearchSuffix))
    if (kind = "search")
        Run "https://www.google.com/search?hl=ko&q=" q
    else if (kind = "translate")
        Run "https://translate.google.com/?sl=auto&tl=" TranslateTo "&op=translate&text=" q
    else if (kind = "nlm")   ; 브라우저 확장 프로그램이 #dl-nlm 을 보고 NotebookLM 보내기 패널을 엽니다
        Run "https://www.google.com/search?hl=ko&q=" q "#dl-nlm"
}

GetSelection() {
    saved := ClipboardAll()
    A_Clipboard := ""
    Send "^c"
    ok := ClipWait(0.7)
    text := ok ? Trim(A_Clipboard, " `t`r`n") : ""
    A_Clipboard := saved
    text := RegExReplace(text, "\s+", " ")
    return SubStr(text, 1, 1500)
}

; 화면의 이미지/글자를 캡처해서 구글 렌즈로 (이미지 속 영어 번역)
CaptureToLens() {
    HideBar()
    A_Clipboard := ""
    Run "ms-screenclip:"
    Tip("검색할 영역을 드래그하세요", 3000)
    Loop 120 {                                   ; 최대 30초 대기
        Sleep 250
        if DllCall("IsClipboardFormatAvailable", "UInt", 2) {   ; CF_BITMAP
            Run "https://www.google.com/?olud"
            Tip("구글 이미지 검색 창에서 Ctrl+V 를 누르세요", 6000)
            return
        }
    }
}

Tip(msg, ms := 1500) {
    ToolTip msg
    SetTimer () => ToolTip(), -ms
}

UriEncode(str) {
    buf := Buffer(StrPut(str, "UTF-8"))
    StrPut(str, buf, "UTF-8")
    out := ""
    Loop buf.Size - 1 {
        c := NumGet(buf, A_Index - 1, "UChar")
        if (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || c = 0x2D || c = 0x2E || c = 0x5F || c = 0x7E
            out .= Chr(c)
        else
            out .= Format("%{:02X}", c)
    }
    return out
}
