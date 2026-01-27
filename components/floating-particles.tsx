"use client";

import { useEffect, useState } from "react";

type Particle = {
  top: number;
  left: number;
  delay: number;
  size: number;
  rotate: number;
};

export function FloatingParticles({ count = 30 }: { count?: number }) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    const generated = Array.from({ length: count }).map(() => ({
      top: Math.random() * 100,
      left: Math.random() * 100,
      delay: Math.random() * 2,
      size: Math.random() * 3 + 1, // star size 1-4px
      rotate: Math.random() * 360,
    }));
    setParticles(generated);
  }, [count]);

  return (
    <>
      {particles.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-amber-400 animate-floating-slow opacity-50 animate-pulse-slow"
          style={{
            top: `${p.top}%`,
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            animationDelay: `${p.delay}s`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </>
  );
}
