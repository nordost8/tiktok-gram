"use client";

import { useState } from "react";

interface ChannelAvatarProps {
  channelId: string;
  title: string;
  className?: string;
}

export function ChannelAvatar({ channelId, title, className }: ChannelAvatarProps) {
  const [failed, setFailed] = useState(false);
  const letter = title.trim().slice(0, 1).toUpperCase() || "?";

  if (failed) {
    return (
      <span className={className} aria-hidden>
        {letter}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/channel-avatar/${channelId}`}
      alt=""
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
