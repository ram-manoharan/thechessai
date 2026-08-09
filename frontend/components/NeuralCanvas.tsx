"use client";

// Static SVG neural-network overlay with CSS animations — no rAF loop,
// no canvas.offsetWidth read race, works with SSR and screenshot tools.
const NODES = [
  { cx: "8%",  cy: "18%", r: 2.8, color: "rgba(201,162,68,0.55)",   delay: "0s",    dur: "7s"  },
  { cx: "22%", cy: "72%", r: 2.2, color: "rgba(91,142,245,0.5)",    delay: "1.2s",  dur: "9s"  },
  { cx: "38%", cy: "12%", r: 3.0, color: "rgba(201,162,68,0.45)",   delay: "0.6s",  dur: "8s"  },
  { cx: "55%", cy: "82%", r: 2.5, color: "rgba(91,142,245,0.48)",   delay: "2.1s",  dur: "6s"  },
  { cx: "70%", cy: "25%", r: 2.4, color: "rgba(201,162,68,0.5)",    delay: "0.4s",  dur: "10s" },
  { cx: "82%", cy: "65%", r: 2.9, color: "rgba(91,142,245,0.52)",   delay: "1.8s",  dur: "7.5s"},
  { cx: "92%", cy: "15%", r: 2.1, color: "rgba(201,162,68,0.42)",   delay: "3.0s",  dur: "8.5s"},
  { cx: "14%", cy: "45%", r: 2.6, color: "rgba(91,142,245,0.46)",   delay: "0.9s",  dur: "11s" },
  { cx: "47%", cy: "55%", r: 2.3, color: "rgba(201,162,68,0.48)",   delay: "1.5s",  dur: "9.5s"},
  { cx: "65%", cy: "88%", r: 2.7, color: "rgba(91,142,245,0.44)",   delay: "2.4s",  dur: "7s"  },
  { cx: "30%", cy: "35%", r: 2.0, color: "rgba(201,162,68,0.40)",   delay: "1.1s",  dur: "12s" },
];

const LINKS = [
  { x1: "8%",  y1: "18%", x2: "22%", y2: "72%", delay: "0s",   dur: "5s"  },
  { x1: "8%",  y1: "18%", x2: "38%", y2: "12%", delay: "0.5s", dur: "6s"  },
  { x1: "38%", y1: "12%", x2: "70%", y2: "25%", delay: "1s",   dur: "5.5s"},
  { x1: "22%", y1: "72%", x2: "47%", y2: "55%", delay: "1.3s", dur: "7s"  },
  { x1: "70%", y1: "25%", x2: "82%", y2: "65%", delay: "0.8s", dur: "6.5s"},
  { x1: "55%", y1: "82%", x2: "65%", y2: "88%", delay: "2s",   dur: "5s"  },
  { x1: "47%", y1: "55%", x2: "70%", y2: "25%", delay: "1.7s", dur: "8s"  },
  { x1: "14%", y1: "45%", x2: "30%", y2: "35%", delay: "0.3s", dur: "7s"  },
  { x1: "30%", y1: "35%", x2: "47%", y2: "55%", delay: "2.2s", dur: "6s"  },
  { x1: "82%", y1: "65%", x2: "92%", y2: "15%", delay: "1.5s", dur: "5.5s"},
];

export function NeuralCanvas() {
  return (
    <>
      <svg
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0, left: 0,
          width: "100%", height: "100%",
          pointerEvents: "none",
          zIndex: 0,
          overflow: "visible",
        }}
        preserveAspectRatio="xMidYMid slice"
      >
        {/* Connection lines */}
        {LINKS.map((l, i) => (
          <line
            key={i}
            x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            stroke="rgba(201,162,68,0.07)"
            strokeWidth="0.8"
            style={{
              animation: "nn-link-pulse " + l.dur + " ease-in-out " + l.delay + " infinite",
            }}
          />
        ))}
        {/* Nodes */}
        {NODES.map((n, i) => (
          <g key={i}>
            {/* Outer ring */}
            <circle cx={n.cx} cy={n.cy} r={n.r * 2.4}
              fill="none" stroke={n.color} strokeWidth="0.5"
              style={{ animation: "nn-node-pulse " + n.dur + " ease-in-out " + n.delay + " infinite" }}
            />
            {/* Core */}
            <circle cx={n.cx} cy={n.cy} r={n.r}
              fill={n.color}
              style={{ animation: "nn-node-pulse " + n.dur + " ease-in-out " + n.delay + " infinite" }}
            />
          </g>
        ))}
      </svg>

      <style>{`
        @keyframes nn-node-pulse {
          0%, 100% { opacity: 0.3; }
          50%       { opacity: 1;   }
        }
        @keyframes nn-link-pulse {
          0%, 100% { opacity: 0.2; }
          50%       { opacity: 0.7; }
        }
      `}</style>
    </>
  );
}
