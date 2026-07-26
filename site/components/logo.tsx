// The Boardhang mark — "Resin Jug b" (brand/resin-jug-b-open.svg), inlined so it costs no
// request. The open (tileless) variant sits on any background. The LED's radial glow halo is
// dropped here: it is imperceptible at header/footer sizes and would need a unique gradient id
// per instance. Decorative — every use is paired with the "Boardhang" wordmark in text.
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 240" aria-hidden="true" focusable="false" className={className}>
      <g transform="translate(-32.4 -24.5) scale(1.187)">
        <path
          fill="#3b82f6"
          fillRule="evenodd"
          d="M63 70 C60 50 68 38 84 38 C97 38 103 48 101 62 C100 76 98 88 97 102 C100 98 106 93 118 91 C130 89 144 89 156 93 C176 99 190 114 194 134 C197 152 193 172 181 186 C175 193 167 198 157 201 C152 203 148 203 142 203 L80 203 C70 203 64 198 63 188 C62 168 66 148 64 126 C62 106 64 88 63 70 Z M171 146 a25 25 0 1 0 -50 0 a25 25 0 1 0 50 0 Z"
        />
        <circle cx="146" cy="146" r="9" fill="#34d97b" />
      </g>
    </svg>
  )
}
