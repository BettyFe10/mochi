import SwiftUI

/// Il riassunto del mese con la mascotte
struct RecapView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @State var month: Date

    var body: some View {
        let cal = DateUtil.cal
        let key = DateUtil.monthKey(month)
        let done = store.items.filter { $0.kind == .todo && $0.done && $0.doneDate.map(DateUtil.monthKey) == key }
        let events = store.items.filter { $0.kind == .event && ($0.dueDate?.hasPrefix(key) ?? false) }
        let notes = store.items.filter { $0.kind == .note && DateUtil.monthKey($0.created) == key }
        let all = done + events
        let lav = all.filter { $0.area == .lavoro }.count
        let per = all.count - lav
        let perDay: [Int] = (1...7).map { w in done.filter { $0.doneDate.map { cal.component(.weekday, from: $0) } == w }.count }
        let best = done.isEmpty ? nil : DateUtil.weekdays[perDay.firstIndex(of: perDay.max() ?? 0) ?? 0]
        let total = all.count
        let isCurrent = key == DateUtil.monthKey(Date())
        let say = total == 0 ? "Un mese tranquillo. Anche il riposo conta 🍵"
            : total < 10 ? "Un mese leggero ma pieno di cose belle 🌸"
            : total < 30 ? "Che mese! Hai tenuto tutto sotto controllo 💪"
            : "Mese da campionessa. \(store.mascot.name) ti offre un sushi immaginario 🍣🏆"

        ScrollView {
            VStack(spacing: 14) {
                HStack {
                    arrow("chevron.left") { move(-1) }
                    Spacer()
                    Text("Recap mensile").font(.rounded(15, .semibold)).foregroundStyle(Palette.ink2)
                    Spacer()
                    arrow("chevron.right") { move(1) }.opacity(isCurrent ? 0.3 : 1).disabled(isCurrent)
                }
                .padding(.top, 18)

                VStack(spacing: 6) {
                    MascotView(forceHappy: true).frame(width: 110, height: 100)
                    Text("Il tuo \(DateUtil.months[cal.component(.month, from: month) - 1])\(isCurrent ? " (finora)" : "")")
                        .font(.rounded(24, .bold))
                    Text(say).font(.rounded(15, .regular)).multilineTextAlignment(.center).padding(.bottom, 8)
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 9) {
                        cell("\(done.count)", "cose completate ✅")
                        cell("\(events.count)", "appuntamenti 📅")
                        cell("\(notes.count)", "appunti scritti 📝")
                        cell(best ?? "-", "giorno più produttivo ⭐", small: best != nil)
                    }
                }
                .foregroundStyle(Palette.ink)
                .padding(18)
                .background(LinearGradient(colors: [Color(hex: 0xFFD6E4), Color(hex: 0xFFE8DE), Color(hex: 0xFFF1C2)],
                                           startPoint: .topLeading, endPoint: .bottomTrailing),
                            in: RoundedRectangle(cornerRadius: 26, style: .continuous))

                if total > 0 {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Lavoro e vita").font(.rounded(18, .bold)).foregroundStyle(Palette.ink)
                        GeometryReader { g in
                            HStack(spacing: 0) {
                                Rectangle().fill(Palette.lavDark).frame(width: g.size.width * CGFloat(lav) / CGFloat(max(total, 1)))
                                Rectangle().fill(Palette.pink)
                            }
                        }
                        .frame(height: 12).clipShape(Capsule())
                        HStack {
                            Text("💼 Lavoro \(lav)")
                            Spacer()
                            Text("🌷 Personale \(per)")
                        }
                        .font(.rounded(12.5, .heavy)).foregroundStyle(Palette.ink2)
                    }
                }

                if !done.isEmpty {
                    VStack(alignment: .leading, spacing: 9) {
                        Text("Cose che hai portato a casa").font(.rounded(18, .bold)).foregroundStyle(Palette.ink)
                        ForEach(Array(done.sorted { ($0.doneAt ?? "") > ($1.doneAt ?? "") }.prefix(10))) { it in
                            HStack(spacing: 10) {
                                Image(systemName: "checkmark").font(.system(size: 12, weight: .heavy)).foregroundStyle(.white)
                                    .frame(width: 24, height: 24).background(Palette.area(it.area), in: RoundedRectangle(cornerRadius: 8))
                                Text(it.title).font(.rounded(15, .bold)).foregroundStyle(Palette.ink)
                                Spacer(minLength: 0)
                            }
                            .card(padding: 12)
                        }
                    }
                }

                PinkButton(title: "Grazie \(store.mascot.name) 💗") { dismiss() }.padding(.top, 6)
            }
            .padding(.horizontal, 18).padding(.bottom, 24)
        }
        .background(Palette.bg)
        .presentationCornerRadius(28)
        .macSheetSize(460, 720)
    }

    private func cell(_ value: String, _ label: String, small: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.rounded(small ? 20 : 28, .bold)).foregroundStyle(Palette.pinkDark)
                .lineLimit(1).minimumScaleFactor(0.7).padding(.vertical, small ? 4 : 0)
            Text(label).font(.rounded(12.5, .heavy)).opacity(0.75)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.white.opacity(0.75), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func arrow(_ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 16, weight: .bold)).foregroundStyle(Palette.ink)
                .frame(width: 42, height: 42).background(Palette.card, in: RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }

    private func move(_ n: Int) {
        guard let m = DateUtil.cal.date(byAdding: .month, value: n, to: month), m <= Date() else { return }
        withAnimation { month = m }
    }
}
