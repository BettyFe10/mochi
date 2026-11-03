import SwiftUI

/// Nuova voce o modifica: un solo campo di testo per i casi veloci, il resto a richiesta
struct EditorView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss

    @State private var item: Item
    private let isNew: Bool
    @State private var advanced: Bool
    @State private var hasDate: Bool
    @State private var date: Date
    @State private var hasTime: Bool
    @State private var time: Date
    @State private var kindManual = false
    @State private var remindManual: Bool
    @State private var confirmDelete = false
    @FocusState private var titleFocused: Bool

    private static let hm: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f
    }()

    init(target: EditorTarget) {
        let it = target.item
        _item = State(initialValue: it)
        isNew = target.isNew
        _advanced = State(initialValue: !target.isNew || it.kind == .note)
        _hasDate = State(initialValue: it.dueDate != nil)
        _date = State(initialValue: it.dueDay ?? Date())
        _hasTime = State(initialValue: it.dueTime != nil)
        _time = State(initialValue: it.dueDay.map { DateUtil.at($0, time: it.dueTime ?? "09:00") } ?? DateUtil.at(Date(), time: "09:00"))
        _remindManual = State(initialValue: !target.isNew)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    MascotView().frame(width: 40, height: 38)
                    Text(isNew ? "Cosa ti ricordo?" : "Modifica").font(.rounded(20, .bold)).foregroundStyle(Palette.ink)
                    Spacer()
                }
                .padding(.top, 18)

                kindPicker

                VStack(alignment: .leading, spacing: 6) {
                    TextField(item.kind == .note ? "Titolo dell'appunto" : "Es. \"dentista giovedì alle 17\"", text: $item.title)
                        .font(.rounded(18, .bold))
                        .softField()
                        .focused($titleFocused)
                        .submitLabel(.done)
                        .onSubmit(save)
                        .onChange(of: item.title) { _, v in if v.count > 300 { item.title = String(v.prefix(300)) } }
                    if isNew && item.kind != .note {
                        Text(QuickParser.hint(item.title) ?? "Scrivi come parli: oggi, domani, venerdì, 12/11, alle 15, #lavoro")
                            .font(.rounded(12.5, .semibold)).foregroundStyle(Palette.ink2).padding(.horizontal, 4)
                    }
                }

                HStack(spacing: 8) {
                    ForEach(Area.allCases) { a in
                        Button { item.area = a } label: {
                            Text(a.label).font(.rounded(14.5, .heavy))
                                .frame(maxWidth: .infinity).padding(.vertical, 11)
                                .foregroundStyle(item.area == a ? (a == .lavoro ? Palette.lavDark : Palette.pinkDark) : Palette.ink)
                                .background(item.area == a ? Palette.areaLight(a) : .clear, in: RoundedRectangle(cornerRadius: 16))
                                .overlay(RoundedRectangle(cornerRadius: 16).stroke(item.area == a ? Palette.area(a) : Palette.line, lineWidth: 2))
                        }
                        .buttonStyle(.plain)
                    }
                }

                if !advanced {
                    Button("+ Data, promemoria e note") { openAdvanced() }
                        .font(.rounded(14, .heavy)).foregroundStyle(Palette.pinkDark).buttonStyle(.plain)
                } else {
                    details
                }

                HStack(spacing: 10) {
                    if !isNew {
                        Button { confirmDelete = true } label: {
                            Image(systemName: "trash").font(.system(size: 17, weight: .bold)).foregroundStyle(Palette.late)
                                .padding(.vertical, 15).padding(.horizontal, 18)
                                .background(Color(hex: 0xFFE0E4), in: RoundedRectangle(cornerRadius: 18))
                        }
                        .buttonStyle(.plain)
                    }
                    PinkButton(title: "Annulla", primary: false) { dismiss() }
                    PinkButton(title: "Salva", action: save).keyboardShortcut(.defaultAction)
                }
                .padding(.top, 6)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 24)
        }
        .background(Palette.card)
        .scrollDismissesKeyboard(.interactively)
        .presentationDetents([.medium, .large])
        .presentationCornerRadius(28)
        .macSheetSize()
        .onAppear { if isNew { titleFocused = true } }
        .confirmationDialog("Eliminare questa voce?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Elimina", role: .destructive) {
                let id = item.id
                dismiss()
                Task { @MainActor in await store.delete(id) }
            }
        }
    }

    // MARK: Parti

    private var kindPicker: some View {
        HStack(spacing: 4) {
            ForEach(Kind.allCases) { k in
                Button {
                    item.kind = k; kindManual = true
                    if k == .note { advanced = true }
                } label: {
                    VStack(spacing: 2) {
                        Text(k.emoji).font(.system(size: 19))
                        Text(k.label).font(.rounded(13, .heavy)).lineLimit(1).minimumScaleFactor(0.8)
                    }
                    .foregroundStyle(item.kind == k ? Palette.pinkDark : Palette.ink2)
                    .frame(maxWidth: .infinity).padding(.vertical, 8)
                    .background(item.kind == k ? Palette.card : .clear, in: RoundedRectangle(cornerRadius: 12))
                    .shadow(color: item.kind == k ? .black.opacity(0.06) : .clear, radius: 4, y: 2)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(Palette.bg2, in: RoundedRectangle(cornerRadius: 16))
    }

    @ViewBuilder private var details: some View {
        if item.kind != .note {
            VStack(alignment: .leading, spacing: 10) {
                Toggle("Giorno", isOn: $hasDate.animation())
                if hasDate {
                    DatePicker("Giorno", selection: $date, displayedComponents: .date).labelsHidden()
                    Toggle("Ora", isOn: $hasTime.animation())
                    if hasTime { DatePicker("Ora", selection: $time, displayedComponents: .hourAndMinute).labelsHidden() }
                    HStack {
                        Text("Promemoria 🔔")
                        Spacer()
                        Picker("Promemoria", selection: Binding(
                            get: { RemindOption(rawValue: item.remind ?? "none") ?? .none },
                            set: { item.remind = $0.rawValue; remindManual = true })) {
                            ForEach(RemindOption.allCases) { Text($0.label).tag($0) }
                        }
                        .labelsHidden()
                    }
                }
            }
            .font(.rounded(15, .bold)).foregroundStyle(Palette.ink)
            .tint(Palette.pinkDark)
            .padding(14)
            .background(Palette.bg, in: RoundedRectangle(cornerRadius: 16))
        } else {
            HStack(spacing: 10) {
                ForEach(1...5, id: \.self) { c in
                    Button { item.color = c } label: {
                        RoundedRectangle(cornerRadius: 12).fill(Palette.note(c)).frame(width: 34, height: 34)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(item.color == c ? Palette.ink : .clear, lineWidth: 3))
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
                FilterChip(label: "📌 Fissa", on: item.pinned) { item.pinned.toggle() }
            }
        }
        VStack(alignment: .leading, spacing: 5) {
            Text(item.kind == .note ? "Testo" : "Note").font(.rounded(12.5, .heavy)).foregroundStyle(Palette.ink2).padding(.leading, 4)
            TextEditor(text: Binding(get: { item.body ?? "" }, set: { item.body = String($0.prefix(20000)) }))
                .font(.rounded(15, .regular))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 100)
                .padding(8)
                .background(Palette.bg, in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Palette.line, lineWidth: 2))
        }
    }

    // MARK: Logica

    private func openAdvanced() {
        if isNew && !item.title.isEmpty {
            let p = QuickParser.parse(item.title)
            if let d = p.date, !hasDate { hasDate = true; date = d }
            if let t = p.time, !hasTime { hasTime = true; time = DateUtil.at(Date(), time: t) }
        }
        if item.remind == "auto" { item.remind = autoRemind(kind: item.kind) }
        remindManual = true
        withAnimation { advanced = true }
    }

    private func autoRemind(kind: Kind) -> String {
        guard hasDate else { return "none" }
        if hasTime { return kind == .event ? RemindOption.m30.rawValue : RemindOption.atTime.rawValue }
        return RemindOption.morning.rawValue
    }

    private func save() {
        var it = item
        if isNew && it.kind != .note {
            let p = QuickParser.parse(it.title)
            if !p.title.isEmpty { it.title = p.title }
            if !hasDate, let d = p.date { hasDate = true; date = d }
            if !hasTime, let t = p.time { hasTime = true; time = DateUtil.at(Date(), time: t) }
            if let a = p.area { it.area = a }
            if p.time != nil && it.kind == .todo && !kindManual { it.kind = .event }
        }
        it.title = it.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !it.title.isEmpty else { store.showToast("Scrivi almeno il titolo 🍙"); return }

        if it.kind == .note {
            it.dueDate = nil; it.dueTime = nil; it.remind = "none"
        } else {
            it.dueDate = hasDate ? DateUtil.ymd(date) : nil
            it.dueTime = hasDate && hasTime ? Self.hm.string(from: time) : nil
            if !remindManual || it.remind == "auto" { it.remind = autoRemind(kind: it.kind) }
        }

        let saved = it
        dismiss()
        Task { @MainActor in
            await store.save(saved, isNew: isNew)
            if isNew {
                if saved.kind == .note { store.showToast("Appunto salvato 📝") }
                else if saved.dueDate != nil {
                    store.showToast("Fatto! Te lo ricordo \(DateUtil.niceDate(saved.dueDate).lowercased())\(saved.dueTime.map { " alle \($0)" } ?? "") 🌸")
                    if !(await Reminders.isAuthorized()) { _ = await Reminders.requestPermission(); await store.rescheduleReminders() }
                } else { store.showToast("Salvato! 🍣") }
            }
        }
    }
}
