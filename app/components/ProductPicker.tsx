"use client";

import { useEffect, useRef, useState } from "react";

type Option = { id: string; sku: string; name: string };

export default function ProductPicker({
  products,
  value,
  onChange,
  placeholder = "Введите SKU или название…",
}: {
  products: Option[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = products.find((p) => p.id === value) ?? null;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = (
    q ? products.filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)) : products
  ).slice(0, 50);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <input
        type="text"
        value={open ? query : selected ? `${selected.sku} — ${selected.name}` : ""}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onChange("");
        }}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (
        <div className="product-picker-dropdown">
          {filtered.length === 0 ? (
            <div className="muted" style={{ padding: 8 }}>
              Ничего не найдено
            </div>
          ) : (
            filtered.map((p) => (
              <div
                key={p.id}
                className="product-picker-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                  setQuery("");
                }}
              >
                {p.sku} — {p.name}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
