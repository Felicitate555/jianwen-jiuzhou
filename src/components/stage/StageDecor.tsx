const LEAVES = [
  { left: '6%', delay: '0s', duration: '17s', size: 11, color: '#5d7a5f' },
  { left: '91%', delay: '5.5s', duration: '21s', size: 9, color: '#4f6b58' },
  { left: '13%', delay: '11s', duration: '24s', size: 7, color: '#6b8368' },
  { left: '86%', delay: '16s', duration: '19s', size: 8, color: '#54705c' },
];

export function StageDecor() {
  return (
    <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden" aria-hidden="true">
      <div className="stage-mountain stage-mountain-far absolute inset-x-0 bottom-0 h-[29%]" />
      <div className="stage-mountain stage-mountain-near absolute inset-x-0 bottom-0 h-[18%]" />
      <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[rgba(4,9,11,0.68)] to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[rgba(4,9,11,0.72)] to-transparent" />
      <div className="mist-edge absolute inset-0" />
      {LEAVES.map((leaf, index) => (
        <svg
          key={index}
          viewBox="0 0 24 24"
          className="leaf"
          style={{
            left: leaf.left,
            width: leaf.size,
            height: leaf.size,
            animationDelay: leaf.delay,
            animationDuration: leaf.duration,
          }}
        >
          <path d="M12 2C19 6 21 13 12 22 3 13 5 6 12 2Z" fill={leaf.color} opacity=".82" />
          <path d="M12 4v16" stroke="rgba(20,30,24,.55)" strokeWidth=".8" />
        </svg>
      ))}
    </div>
  );
}
