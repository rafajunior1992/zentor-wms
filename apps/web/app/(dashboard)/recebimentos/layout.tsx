import { Suspense } from "react";

export default function RecebimentosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Suspense fallback={<p className="p-6 text-muted-foreground">Carregando…</p>}>{children as never}</Suspense>;
}
