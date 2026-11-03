import SwiftUI

struct EditorTarget: Identifiable {
    let id = UUID()
    var item: Item
    var isNew: Bool
}

struct RecapTarget: Identifiable {
    let id = UUID()
    var month: Date
}

enum Tab: String, CaseIterable, Identifiable {
    case oggi, todo, agenda, appunti
    var id: String { rawValue }
    var label: String {
        switch self { case .oggi: return "Oggi"; case .todo: return "Da fare"; case .agenda: return "Agenda"; case .appunti: return "Appunti" }
    }
    var emoji: String {
        switch self { case .oggi: return "🌸"; case .todo: return "✅"; case .agenda: return "📅"; case .appunti: return "📝" }
    }
}

struct MainView: View {
    @EnvironmentObject var store: Store
    @State private var tab: Tab = .oggi
    @State private var editing: EditorTarget?
    @State private var recap: RecapTarget?
    @State private var showSettings = false
    @State private var todoFilter: Area?
    @State private var noteFilter: Area?
    @State private var agendaDay = DateUtil.today()
    @State private var mottoShift = 0

    var body: some View {
        ZStack(alignment: .bottom) {
            Palette.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                header
                ScrollView {
                    Group {
                        switch tab {
                        case .oggi: TodayView(onEdit: edit)
                        case .todo: TodoView(filter: $todoFilter, onEdit: edit)
                        case .agenda: AgendaView(day: $agendaDay, onEdit: edit, onAdd: { newItem(kind: .event, date: agendaDay) })
                        case .appunti: NotesView(filter: $noteFilter, onEdit: edit)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 120)
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity)
                }
                .refreshable { await store.refresh() }
            }
            tabBar
        }
        .sheet(item: $editing) { t in EditorView(target: t).environmentObject(store) }
        .sheet(item: $recap) { r in RecapView(month: r.month).environmentObject(store) }
        .sheet(isPresented: $showSettings) { SettingsView(onRecap: { showSettings = false; openRecap() }).environmentObject(store) }
        .onAppear(perform: autoRecap)
    }

    // MARK: Intestazione

    private var header: some View {
        HStack(spacing: 12) {
            MascotView().frame(width: 62, height: 58)
            VStack(alignment: .leading, spacing: 2) {
                Text(store.greeting).font(.rounded(23, .bold)).foregroundStyle(Palette.ink)
                    .lineLimit(2).minimumScaleFactor(0.8)
                HStack(spacing: 6) {
                    Text(DateUtil.longDay(Date()))
                    if store.isOnline {
                        Circle().fill(store.synced ? Palette.mint : Color.orange).frame(width: 7, height: 7)
                        Text(store.synced ? "sincronizzato" : "offline")
                    } else {
                        Text("· modalità prova")
                    }
                }
                .font(.rounded(13, .semibold)).foregroundStyle(Palette.ink2)
                // Frase del giorno: toccandola ne esce un'altra e la mascotte festeggia
                Text("💭 " + Frasi.delGiorno(shift: mottoShift))
                    .font(.rounded(13.5, .bold)).italic()
                    .foregroundStyle(Palette.pinkDark)
                    .lineLimit(2)
                    .padding(.top, 3)
                    .id(mottoShift)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                    .onTapGesture { withAnimation(.easeOut(duration: 0.3)) { mottoShift += 1 }; store.cheer() }
                    .accessibilityHint("Tocca per un'altra frase")
            }
            Spacer(minLength: 0)
            roundButton("🎀", label: "Recap del mese") { openRecap() }
            roundButton("⚙️", label: "Impostazioni") { showSettings = true }
        }
        .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 8)
        .frame(maxWidth: 720)
        .frame(maxWidth: .infinity)
    }

    private func roundButton(_ emoji: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(emoji).font(.system(size: 20))
                .frame(width: 42, height: 42)
                .background(Palette.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .shadow(color: Palette.pinkDark.opacity(0.12), radius: 8, y: 3)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    // MARK: Barra in basso

    private var tabBar: some View {
        HStack(spacing: 0) {
            tabButton(.oggi); tabButton(.todo)
            Button { newItem() } label: {
                Image(systemName: "plus").font(.system(size: 28, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 62, height: 62)
                    .background(Palette.button, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .shadow(color: Palette.pinkDark.opacity(0.45), radius: 12, y: 8)
            }
            .buttonStyle(.plain)
            .offset(y: -18)
            .frame(width: 76)
            .keyboardShortcut("n", modifiers: .command)
            .accessibilityLabel("Aggiungi")
            tabButton(.agenda); tabButton(.appunti)
        }
        .frame(height: 68)
        .padding(.horizontal, 6)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: Palette.pinkDark.opacity(0.22), radius: 16, y: 8)
        .frame(maxWidth: 520)
        .padding(.horizontal, 12)
        .padding(.bottom, 10)
    }

    private func tabButton(_ t: Tab) -> some View {
        Button { withAnimation(.easeInOut(duration: 0.2)) { tab = t } } label: {
            VStack(spacing: 2) {
                Text(t.emoji).font(.system(size: 21))
                    .saturation(tab == t ? 1 : 0.4).opacity(tab == t ? 1 : 0.75)
                    .scaleEffect(tab == t ? 1.12 : 1)
                Text(t.label).font(.rounded(11.5, .bold))
                    .foregroundStyle(tab == t ? Palette.pinkDark : Palette.ink2)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Azioni

    private func edit(_ item: Item) { editing = EditorTarget(item: item, isNew: false) }

    private func newItem(kind: Kind? = nil, date: String? = nil) {
        let k = kind ?? (tab == .appunti ? .note : .todo)
        let area: Area = (tab == .todo ? todoFilter : tab == .appunti ? noteFilter : nil) ?? .personale
        editing = EditorTarget(item: Item(kind: k, area: area, dueDate: date ?? (tab == .agenda ? agendaDay : nil)), isNew: true)
    }

    private func openRecap(_ month: Date? = nil) {
        let now = Date()
        let m = month ?? DateUtil.cal.date(from: DateUtil.cal.dateComponents([.year, .month], from: now)) ?? now
        recap = RecapTarget(month: m)
    }

    /// Nella prima settimana del mese mostra da solo il recap del mese prima (una volta)
    private func autoRecap() {
        let cal = DateUtil.cal, now = Date()
        guard cal.component(.day, from: now) <= 7,
              let thisMonth = cal.date(from: cal.dateComponents([.year, .month], from: now)),
              let prev = cal.date(byAdding: .month, value: -1, to: thisMonth) else { return }
        let key = DateUtil.monthKey(prev)
        guard UserDefaults.standard.string(forKey: "mochi.recapSeen") != key else { return }
        let has = store.items.contains { ($0.doneDate.map(DateUtil.monthKey) == key) || ($0.dueDate?.hasPrefix(key) ?? false) }
        guard has else { return }
        UserDefaults.standard.set(key, forKey: "mochi.recapSeen")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { openRecap(prev) }
    }
}

// MARK: - Oggi

struct TodayView: View {
    @EnvironmentObject var store: Store
    var onEdit: (Item) -> Void

    var body: some View {
        let t = DateUtil.today()
        let items = store.items
        let events = items.filter { $0.kind == .event && $0.dueDate == t }.byDue()
        let late = items.filter(\.isLate).byDue()
        let todo = items.filter { $0.kind == .todo && !$0.done && $0.dueDate == t && !$0.isLate }.byDue()
        let noDate = Array(items.filter { $0.kind == .todo && !$0.done && $0.dueDate == nil }.suffix(5).reversed())
        let doneToday = items.filter { $0.kind == .todo && $0.done && $0.doneDate.map(DateUtil.ymd) == t }
        let week = (1...6).map { DateUtil.ymd(DateUtil.addDays(Date(), $0)) }
        let soon = Array(items.filter { !$0.done && $0.kind != .note && week.contains($0.dueDate ?? "") }.byDue().prefix(6))

        VStack(alignment: .leading, spacing: 0) {
            Text(speech(late: late.count, todo: todo.count, events: events.count, done: doneToday.count))
                .font(.rounded(14.5, .regular)).foregroundStyle(Palette.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .card(padding: 13)
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(Palette.pinkLight, lineWidth: 2))
                .padding(.top, 6)

            HStack(spacing: 9) {
                stat(events.count, "appuntamenti")
                stat(todo.count + late.count, "da fare")
                stat(doneToday.count, "fatte oggi")
            }
            .padding(.top, 14)

            if !late.isEmpty { SectionTitle(title: "Rimaste indietro", count: late.count); list(late) }
            SectionTitle(title: "Appuntamenti di oggi")
            if events.isEmpty { EmptyHint(text: "Nessun appuntamento oggi ☁️") } else { list(events) }
            SectionTitle(title: "Da fare oggi")
            if todo.isEmpty { EmptyHint(text: "Niente in scadenza oggi ✨") } else { list(todo) }
            if !noDate.isEmpty { SectionTitle(title: "Quando hai tempo"); list(noDate) }
            if !soon.isEmpty { SectionTitle(title: "Nei prossimi giorni"); list(soon) }
            if !doneToday.isEmpty { SectionTitle(title: "Fatte oggi 🎉"); list(doneToday) }
        }
    }

    private func list(_ items: [Item]) -> some View {
        VStack(spacing: 9) { ForEach(items) { ItemRow(item: $0, onEdit: onEdit) } }
    }

    private func stat(_ n: Int, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text("\(n)").font(.rounded(26, .bold)).foregroundStyle(Palette.pinkDark).contentTransition(.numericText())
            Text(label).font(.rounded(12, .bold)).foregroundStyle(Palette.ink2)
        }
        .frame(maxWidth: .infinity).card(padding: 12)
    }

    private func speech(late: Int, todo: Int, events: Int, done: Int) -> AttributedString {
        let name = store.mascot.name
        var s: String
        if store.items.isEmpty {
            s = "Ciao, sono **\(name)**! Tocca il **+** e scrivi come parli: *\"dentista giovedì alle 17\"*. Al resto penso io 🍣"
        } else if late > 0 {
            s = "Psst... ci sono **\(late)** \(late == 1 ? "cosa rimasta" : "cose rimaste") indietro. Una alla volta, ce la fai 💪"
        } else if done >= 3 {
            s = "Oggi hai già completato **\(done)** cose. Sei una macchina da sushi! 🍱"
        } else if events > 0 || todo > 0 {
            var parts: [String] = []
            if events > 0 { parts.append("**\(events)** \(events == 1 ? "appuntamento" : "appuntamenti")") }
            if todo > 0 { parts.append("**\(todo)** \(todo == 1 ? "cosa da fare" : "cose da fare")") }
            s = "Oggi hai \(parts.joined(separator: " e ")). Ci penso io a ricordartelo 🌸"
        } else {
            s = "Giornata libera! Se ti viene in mente qualcosa, dimmelo e lo tengo io 💭"
        }
        return (try? AttributedString(markdown: s)) ?? AttributedString(s)
    }
}

// MARK: - Da fare

struct TodoView: View {
    @EnvironmentObject var store: Store
    @Binding var filter: Area?
    var onEdit: (Item) -> Void

    var body: some View {
        let list = store.items.filter { $0.kind == .todo && (filter == nil || $0.area == filter) }
        let open = list.filter { !$0.done }.byDue()
        let done = Array(list.filter(\.done).sorted { ($0.doneAt ?? "") > ($1.doneAt ?? "") }.prefix(15))

        VStack(alignment: .leading, spacing: 0) {
            AreaFilter(filter: $filter).padding(.top, 6)
            SectionTitle(title: "Da fare", count: open.count)
            if open.isEmpty { EmptyHint(text: "Tutto fatto! \(store.mascot.name) è fiera di te 🌸", showMascot: true) }
            VStack(spacing: 9) { ForEach(open) { ItemRow(item: $0, onEdit: onEdit) } }
            if !done.isEmpty {
                SectionTitle(title: "Completate")
                VStack(spacing: 9) { ForEach(done) { ItemRow(item: $0, onEdit: onEdit) } }
            }
        }
    }
}

struct AreaFilter: View {
    @Binding var filter: Area?
    var allLabel = "Tutte"
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                FilterChip(label: allLabel, on: filter == nil) { filter = nil }
                FilterChip(label: Area.personale.label, on: filter == .personale) { filter = .personale }
                FilterChip(label: Area.lavoro.label, on: filter == .lavoro) { filter = .lavoro }
            }
            .padding(.vertical, 4)
        }
    }
}

// MARK: - Agenda

struct AgendaView: View {
    @EnvironmentObject var store: Store
    @Binding var day: String
    var onEdit: (Item) -> Void
    var onAdd: () -> Void
    @State private var month: Date = DateUtil.cal.date(from: DateUtil.cal.dateComponents([.year, .month], from: Date())) ?? Date()

    var body: some View {
        let cal = DateUtil.cal
        let byDay = Dictionary(grouping: store.items.filter { $0.dueDate != nil && $0.kind != .note }, by: { $0.dueDate! })
        let offset = (cal.component(.weekday, from: month) + 5) % 7
        let start = DateUtil.addDays(month, -offset)
        let cells: [Date] = (0..<42).map { DateUtil.addDays(start, $0) }
            .enumerated().filter { $0.offset < 35 || cal.isDate($0.element, equalTo: month, toGranularity: .month) }.map(\.element)
        let selected = (byDay[day] ?? []).sorted { ($0.kind == .event ? 0 : 1, $0.dueTime ?? "99") < ($1.kind == .event ? 0 : 1, $1.dueTime ?? "99") }

        VStack(alignment: .leading, spacing: 0) {
            HStack {
                navButton("chevron.left") { move(-1) }
                Spacer()
                Text("\(DateUtil.capitalized(DateUtil.months[cal.component(.month, from: month) - 1])) \(String(cal.component(.year, from: month)))")
                    .font(.rounded(20, .bold)).foregroundStyle(Palette.ink)
                Spacer()
                navButton("chevron.right") { move(1) }
            }
            .padding(.top, 6).padding(.bottom, 10)

            VStack(spacing: 4) {
                HStack { ForEach(["L", "M", "M", "G", "V", "S", "D"].indices, id: \.self) { i in
                    Text(["L", "M", "M", "G", "V", "S", "D"][i]).font(.rounded(11.5, .heavy)).foregroundStyle(Palette.ink2).frame(maxWidth: .infinity)
                } }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 7), spacing: 2) {
                    ForEach(cells, id: \.self) { d in dayCell(d, items: byDay[DateUtil.ymd(d)] ?? []) }
                }
            }
            .card(padding: 10)

            HStack {
                Text(DateUtil.parseYmd(day).map(DateUtil.longDay) ?? "").font(.rounded(18, .bold)).foregroundStyle(Palette.ink)
                Spacer()
                FilterChip(label: "+ Aggiungi", on: false, action: onAdd)
            }
            .padding(.top, 18).padding(.bottom, 8)
            if selected.isEmpty { EmptyHint(text: "Giornata libera 🌤️") }
            VStack(spacing: 9) { ForEach(selected) { ItemRow(item: $0, onEdit: onEdit) } }
        }
    }

    private func dayCell(_ d: Date, items: [Item]) -> some View {
        let s = DateUtil.ymd(d)
        let isSel = s == day, isToday = s == DateUtil.today()
        let inMonth = DateUtil.cal.isDate(d, equalTo: month, toGranularity: .month)
        return Button { withAnimation(.easeInOut(duration: 0.15)) { day = s } } label: {
            VStack(spacing: 3) {
                Text("\(DateUtil.cal.component(.day, from: d))").font(.rounded(15, .bold))
                HStack(spacing: 3) {
                    ForEach(Array(items.prefix(3).enumerated()), id: \.offset) { _, it in
                        Circle().fill(isSel ? .white : (it.area == .lavoro ? Palette.lavDark : Color(hex: 0xFF9E7A))).frame(width: 5, height: 5)
                    }
                }
                .frame(height: 6)
            }
            .foregroundStyle(isSel ? .white : isToday ? Palette.pinkDark : Palette.ink)
            .frame(maxWidth: .infinity).aspectRatio(1, contentMode: .fit)
            .background(isSel ? Palette.pink : isToday ? Palette.pinkLight : .clear, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .opacity(inMonth ? 1 : 0.3)
        }
        .buttonStyle(.plain)
    }

    private func navButton(_ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 16, weight: .bold)).foregroundStyle(Palette.ink)
                .frame(width: 42, height: 42).background(Palette.card, in: RoundedRectangle(cornerRadius: 14))
                .shadow(color: Palette.pinkDark.opacity(0.12), radius: 8, y: 3)
        }
        .buttonStyle(.plain)
    }

    private func move(_ n: Int) {
        if let m = DateUtil.cal.date(byAdding: .month, value: n, to: month) { withAnimation { month = m } }
    }
}

