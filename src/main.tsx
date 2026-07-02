import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./app/App";
import "./app/styles.css";

// WebXR sessions are single-use native resources. React StrictMode's dev-only
// effect remount probe ends the session before the real scanner startup.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
