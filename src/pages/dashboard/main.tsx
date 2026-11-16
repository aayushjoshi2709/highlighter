import { createRoot } from "react-dom/client";
import "../../ui/styles.css";
import "../../ui/theme";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
