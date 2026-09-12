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
import { CollectionDeadlineRow } from "@/components/CollectionDeadlineRow";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import {
  useAcceptWave,
  useCurrentWave,
  useReleaseWaveAccept,
} from "@/hooks/useWavePicking";
import { showErrorAlert, showInfoAlert } from "@/lib/app-alert";
import { ApiError } from "@/lib/api";
import type { WaveLineSummary } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

function statusLabel(line: WaveLineSummary) {
  if (line.sortStatus === "SORTED") return "Concluído";
  if (line.sortStatus === "PICKED") return "Aguardando packing (web)";
  if (line.quantityPicked > 0) return "Em andamento";
  return "Pendente";
}

export function WavePickingPanel() {
  const { data, isLoading, error, refetch, isRefetching } = useCurrentWave();
  const acceptWave = useAcceptWave(data?.wave.id);
  const releaseWave = useReleaseWaveAccept(data?.wave.id);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={styles.loadingText}>Carregando onda...</Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>
          {error instanceof Error
            ? error.message
            : "Nenhuma onda ativa. Libere uma onda no painel web."}
        </Text>
        <FactoryButton
          label="Atualizar"
          variant="secondary"
          onPress={() => refetch()}
        />
      </View>
    );
  }

  const { wave, lines } = data;
  const pending = lines.filter((l) => l.sortStatus !== "SORTED");
  const canReleaseWave =
    wave.canWork && lines.every((l) => l.quantityPicked === 0);

  const handleReleaseWave = async () => {
    try {
      await releaseWave.mutateAsync();
      await refetch();
    } catch (e) {
      showErrorAlert(
        e instanceof ApiError ? e.message : "Erro ao cancelar aceite",
      );
    }
  };

  if (wave.canAccept) {
    return (
      <View style={styles.centered}>
        <Text style={styles.waveName}>{wave.name}</Text>
        <CollectionDeadlineRow deadline={wave.collectionDeadline} />
        <Text style={styles.waveMeta}>
          {wave.orderCount} pedidos · {wave.gondolaPasses} passagens na gôndola
        </Text>
        {wave.marketplaces && wave.marketplaces.length > 0 ? (
          <Text style={styles.marketplaces}>
            {wave.marketplaces.join(" · ")}
          </Text>
        ) : null}
        <Text style={styles.acceptHint}>
          Mesmo SKU agrupado — pick consolidado no mobile; packing no painel
          web.
        </Text>
        <FactoryButton
          label="Aceitar esta onda"
          onPress={() => {
            void acceptWave.mutateAsync().catch((e) => {
              showErrorAlert(
                e instanceof ApiError ? e.message : "Erro ao aceitar onda",
              );
            });
          }}
          loading={acceptWave.isPending}
        />
        <FactoryButton
          label="Atualizar"
          variant="secondary"
          onPress={() => refetch()}
        />
      </View>
    );
  }

  if (!wave.canWork) {
    return (
      <View style={styles.centered}>
        <Text style={styles.waveName}>{wave.name}</Text>
        <Text style={styles.error}>
          Onda aceita por {wave.acceptedByName ?? "outro operador"}.
        </Text>
        <FactoryButton
          label="Atualizar"
          variant="secondary"
          onPress={() => refetch()}
        />
      </View>
    );
  }

  const listHeader = (
    <View style={styles.listHeader}>
      <Text style={styles.waveName}>{wave.name}</Text>
      <CollectionDeadlineRow deadline={wave.collectionDeadline} />
      <Text style={styles.waveMeta}>
        {wave.orderCount} pedidos · {pending.length} linhas pendentes
      </Text>
      {wave.marketplaces && wave.marketplaces.length > 0 ? (
        <Text style={styles.marketplaces}>
          {wave.marketplaces.join(" · ")}
        </Text>
      ) : null}
      {canReleaseWave ? (
        <FactoryButton
          label="Cancelar aceite"
          variant="secondary"
          onPress={handleReleaseWave}
          loading={releaseWave.isPending}
        />
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={styles.listFlex}
      data={lines}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshing={isRefetching}
      onRefresh={refetch}
      ListHeaderComponent={listHeader}
      ListFooterComponent={
        <FactoryButton
          label="Atualizar onda"
          variant="secondary"
          onPress={() => refetch()}
          loading={isRefetching}
        />
      }
      renderItem={({ item }) => {
        const done =
          item.sortStatus === "PICKED" || item.sortStatus === "SORTED";
        const openLine = () => {
          if (done) {
            showInfoAlert(
              item.sortStatus === "PICKED"
                ? "Pick concluído — finalize o packing no painel web."
                : "Linha já concluída.",
            );
            return;
          }
          router.push({
            pathname: "/wave-picking/[lineId]/pick",
            params: { lineId: item.id },
          });
        };

        return (
          <Pressable
            style={[styles.card, done && styles.cardDone]}
            onPress={openLine}
          >
            <View style={styles.cardTop}>
              <ProductThumbnail
                imageUrl={item.product.imageUrl}
                alt={item.product.name}
                size={48}
              />
              <View style={styles.cardTopText}>
                <Text style={styles.sku}>{item.product.sku}</Text>
                <Text style={styles.badge}>{statusLabel(item)}</Text>
              </View>
            </View>
            <CollectionDeadlineRow deadline={item.collectionDeadline} compact />
            <Text style={styles.productName} numberOfLines={2}>
              {item.product.name}
            </Text>
            <Text style={styles.location}>{item.pickLocation.label}</Text>
            <View style={styles.qtyRow}>
              <Text style={styles.qtyMain}>
                {item.quantityPicked} / {item.quantityTotal} un.
              </Text>
            </View>
            {item.remaining > 0 ? (
              <Text style={styles.remaining}>
                Faltam {item.remaining} un. na gôndola
              </Text>
            ) : item.sortStatus === "PICKED" ? (
              <Text style={styles.hint}>
                Pick concluído — packing no painel web
              </Text>
            ) : done ? (
              <Text style={styles.hint}>Linha concluída</Text>
            ) : (
              <Text style={styles.tapLine}>TOQUE PARA SEPARAR</Text>
            )}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  listFlex: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  loadingText: { marginTop: spacing.md, color: theme.textMuted },
  error: {
    color: theme.danger,
    textAlign: "center",
    fontWeight: "700",
    marginBottom: spacing.lg,
  },
  listHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  waveName: {
    fontSize: typography.title,
    fontWeight: "900",
    color: theme.primary,
    textAlign: "center",
  },
  waveMeta: {
    color: theme.textMuted,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  marketplaces: {
    color: theme.textMuted,
    marginTop: spacing.xs,
    textAlign: "center",
    fontSize: typography.caption,
    fontWeight: "600",
  },
  acceptHint: {
    color: theme.textMuted,
    textAlign: "center",
    marginVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    flexGrow: 1,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: theme.primary,
  },
  cardDone: { borderColor: theme.border, opacity: 0.85 },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  cardTopText: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sku: { fontWeight: "900", color: theme.info, fontSize: typography.subtitle },
  badge: {
    fontSize: typography.caption,
    fontWeight: "800",
    color: theme.primary,
    backgroundColor: theme.bg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 8,
  },
  productName: {
    fontSize: typography.body,
    fontWeight: "700",
    color: theme.text,
    marginTop: spacing.xs,
  },
  location: {
    fontFamily: "monospace",
    color: theme.textMuted,
    marginTop: spacing.xs,
  },
  qtyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
    alignItems: "flex-end",
  },
  qtyMain: { fontSize: 28, fontWeight: "900", color: theme.text },
  remaining: { color: theme.warning, fontWeight: "700", marginTop: spacing.sm },
  hint: { color: theme.success, fontWeight: "600", marginTop: spacing.sm },
  tapLine: {
    marginTop: spacing.sm,
    textAlign: "center",
    fontWeight: "800",
    color: theme.primary,
    fontSize: typography.caption,
  },
});
