/** Inline SVG placeholder when MinIO has no channel avatar yet. */
export function channelAvatarFallbackSvg(title: string): string {
  const letter = (title.trim()[0] ?? "?").toUpperCase();
  const hue = [...title].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 360;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="">
  <rect width="64" height="64" rx="32" fill="hsl(${hue} 45% 32%)"/>
  <text x="50%" y="54%" text-anchor="middle" font-family="system-ui,sans-serif" font-size="28" font-weight="600" fill="white">${letter}</text>
</svg>`;
}
