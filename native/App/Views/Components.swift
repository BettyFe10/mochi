import SwiftUI

// MARK: - Mascotte animata

/// Respira, sbatte le palpebre, saltella felice quando completi qualcosa e manda cuoricini se la tocchi
struct MascotView: View {
    @EnvironmentObject var store: Store
    var mascot: Mascot? = nil
    var forceHappy = false
    var tappable = true

    @State private var mood: Mascot.Mood = .normal
    @State private var breathe = false
    @State private var hop = false
    @State private var hearts: [UUID] = []

    private var m: Mascot { mascot ?? store.mascot }

    var body: some View {
        Image(m.image(forceHappy ? .happy : mood))
            .resizable()
            .scaledToFit()
            .scaleEffect(x: breathe ? 0.985 : 1, y: breathe ? 1.025 : 1, anchor: .bottom)
            .offset(y: hop ? -10 : 0)
            .overlay(alignment: .top) {
                ZStack { ForEach(hearts, id: \.self) { _ in FloatingHeart() } }
            }
            .contentShape(Rectangle())
            .onTapGesture {
                guard tappable else { return }
                celebrate()
                let id = UUID()
                hearts.append(id)
                Task { @MainActor in try? await Task.sleep(nanoseconds: 1_200_000_000); hearts.removeAll { $0 == id } }
            }
            .onAppear {
                withAnimation(.easeInOut(duration: 1.7).repeatForever(autoreverses: true)) { breathe = true }
            }
            .task { await blinkLoop() }
            .onChange(of: store.cheerToken) { _, _ in if mascot == nil { celebrate() } }
            .sensoryFeedback(.impact(weight: .light), trigger: hearts.count)
            .accessibilityLabel(m.name)
    }

    private func celebrate() {
        Task { @MainActor in
            mood = .happy
            for _ in 0..<3 {
                withAnimation(.spring(response: 0.22, dampingFraction: 0.5)) { hop = true }
                try? await Task.sleep(nanoseconds: 220_000_000)
                withAnimation(.spring(response: 0.25, dampingFraction: 0.6)) { hop = false }
                try? await Task.sleep(nanoseconds: 240_000_000)
            }
            mood = .normal
        }
    }

    private func blinkLoop() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: UInt64.random(in: 2_800_000_000...5_200_000_000))
            guard mood == .normal else { continue }
            mood = .blink
            try? await Task.sleep(nanoseconds: 140_000_000)
            if mood == .blink { mood = .normal }
        }
    }
}

private struct FloatingHeart: View {
    @State private var go = false
    private let emoji = ["💗", "🌸", "✨", "💕"].randomElement()!
    var body: some View {
        Text(emoji)
            .font(.system(size: 22))
            .offset(y: go ? -60 : 0)
            .scaleEffect(go ? 1.3 : 0.6)
            .opacity(go ? 0 : 1)
            .onAppear { withAnimation(.easeOut(duration: 1.1)) { go = true } }
    }
}

// MARK: - Piccoli elementi

struct Chip: View {
    var text: String
    var fg: Color = Palette.ink2
    var bg: Color = Palette.bg2
    var body: some View {
        Text(text)
            .font(.rounded(12.5, .bold))
            .foregroundStyle(fg)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(bg, in: Capsule())
            .lineLimit(1)
    }
}

struct SectionTitle: View {
    var title: String
    var count: Int? = nil
    var body: some View {
        HStack {
            Text(title).font(.rounded(18, .bold)).foregroundStyle(Palette.ink)
            Spacer()
            if let count {
                Text("\(count)").font(.rounded(12.5, .heavy)).foregroundStyle(Palette.pinkDark)
                    .padding(.horizontal, 10).padding(.vertical, 3)
                    .background(Palette.pinkLight, in: Capsule())
            }
        }
        .padding(.top, 18).padding(.bottom, 6)
    }
}

struct EmptyHint: View {
    var text: String
    var showMascot = false
    var body: some View {
        VStack(spacing: 6) {
            if showMascot { MascotView(tappable: true).frame(width: 90, height: 82) }
            Text(text).font(.rounded(14.5, .regular)).foregroundStyle(Palette.ink2).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, showMascot ? 24 : 10)
    }
}

struct FilterChip: View {
    var label: String
    var on: Bool
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(label).font(.rounded(14, .bold))
                .foregroundStyle(on ? .white : Palette.ink2)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(on ? Palette.pink : Palette.card, in: Capsule())
                .shadow(color: Palette.pinkDark.opacity(0.1), radius: 6, y: 2)
        }
        .buttonStyle(.plain)
    }
}

