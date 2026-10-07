import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import "./expandedClosing.css";
import "./expandedScroll.css";

interface ExpandedInformationProps {
  eyebrow: string;
  title: string;
  detail: string;
  connections?: string[];
  image?: string;
  links?: string[];
  onClose: () => void;
}

function hostOf(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return url;
  }
}

export function ExpandedInformation({
  eyebrow,
  title,
  detail,
  connections,
  image,
  links,
  onClose,
}: ExpandedInformationProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setImageFailed(false);
  }, [image]);

  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => onClose(), 220);
  };

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  return (
    <div
      className={"expanded-backdrop" + (closing ? " expanded-closing" : "")}
      role="presentation"
      onClick={handleClose}
    >
      <article
        className={
          "expanded-information expanded-scrollable" + (closing ? " expanded-closing" : "")
        }
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <Button
          variant="glassIcon"
          size="icon"
          className="expanded-close"
          onClick={handleClose}
          aria-label="Close expanded information"
        >
          <X />
        </Button>
        <div className="expanded-index">FINCH / {eyebrow.toUpperCase()}</div>
        <p className="information-category">{eyebrow}</p>
        <h2>{title}</h2>
        {image && !imageFailed && (
          <img
            src={image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            style={{
              width: "100%",
              maxHeight: "16rem",
              objectFit: "cover",
              borderRadius: ".6rem",
              display: "block",
            }}
          />
        )}
        <div className="expanded-divider" />
        <p className="expanded-detail">{detail}</p>
        {links && links.length > 0 && (
          <div style={{ marginTop: "1rem", fontSize: ".68rem", color: "var(--muted-foreground)" }}>
            {links.map((url, index) => (
              <span key={url}>
                {index > 0 && " · "}
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {hostOf(url)}
                </a>
              </span>
            ))}
          </div>
        )}
        {connections && (
          <div className="connection-list">
            {connections.map((connection) => (
              <span key={connection}>{connection}</span>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}
