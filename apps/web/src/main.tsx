import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Home } from "./Home";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    {/* The front page is "/"; the studio, and any other path, is the app. */}
    {window.location.pathname === "/" ? <Home /> : <App />}
  </StrictMode>,
);
