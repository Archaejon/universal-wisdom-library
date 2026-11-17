import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

const listeners = new Set<() => void>();
let lastPath = "";

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onPop = () => {
    cb();
    emitScroll();
  };
  window.addEventListener("popstate", onPop);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("popstate", onPop);
  };
}

function getSnapshot() {
  return window.location.pathname + window.location.search + window.location.hash;
}

function emitScroll() {
  const path = window.location.pathname;
  if (path !== lastPath) {
    lastPath = path;
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }
}

export function navigate(to: string, opts: { replace?: boolean; scroll?: boolean } = {}) {
  const before = window.location.pathname;
  if (opts.replace) window.history.replaceState({}, "", to);
  else window.history.pushState({}, "", to);
  emit();
  if (before !== window.location.pathname || opts.scroll) {
    if (opts.scroll !== false) window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }
}

export function useLocation() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => "/");
  return new URL(snapshot, window.location.origin);
}

export function useNavigate() {
  return navigate;
}

export function Link({
  to,
  children,
  className,
  onClick,
  ...rest
}: { to: string; children: ReactNode; className?: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick"> & { onClick?: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  const external = /^https?:\/\//.test(to);
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || external || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...rest}
    >
      {children}
    </a>
  );
}
