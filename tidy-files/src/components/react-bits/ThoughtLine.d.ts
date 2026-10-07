import type { CSSProperties, ReactElement, ReactNode } from "react";

export interface ThoughtLineProps {
  label?: string | undefined;
  doneLabel?: string | undefined;
  renderLabel?: ((text: string, working: boolean) => ReactNode) | undefined;
  glyph?: string | undefined;
  steps?: string[] | undefined;
  collapsible?: boolean | undefined;
  collapseOnSettle?: boolean | undefined;
  color?: string | undefined;
  glyphColor?: string | undefined;
  fontSize?: number | undefined;
  breathPeriod?: number | undefined;
  breathDepth?: number | undefined;
  shimmer?: boolean | undefined;
  shimmerDuration?: number | undefined;
  settleDuration?: number | undefined;
  settleBlur?: number | undefined;
  working?: boolean | undefined;
  settleAfter?: number | undefined;
  elapsed?: number | undefined;
  showTimer?: boolean | undefined;
  onSettle?: ((elapsed: number) => void) | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

declare function ThoughtLine(props: ThoughtLineProps): ReactElement;

export default ThoughtLine;
