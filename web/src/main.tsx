import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import App from "./App";
import "./styles/app.css";

// A single-file build has no server to rewrite URLs, so it routes on the hash.
// The deployed site uses real paths plus the 404.html fallback.
const standalone = import.meta.env.VITE_STANDALONE === "true";
const Router = standalone ? HashRouter : BrowserRouter;
const routerProps = standalone ? {} : { basename: import.meta.env.BASE_URL };

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Router {...routerProps}>
      <App />
    </Router>
  </React.StrictMode>,
);
