import WidgetKit
import SwiftUI

// I widget leggono la copia locale salvata dall'app nel contenitore condiviso (App Group):
// non fanno login e non chiamano il server.

struct DayEntry: TimelineEntry {
    let date: Date
    let custom: Custom
    let late: [Item]
    let today: [Item]
    let next: [Item]
    var todayCount: Int { today.count + late.count }
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> DayEntry {
        DayEntry(date: Date(), custom: Custom(), late: [],
                 today: [Item(kind: .event, title: "Dentista", dueDate: DateUtil.today(), dueTime: "17:00"),
                         Item(kind: .todo, title: "Comprare il latte", dueDate: DateUtil.today())],
                 next: [Item(kind: .todo, title: "Pagare la bolletta", dueDate: DateUtil.ymd(DateUtil.addDays(Date(), 2)))])
    }

    func getSnapshot(in context: Context, completion: @escaping (DayEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : entry(at: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DayEntry>) -> Void) {
        let now = Date()
        // Un aggiornamento ad ogni appuntamento di oggi, a mezzanotte e comunque ogni 30 minuti
        var moments: [Date] = [now]
        let items = SharedCache.loadItems()
        for it in items where it.dueDate == DateUtil.today() && !it.done {
            if let d = it.dueDateTime, d > now { moments.append(d.addingTimeInterval(60)) }
        }
        let midnight = DateUtil.cal.startOfDay(for: DateUtil.addDays(now, 1))
        moments.append(midnight.addingTimeInterval(5))
        let entries = moments.sorted().prefix(12).map { entry(at: $0) }
        completion(Timeline(entries: Array(entries), policy: .after(min(now.addingTimeInterval(1800), midnight))))
    }

    private func entry(at date: Date) -> DayEntry {
        let items = SharedCache.loadItems()
        let day = DateUtil.ymd(date)
        let isLate: (Item) -> Bool = { it in it.kind == .todo && !it.done && (it.dueDateTime.map { $0 < date } ?? false) }
        let late = items.filter(isLate).byDue()
        let today = items.filter { $0.kind != .note && !$0.done && $0.dueDate == day && !isLate($0) }
            .filter { $0.kind != .event || ($0.dueDateTime ?? .distantFuture) >= date.addingTimeInterval(-3600) }
            .byDue()
        let week = (1...6).map { DateUtil.ymd(DateUtil.addDays(date, $0)) }
        let next = Array(items.filter { $0.kind != .note && !$0.done && week.contains($0.dueDate ?? "") }.byDue().prefix(4))
        return DayEntry(date: date, custom: SharedCache.loadCustom(), late: late, today: today, next: next)
    }
}

// MARK: - Viste

struct MochiWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: DayEntry

    var body: some View {
        switch family {
        #if os(iOS)
        case .accessoryCircular: circular
        case .accessoryRectangular: rectangular
        case .accessoryInline: inline
        #endif
        case .systemSmall: small
        default: medium
        }
    }

    private var mascotImage: some View {
        Image(entry.custom.mascot.image(entry.todayCount == 0 ? .happy : .normal)).resizable().scaledToFit()
    }

    private var upcoming: [Item] { entry.late + entry.today + entry.next }

    private var small: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top) {
                mascotImage.frame(width: 48, height: 44)
                Spacer()
                VStack(alignment: .trailing, spacing: 0) {
                    Text("\(entry.todayCount)").font(.rounded(30, .bold)).foregroundStyle(Palette.pinkDark)
                    Text("oggi").font(.rounded(11, .heavy)).foregroundStyle(Palette.ink2)
                }
            }
            Spacer(minLength: 0)
            if let first = upcoming.first {
                Text(first.title).font(.rounded(14, .bold)).foregroundStyle(Palette.ink).lineLimit(2)
                Text(when(first)).font(.rounded(11.5, .semibold)).foregroundStyle(first.isLate ? Palette.late : Palette.ink2)
            } else {
                Text("Giornata libera ✨").font(.rounded(14, .bold)).foregroundStyle(Palette.ink)
            }
        }
    }

    private var medium: some View {
        HStack(spacing: 12) {
            VStack(spacing: 4) {
                mascotImage.frame(width: 70, height: 64)
                Text(entry.custom.appName).font(.rounded(12, .heavy)).foregroundStyle(Palette.pinkDark).lineLimit(1)
                Text("\(entry.todayCount) oggi").font(.rounded(11, .bold)).foregroundStyle(Palette.ink2)
            }
            .frame(width: 84)
            VStack(alignment: .leading, spacing: 6) {
                if upcoming.isEmpty {
                    Spacer()
                    Text("Niente in programma. Goditi la giornata 🌸").font(.rounded(14, .bold)).foregroundStyle(Palette.ink)
                    Spacer()
                } else {
                    ForEach(upcoming.prefix(4)) { it in
                        HStack(spacing: 8) {
                            RoundedRectangle(cornerRadius: 3).fill(Palette.area(it.area)).frame(width: 4, height: 28)
                            VStack(alignment: .leading, spacing: 0) {
                                Text("\(it.kind.emoji) \(it.title)").font(.rounded(13, .bold)).foregroundStyle(Palette.ink).lineLimit(1)
                                Text(when(it)).font(.rounded(11, .semibold)).foregroundStyle(it.isLate ? Palette.late : Palette.ink2)
                            }
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
            Spacer(minLength: 0)
        }
    }

    #if os(iOS)
    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Text("\(entry.todayCount)").font(.rounded(22, .bold))
                Text("oggi").font(.rounded(9, .heavy))
            }
        }
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("\(entry.custom.mascot.name) · \(entry.todayCount) oggi").font(.rounded(12, .heavy)).widgetAccentable()
            if let first = upcoming.first {
                Text(first.title).font(.rounded(14, .bold)).lineLimit(1).privacySensitive()
                Text(when(first)).font(.rounded(12, .regular)).privacySensitive()
            } else {
                Text("Giornata libera ✨").font(.rounded(14, .bold))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var inline: some View {
        if let first = upcoming.first {
            Text("🍣 \(first.title) · \(when(first))").privacySensitive()
        } else {
            Text("🍣 Giornata libera")
        }
    }
    #endif

    private func when(_ it: Item) -> String {
        if it.isLate { return "⏰ Rimasta indietro" }
        return DateUtil.niceDate(it.dueDate) + (it.dueTime.map { " · \($0)" } ?? "")
    }
}

// MARK: - Configurazione

struct MochiWidget: Widget {
    let kind = "MochiWidget"

    private var families: [WidgetFamily] {
        #if os(iOS)
        return [.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline]
        #else
        return [.systemSmall, .systemMedium]
        #endif
    }

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            MochiWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    LinearGradient(colors: [Palette.bg, entry.custom.mascot.gradient[0]], startPoint: .top, endPoint: .bottom)
                }
        }
        .configurationDisplayName("Le mie cose")
        .description("Cosa c'è oggi e nei prossimi giorni, con la tua mascotte.")
        .supportedFamilies(families)
    }
}

@main
struct MochiWidgetBundle: WidgetBundle {
    var body: some Widget { MochiWidget() }
}
