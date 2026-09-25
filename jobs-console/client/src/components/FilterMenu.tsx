import { useEffect, useRef, useState } from 'react';

export function FilterMenu({ label, options, selected, onToggle, onClear }: {
  label: string;
  options: { value: string; label: string; count: number }[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  const one = selected.length === 1 ? options.find((o) => o.value === selected[0]) : undefined;
  const text = selected.length === 0 ? label : one ? one.label : `${label} · ${selected.length}`;

  return (
    <div className={`fm${open ? ' open' : ''}`} ref={ref}>
      <button type="button" className={`fm-btn${selected.length ? ' on' : ''}`} onClick={() => setOpen((o) => !o)}>
        {text} <span className="chev">▾</span>
      </button>
      {selected.length > 0 && (
        <button type="button" className="fm-x" aria-label={`clear ${label}`} onClick={onClear}>×</button>
      )}
      {open && (
        <div className="fm-menu">
          {options.map((o) => (
            <label key={o.value}>
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onToggle(o.value)} /> {o.label}
              <span className="n">{o.count}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
