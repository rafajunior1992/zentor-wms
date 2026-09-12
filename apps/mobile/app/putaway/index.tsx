import { router } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { FactoryButton } from "@/components/FactoryButton";
import { ScreenShell } from "@/components/ScreenShell";
import { usePutawayQueue, useStartPutaway } from "@/hooks/usePutaway";
import { ApiError } from "@/lib/api";
import { showErrorAlert } from "@/lib/app-alert";
import { theme, spacing, typography } from "@/lib/theme";

export default function PutawayListScreen() {
  const { data, isLoading, error, refetch, isRefetching } = usePutawayQueue();
  const start = useStartPutaway();

  const openItem = async (
    purchaseReceiptId: string,
    putawaySessionId: string | null,
  ) => {
    try {
      if (putawaySessionId) {
        router.push(`/putaway/${putawaySessionId}`);
        return;
      }
      const session = await start.mutateAsync(purchaseReceiptId);
      router.push(`/putaway/${session.session.id}`);
    } catch (e) {
      showErrorAlert(
        e instanceof ApiError ? e.message : "Erro ao iniciar armazenagem",
      );
    }
  };

  return (
    <ScreenShell
      backToHome
      title="Armazenagem pulmão"
      style={styles.shell}
      subtitle="NFs conferidas no recebimento — endereçamento no pulmão"
    >
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : error ? (
        <Text style={styles.error}>
          {error instanceof Error ? error.message : "Erro ao carregar fila"}
        </Text>
      ) : (
        <>
          <Text style={styles.count}>{data?.length ?? 0} NF(s) na fila</Text>
          <FlatList
            style={styles.listWrap}
            data={data ?? []}
            keyExtractor={(item) => item.purchaseReceiptId}
            refreshing={isRefetching}
            onRefresh={refetch}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={styles.empty}>
                Nenhuma NF aguardando armazenagem. Conferir notas no painel web.
              </Text>
            }
            ListFooterComponent={
              <View style={styles.footer}>
                <FactoryButton
                  label="Atualizar"
                  variant="secondary"
                  onPress={() => refetch()}
                  loading={isRefetching}
                />
                <Pressable
                  style={styles.avulsoLink}
                  onPress={() => router.push("/armazenagem-pulmao")}
                >
                  <Text style={styles.avulsoLinkText}>
                    Entrada avulsa no pulmão (sem NF)
                  </Text>
                </Pressable>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.numero}>
                  NF {item.invoiceNumber ?? "—"}
                </Text>
                {item.supplierName ? (
                  <Text style={styles.meta}>{item.supplierName}</Text>
                ) : null}
                <Text style={styles.meta}>
                  {item.itemCount} itens · {item.receiptOperator}
                </Text>
                <FactoryButton
                  label={
                    item.putawaySessionId
                      ? "Continuar armazenagem"
                      : "Iniciar armazenagem"
                  }
                  onPress={() =>
                    openItem(item.purchaseReceiptId, item.putawaySessionId)
                  }
                  loading={start.isPending}
                />
              </View>
            )}
          />
        </>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  listWrap: { flex: 1, minHeight: 120 },
  centered: { padding: spacing.xl, alignItems: "center" },
  count: {
    marginBottom: spacing.sm,
    fontWeight: "800",
    fontSize: typography.body,
    color: theme.text,
  },
  list: { paddingBottom: spacing.xl },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: theme.border,
    gap: spacing.sm,
  },
  numero: { fontWeight: "900", fontSize: typography.subtitle, color: theme.text },
  meta: { color: theme.textMuted, fontSize: typography.caption, fontWeight: "600" },
  footer: { gap: spacing.md, marginTop: spacing.sm },
  avulsoLink: { paddingVertical: spacing.sm, alignItems: "center" },
  avulsoLinkText: {
    color: theme.primary,
    fontWeight: "800",
    fontSize: typography.caption,
    textDecorationLine: "underline",
  },
  error: { color: theme.danger },
  empty: { textAlign: "center", color: theme.textMuted, marginTop: spacing.lg },
});
