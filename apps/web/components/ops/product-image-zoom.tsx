"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const ZOOM_SCALE = 2.2;
const VIEWPORT_PADDING_PX = 8;

type ProductImageZoomProps = {
  src: string | null | undefined;
  alt: string;
  /** Classes do slot (ex.: aspect-square w-64 shrink-0) */
  className?: string;
  placeholder?: string;
  sizes?: string;
};

function computeZoomPopoverStyle(
  anchor: DOMRect,
  zoomSize: number,
): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = anchor.left + anchor.width / 2 - zoomSize / 2;
  let top = anchor.top + anchor.height / 2 - zoomSize / 2;

  left = Math.max(
    VIEWPORT_PADDING_PX,
    Math.min(left, vw - zoomSize - VIEWPORT_PADDING_PX),
  );
  top = Math.max(
    VIEWPORT_PADDING_PX,
    Math.min(top, vh - zoomSize - VIEWPORT_PADDING_PX),
  );

  return {
    position: "fixed",
    left,
    top,
    width: zoomSize,
    height: zoomSize,
    zIndex: 100,
  };
}

export function ProductImageZoom({
  src,
  alt,
  className = "relative aspect-square w-64 shrink-0",
  placeholder,
  sizes = "256px",
}: ProductImageZoomProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const zoomLayerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);

  const syncPopoverPosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const base = Math.max(rect.width, rect.height);
    const zoomSize = Math.round(base * ZOOM_SCALE);
    setPopoverStyle(computeZoomPopoverStyle(rect, zoomSize));
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!hovered || !src || lightbox) return;
    syncPopoverPosition();
    window.addEventListener("scroll", syncPopoverPosition, true);
    window.addEventListener("resize", syncPopoverPosition);
    return () => {
      window.removeEventListener("scroll", syncPopoverPosition, true);
      window.removeEventListener("resize", syncPopoverPosition);
    };
  }, [hovered, src, lightbox, syncPopoverPosition]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const showPopover = mounted && hovered && src && popoverStyle && !lightbox;

  const stayHovered = (relatedTarget: EventTarget | null) =>
    relatedTarget instanceof Node &&
    (anchorRef.current?.contains(relatedTarget) ||
      zoomLayerRef.current?.contains(relatedTarget));

  return (
    <>
      <div
        ref={anchorRef}
        className={`${className} ${src ? "cursor-zoom-in" : ""}`}
        onMouseEnter={() => {
          setHovered(true);
          syncPopoverPosition();
        }}
        onMouseLeave={(e) => {
          if (!stayHovered(e.relatedTarget)) setHovered(false);
        }}
        onClick={() => {
          if (src) setLightbox(true);
        }}
        onKeyDown={(e) => {
          if (src && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setLightbox(true);
          }
        }}
        role={src ? "button" : undefined}
        tabIndex={src ? 0 : undefined}
        aria-label={src ? `Ampliar imagem de ${alt}` : undefined}
      >
        <div
          className={`relative h-full w-full overflow-hidden rounded-md bg-slate-100 ${
            hovered && src && !lightbox ? "invisible" : ""
          }`}
        >
          {src ? (
            <Image
              src={src}
              alt={alt}
              fill
              className="object-contain"
              sizes={sizes}
              unoptimized
            />
          ) : (
            <div className="flex h-full min-h-[4rem] items-center justify-center p-2 text-center text-xs text-muted-foreground">
              {placeholder ?? alt}
            </div>
          )}
        </div>
      </div>

      {showPopover
        ? createPortal(
            <div
              ref={zoomLayerRef}
              className="pointer-events-none overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
              style={popoverStyle}
              role="presentation"
              aria-hidden
            >
              <div className="relative h-full w-full">
                <Image
                  src={src}
                  alt=""
                  fill
                  className="object-contain p-1"
                  sizes={`${popoverStyle.width}px`}
                  unoptimized
                />
              </div>
            </div>,
            document.body,
          )
        : null}

      {mounted && lightbox && src
        ? createPortal(
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
              onClick={() => setLightbox(false)}
              role="dialog"
              aria-modal
              aria-label={alt}
            >
              <button
                type="button"
                className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-slate-900 shadow"
                onClick={() => setLightbox(false)}
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
              <div
                className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-xl bg-white p-2 shadow-2xl"
                style={{ width: "min(90vw, 720px)", height: "min(90vh, 720px)" }}
                onClick={(e) => e.stopPropagation()}
              >
                <Image
                  src={src}
                  alt={alt}
                  fill
                  className="object-contain p-2"
                  sizes="720px"
                  unoptimized
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
