import { HashRouter, Routes, Route, NavLink } from "react-router-dom";
import Dashboard from "./pages/Dashboard.jsx";
import StorePage from "./pages/StorePage.jsx";
import FacebookPage from "./pages/FacebookPage.jsx";
import CommentExplorer from "./pages/CommentExplorer.jsx";
import IngestSettings from "./pages/IngestSettings.jsx";

const NAV = [
  { to: "/", label: "Tổng quan", end: true },
  { to: "/store", label: "Store" },
  { to: "/facebook", label: "Facebook" },
  { to: "/comments", label: "Comment Explorer" },
  { to: "/ingest", label: "Ingest & Cài đặt" },
];

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
  return (
    <HashRouter>
      <div className="app-shell">
        <Sidebar />
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/store" element={<StorePage />} />
            <Route path="/facebook" element={<FacebookPage />} />
            <Route path="/comments" element={<CommentExplorer />} />
            <Route path="/ingest" element={<IngestSettings />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