// MARK: - Appunti

struct NotesView: View {
    @EnvironmentObject var store: Store
    @Binding var filter: Area?
    var onEdit: (Item) -> Void

    var body: some View {
        let notes = store.items.filter { $0.kind == .note && (filter == nil || $0.area == filter) }
            .sorted { ($0.pinned ? 1 : 0, $0.updatedAt) > ($1.pinned ? 1 : 0, $1.updatedAt) }
        // Due colonne "a muratura", come i post-it
        let left = notes.enumerated().filter { $0.offset % 2 == 0 }.map(\.element)
        let right = notes.enumerated().filter { $0.offset % 2 == 1 }.map(\.element)

        VStack(alignment: .leading, spacing: 0) {
            AreaFilter(filter: $filter, allLabel: "Tutti").padding(.top, 6).padding(.bottom, 10)
            if notes.isEmpty {
                EmptyHint(text: "Nessun appunto. Idee, liste della spesa, la password del wifi della nonna... 📝", showMascot: true)
            } else {
                HStack(alignment: .top, spacing: 10) {
                    VStack(spacing: 10) { ForEach(left) { note($0) } }
                    VStack(spacing: 10) { ForEach(right) { note($0) } }
                }
            }
        }
    }

    private func note(_ n: Item) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                Text(n.title).font(.rounded(16, .bold))
                Spacer(minLength: 0)
                if n.pinned { Text("📌").font(.system(size: 13)) }
            }
            if let b = n.body, !b.isEmpty { Text(b).font(.rounded(14, .regular)).lineLimit(12) }
            Text("\(n.area == .lavoro ? "💼" : "🌷") \(DateUtil.niceDate(DateUtil.ymd(n.updated)))")
                .font(.rounded(11.5, .bold)).opacity(0.6).padding(.top, 2)
        }
        .foregroundStyle(Palette.ink)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Palette.note(n.color), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: Palette.pinkDark.opacity(0.12), radius: 10, y: 4)
        .onTapGesture { onEdit(n) }
    }
}
