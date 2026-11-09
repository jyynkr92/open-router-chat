import { cn } from '@/lib/class-name';

interface Props {
  label: string;
  className?: string;
}

export const LoadingDots = ({ label, className }: Props) => (
  <span className={cn('inline-flex items-center gap-1', className)}>
    <span
      className="size-2 animate-bounce rounded-full bg-current [animation-delay:-0.3s]"
      aria-hidden="true"
    />
    <span
      className="size-2 animate-bounce rounded-full bg-current [animation-delay:-0.15s]"
      aria-hidden="true"
    />
    <span className="size-2 animate-bounce rounded-full bg-current" aria-hidden="true" />
    <span className="sr-only">{label}</span>
  </span>
);
