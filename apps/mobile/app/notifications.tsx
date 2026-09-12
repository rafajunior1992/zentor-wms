import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationDto,
} from "@/lib/notifications-api";
import { showErrorAlert } from "@/lib/app-alert";
import { theme, spacing, typography } from "@/lib/theme";

export default function NotificationsScreen() {
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchNotifications(1);
      setItems(data.notifications);
    } catch (e) {
      setItems([]);
      showErrorAlert(
        e instanceof Error ? e.message : "Erro ao carregar notificações",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Notificações</Text>
        <Pressable
          onPress={async () => {
            try {
              await markAllNotificationsRead();
              await load();
            } catch (e) {
              showErrorAlert(
                e instanceof Error ? e.message : "Erro ao marcar como lidas",
              );
            }
          }}
        >
          <Text style={styles.markAll}>Marcar todas lidas</Text>
        </Pressable>
      </View>
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        ListEmptyComponent={
          <Text style={styles.empty}>Nenhuma notificação</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.item, !item.readAt && styles.unread]}
            disabled={Boolean(item.readAt)}
            onPress={async () => {
              if (item.readAt) return;
              try {
                await markNotificationRead(item.id);
                await load();
              } catch (e) {
                showErrorAlert(
                  e instanceof Error ? e.message : "Erro ao marcar como lida",
                );
              }
            }}
          >
            <Text style={styles.itemTitle}>{item.title}</Text>
            <Text style={styles.itemBody}>{item.body}</Text>
            <Text style={styles.itemDate}>
              {new Date(item.createdAt).toLocaleString("pt-BR")}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, padding: spacing.md },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  title: { fontSize: typography.title, fontWeight: "900", color: theme.text },
  markAll: { color: theme.primary, fontWeight: "700", fontSize: typography.caption },
  empty: { textAlign: "center", color: theme.textMuted, marginTop: spacing.lg },
  item: {
    backgroundColor: theme.surface,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: theme.border,
  },
  unread: { borderColor: theme.primary, backgroundColor: "#F0FDFA" },
  itemTitle: { fontWeight: "800", color: theme.text },
  itemBody: { color: theme.textMuted, marginTop: 4 },
  itemDate: { fontSize: typography.caption, color: theme.textMuted, marginTop: 6 },
});
