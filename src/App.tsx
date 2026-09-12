import { getCurrentWindow } from "@tauri-apps/api/window";
import MainWindow from "./MainWindow";
import PipWindow from "./PipWindow";
import "./App.css";

function App() {
  const label =
    "__TAURI_INTERNALS__" in window
      ? getCurrentWindow().label
      : new URLSearchParams(window.location.search).get("view") ?? "pip";

  return label === "main" ? <MainWindow /> : <PipWindow />;
}

export default App;
