import type { MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FloatingInformationProps {
  children: ReactNode;
  className?: string;
  depth?: string;
  onClick: () => void;
}

export function FloatingInformation({
  children,
  className,
  depth,
  onClick,
}: FloatingInformationProps) {
  const handlePointer = (event: MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
  };

  return (
    <button
      type="button"
      className={cn("floating-information", className)}
      data-depth={depth}
      onMouseMove={handlePointer}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
