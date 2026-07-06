import { useEffect, useState } from "react";
import { HashRouter, Routes, Route, NavLink } from "react-router-dom";
import FeedbackWorkspace from "./pages/FeedbackWorkspace.jsx";
import IngestSettings from "./pages/IngestSettings.jsx";

const NAV = [
  { to: "/", label: "Feedback Workspace", end: true },
  { to: "/ingest", label: "Ingest & Cài đặt" },
];

function readSavedTheme() {
  try {
    const saved = window.localStorage.getItem("cfl-theme");
    return saved === "dark" || saved === "light" ? saved : "light";
  } catch {
    return "light";
  }
}

function Sidebar() {
  return (
    <nav className="sidebar">
      <h1>
        CFL Feedback
        <small>Crossfire Legends Intelligence</small>
      </h1>
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function App() {
  const [theme, setTheme] = useState(readSavedTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("cfl-theme", theme);
    } catch {
      // Ignore storage errors in restricted browser contexts.
    }
  }, [theme]);

  return (
    <HashRouter>
      <div className="app-shell">
        <Sidebar />
        <main className="main">
          <Routes>
            <Route path="/" element={<FeedbackWorkspace theme={theme} onThemeChange={setTheme} />} />
            <Route path="/ingest" element={<IngestSettings />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
