import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

export function Card({
  title,
  children,
  collapsible = false,
  open,
  defaultOpen = false,
  onToggle,
}: {
  title?: string;
  children: ReactNode;
  /** Если true — карточка сворачивается/разворачивается по клику на заголовок. */
  collapsible?: boolean;
  /** Управляемое состояние (например, чтобы открыть форму программно при клике на запись). */
  open?: boolean;
  /** Начальное состояние, если open не задан (неуправляемый режим). */
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  // Неуправляемый режим держит своё состояние внутри — если просто читать
  // open ?? defaultOpen на каждый рендер без internal state, любой чужой
  // ре-рендер родителя (например, набор текста в соседнем поле формы) сбросит
  // разворот обратно в defaultOpen, потому что React считает open управляемым
  // атрибутом и переустанавливает его каждый раз.
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  if (!collapsible) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        {title && <h2 className="text-lg font-semibold mb-3 text-slate-800">{title}</h2>}
        {children}
      </div>
    );
  }

  return (
    <details
      className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 [&_summary::-webkit-details-marker]:hidden group"
      open={isOpen}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (!isControlled) setInternalOpen(next);
        onToggle?.(next);
      }}
    >
      <summary className="text-lg font-semibold text-slate-800 cursor-pointer select-none list-none flex items-center gap-2">
        <span className="text-slate-400 text-sm transition-transform group-open:rotate-90">▶</span>
        {title}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const variants = {
    primary: "bg-sky-600 hover:bg-sky-700 text-white",
    secondary: "bg-slate-100 hover:bg-slate-200 text-slate-800",
    danger: "bg-red-600 hover:bg-red-700 text-white",
  };
  return (
    <button
      className={`px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-sky-500"
      {...props}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-sky-500"
      {...props}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block mb-2">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-200">
            {head.map((h, i) => (
              <th key={i} className="py-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="text-sm text-red-600 mt-2">{children}</p>;
}
