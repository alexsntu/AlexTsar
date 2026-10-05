import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

type NavItem = { to: string; label: string };

// Сколько разделов помещается в нижнюю панель на телефоне рядом с «Ещё» —
// остальные уходят в выезжающий список (см. MobileNav).
const MOBILE_PRIMARY_COUNT = 4;

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

// Иконка по последнему сегменту пути — Layout общий для диспетчера и
// водителя, и список ссылок приходит снаружи (см. App.tsx).
const ICONS: Record<string, ReactNode> = {
  fuel: <path d="M12 3s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.2 12 3 12 3z" />,
  maintenance: <path d="M14.5 6.5a4 4 0 0 0 5 5L11 20a2.1 2.1 0 0 1-3-3l8.5-8.5a4 4 0 0 1-2-2zM14.5 6.5l3-3" />,
  trips: (
    <>
      <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" />
      <circle cx="7" cy="17.5" r="1.5" />
      <circle cx="17" cy="17.5" r="1.5" />
    </>
  ),
  documents: <path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" />,
  directories: <path d="M5 4h13v16H5zM9 4v16M12 9h3M12 13h3" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01" />
    </>
  ),
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />,
};

function iconFor(to: string): ReactNode {
  return <Icon>{ICONS[to.split("/").pop() ?? ""] ?? ICONS.documents}</Icon>;
}

function mobileItemClass(active: boolean): string {
  return `flex flex-col items-center justify-center gap-0.5 min-h-14 px-1 text-[11px] leading-tight ${
    active ? "text-sky-700 font-semibold" : "text-slate-500"
  }`;
}

/** Навигация для телефона: панель внизу экрана (первые разделы + «Ещё») и
 * выезжающий снизу список с остальными разделами и выходом. На широком
 * экране не показывается — там остаётся строка вкладок в шапке. */
function MobileNav({ links }: { links: NavItem[] }) {
  const { user, logout, logoutEverywhere } = useAuth();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const primary = links.slice(0, MOBILE_PRIMARY_COUNT);
  const rest = links.slice(MOBILE_PRIMARY_COUNT);
  const restActive = rest.some((l) => location.pathname.startsWith(l.to));

  // Переход в другой раздел закрывает список сам — в том числе по кнопке
  // «назад» в браузере, а не только по нажатию на пункт.
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  return (
    <div className="md:hidden">
      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/40" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-0 bg-white rounded-t-2xl shadow-lg px-4 pt-3"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 4.5rem)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mb-2" />
            {rest.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 min-h-12 px-2 rounded-lg text-base ${isActive ? "bg-sky-50 text-sky-700 font-semibold" : "text-slate-800"}`
                }
              >
                {iconFor(link.to)}
                {link.label}
              </NavLink>
            ))}
            <div className="border-t border-slate-100 mt-2 pt-2">
              <p className="px-2 py-1 text-xs text-slate-500">Вы вошли как {user?.email}</p>
              <button onClick={() => void logout()} className="block w-full text-left min-h-12 px-2 rounded-lg text-base text-slate-800">
                Выйти
              </button>
              <button
                onClick={() => {
                  if (window.confirm("Выйти со всех устройств? Понадобится заново войти везде, включая этот телефон/браузер."))
                    void logoutEverywhere();
                }}
                className="block w-full text-left min-h-12 px-2 rounded-lg text-sm text-slate-500"
              >
                Выйти на всех устройствах
                <span className="block text-xs text-slate-400">например, если потеряли телефон</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <nav
        className="fixed bottom-0 inset-x-0 z-50 bg-white border-t border-slate-200 grid"
        style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))`, paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {primary.map((link) => (
          <NavLink key={link.to} to={link.to} className={({ isActive }) => mobileItemClass(isActive && !moreOpen)}>
            {iconFor(link.to)}
            <span className="truncate max-w-full">{link.label}</span>
          </NavLink>
        ))}
        <button onClick={() => setMoreOpen((v) => !v)} className={mobileItemClass(moreOpen || restActive)} aria-expanded={moreOpen}>
          <Icon>{ICONS.more}</Icon>
          <span>Ещё</span>
        </button>
      </nav>
    </div>
  );
}

export function Layout({ links, title }: { links: NavItem[]; title: string }) {
  const { user, logout, logoutEverywhere } = useAuth();
  const location = useLocation();
  const activeLabel = links.find((l) => location.pathname.startsWith(l.to))?.label ?? title;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-slate-900 text-white" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        {/* Телефон: одна строка — текущий раздел; меню и выход живут в MobileNav. */}
        <div className="md:hidden px-4 py-2.5 flex items-baseline justify-between gap-3">
          <span className="font-bold text-lg truncate">{activeLabel}</span>
          <span className="text-slate-400 text-xs whitespace-nowrap">ИП Царюк А.Б.</span>
        </div>

        <div className="hidden md:flex max-w-5xl mx-auto px-4 py-3 items-center justify-between">
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
        <nav className="hidden md:flex max-w-5xl mx-auto px-4 gap-1 overflow-x-auto">
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
        {/* Нижний отступ на телефоне — под закреплённую панель MobileNav. */}
        <div className="max-w-5xl mx-auto px-4 pt-4 pb-24 md:pb-4">
          <Outlet />
        </div>
      </main>
      <MobileNav links={links} />
    </div>
  );
}
