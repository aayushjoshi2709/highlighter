import { createRoot } from "react-dom/client";
import "pdfjs-dist/web/pdf_viewer.css";
import "../../ui/styles.css";
import "../../ui/theme";
import "./viewer.css";
import { Viewer } from "./Viewer";

createRoot(document.getElementById("root")!).render(<Viewer />);
