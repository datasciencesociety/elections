import { ArrowLeft } from "lucide-react";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

/**
 * Section/detail panel. On desktop it renders as a 480px right-side rail
 * that sits on top of the page content. On mobile it takes over the full
 * viewport so the preview has all the room it needs and the underlying
 * map/table is hidden — no competing scroll regions.
 */
export default function Sidebar({ open, onClose, title, children }: SidebarProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-background md:absolute md:inset-y-0 md:left-auto md:right-0 md:w-sidebar md:border-l md:border-border md:shadow-sm">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2 md:h-10 md:px-3">
        <button
          onClick={onClose}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:p-1"
          aria-label="Назад"
        >
          <ArrowLeft size={18} className="md:hidden" />
          <span className="hidden md:inline">✕</span>
        </button>
        {title && (
          <span className="truncate text-sm font-medium">{title}</span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {children}
      </div>
    </div>
  );
}
