"use client";

import { useState } from "react";

export default function PhotoThumb({
  url,
  size = 40,
}: {
  url: string | null;
  size?: number;
}) {
  const [zoomed, setZoomed] = useState(false);

  if (url) {
    return (
      <>
        <div
          className="photo-thumb-wrapper"
          onClick={() => setZoomed(true)}
          style={{ width: size, height: size }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            width={size}
            height={size}
            style={{
              width: size,
              height: size,
              objectFit: "cover",
              borderRadius: 6,
              border: "1px solid var(--border)",
              display: "block",
            }}
          />
          <div className="photo-thumb-zoom-overlay">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </div>
        </div>

        {zoomed && (
          <div className="photo-lightbox-backdrop" onClick={() => setZoomed(false)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="photo-lightbox-image" onClick={(e) => e.stopPropagation()} />
          </div>
        )}
      </>
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--surface-alt)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg
        width={size * 0.5}
        height={size * 0.5}
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--muted)"
        strokeWidth={1.5}
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    </div>
  );
}
