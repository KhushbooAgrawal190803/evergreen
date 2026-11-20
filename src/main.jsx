import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import "./styles.css";
import { ToastProvider, ConfirmProvider } from "./ui.jsx";
import { AuthProvider, useAuth, Login, ForcePassword } from "./auth.jsx";
import { TipLayer } from "./charts.jsx";
import Today from "./pages/Today.jsx";
import Orders from "./pages/Orders.jsx";
import OrderDetail from "./pages/OrderDetail.jsx";
import NewOrder from "./pages/NewOrder.jsx";
import Production from "./pages/Production.jsx";
import Stock from "./pages/Stock.jsx";
import Dispatch from "./pages/Dispatch.jsx";
import Settings from "./pages/Settings.jsx";
import ChallanPrint from "./pages/ChallanPrint.jsx";
import { ClientList, ClientDetail } from "./pages/Clients.jsx";

const I = {
  today: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  orders: <><path d="M6 3h9l3 3v15H6z" /><path d="M9 10h6M9 14h6M9 18h4" /></>,
  clients: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 010 6.8M18.5 14.8c1.6.8 2.6 2.6 3 5.2" /></>,
  production: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
  stock: <><path d="M3 7l9-4 9 4-9 4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></>,
  dispatch: <><path d="M2 6h12v10H2zM14 10h4l3 3v3h-7" /><circle cx="6" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>,
  settings: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
};
const Icon = ({ name }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{I[name]}</svg>;

const NAV = [
  ["/", "Today", "today"], ["/orders", "Orders", "orders"], ["/clients", "Clients", "clients"], ["/production", "Production", "production"],
  ["/stock", "Fabric & stock", "stock"], ["/dispatch", "Dispatch", "dispatch"], ["/settings", "Settings", "settings"],
];

function UserMenu() {
  const { user, logout } = useAuth();
  const initials = user.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <details className="user-menu">
      <summary>
        <span className="avatar">{initials}</span>
        <span className="user-id"><b>{user.name}</b><small>{user.roleLabel}</small></span>
      </summary>
      <div className="user-pop">
        <div className="user-pop-h">{user.email}</div>
        <NavLink to="/settings?tab=account" onClick={(e) => e.currentTarget.closest("details").removeAttribute("open")}>My account</NavLink>
        <button onClick={logout}>Sign out</button>
      </div>
    </details>
  );
}

function App() {
  const { user, can } = useAuth();
  const { pathname } = useLocation();
  if (!user) return <Login />;
  if (user.mustChange) return <ForcePassword />;
  // Printable documents render on their own, without the app chrome.
  if (pathname.startsWith("/challans/")) return <Routes><Route path="/challans/:id" element={<ChallanPrint />} /></Routes>;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="brand-mark"><svg width="16" height="16" viewBox="0 0 32 32"><path d="M16 4l8 12h-5l6 10H7l6-10H8z" fill="#F5F3EE" /></svg></div>
          <div><div className="brand-name">Evergreen</div><div className="brand-sub">Bag works</div></div>
        </div>
        <nav className="nav">
          {NAV.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === "/"}><Icon name={icon} />{label}</NavLink>
          ))}
        </nav>
        <div className="side-foot"><UserMenu /></div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/new" element={can("orders") ? <NewOrder /> : <div className="empty">You don't have permission to create orders.</div>} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/clients" element={<ClientList />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/production" element={<Production />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/dispatch" element={<Dispatch />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode><BrowserRouter><ToastProvider><ConfirmProvider><AuthProvider><App /><TipLayer /></AuthProvider></ConfirmProvider></ToastProvider></BrowserRouter></StrictMode>,
);
