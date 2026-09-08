"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PackingReturnDetail } from "@/lib/types/dashboard";

interface PackingReturnsTableProps {
  data: PackingReturnDetail[];
}

export function PackingReturnsTable({ data }: PackingReturnsTableProps) {
  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Devoluções do packing para separação</CardTitle>
        <CardDescription>
          Quem separou, motivo reportado no packing e operador da conferência
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma devolução registrada hoje
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Pedido</th>
                  <th className="pb-2 pr-3 font-medium">Separador</th>
                  <th className="pb-2 pr-3 font-medium">Motivo</th>
                  <th className="pb-2 pr-3 font-medium">SKU</th>
                  <th className="pb-2 pr-3 font-medium">Qtd</th>
                  <th className="pb-2 pr-3 font-medium">Conferiu</th>
                  <th className="pb-2 font-medium">Horário</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={`${row.orderId}-${row.reportedAt}`} className="border-b last:border-0">
                    <td className="py-3 pr-3 font-semibold">{row.erpOrderId}</td>
                    <td className="py-3 pr-3">
                      {row.pickerName ?? (
                        <span className="text-muted-foreground">Não identificado</span>
                      )}
                    </td>
                    <td className="py-3 pr-3">{row.issueLabel}</td>
                    <td className="py-3 pr-3">
                      {row.sku}
                      {row.productName ? (
                        <span className="block text-xs text-muted-foreground">
                          {row.productName}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3">{row.quantity > 0 ? row.quantity : "—"}</td>
                    <td className="py-3 pr-3">
                      {row.reportedByName ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 whitespace-nowrap">
                      {new Date(row.reportedAt).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
