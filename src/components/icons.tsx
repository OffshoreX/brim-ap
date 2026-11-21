// Inline SVG icons, no icon library. Decorative by default (aria-hidden): the text beside them carries the meaning.
// Icon-only buttons must give the button an aria-label.
const PATHS = {
  received: "M4 6h16v12H4zM4 7l8 6 8-6",
  needs_review: "M12 3l10 18H2zM12 10v5M12 18v.5",
  pending_approval: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2",
  approved: "M5 12l5 5 9-10",
  scheduled: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  paid: "M3 7h18v10H3zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z",
  rejected: "M6 6l12 12M18 6L6 18",
  error: "M12 3a9 9 0 100 18 9 9 0 000-18zM9 9l6 6M15 9l-6 6",
  warning: "M12 3l10 18H2zM12 10v5M12 18v.5",
  info: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M12 7.5v.5",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  download: "M12 4v12M7 11l5 5 5-5M4 20h16",
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

// Invented logo mark (an anchor-less "H" in a rounded square). Not a real brand.
export const LogoMark = () => (
  <svg className="logo" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false">
    <rect width="32" height="32" rx="8" fill="currentColor" />
    <path d="M10 9v14M22 9v14M10 16h12" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" />
  </svg>
);
