import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installDownloads } from "./downloads";
import "./tailwind.css";
import "./App.css";

installDownloads();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
