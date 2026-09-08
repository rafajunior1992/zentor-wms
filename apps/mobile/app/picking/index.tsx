import { useEffect, useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { OrderStatus } from "@wms/shared";
import {
  useCreateWaveFromOrders,
  useMobileConfig,
  useOrderQueue,
} from "@/hooks/usePicking";
import { FactoryButton } from "@/components/FactoryButton";
import { CollectionDeadlineRow } from "@/components/CollectionDeadlineRow";
import { WavePickingPanel } from "@/components/WavePickingPanel";
import { BackButton } from "@/components/BackButton";
import { showErrorAlert, showInfoAlert } from "@/lib/app-alert";
import { theme, spacing, typography } from "@/lib/theme";
import {
  api,
  ApiError,
  type PickingIssueDetail,
  type ProblemOrder,
  type ProblemWave,
  type ProblemWaveOrder,
  type ProximityGroupDto,
  type QueueOrder,
} from "@/lib/api";

type Tab = "wave" | "orders" | "problems";

export default function PickingHubScreen() {
  const [tab, setTab] = useState<Tab>("wave");
  const { data: queueData, isLoading, error, refetch, isRefetching } =
    useOrderQueue();
  const data = queueData?.orders;
  const proximityGroups = queueData?.proximityGroups ?? [];

  const problemOrders = useQuery({
    queryKey: ["problem-orders"],
    queryFn: () => api.getProblemOrders(),
    enabled: tab === "problems",
  });

  const problemWaves = useQuery({
    queryKey: ["problem-waves"],
    queryFn: () => api.getProblemWaves(),
    enabled: tab === "problems",
  });

  useEffect(() => {
    if (tab !== "orders" || !error) return;
    const msg =
      error instanceof Error ? error.message : "Erro ao carregar fila";
    showErrorAlert(msg);
  }, [tab, error]);

  useEffect(() => {
    if (tab !== "problems") return;
    if (problemOrders.error) {
      const msg =
        problemOrders.error instanceof Error
          ? problemOrders.error.message
          : "Erro ao carregar pedidos com problema";
      showErrorAlert(msg);
    }
  }, [tab, problemOrders.error]);

  const handleOrderPress = async (order: QueueOrder | ProblemOrder) => {
    try {
      try {
        await api.acceptOrder(order.id);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          showErrorAlert(e.message);
          void refetch();
          void problemOrders.refetch();
          return;
        }
        throw e;
      }
      void refetch();

      const session = await api.getPickingSession(order.id).catch(() => null);
      if (session?.order.basket) {
        router.push({
          pathname: "/picking/[orderId]/pick",
          params: {
            orderId: order.id,
            basketCode: session.order.basket.code,
          },
        });
        return;
      }
      router.push(`/picking/${order.id}/basket`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Erro ao abrir pedido";
      showErrorAlert(msg);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "wave", label: "Ondas" },
    { id: "orders", label: "Pedidos" },
    { id: "problems", label: "Problemas" },
  ];

  const problemsLoading =
    problemOrders.isLoading || problemWaves.isLoading;

  const refreshProblems = () => {
    void problemOrders.refetch();
    void problemWaves.refetch();
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
      <View style={styles.headerFixed}>
        <View style={styles.topBar}>
          <BackButton color={theme.text} />
          <Text style={styles.hubTitle}>Separação</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabScroll}
          contentContainerStyle={styles.tabRow}
        >
          {tabs.map((t) => (
            <Pressable
              key={t.id}
              style={[styles.tab, tab === t.id && styles.tabActive]}
              onPress={() => setTab(t.id)}
            >
              <Text
                style={[styles.tabText, tab === t.id && styles.tabTextActive]}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={styles.body}>
        {tab === "wave" ? (
          <WavePickingPanel />
        ) : tab === "problems" ? (
          <ProblemsPanel
            loading={problemsLoading}
            orders={problemOrders.data?.orders ?? []}
            waves={problemWaves.data?.waves ?? []}
            onPressOrder={handleOrderPress}
            onRefresh={refreshProblems}
            refreshing={
              problemOrders.isRefetching || problemWaves.isRefetching
            }
          />
        ) : isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={styles.loadingText}>Carregando fila...</Text>
          </View>
        ) : (
          <OrdersQueuePanel
            orders={data ?? []}
            proximityGroups={proximityGroups}
            refreshing={isRefetching}
            onRefresh={refetch}
            onPressOrder={handleOrderPress}
            onGoToWaves={() => setTab("wave")}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function OrdersQueuePanel({
  orders,
  proximityGroups,
  refreshing,
  onRefresh,
  onPressOrder,
  onGoToWaves,
}: {
  orders: QueueOrder[];
  proximityGroups: ProximityGroupDto[];
  refreshing: boolean;
  onRefresh: () => void;
  onPressOrder: (o: QueueOrder) => void;
  onGoToWaves: () => void;
}) {
  const { data: config } = useMobileConfig();
  const createWave = useCreateWaveFromOrders();

  const handleAcceptBatch = async (group: ProximityGroupDto) => {
    const firstId = group.orderIds[0];
    if (!firstId) return;
    router.push(`/picking/${firstId}/basket`);
  };

  const runCreateWave = async (
    orderIds: string[],
    appendToWaveId?: string,
  ) => {
    try {
      const result = await createWave.mutateAsync({ orderIds, appendToWaveId });
      await onRefresh();
      showInfoAlert(
        `Onda criada com ${result.orderCount} pedido(s) e ${result.lineCount} linha(s). Aceite na aba Ondas.`,
      );
      onGoToWaves();
    } catch (e) {
      showErrorAlert(
        e instanceof ApiError ? e.message : "Erro ao criar onda",
      );
    }
  };

  const handleCreateWave = async (group: ProximityGroupDto) => {
    try {
      const { wave: openWave } = await api.getOpenWave();
      if (openWave) {
        Alert.alert(
          "Onda aberta",
          `Adicionar ${group.orderIds.length} pedido(s) à onda "${openWave.name}" ou criar nova onda?`,
          [
            { text: "Cancelar", style: "cancel" },
            {
              text: "Criar nova",
              onPress: () => void runCreateWave(group.orderIds),
            },
            {
              text: "Adicionar à atual",
              onPress: () =>
                void runCreateWave(group.orderIds, openWave.id),
            },
          ],
        );
        return;
      }
      await runCreateWave(group.orderIds);
    } catch (e) {
      showErrorAlert(
        e instanceof ApiError ? e.message : "Erro ao verificar ondas",
      );
    }
  };

  const header = (
    <View style={styles.listHeader}>
      <Text style={styles.count}>{orders.length} pedido(s) na fila</Text>
      <Text style={styles.waveHint}>
        Pedidos em onda liberada aparecem na aba Ondas.
      </Text>
      {proximityGroups.length > 0 ? (
        <View style={styles.recBlock}>
          <Text style={styles.recTitle}>Recomendado — pedidos próximos</Text>
          {proximityGroups.slice(0, 5).map((g) => (
            <View key={g.id} style={styles.recCard}>
              <Text style={styles.recMeta}>
                {g.orders.length} pedido(s) · {g.routeHint}
              </Text>
              <Text style={styles.recOrders} numberOfLines={2}>
                {g.orders.map((o) => o.erpOrderId).join(" · ")}
              </Text>
              <View style={styles.recActions}>
                {config?.waveEnabled ? (
                  <FactoryButton
                    label="Criar onda com este grupo"
                    onPress={() => void handleCreateWave(g)}
                    loading={createWave.isPending}
                  />
                ) : null}
                <FactoryButton
                  label="Abrir primeiro pedido"
                  variant="secondary"
                  onPress={() => void handleAcceptBatch(g)}
                />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={styles.listFlex}
      data={orders}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListHeaderComponent={header}
      ListFooterComponent={
        <FactoryButton
          label="Atualizar"
          variant="secondary"
          onPress={onRefresh}
          loading={refreshing}
        />
      }
      ListEmptyComponent={
        <Text style={styles.empty}>
          Nenhum pedido avulso na fila. Verifique a aba Ondas se houver ondas
          liberadas.
        </Text>
      }
      renderItem={({ item }) => (
        <OrderCard item={item} onPress={() => onPressOrder(item)} />
      )}
    />
  );
}

function waveOrderToProblem(
  o: ProblemWaveOrder,
  waveName: string,
): ProblemOrder {
  return {
    id: o.id,
    erpOrderId: o.erpOrderId,
    status: o.status as OrderStatus,
    priority: 0,
    customerName: o.customerName,
    marketplaceLabel: o.marketplaceLabel,
    collectionDeadline: null,
    returnedFromPacking: o.returnedFromPacking,
    pausedIssue: o.pausedIssue,
    issueSummary: o.issueSummary,
    issueDetail: o.issueDetail,
    waveName,
    itemCount: 0,
    totalUnits: 0,
    qtyPicked: 0,
  };
}

function ProblemsPanel({
  loading,
  orders,
  waves,
  onPressOrder,
  onRefresh,
  refreshing,
}: {
  loading: boolean;
  orders: ProblemOrder[];
  waves: ProblemWave[];
  onPressOrder: (o: ProblemOrder) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  const header = (
    <View style={styles.listHeader}>
      {waves.length > 0 ? (
        <View style={styles.problemsSection}>
          <Text style={styles.sectionTitle}>
            {waves.length} onda(s) com problema
          </Text>
          {waves.map((wave) => (
            <View key={wave.id} style={styles.waveSection}>
              <Text style={styles.waveSectionTitle}>{wave.name}</Text>
              {wave.problemOrders.map((o) => (
                <OrderCard
                  key={o.id}
                  item={waveOrderToProblem(o, wave.name)}
                  problem
                  resume
                  inWave
                  onPress={() => onPressOrder(waveOrderToProblem(o, wave.name))}
                />
              ))}
            </View>
          ))}
        </View>
      ) : null}
      <Text style={styles.sectionTitle}>
        {orders.length} pedido(s) com problema
      </Text>
    </View>
  );

  return (
    <FlatList
      style={styles.listFlex}
      data={orders}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListHeaderComponent={header}
      ListEmptyComponent={
        waves.length === 0 ? (
          <Text style={styles.empty}>Nenhum pedido com problema</Text>
        ) : null
      }
      renderItem={({ item }) => (
        <OrderCard
          item={item}
          problem
          resume
          onPress={() => onPressOrder(item)}
        />
      )}
      ListFooterComponent={
        <FactoryButton
          label="Atualizar"
          variant="secondary"
          onPress={onRefresh}
          loading={refreshing}
        />
      }
    />
  );
}

function PickingIssueBlock({ detail }: { detail: PickingIssueDetail }) {
  const title =
    detail.source === "PACKING"
      ? "Problema no packing"
      : "Problema na separação";
  return (
    <View style={styles.issueBlock}>
      <Text style={styles.issueBlockTitle}>{title}</Text>
      <Text style={styles.issueBlockLine}>
        <Text style={styles.issueBlockLabel}>Tipo: </Text>
        {detail.typeLabel}
      </Text>
      {detail.sku ? (
        <Text style={styles.issueBlockLine}>
          <Text style={styles.issueBlockLabel}>SKU: </Text>
          {detail.sku}
          {detail.productName ? ` — ${detail.productName}` : ""}
        </Text>
      ) : null}
      {detail.quantity > 0 ? (
        <Text style={styles.issueBlockLine}>
          <Text style={styles.issueBlockLabel}>Qtd.: </Text>
          {detail.quantity} un.
        </Text>
      ) : null}
      {detail.description ? (
        <Text style={styles.issueBlockDesc}>{detail.description}</Text>
      ) : null}
    </View>
  );
}

function OrderCard({
  item,
  onPress,
  problem,
  resume,
  inWave,
}: {
  item: QueueOrder | ProblemOrder;
  onPress: () => void;
  problem?: boolean;
  resume?: boolean;
  inWave?: boolean;
}) {
  const returned =
    "returnedFromPacking" in item && item.returnedFromPacking;
  const resuming =
    "resumingPicking" in item && Boolean(item.resumingPicking);
  const paused = "pausedIssue" in item && item.pausedIssue;
  const issueDetail =
    "issueDetail" in item ? item.issueDetail : null;
  const waveName = "waveName" in item ? item.waveName : null;
  const itemCount = item.itemCount ?? 0;
  const totalUnits = item.totalUnits ?? 0;
  const qtyPicked =
    "qtyPicked" in item ? (item as ProblemOrder).qtyPicked : 0;

  return (
    <Pressable
      style={[
        styles.card,
        (returned || paused || problem) && styles.cardReturned,
      ]}
      onPress={onPress}
    >
      {returned ? (
        <View style={styles.returnBadge}>
          <Text style={styles.returnBadgeText}>RETORNO SEPARAÇÃO</Text>
        </View>
      ) : null}
      {resuming ? (
        <View style={[styles.returnBadge, { backgroundColor: theme.warning }]}>
          <Text style={styles.returnBadgeText}>EM ANDAMENTO</Text>
        </View>
      ) : null}
      {paused ? (
        <View style={[styles.returnBadge, { backgroundColor: theme.danger }]}>
          <Text style={styles.returnBadgeText}>PAUSADO</Text>
        </View>
      ) : null}
      {inWave || waveName ? (
        <View style={[styles.returnBadge, { backgroundColor: theme.info }]}>
          <Text style={styles.returnBadgeText}>
            {waveName ? `ONDA ${waveName}` : "EM ONDA"}
          </Text>
        </View>
      ) : null}
      <Text style={styles.erp}>{item.erpOrderId}</Text>
      {"routeHint" in item && item.routeHint ? (
        <Text style={styles.routeHint}>{item.routeHint}</Text>
      ) : null}
      {"proximityNeighborCount" in item &&
      (item.proximityNeighborCount ?? 0) > 0 ? (
        <Text style={styles.proxBadge}>
          Próximo de {item.proximityNeighborCount} outro(s)
        </Text>
      ) : null}
      {item.marketplaceLabel ? (
        <Text style={styles.marketplace}>{item.marketplaceLabel}</Text>
      ) : null}
      <CollectionDeadlineRow deadline={item.collectionDeadline} />
      {"customerName" in item && item.customerName ? (
        <Text style={styles.customer}>{item.customerName}</Text>
      ) : null}
      {issueDetail ? <PickingIssueBlock detail={issueDetail} /> : null}
      <View style={styles.meta}>
        <Text style={styles.metaText}>
          {problem && totalUnits > 0
            ? `Separado ${qtyPicked}/${totalUnits} un.`
            : itemCount > 0
              ? `${itemCount} itens · ${totalUnits} un.`
              : "Toque para continuar"}
        </Text>
        {item.priority > 0 ? (
          <Text style={styles.priority}>PRIORIDADE {item.priority}</Text>
        ) : null}
      </View>
      <Text style={styles.tapHint}>
        {resume || problem || returned || paused || resuming
          ? "TOQUE PARA CONTINUAR"
          : "TOQUE PARA INICIAR"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  headerFixed: {
    flexGrow: 0,
    flexShrink: 0,
  },
  topBar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  hubTitle: {
    fontSize: typography.title,
    fontWeight: "900",
    color: theme.text,
  },
  tabScroll: {
    flexGrow: 0,
    maxHeight: 48,
  },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    backgroundColor: theme.surface,
    borderWidth: 2,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  tabActive: {
    borderColor: theme.primary,
    backgroundColor: theme.primary,
  },
  tabText: {
    fontWeight: "800",
    color: theme.text,
    fontSize: 15,
  },
  tabTextActive: { color: "#fff" },
  body: {
    flex: 1,
    minHeight: 0,
  },
  listFlex: {
    flex: 1,
  },
  listHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  problemsSection: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontWeight: "800",
    fontSize: typography.body,
    color: theme.text,
  },
  waveHint: {
    fontSize: typography.caption,
    color: theme.textMuted,
    fontWeight: "600",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
  },
  loadingText: { color: theme.textMuted, fontSize: typography.body },
  count: {
    fontWeight: "800",
    fontSize: typography.body,
    color: theme.text,
  },
  recBlock: { gap: spacing.xs },
  recTitle: {
    fontWeight: "800",
    fontSize: typography.caption,
    color: theme.primary,
  },
  recCard: {
    backgroundColor: "#ecfdf5",
    borderRadius: 10,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: "#99f6e4",
  },
  recMeta: { fontWeight: "700", fontSize: typography.caption },
  recOrders: {
    marginTop: 4,
    fontSize: typography.caption,
    color: theme.textMuted,
  },
  recActions: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  routeHint: {
    marginTop: 2,
    fontSize: typography.caption,
    color: theme.primary,
    fontWeight: "600",
  },
  proxBadge: {
    marginTop: 2,
    fontSize: typography.caption,
    color: "#0f766e",
    fontWeight: "700",
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    flexGrow: 1,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: theme.border,
  },
  cardReturned: {
    borderColor: "#f59e0b",
    backgroundColor: "#fffbeb",
  },
  returnBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#f59e0b",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: spacing.xs,
  },
  returnBadgeText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: typography.caption,
  },
  issueBlock: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 8,
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#fdba74",
    gap: 4,
  },
  issueBlockTitle: {
    fontWeight: "900",
    fontSize: typography.caption,
    color: "#9a3412",
  },
  issueBlockLine: {
    fontSize: typography.caption,
    color: "#78350f",
  },
  issueBlockLabel: { fontWeight: "800" },
  issueBlockDesc: {
    marginTop: 2,
    fontSize: typography.caption,
    color: "#92400e",
    fontStyle: "italic",
  },
  erp: {
    fontSize: typography.hero,
    fontWeight: "900",
    color: theme.text,
  },
  customer: { color: theme.textMuted, marginTop: 4 },
  marketplace: { color: theme.info, fontWeight: "700", marginTop: 2 },
  meta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  metaText: { color: theme.textMuted, fontSize: typography.caption },
  priority: {
    color: theme.danger,
    fontWeight: "900",
    fontSize: typography.caption,
  },
  tapHint: {
    marginTop: spacing.sm,
    textAlign: "center",
    fontWeight: "800",
    color: theme.primary,
    fontSize: typography.caption,
  },
  empty: { textAlign: "center", color: theme.textMuted, marginTop: spacing.lg },
  waveSection: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  waveSectionTitle: {
    fontWeight: "900",
    fontSize: typography.subtitle,
    color: theme.text,
    marginBottom: spacing.xs,
  },
});