struct PinkButton: View {
    var title: String
    var primary = true
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.rounded(16, .heavy))
                .frame(maxWidth: .infinity).padding(.vertical, 15)
                .foregroundStyle(primary ? .white : Palette.ink)
                .background {
                    if primary { RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.button) }
                    else { RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.bg2) }
                }
                .shadow(color: primary ? Palette.pinkDark.opacity(0.35) : .clear, radius: 10, y: 6)
        }
        .buttonStyle(.plain)
    }
}

enum FieldKind { case name, username, password, newPassword }

/// Campo di testo arrotondato
struct SoftField: ViewModifier {
    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .font(.rounded(16, .regular))
            .padding(13)
            .background(Palette.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Palette.line, lineWidth: 2))
    }
}

extension View {
    func softField() -> some View { modifier(SoftField()) }

    /// Tastiera email e niente maiuscole automatiche (solo iPhone)
    @ViewBuilder func emailInput() -> some View {
        #if os(iOS)
        self.keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
        #else
        self.autocorrectionDisabled()
        #endif
    }

    /// Suggerimenti di compilazione automatica (solo iPhone: su Mac non servono)
    @ViewBuilder func fieldKind(_ k: FieldKind) -> some View {
        #if os(iOS)
        switch k {
        case .name: self.textContentType(.givenName)
        case .username: self.textContentType(.username)
        case .password: self.textContentType(.password)
        case .newPassword: self.textContentType(.newPassword)
        }
        #else
        self
        #endif
    }

    /// Dimensione minima dei pannelli su Mac
    @ViewBuilder func macSheetSize(_ w: CGFloat = 460, _ h: CGFloat = 620) -> some View {
        #if os(macOS)
        self.frame(minWidth: w, minHeight: h)
        #else
        self
        #endif
    }
}

// MARK: - Riga di una voce

struct ItemRow: View {
    @EnvironmentObject var store: Store
    var item: Item
    var onEdit: (Item) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if item.kind == .event {
                Text("📅").font(.system(size: 14))
                    .frame(width: 26, height: 26)
                    .background(Palette.salmonLight, in: RoundedRectangle(cornerRadius: 9))
            } else {
                Button { Task { @MainActor in await store.toggle(item) } } label: {
                    ZStack {
                        RoundedRectangle(cornerRadius: 9).fill(item.done ? Palette.area(item.area) : Palette.card)
                        RoundedRectangle(cornerRadius: 9).stroke(Palette.area(item.area), lineWidth: 2.5)
                        if item.done { Image(systemName: "checkmark").font(.system(size: 13, weight: .heavy)).foregroundStyle(.white) }
                    }
                    .frame(width: 26, height: 26)
                }
                .buttonStyle(.plain)
                .sensoryFeedback(.success, trigger: item.done)
                .accessibilityLabel(item.done ? "Segna come da fare" : "Completa")
            }
            VStack(alignment: .leading, spacing: 5) {
                Text(item.title).font(.rounded(16, .bold)).foregroundStyle(Palette.ink)
                    .strikethrough(item.done).multilineTextAlignment(.leading)
                chips
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 13).padding(.horizontal, 14)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18).fill(Palette.area(item.area)).frame(width: 5)
        }
        .shadow(color: Palette.pinkDark.opacity(0.12), radius: 10, y: 4)
        .opacity(item.done ? 0.55 : 1)
        .contentShape(Rectangle())
        .onTapGesture { onEdit(item) }
        .animation(.easeInOut(duration: 0.25), value: item.done)
    }

    private var chips: some View {
        HStack(spacing: 6) {
            if item.dueDate != nil {
                let txt = DateUtil.niceDate(item.dueDate) + (item.dueTime.map { " · \($0)" } ?? "")
                Chip(text: (item.isLate ? "⏰ " : "") + txt, fg: item.isLate ? Palette.late : Palette.ink2, bg: item.isLate ? Palette.lateBg : Palette.bg2)
            }
            Chip(text: item.area.label, fg: item.area == .lavoro ? Palette.lavDark : Palette.pinkDark, bg: Palette.areaLight(item.area))
            if item.remindAt != nil && !item.done { Chip(text: "🔔") }
            if !(item.body ?? "").isEmpty { Chip(text: "📝") }
        }
    }
}

// MARK: - Avviso temporaneo

struct ToastView: View {
    var text: String
    var body: some View {
        Text(text).font(.rounded(14, .bold)).foregroundStyle(Palette.bg)
            .padding(.horizontal, 16).padding(.vertical, 11)
            .background(Palette.ink, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .multilineTextAlignment(.center)
            .padding(.horizontal, 24)
            .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}
