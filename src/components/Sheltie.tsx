// Шелти — собственный рисунок: соболиный шелти с белым воротником. Всё рисуется кодом (SVG),
// поэтому цвет ошейника подстраивается под выбранное оформление, а части — уши, глаза, хвост, язык — оживают.
import { forwardRef, type ReactElement } from 'react'

const HEAD = 'M100 40 C130 40 148 58 150 84 C151 98 142 108 131 118 C124 126 119 144 116 160 C114 172 109 180 100 180 C91 180 86 172 84 160 C81 144 76 126 69 118 C58 108 49 98 50 84 C52 58 70 40 100 40 Z'

export type Mood = 'idle' | 'sleep' | 'alert' | 'happy' | 'worried'

export const Sheltie = forwardRef<SVGSVGElement, { mood: Mood; blinking: boolean; hop: boolean }>(function Sheltie({ mood, blinking, hop }, ref): ReactElement {
  return (
    <svg ref={ref} className={`sheltie sheltie--${mood}${blinking ? ' is-blinking' : ''}${hop ? ' is-hop' : ''}`} viewBox="0 0 200 224" role="img" aria-label="Шелти — собака-помощник">
      <defs>
        <linearGradient id="sh-sable" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eaa65a" />
          <stop offset="1" stopColor="#c9782c" />
        </linearGradient>
        <linearGradient id="sh-sable-dark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b8691f" />
          <stop offset="1" stopColor="#8f4c14" />
        </linearGradient>
        <linearGradient id="sh-white" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#efe4d4" />
        </linearGradient>
        <linearGradient id="sh-collar" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-2)" />
        </linearGradient>
        <clipPath id="sh-headclip">
          <path d={HEAD} />
        </clipPath>
      </defs>

      <g className="sh-all">
        {/* хвост-«плюмаж» (машет, когда довольна) */}
        <g className="sh-tail">
          <path d="M146 206 C178 200 196 174 192 134 C190 112 178 100 166 106 C178 136 170 170 142 184 Z" fill="url(#sh-sable)" />
          <path d="M192 134 C190 112 178 100 166 106 C171 116 174 126 174 136 C186 140 193 138 192 134 Z" fill="url(#sh-white)" />
        </g>

        {/* соболиные плечи сзади и пышный белый воротник-«грива» */}
        <path d="M30 224 Q20 204 28 188 Q24 164 44 152 L156 152 Q176 164 172 188 Q180 204 170 224 Z" fill="url(#sh-sable)" />
        <path d="M40 224 Q22 208 30 192 Q18 178 32 166 Q24 152 40 144 Q38 128 56 126 Q60 108 80 112 L120 112 Q140 108 144 126 Q162 128 160 144 Q176 152 168 166 Q182 178 170 192 Q178 208 160 224 Z" fill="url(#sh-white)" />
        <path d="M56 176 Q62 188 56 198 M74 186 Q80 200 74 212 M126 186 Q120 200 126 212 M144 176 Q138 188 144 198 M46 158 Q54 164 52 172 M154 158 Q146 164 148 172" stroke="#e2d3bd" strokeWidth="2.4" strokeLinecap="round" fill="none" />

        {/* голова (качается и поворачивается вслед за курсором) */}
        <g className="sh-head">
          {/* уши: стоят, а кончики загнуты вперёд — как у настоящих шелти */}
          <g className="sh-ear sh-ear--l">
            <path d="M62 64 C54 48 52 34 58 22 C72 22 86 34 92 50 Z" fill="url(#sh-sable-dark)" />
            <path d="M66 58 C62 48 62 40 64 32 C72 38 78 46 82 52 Z" fill="#d98a7a" opacity="0.6" />
            <path className="sh-flap" d="M58 22 C50 20 44 27 45 36 C52 40 64 35 74 27 C68 22 63 21 58 22 Z" fill="#8f4c14" />
          </g>
          <g className="sh-ear sh-ear--r">
            <path d="M138 64 C146 48 148 34 142 22 C128 22 114 34 108 50 Z" fill="url(#sh-sable-dark)" />
            <path d="M134 58 C138 48 138 40 136 32 C128 38 122 46 118 52 Z" fill="#d98a7a" opacity="0.6" />
            <path className="sh-flap" d="M142 22 C150 20 156 27 155 36 C148 40 136 35 126 27 C132 22 137 21 142 22 Z" fill="#8f4c14" />
          </g>

          {/* череп и длинная узкая морда */}
          <path d={HEAD} fill="url(#sh-sable)" />
          {/* тонкая белая проточина и белый низ морды */}
          <g clipPath="url(#sh-headclip)">
            <path d="M97 40 Q100 38 103 40 L106 84 C108 100 118 108 132 122 L140 200 L60 200 L68 122 C82 108 92 100 94 84 Z" fill="url(#sh-white)" />
          </g>
          <path d={HEAD} fill="none" stroke="#a45f1f" strokeOpacity="0.18" strokeWidth="1.5" />

          {/* «брови» — по ним видно настроение */}
          <ellipse className="sh-brow sh-brow--l" cx="77" cy="69" rx="6" ry="2.6" fill="#f6cd8a" />
          <ellipse className="sh-brow sh-brow--r" cx="123" cy="69" rx="6" ry="2.6" fill="#f6cd8a" />

          {/* глаза */}
          <g className="sh-eyes">
            <g className="sh-eye sh-eye--l">
              <ellipse className="sh-eyeball" cx="77" cy="85" rx="7" ry="8" fill="#2a1a10" transform="rotate(10 77 85)" />
              <circle className="sh-glint" cx="79.5" cy="81.5" r="2.4" fill="#fff" />
              <circle className="sh-glint2" cx="74.5" cy="88" r="1.1" fill="#fff" opacity="0.8" />
            </g>
            <g className="sh-eye sh-eye--r">
              <ellipse className="sh-eyeball" cx="123" cy="85" rx="7" ry="8" fill="#2a1a10" transform="rotate(-10 123 85)" />
              <circle className="sh-glint" cx="125.5" cy="81.5" r="2.4" fill="#fff" />
              <circle className="sh-glint2" cx="120.5" cy="88" r="1.1" fill="#fff" opacity="0.8" />
            </g>
            <path className="sh-lids" d="M69 86 Q77 91 85 86 M115 86 Q123 91 131 86" stroke="#2a1a10" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          </g>

          {/* нос и рот */}
          <path d="M90 150 Q100 143 110 150 Q109 161 100 165 Q91 161 90 150 Z" fill="#241a1a" />
          <ellipse cx="97" cy="150" rx="3.4" ry="1.7" fill="#fff" opacity="0.3" />
          <path d="M100 165 L100 169" stroke="#241a1a" strokeWidth="2.2" strokeLinecap="round" />
          <path className="sh-mouth" d="M90 169 Q100 176 110 169" stroke="#241a1a" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <path className="sh-tongue" d="M95 173 Q100 192 105 173 Z" fill="#ff7f9a" />
          <path className="sh-tongue" d="M100 175 L100 184" stroke="#e5587a" strokeWidth="1.6" strokeLinecap="round" />
        </g>

        {/* ошейник цвета оформления и жетон */}
        <path d="M54 176 Q100 200 146 176 L147 188 Q100 214 53 188 Z" fill="url(#sh-collar)" />
        <g className="sh-tag">
          <circle cx="100" cy="207" r="9.5" fill="url(#sh-collar)" stroke="#fff" strokeWidth="2" />
          <path d="M104.6 203 A6 6 0 1 1 95.4 203" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <circle cx="100" cy="199.8" r="1.6" fill="#fff" />
        </g>

        {/* «Z-z-z», когда дремлет */}
        <g className="sh-zzz" fill="var(--accent)">
          <text x="150" y="44" fontSize="20" fontWeight="800">z</text>
          <text x="162" y="26" fontSize="15" fontWeight="800">z</text>
          <text x="172" y="12" fontSize="11" fontWeight="800">z</text>
        </g>
      </g>
    </svg>
  )
})
