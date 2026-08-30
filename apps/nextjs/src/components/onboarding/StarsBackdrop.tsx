"use client";

// Ambient celestial doodles scattered around the edges/corners (away from the
// central art + text) for onboarding hero screens. Reuses the white sprites and
// the `pull-star` drift/twinkle animation. Drop behind content; the host screen
// should be `relative isolate`.
const STARS = [
  { x: 7, y: 9, s: 30, d: 0, t: 6, n: "saturn" },
  { x: 24, y: 5, s: 18, d: 1.2, t: 6.6, n: "sparkle-mini" },
  { x: 50, y: 7, s: 20, d: 0.6, t: 5.8, n: "star-spark" },
  { x: 76, y: 6, s: 18, d: 1.8, t: 7, n: "star-five" },
  { x: 91, y: 13, s: 28, d: 0.3, t: 6.4, n: "comet" },
  { x: 5, y: 32, s: 18, d: 2.2, t: 6.8, n: "star-burst" },
  { x: 93, y: 38, s: 16, d: 1.1, t: 5.9, n: "sparkle-mini" },
  { x: 9, y: 82, s: 22, d: 0.9, t: 7.2, n: "moon" },
  { x: 88, y: 80, s: 24, d: 1.6, t: 6.1, n: "planet" },
  { x: 28, y: 90, s: 16, d: 2.4, t: 6.7, n: "star-five" },
  { x: 70, y: 91, s: 18, d: 0.5, t: 5.7, n: "star-spark" },
];

export function StarsBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
      {STARS.map((st, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={`/ui/stars/${st.n}.png`}
          alt=""
          draggable={false}
          className="pull-star absolute opacity-60"
          style={{
            left: `${st.x}%`,
            top: `${st.y}%`,
            width: st.s,
            height: st.s,
            animationDuration: `${st.t}s`,
            animationDelay: `${st.d}s`,
          }}
        />
      ))}
    </div>
  );
}
