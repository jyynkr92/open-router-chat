'use client';

import { useEffect, useId, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';

interface Props {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
}

export const Dialog = ({ open, title, description, children, onOpenChange }: Props) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      setIsVisible(false);
      if (dialog.open) dialog.close();
      return;
    }
    if (dialog.open) return;
    dialog.showModal();
    const frame = requestAnimationFrame(() => setIsVisible(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    onOpenChange(false);
  };

  const handleClose = () => {
    if (open) onOpenChange(false);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      data-state={open && isVisible ? 'open' : 'closed'}
      onCancel={handleCancel}
      onClose={handleClose}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md translate-y-2 rounded-2xl border bg-background p-0 text-foreground opacity-0 shadow-2xl transition-[opacity,transform] duration-200 data-[state=open]:translate-y-0 data-[state=open]:opacity-100 backdrop:bg-foreground/30 backdrop:backdrop-blur-sm"
    >
      <div className="p-6">
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {description && (
          <p id={descriptionId} className="mt-2 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        )}
        <div className="mt-6">{children}</div>
      </div>
    </dialog>
  );
};
