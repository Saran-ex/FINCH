import finchImage from "@/assets/finch-companion.png";
import { cn } from "@/lib/utils";

interface FinchViewportProps {
  immersed?: boolean;
  className?: string;
}

export function FinchViewport({ immersed = false, className }: FinchViewportProps) {
  return (
    <div className={cn("finch-viewport", immersed && "finch-immersed", className)}>
      <div className="finch-aura" aria-hidden="true" />
      <img
        src={finchImage}
        alt="Finch, your digital companion"
        width={1024}
        height={1536}
        className="finch-figure"
      />
      <div className="finch-ground" aria-hidden="true" />
    </div>
  );
}