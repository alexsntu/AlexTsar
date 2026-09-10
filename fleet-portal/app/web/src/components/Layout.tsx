import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function Layout({ links, title }: { links: { to: string; label: string }[]; title: string }) {
  const { user, logout, logoutEverywhere } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-slate-900 text-white">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <span className="font-bold">ИП Царюк А.Б.</span>
            <span className="text-slate-400 text-sm ml-2">{title}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-300">{user?.email}</span>
            <button
              onClick={() => {
                if (window.confirm("Выйти со всех устройств? Понадобится заново войти везде, включая этот телефон/браузер."))
                  void logoutEverywhere();
              }}
              className="text-slate-400 hover:text-white underline underline-offset-2 text-xs"
              title="Отозвать доступ у всех устройств, где вы входили — например, если потеряли телефон"
            >
              Выйти везде
            </button>
            <button onClick={() => void logout()} className="text-slate-300 hover:text-white underline underline-offset-2">
              Выйти
            </button>
          </div>
        </div>
        <nav className="max-w-5xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `px-3 py-2 text-sm rounded-t-lg whitespace-nowrap ${
                  isActive ? "bg-slate-50 text-slate-900 font-medium" : "text-slate-300 hover:text-white"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex-1 bg-slate-50">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
