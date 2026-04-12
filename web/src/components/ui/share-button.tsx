import { useCallback, useState } from "react";
import { Share2, Check } from "lucide-react";

export function ShareButton({
  url,
  title,
  variant = "icon",
  className = "",
}: {
  url?: string;
  title?: string;
  variant?: "icon" | "button";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback(async () => {
    const shareUrl = url ?? window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title, url: shareUrl });
      } catch { /* user cancelled */ }
      return;
    }
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [url, title]);

  if (variant === "button") {
    return (
      <button
        onClick={handleShare}
        className={`flex items-center justify-center gap-1.5 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${className}`}
      >
        {copied ? (
          <>
            <Check size={13} className="text-green-600" />
            <span className="text-green-600">Копирано!</span>
          </>
        ) : (
          <>
            <Share2 size={13} />
            {"share" in navigator ? "Сподели" : "Копирай линк"}
          </>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={handleShare}
      className={`rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${className}`}
      title={copied ? "Копирано!" : "Сподели"}
    >
      {copied ? <Check size={16} className="text-green-600" /> : <Share2 size={16} />}
    </button>
  );
}
