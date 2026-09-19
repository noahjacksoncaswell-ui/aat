import React, { useEffect, useState } from "react";
import { fetchDocumentBlobUrl } from "../utils/documentAccess";

/**
 * Opens/downloads a document version through the authenticated API client
 * rather than a raw <a href> (v3.1 Item 8). Opens a blank tab synchronously
 * on click (inside the trusted click handler, so popup blockers allow it),
 * then redirects that tab to the fetched blob URL once the authenticated
 * request resolves.
 */
export function DocumentLink({
  documentId,
  version,
  className,
  children,
}: {
  documentId: string;
  version: number;
  className?: string;
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    const tab = window.open("", "_blank");
    try {
      const url = await fetchDocumentBlobUrl(documentId, version);
      if (tab) tab.location.href = url;
      else window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    } catch {
      tab?.close();
      alert("Unable to retrieve document. Your session may have expired.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <a href="#" onClick={handleClick} className={className}>
      {loading ? "Retrieving..." : children}
    </a>
  );
}

/** Renders a document/photo as an <img>, fetched through the authenticated API client. */
export function DocumentImage({ documentId, version, alt, className }: { documentId: string; version: number; alt?: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchDocumentBlobUrl(documentId, version).then((url) => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setSrc(url);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, version]);

  if (!src) return <div className={`${className ?? ""} animate-pulse bg-zinc-800`} aria-label="Loading image" />;
  return <img src={src} alt={alt ?? ""} className={className} />;
}
