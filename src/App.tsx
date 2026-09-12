import { getCurrentWindow } from "@tauri-apps/api/window";
import MainWindow from "./MainWindow";
import PetWindow from "./PetWindow";
import PipWindow from "./PipWindow";
import QuickAddWindow from "./features/quick-add/QuickAddWindow";
import "./App.css";

function App() {
  const label =
    "__TAURI_INTERNALS__" in window
      ? getCurrentWindow().label
      : new URLSearchParams(window.location.search).get("view") ?? "pip";

  if (label === "main") return <MainWindow />;
  if (label === "pet") return <PetWindow />;
  if (label === "quick-add") return <QuickAddWindow />;
  return <PipWindow />;
}

export default App;
