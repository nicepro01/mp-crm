"use client";

import { ReactNode, useState } from "react";

type Tab = {
  key: string;
  label: string;
  content: ReactNode;
};

export default function AnalyticsTabs({ tabs }: { tabs: Tab[] }) {
  const [activeKey, setActiveKey] = useState(tabs[0]?.key);

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid var(--border)",
          marginBottom: 20,
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveKey(tab.key)}
              style={{
                background: "none",
                border: "none",
                borderBottom: isActive ? "2px solid var(--link)" : "2px solid transparent",
                color: isActive ? "var(--link)" : "var(--fg)",
                fontWeight: isActive ? 600 : 500,
                fontSize: 15,
                padding: "10px 16px",
                cursor: "pointer",
                marginBottom: -1,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div key={tab.key} style={{ display: tab.key === activeKey ? "block" : "none" }}>
          {tab.content}
        </div>
      ))}
    </div>
  );
}
