import React from "react";
import ReactDOM from "react-dom/client";
import { VisualCursor } from "visual-cursor/client";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    {import.meta.env.DEV && <VisualCursor skipPrefixes={["src/ui/"]} />}
  </React.StrictMode>
);
