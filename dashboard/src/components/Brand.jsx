// Logo NBCoach per il SITO — solo wordmark (nessun quadrato).
// "NBCOACH" (NB oro, COACH bianco) + due caption identiche:
// "DOTT. NICOLA BAIOCCHI" e "COACHING & NUTRIZIONE".
// align="center" centra le righe (login/set-password).
// captionSize regola la dimensione delle due righe caption (default 4.6).

const HEIGHTS = {
  sm: 'h-12',  // 48px
  md: 'h-16',  // 64px — sidebar
  lg: 'h-24',  // 96px — login / set-password
}

export function Brand({ size = 'md', className = '', align = 'left', captionSize = 4.6 }) {
  const h = HEIGHTS[size] ?? HEIGHTS.md
  const centered = align === 'center'
  const anchor = centered ? 'middle' : 'start'
  const xMain = centered ? 56 : 1
  const xSub = centered ? 56 : 2

  return (
    <svg
      viewBox="0 0 112 42"
      role="img"
      aria-label="NBCoach — Dott. Nicola Baiocchi — Coaching & Nutrizione"
      className={`${h} w-auto ${className}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <text x={xMain} y="20" textAnchor={anchor} fontFamily="'Barlow Condensed', sans-serif" fontStyle="italic" fontWeight="800" fontSize="25" letterSpacing="0.5" fill="#F0A800">NB<tspan fill="#ffffff">COACH</tspan></text>
      <text x={xSub} y="30" textAnchor={anchor} fontFamily="'Inter', sans-serif" fontWeight="600" fontSize={captionSize} letterSpacing="1" fill="#8194ad">DOTT. NICOLA BAIOCCHI</text>
      <text x={xSub} y="38" textAnchor={anchor} fontFamily="'Inter', sans-serif" fontWeight="600" fontSize={captionSize} letterSpacing="1" fill="#8194ad">COACHING &amp; NUTRIZIONE</text>
    </svg>
  )
}
