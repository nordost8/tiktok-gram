import { cn } from "@tiktok-gram/ui";

interface IconProps {
  className?: string;
  size?: number;
}

function IconBase({
  className,
  size = 24,
  children,
  viewBox = "0 0 24 24",
}: IconProps & { children: React.ReactNode; viewBox?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** Speaker with sound waves — sound is on. */
export function IconVolumeOn({ className, size }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M11 5 6 9H3v6h3l5 4V5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M15.5 8.5a5 5 0 0 1 0 7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M18 6a8.5 8.5 0 0 1 0 12"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </IconBase>
  );
}

/** Crossed-out speaker — sound is off. */
export function IconVolumeOff({ className, size }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M11 5 6 9H3v6h3l5 4V5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="m16 9 5 6M21 9l-5 6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </IconBase>
  );
}

export function IconHeart({ className, size, filled }: IconProps & { filled?: boolean }) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M12 20.5s-6.5-4.35-8.5-8.1C1.9 9.25 3.6 5.5 7.1 5.1c1.9-.25 3.55.7 4.4 2  .85-1.3 2.5-2.25 4.4-2 3.5.4 5.2 4.15 3.6 7.3-2 3.75-8.5 8.1-8.5 8.1Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </IconBase>
  );
}

export function IconBookmark({ className, size, filled }: IconProps & { filled?: boolean }) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M6 4.5h12v15l-6-3.75L6 19.5v-15Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </IconBase>
  );
}

/** "Share" arrow (like on TikTok/Reels). */
export function IconShare({ className, size }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M12 16V5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="m8.5 8.5 3.5-3.5L15.5 8.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 13.5v5h12v-5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconBase>
  );
}

export function IconMore({ className, size }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <circle cx="12" cy="6" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="18" r="1.5" fill="currentColor" />
    </IconBase>
  );
}

export function IconHome({ className, size }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </IconBase>
  );
}

export function IconChannels({ className, size }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path d="M8 10.5 12 13l4-2.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </IconBase>
  );
}

export function IconProfile({ className, size }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <circle cx="12" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M5 20c0-3.314 3.134-6 7-6s7 2.686 7 6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </IconBase>
  );
}
