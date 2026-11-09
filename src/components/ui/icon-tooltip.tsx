import type { ReactNode } from 'react';

interface Props {
  label: string;
  children: ReactNode;
}

export const IconTooltip = ({ label, children }: Props) => (
  <span className="group/tooltip relative inline-flex">
    {children}
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background opacity-0 shadow-md transition-[opacity,transform] duration-150 group-hover/tooltip:translate-y-0 group-hover/tooltip:opacity-100 group-focus-within/tooltip:translate-y-0 group-focus-within/tooltip:opacity-100"
    >
      {label}
    </span>
  </span>
);
