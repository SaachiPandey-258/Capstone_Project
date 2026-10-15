import type { ReactNode } from "react";

export function PageHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return <div className="loading-state" role="status">{label}</div>;
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return <div className="error-message" role="alert">{children}</div>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><h2>{title}</h2><p>{children}</p></div>;
}
