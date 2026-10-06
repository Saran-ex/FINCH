import type { ReactNode } from "react";

export function LiquidGlassLayer({ className }: { className: string }) {
  return <div className={className} aria-hidden="true" />;
}

export function LiquidGlassEnvironment({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <div className="liquid-environment" data-active={active}>
      <LiquidGlassLayer className="liquid-layer liquid-fluid" />
      <LiquidGlassLayer className="liquid-layer liquid-refraction" />
      <LiquidGlassLayer className="liquid-layer liquid-highlight" />
      <LiquidGlassLayer className="liquid-layer liquid-reflection" />
      <div className="liquid-content">{children}</div>
    </div>
  );
}