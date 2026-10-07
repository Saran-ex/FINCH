import type { Attachment01Icon } from "@hugeicons/core-free-icons";
import type { ReactElement } from "react";

/**
 * Shape of an icon entry from `@hugeicons/core-free-icons`.
 *
 * That package declares `IconSvgObject` in its entry file but never exports it,
 * so we recover the type from one of its icon constants.
 */
export type PromptBarIcon = typeof Attachment01Icon;

export interface PromptBarSource {
  key: string;
  name: string;
  description: string;
  icon: PromptBarIcon | ReactElement;
  attach?: boolean | undefined;
}

export interface PromptBarCommand {
  key: string;
  name: string;
  description: string;
}

export interface PromptBarModel {
  key: string;
  name: string;
  tag?: string | undefined;
}

export interface PromptBarSendDetail {
  attachments: File[];
  model?: PromptBarModel | undefined;
  effort: string;
}

export interface PromptBarProps {
  placeholder?: string | undefined;
  sources?: PromptBarSource[] | undefined;
  commands?: PromptBarCommand[] | undefined;
  models?: PromptBarModel[] | undefined;
  defaultModel?: string | undefined;
  efforts?: string[] | undefined;
  defaultEffort?: string | undefined;
  onEffortChange?: ((level: string) => void) | undefined;
  busy?: boolean | undefined;
  onSend?: ((text: string, detail: PromptBarSendDetail) => void) | undefined;
  onStop?: (() => void) | undefined;
  onAttach?: (() => File | File[] | void) | undefined;
  onDictate?: (() => string | void) | undefined;
  background?: string | undefined;
  color?: string | undefined;
  menuBackground?: string | undefined;
  sparkColor?: string | undefined;
  sparkBoost?: number | undefined;
  width?: number | string | undefined;
  radius?: number | string | undefined;
  maxRows?: number | undefined;
  morphDuration?: number | undefined;
  squash?: number | undefined;
  tilt?: number | undefined;
  pressScale?: number | undefined;
  className?: string | undefined;
}

declare function PromptBar(props: PromptBarProps): ReactElement;

export default PromptBar;
