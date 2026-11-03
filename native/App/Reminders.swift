import Foundation
import UserNotifications

/// Promemoria locali: li programma il dispositivo stesso, senza server.
/// iOS tiene al massimo 64 notifiche in coda, quindi programmo le 60 più vicine.
enum Reminders {
    private static let prefix = "mochi-"

    static func requestPermission() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    static func isAuthorized() async -> Bool {
        let s = await UNUserNotificationCenter.current().notificationSettings()
        return s.authorizationStatus == .authorized || s.authorizationStatus == .provisional
    }

    static func reschedule(_ items: [Item], mascot: Mascot) async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(prefix) })
        guard await isAuthorized() else { return }

        let now = Date()
        let upcoming = items
            .compactMap { it -> (Item, Date)? in
                guard !it.done, it.kind != .note, let d = DateUtil.parseIso(it.remindAt), d > now else { return nil }
                return (it, d)
            }
            .sorted { $0.1 < $1.1 }
            .prefix(60)

        for (it, date) in upcoming {
            let content = UNMutableNotificationContent()
            content.title = "\(it.kind.emoji) \(String(it.title.prefix(120)))"
            let when = it.dueTime.map { "alle \($0)" } ?? DateUtil.niceDate(it.dueDate).lowercased()
            content.body = it.kind == .event
                ? "Appuntamento \(when). \(mascot.name) te lo ricorda 🌸"
                : "Da fare \(when). Ce la fai! 💪"
            content.sound = .default
            let comps = DateUtil.cal.dateComponents([.year, .month, .day, .hour, .minute], from: date)
            let req = UNNotificationRequest(identifier: prefix + it.id, content: content,
                                            trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false))
            try? await center.add(req)
        }
    }

    static func clearAll() {
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
    }
}
