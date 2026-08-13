import "./styles.css";
import "./search.css";
import { getCurrentWindow } from "@tauri-apps/api/window";

type View = "collector" | "search" | "dash" | "analysis";
const app = document.querySelector<HTMLDivElement>("#app")!;
let view: View = "collector";

function setupWindowChrome() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const appWindow = getCurrentWindow();
  const titlebar = document.querySelector<HTMLElement>("#window-titlebar");
  const minimize = document.querySelector<HTMLButtonElement>("#window-minimize");
  const maximize = document.querySelector<HTMLButtonElement>("#window-maximize");
  const maximizeIcon = document.querySelector<HTMLElement>("#window-maximize-icon");
  const close = document.querySelector<HTMLButtonElement>("#window-close");
  if (!titlebar || !minimize || !maximize || !maximizeIcon || !close) return;
  const updateMaximizeState = async () => {
    const isMaximized = await appWindow.isMaximized();
    maximizeIcon.classList.toggle("is-restore", isMaximized);
    maximize.ariaLabel = isMaximized ? "복원" : "최대화";
  };
  minimize.addEventListener("click", () => void appWindow.minimize());
  maximize.addEventListener("click", () => void appWindow.toggleMaximize().then(updateMaximizeState));
  close.addEventListener("click", () => void appWindow.close());
  titlebar.addEventListener("dblclick", (event) => {
    if ((event.target as HTMLElement).closest(".window-controls")) return;
    void appWindow.toggleMaximize().then(updateMaximizeState);
  });
  void updateMaximizeState();
  void appWindow.onResized(() => void updateMaximizeState());
}

const collector = () => `
  <section class="page">
    <header><p class="eyebrow">KONEPS / 나라장터 API COLLECTOR</p><h2>Collector</h2><p>나라장터 OpenAPI 기반 수집기가 연결될 독립 영역입니다.</p></header>
    <div class="status-grid">
      <article><span>Collector 상태</span><strong>NOT IMPLEMENTED</strong><small>Market Collector 준비 중</small></article>
      <article><span>데이터 소스</span><strong>KONEPS</strong><small>나라장터 OpenAPI</small></article>
      <article><span>수집 방식</span><strong>HTTP REST API</strong><small>JSON/XML 응답</small></article>
      <article><span>저장소</span><strong>미정</strong><small>Market DB 설계 예정</small></article>
    </div>
    <div class="workspace"><div class="actions"><button class="primary" disabled>수집 시작</button><button disabled>중단</button></div></div>
    <div class="log"><div class="log-head"><h3>작업 로그</h3><span>최근 이벤트</span></div><div class="empty">Collector not implemented</div></div>
  </section>`;

const placeholder = (name: string, description: string) => `
  <section class="page centered"><p class="eyebrow">MONA RADAR / MARKET</p><h2>${name}</h2><div class="orb"></div><h3>Ready for Market data</h3><p>${description}</p></section>`;

function render() {
  const content = view === "collector" ? collector()
    : view === "search" ? placeholder("Search", "향후 Market DB 검색 기능이 연결됩니다.")
    : view === "dash" ? placeholder("Dash", "공공조달 시장 현황 대시보드가 연결됩니다.")
    : placeholder("Analysis", "공공조달 시장 분석 기능이 연결됩니다.");
  app.innerHTML = `<aside><div class="brand"><span>MR</span><div><b>MONA RADAR</b><small>Market</small></div></div><nav>${(["collector", "search", "dash", "analysis"] as View[]).map((item) => `<button data-view="${item}" class="${item === view ? "active" : ""}">${item[0]!.toUpperCase() + item.slice(1)}</button>`).join("")}</nav><footer>LOCAL-FIRST<br><span>KONEPS market intelligence</span></footer></aside><main>${content}</main>`;
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => button.addEventListener("click", () => { view = button.dataset.view as View; render(); }));
  setupWindowChrome();
}
render();
