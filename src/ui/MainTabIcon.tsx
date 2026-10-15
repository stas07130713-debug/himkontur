type Props = Readonly<{ kind: "plume" | "placard" | "map" }>;

export function MainTabIcon({ kind }: Props) {
  if (kind === "map") {
    return (
      <svg className="main-tab-icon district-tab-icon" viewBox="0 0 36 34" aria-hidden="true">
        <path d="m3 7 9-4 12 4 9-4v24l-9 4-12-4-9 4V7Z" />
        <path d="M12 3v24M24 7v24" />
        <circle cx="18" cy="16" r="3.5" />
      </svg>
    );
  }
  if (kind === "placard") {
    return (
      <svg className="main-tab-icon placard-tab-icon" viewBox="0 0 34 34" aria-hidden="true">
        <rect x="3" y="3" width="28" height="28" rx="2.5" />
        <path d="M4 16.7h26" />
        <text x="17" y="13.7">33</text>
        <text x="17" y="27">1017</text>
      </svg>
    );
  }

  return (
    <svg className="main-tab-icon plume-tab-icon" viewBox="0 0 38 34" aria-hidden="true">
      <circle cx="5" cy="17" r="3.2" />
      <path className="plume-outer" d="M7.5 17 34 4.5c-2.9 8.2-2.9 16.8 0 25L7.5 17Z" />
      <path className="plume-inner" d="M8 17 26.5 10.2a20 20 0 0 0 0 13.6L8 17Z" />
      <path className="plume-axis" d="M8.5 17H34" />
    </svg>
  );
}
