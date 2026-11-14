import { useEffect } from "react";
import {
  DockviewApi,
  DockviewDefaultTab,
  DockviewReact,
  DockviewTheme,
  GetTabContextMenuItemsParams,
  IDockviewPanelHeaderProps,
  IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { useStore } from "../store";
import { Inspector } from "./Inspector";
import { SettingsPanel } from "./SettingsPanel";
import { AvatarSection, LayersSection, RangesSection, Section, StatesSection } from "./Sidebar";
import { Stage } from "./Stage";

const LAYOUT_KEY = "pngtubah.layout";

const theme: DockviewTheme = { name: "chalk", className: "dockview-theme-chalk", colorScheme: "dark" };

let api: DockviewApi | null = null;

function EditorTop() {
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const { set, undo, redo } = useStore.getState();
  return (
    <div className="editor-top">
      <button onClick={() => set({ screen: "live", previewRange: false })}>✓ Xong</button>
      <button onClick={() => set({ screen: "home", previewRange: false })}>← Thư viện</button>
      <button disabled={!canUndo} onClick={undo} title="Hoàn tác (Ctrl+Z)">↶</button>
      <button disabled={!canRedo} onClick={redo} title="Làm lại (Ctrl+Y / Ctrl+Shift+Z)">↷</button>
      <button onClick={resetLayout} title="Đưa các bảng về vị trí ban đầu">⊞ Bố cục mặc định</button>
    </div>
  );
}

const scroll = (node: React.ReactNode) => <div className="dock-panel">{node}</div>;

const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  stage: () => (
    <div className="dock-stage">
      <EditorTop />
      <Stage editable hint='Chọn layer rồi bấm "Chọn hình" để bắt đầu' />
    </div>
  ),
  inspector: () => scroll(<Inspector />),
  avatar: () => scroll(<AvatarSection />),
  states: () => scroll(<StatesSection />),
  ranges: () => scroll(<RangesSection />),
  layers: () => scroll(<LayersSection />),
  settings: () => scroll(<Section><SettingsPanel /></Section>),
};

/** Panels can be moved, tabbed and resized but not closed, so none gets lost. */
const Tab = (props: IDockviewPanelHeaderProps) => <DockviewDefaultTab {...props} hideClose />;

function buildDefault(a: DockviewApi) {
  a.addPanel({ id: "stage", component: "stage", title: "Sân khấu" });
  a.addPanel({
    id: "layers",
    component: "layers",
    title: "Layer",
    position: { referencePanel: "stage", direction: "right" },
    initialWidth: 340,
  });
  a.addPanel({ id: "states", component: "states", title: "State", position: { referencePanel: "layers" }, inactive: true });
  a.addPanel({ id: "avatar", component: "avatar", title: "Avatar", position: { referencePanel: "layers" }, inactive: true });
  a.addPanel({
    id: "ranges",
    component: "ranges",
    title: "Voice range",
    position: { referencePanel: "layers", direction: "below" },
  });
  a.addPanel({ id: "settings", component: "settings", title: "Cài đặt", position: { referencePanel: "ranges" }, inactive: true });
  a.addPanel({
    id: "inspector",
    component: "inspector",
    title: "Inspector",
    position: { referencePanel: "stage", direction: "below" },
    initialHeight: 320,
  });
  a.getPanel("stage")?.api.setActive();
}

/** Right-click on a tab: float it out of the grid, dock it back, maximize. */
function tabMenu({ panel, group, api: a }: GetTabContextMenuItemsParams) {
  const floating = group.api.location.type === "floating";
  return [
    floating
      ? { label: "Gắn lại vào khung", action: () => group.api.moveTo({ position: "right" }) }
      : {
          label: "Nhổ ra (cửa sổ nổi)",
          action: () => a.addFloatingGroup(panel, { position: { left: 80, top: 80 }, width: 420, height: 360 }),
        },
    {
      label: panel.api.isMaximized() ? "Thu nhỏ lại" : "Phóng to",
      disabled: floating,
      action: () => (panel.api.isMaximized() ? panel.api.exitMaximized() : panel.api.maximize()),
    },
  ];
}

function resetLayout() {
  if (!api) return;
  localStorage.removeItem(LAYOUT_KEY);
  api.clear();
  buildDefault(api);
}

/** Editor screen: Unity-like dock. Drag a tab onto another panel's edge to
 *  split, onto its tab bar to group; drag the gaps to resize. Shift+drag a tab
 *  (or right-click > float) pulls it out as a floating window; dragging a
 *  floating tab back onto the grid docks it. Layout is saved. */
export function EditorLayout() {
  useEffect(() => () => void (api = null), []);
  return (
    <DockviewReact
      className="editor"
      theme={theme}
      components={components}
      defaultTabComponent={Tab}
      getTabContextMenuItems={tabMenu}
      onReady={(e) => {
        api = e.api;
        try {
          const saved = localStorage.getItem(LAYOUT_KEY);
          if (saved) e.api.fromJSON(JSON.parse(saved));
        } catch {
          e.api.clear();
        }
        // a saved layout from an older version may miss panels
        if (Object.keys(components).some((id) => !e.api.getPanel(id))) {
          e.api.clear();
          buildDefault(e.api);
        }
        e.api.onDidLayoutChange(() => {
          if (e.api.totalPanels) localStorage.setItem(LAYOUT_KEY, JSON.stringify(e.api.toJSON()));
        });
      }}
    />
  );
}
