import { X } from "lucide-react";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export default function Sidebar({ open, onClose, title, children }: SidebarProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[480px] flex-col border-l border-border bg-background shadow-lg">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        {title && (
          <span className="truncate text-sm font-semibold">{title}</span>
        )}
        <button
          onClick={onClose}
          className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {children}
      </div>
    </div>
  );
}
